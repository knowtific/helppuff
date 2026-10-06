/**
 * The D1 schema, as numbered migrations.
 *
 * Applied in two places that must agree: `helppuff deploy` (through the
 * Cloudflare REST API, before the new Worker serves anything) and the Worker
 * itself, once per isolate on first use, so a Worker never writes to a table
 * that does not exist.
 *
 * Rules for adding one — they are what keeps `helppuff upgrade` safe and a
 * rollback possible:
 *  - Append; never edit a migration that has shipped.
 *  - Additive only: new tables, new columns (nullable or with a default), new
 *    indexes, and data backfills. The previous release must still run on the
 *    upgraded database, because a rollback is just deploying it again.
 *  - Removing or renaming takes two releases (expand, then contract): the
 *    first stops using the old column or table and copies what it needs; a
 *    later major release may drop it, saying so in the changelog.
 *  - A change too big for SQL (re-embedding, reshaping KV config) is not a
 *    migration: it is a job the deploy starts (see the embedding-model check
 *    in the CLI's deploy) or a reader that accepts both shapes
 *    (`upgradeSettings`, the connectors' retired option keys).
 *  - Every statement must be safe to run twice (`IF NOT EXISTS`), because two
 *    isolates can race the same migration. The one exception SQLite forces on
 *    us, `ALTER TABLE … ADD COLUMN`, is tolerated by the runner when the
 *    column is already there.
 *  - No `WITHOUT ROWID` on `chunks`: `chunks_fts` indexes it by rowid.
 */

export type Migration = { id: number; name: string; statements: readonly string[] };

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'dashboard',
    // The schema from before migrations existed. Every statement was already
    // `IF NOT EXISTS`, so existing databases take this one as a no-op.
    statements: [
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        last_at INTEGER NOT NULL,
        page_url TEXT,
        page_title TEXT,
        referrer TEXT,
        utm TEXT,
        locale TEXT,
        country TEXT,
        first_message TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        lead_id TEXT,
        summary TEXT,
        intent TEXT,
        summarized_at INTEGER
      )`,
      'CREATE INDEX IF NOT EXISTS conversations_site_last ON conversations (site_id, last_at DESC)',
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        type TEXT NOT NULL,
        text TEXT,
        payload TEXT,
        ts INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, ts)',
      `CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        conversation_id TEXT,
        name TEXT,
        email TEXT,
        phone TEXT,
        fields TEXT,
        source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS leads_site_created ON leads (site_id, created_at DESC)',
      'CREATE UNIQUE INDEX IF NOT EXISTS leads_conversation ON leads (conversation_id)',
      `CREATE TABLE IF NOT EXISTS admins (
        email TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        name TEXT,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      )`,
      // Every published system prompt, append-only. A restore is a new version
      // carrying an old text, so history never loses anything. The primary key
      // is also the lock: two publishes racing for the same number cannot both win.
      `CREATE TABLE IF NOT EXISTS prompt_versions (
        site_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        text TEXT NOT NULL,
        hash TEXT NOT NULL,
        source TEXT NOT NULL,
        author TEXT,
        note TEXT,
        restored_from INTEGER,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (site_id, version)
      )`,
    ],
  },
  {
    id: 2,
    name: 'knowledge',
    statements: [
      // One row per URL we know about: discovered, selected, crawled or not.
      `CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        url TEXT NOT NULL,
        final_url TEXT,
        title TEXT,
        category TEXT,
        status TEXT NOT NULL DEFAULT 'discovered',
        http_status INTEGER,
        error TEXT,
        content_hash TEXT,
        selected INTEGER NOT NULL DEFAULT 1,
        source TEXT,
        lastmod TEXT,
        run_id TEXT,
        crawled_at INTEGER,
        UNIQUE (site_id, url)
      )`,
      'CREATE INDEX IF NOT EXISTS pages_site_status ON pages (site_id, status)',
      // `content` is what the reader sees; `context` is the heading/page prefix
      // that is embedded with it but never shown.
      `CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        heading_path TEXT,
        category TEXT,
        ordinal INTEGER NOT NULL,
        content TEXT NOT NULL,
        context TEXT,
        token_estimate INTEGER
      )`,
      'CREATE INDEX IF NOT EXISTS chunks_page ON chunks (site_id, page_id)',
      `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content, title, heading_path,
        content='chunks', content_rowid='rowid', tokenize='porter unicode61'
      )`,
      `CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts (rowid, content, title, heading_path) VALUES (new.rowid, new.content, new.title, new.heading_path);
      END`,
      `CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts (chunks_fts, rowid, content, title, heading_path) VALUES ('delete', old.rowid, old.content, old.title, old.heading_path);
      END`,
      `CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts (chunks_fts, rowid, content, title, heading_path) VALUES ('delete', old.rowid, old.content, old.title, old.heading_path);
        INSERT INTO chunks_fts (rowid, content, title, heading_path) VALUES (new.rowid, new.content, new.title, new.heading_path);
      END`,
      // Phone, email, hours… extracted from the site; pre-fills onboarding and
      // becomes one always-retrievable chunk.
      `CREATE TABLE IF NOT EXISTS site_facts (
        site_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source_url TEXT,
        updated_at INTEGER,
        PRIMARY KEY (site_id, key)
      )`,
      `CREATE TABLE IF NOT EXISTS knowledge_manual (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS crawl_runs (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        chunks INTEGER NOT NULL DEFAULT 0,
        trigger TEXT,
        robots TEXT,
        boilerplate TEXT,
        error TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      )`,
      'CREATE INDEX IF NOT EXISTS crawl_runs_site ON crawl_runs (site_id, started_at DESC)',
      // Workers AI's free allocation resets at 00:00 UTC, so `day` is a UTC date.
      `CREATE TABLE IF NOT EXISTS usage_daily (
        day TEXT NOT NULL,
        site_id TEXT NOT NULL,
        neurons_est REAL NOT NULL DEFAULT 0,
        messages INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, site_id)
      )`,
      // One-time setup and login links. Only the hash is stored.
      `CREATE TABLE IF NOT EXISTS admin_tokens (
        token_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        email TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      )`,
      'ALTER TABLE messages ADD COLUMN sources TEXT',
      'ALTER TABLE messages ADD COLUMN feedback INTEGER',
      'ALTER TABLE messages ADD COLUMN tokens_in INTEGER',
      'ALTER TABLE messages ADD COLUMN tokens_out INTEGER',
    ],
  },
  {
    id: 3,
    name: 'contacts',
    // A lead is a person, not a conversation: one per email per site. Merge the
    // ones recorded twice into the oldest (keeping its status and notes,
    // filling its gaps), point their conversations at it, then let the
    // database refuse a second.
    statements: [
      "UPDATE leads SET email = lower(trim(email)) WHERE email IS NOT NULL AND email <> lower(trim(email))",
      "UPDATE leads SET email = NULL WHERE email = ''",
      `UPDATE leads SET
         name = COALESCE(name, (SELECT d.name FROM leads d WHERE d.site_id = leads.site_id AND d.email = leads.email AND d.name IS NOT NULL ORDER BY d.updated_at DESC LIMIT 1)),
         phone = COALESCE(phone, (SELECT d.phone FROM leads d WHERE d.site_id = leads.site_id AND d.email = leads.email AND d.phone IS NOT NULL ORDER BY d.updated_at DESC LIMIT 1)),
         updated_at = (SELECT MAX(d.updated_at) FROM leads d WHERE d.site_id = leads.site_id AND d.email = leads.email)
       WHERE email IS NOT NULL`,
      `UPDATE conversations SET lead_id = (
         SELECT k.id FROM leads l JOIN leads k ON k.site_id = l.site_id AND k.email = l.email
         WHERE l.id = conversations.lead_id ORDER BY k.created_at, k.id LIMIT 1)
       WHERE lead_id IN (SELECT id FROM leads WHERE email IS NOT NULL)`,
      `DELETE FROM leads WHERE email IS NOT NULL AND id <> (
         SELECT k.id FROM leads k WHERE k.site_id = leads.site_id AND k.email = leads.email ORDER BY k.created_at, k.id LIMIT 1)`,
      'CREATE UNIQUE INDEX IF NOT EXISTS leads_site_email ON leads (site_id, email) WHERE email IS NOT NULL',
    ],
  },
  {
    id: 4,
    name: 'files',
    // Uploaded documents. The bytes wait in KV until the Workflow reads them;
    // what is kept is the cleaned Markdown, so the file can be re-embedded
    // (a new embedding model) without uploading it again. Its passages are
    // pages with source 'file' and URLs helppuff://file/<id>#<section>.
    statements: [
      `CREATE TABLE IF NOT EXISTS knowledge_files (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        error TEXT,
        markdown TEXT,
        truncated INTEGER NOT NULL DEFAULT 0,
        chunks INTEGER NOT NULL DEFAULT 0,
        embedding_model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS knowledge_files_site ON knowledge_files (site_id, created_at DESC)',
    ],
  },
  {
    id: 5,
    name: 'webhooks',
    // Endpoints the owner adds in the dashboard (helppuff.json `sinks` still work,
    // for leads). `events` is a JSON array, or ["*"] for everything. The
    // secret is generated here and signs every delivery. Deliveries are a
    // short log per endpoint (the newest 50), for the dashboard.
    statements: [
      `CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        events TEXT NOT NULL,
        secret TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_status TEXT,
        last_error TEXT,
        last_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS webhooks_site ON webhooks (site_id)',
      `CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event TEXT NOT NULL,
        ok INTEGER NOT NULL,
        http_status INTEGER,
        error TEXT,
        attempts INTEGER NOT NULL,
        duration_ms INTEGER,
        at INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS webhook_deliveries_hook ON webhook_deliveries (webhook_id, at DESC)',
    ],
  },
  {
    id: 6,
    name: 'background jobs',
    // `completed_at`: the conversation's end-of-chat job ran (summary, labels,
    // conversation.completed); a new message clears it. The usage marks make
    // the budget webhooks fire once a day.
    statements: [
      'ALTER TABLE conversations ADD COLUMN completed_at INTEGER',
      'ALTER TABLE usage_daily ADD COLUMN warned_at INTEGER',
      'ALTER TABLE usage_daily ADD COLUMN exhausted_at INTEGER',
    ],
  },
  {
    id: 7,
    name: 'callbacks',
    // A callback a visitor asked for, as a task: open until the team marks it
    // done or dismissed. At most one open request per conversation (asking
    // again updates it); a contact (lead) may have many over time.
    statements: [
      `CREATE TABLE IF NOT EXISTS callbacks (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        lead_id TEXT,
        name TEXT,
        phone TEXT,
        email TEXT,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        note TEXT,
        requested_at INTEGER NOT NULL,
        closed_at INTEGER,
        closed_by TEXT
      )`,
      'CREATE INDEX IF NOT EXISTS callbacks_site_status ON callbacks (site_id, status, requested_at DESC)',
      "CREATE UNIQUE INDEX IF NOT EXISTS callbacks_open_conversation ON callbacks (conversation_id) WHERE status = 'open'",
      'CREATE INDEX IF NOT EXISTS callbacks_lead ON callbacks (lead_id)',
    ],
  },
];

export const LATEST_MIGRATION = MIGRATIONS[MIGRATIONS.length - 1]!.id;

/** Runs one statement and returns its rows: a D1 binding in the Worker, the REST API in the CLI. */
export type SqlRunner = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const LEDGER = `CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)`;

/** SQLite has no `ADD COLUMN IF NOT EXISTS`; a re-run is detected from the error instead. */
function alreadyApplied(sql: string, thrown: unknown): boolean {
  return /^\s*ALTER\s+TABLE/i.test(sql) && /duplicate column/i.test(String((thrown as Error)?.message ?? thrown));
}

/**
 * Bring a database up to date. Returns the ids applied by this call (empty
 * when it was already current). Safe to run concurrently with itself.
 */
export async function migrate(run: SqlRunner, now: () => number = Date.now): Promise<number[]> {
  await run(LEDGER);
  const rows = await run('SELECT id FROM _migrations');
  const done = new Set(rows.map((row) => Number(row['id'])));
  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    for (const sql of migration.statements) {
      try {
        await run(sql);
      } catch (thrown) {
        if (!alreadyApplied(sql, thrown)) throw thrown;
      }
    }
    await run('INSERT OR IGNORE INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)', [migration.id, migration.name, now()]);
    applied.push(migration.id);
  }
  return applied;
}
