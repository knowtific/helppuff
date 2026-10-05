import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LATEST_MIGRATION, MIGRATIONS, migrate, type SqlRunner } from '../src/db/migrations.js';

/** D1 is SQLite: the statements under test are the ones production runs. */
function sqlite(): { db: DatabaseSync; run: SqlRunner } {
  const db = new DatabaseSync(':memory:');
  const run: SqlRunner = async (sql, params = []) => db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
  return { db, run };
}

const columns = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('migrate', () => {
  it('brings an empty database to the latest version', async () => {
    const { db, run } = sqlite();
    expect(await migrate(run)).toEqual(MIGRATIONS.map((m) => m.id));
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all() as { name: string }[]).map((t) => t.name);
    for (const table of ['conversations', 'messages', 'leads', 'pages', 'chunks', 'chunks_fts', 'site_facts', 'crawl_runs', 'usage_daily', 'admin_tokens']) {
      expect(tables).toContain(table);
    }
    expect(columns(db, 'messages')).toEqual(expect.arrayContaining(['sources', 'feedback', 'tokens_in', 'tokens_out']));
  });

  it('does nothing the second time', async () => {
    const { run } = sqlite();
    await migrate(run);
    expect(await migrate(run)).toEqual([]);
    expect(await run('SELECT max(id) AS id FROM _migrations')).toEqual([{ id: LATEST_MIGRATION }]);
  });

  it('merges leads recorded twice for one email into the oldest', async () => {
    const { db, run } = sqlite();
    // A database from before contacts: everything up to 2, without the unique index.
    await migrate(run);
    db.exec('DROP INDEX leads_site_email');
    db.exec('DELETE FROM _migrations WHERE id >= 3');
    const lead = db.prepare(
      "INSERT INTO leads (id, site_id, conversation_id, name, email, phone, source, status, created_at, updated_at) VALUES (?, 's', ?, ?, ?, ?, 'form', ?, ?, ?)",
    );
    lead.run('a', 'c1', 'Ada', 'ada@example.com', null, 'contacted', 1, 1);
    lead.run('b', 'c2', null, 'ADA@example.com ', '0412', 'new', 2, 5);
    lead.run('c', 'c3', 'Bo', null, '0499', 'new', 3, 3);
    const conversation = db.prepare("INSERT INTO conversations (id, site_id, started_at, last_at, lead_id) VALUES (?, 's', 0, 0, ?)");
    for (const [id, leadId] of [['c1', 'a'], ['c2', 'b'], ['c3', 'c']]) conversation.run(id!, leadId!);

    expect(await migrate(run)).toEqual(MIGRATIONS.filter((m) => m.id >= 3).map((m) => m.id));
    expect(db.prepare('SELECT id, name, email, phone, status, updated_at FROM leads ORDER BY id').all()).toEqual([
      { id: 'a', name: 'Ada', email: 'ada@example.com', phone: '0412', status: 'contacted', updated_at: 5 },
      { id: 'c', name: 'Bo', email: null, phone: '0499', status: 'new', updated_at: 3 },
    ]);
    expect(db.prepare('SELECT id, lead_id FROM conversations ORDER BY id').all()).toEqual([
      { id: 'c1', lead_id: 'a' },
      { id: 'c2', lead_id: 'a' },
      { id: 'c3', lead_id: 'c' },
    ]);
    expect(() => lead.run('d', 'c4', null, 'ada@example.com', null, 'new', 9, 9)).toThrow(/UNIQUE/);
  });

  it('upgrades a database created before migrations existed', async () => {
    const { db, run } = sqlite();
    for (const sql of MIGRATIONS[0]!.statements) db.exec(sql);
    db.prepare("INSERT INTO messages (id, conversation_id, role, type, text, ts) VALUES ('m1', 'c1', 'user', 'text', 'hi', 1)").run();
    await migrate(run);
    expect(db.prepare("SELECT text, feedback FROM messages WHERE id = 'm1'").get()).toEqual({ text: 'hi', feedback: null });
  });

  it('survives a race: a migration half-applied by another isolate', async () => {
    const { db, run } = sqlite();
    await migrate(run);
    // The other isolate ran every statement but had not written the ledger yet.
    db.exec('DELETE FROM _migrations WHERE id = 2');
    expect(await migrate(run)).toEqual([2]);
  });

  it('keeps the full-text index in step with chunks', async () => {
    const { db, run } = sqlite();
    await migrate(run);
    const insert = db.prepare(
      'INSERT INTO chunks (id, site_id, page_id, url, title, heading_path, ordinal, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('a', 's', 'p', 'https://x.test/hot-water', 'Hot water', 'Services › Hot water', 0, 'We repair Rinnai heaters');
    insert.run('b', 's', 'p', 'https://x.test/contact', 'Contact', 'Contact', 0, 'Call us on 0400 000 000');
    const match = (q: string) =>
      (db.prepare('SELECT c.id FROM chunks_fts f JOIN chunks c ON c.rowid = f.rowid WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts)').all(q) as {
        id: string;
      }[]).map((r) => r.id);

    expect(match('rinnai')).toEqual(['a']);
    expect(match('repairing')).toEqual(['a']); // porter stemming
    db.prepare("UPDATE chunks SET content = 'Gas fitting only' WHERE id = 'a'").run();
    expect(match('rinnai')).toEqual([]);
    db.prepare("DELETE FROM chunks WHERE id = 'b'").run();
    expect(match('call')).toEqual([]);
  });

  it('fails loudly on a real error', async () => {
    const run: SqlRunner = async (sql) => {
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS pages')) throw new Error('disk full');
      return [];
    };
    await expect(migrate(run)).rejects.toThrow('disk full');
  });
});
