import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/admin/auth.js';
import { resetSchemaMemo, type D1Like, type D1Statement } from '../src/admin/db.js';
import { contactIn } from '../src/admin/record.js';
import { extractJson as extractJsonForTest } from '../src/admin/routes.js';
import { memoryKv } from '../src/core/platform.js';
import { harness, ORIGIN, startBody, startSession, testConfig, testEnv, type Harness } from './helpers.js';

/**
 * The dashboard, against a real SQLite database: D1 is SQLite, so the
 * queries under test are the queries that run in production.
 */

function d1(): D1Like & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const statement = (sql: string, values: unknown[] = []): D1Statement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => raw.prepare(sql).run(...(values as never[])),
    all: async <T,>() => ({ results: raw.prepare(sql).all(...(values as never[])) as T[] }),
    first: async <T,>() => (raw.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
  });
  return {
    raw,
    prepare: (sql) => statement(sql),
    batch: async (statements) => Promise.all(statements.map((s) => s.run())),
  };
}

const OWNER = 'owner@acme.com';
const PASSWORD = 'correct horse battery staple';
const ADMIN_ORIGIN = 'http://server.test';

type World = { h: Harness; db: ReturnType<typeof d1>; settle: () => Promise<void>; admin: Harness };

async function world(env: Record<string, unknown> = {}): Promise<World> {
  resetSchemaMemo();
  const db = d1();
  const pending: Promise<unknown>[] = [];
  const bindings = testEnv({ MURMUR_DB: db, ADMIN_EMAIL: OWNER, ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD, 10_000), ...env });
  const h = harness(testConfig(), bindings, ORIGIN, (p) => pending.push(p));
  const admin = harness(testConfig(), bindings, ADMIN_ORIGIN, (p) => pending.push(p));
  return { h, db, admin, settle: async () => void (await Promise.all(pending.splice(0))) };
}

async function login(admin: Harness, email = OWNER, password = PASSWORD): Promise<string> {
  const response = await admin.post('/admin/api/login', { email, password });
  expect(response.status).toBe(200);
  return response.headers.get('Set-Cookie')!.split(';')[0]!;
}

const get = (admin: Harness, path: string, cookie: string) => admin.fetch(path, { headers: { Cookie: cookie } });

describe('recording', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it('writes the conversation, both sides of each turn, and the form lead', async () => {
    const started = await startSession(w.h, { ...startBody, firstMessage: 'Do you work weekends?' });
    await w.h.post(
      '/v1/sessions/messages',
      { kind: 'text', text: 'Call me on 0412 345 678', clientId: 'c1' },
      { headers: { Authorization: `Bearer ${started.sessionToken}` } },
    );
    await w.settle();

    const conversation = w.db.raw.prepare('SELECT * FROM conversations').get() as Record<string, unknown>;
    expect(conversation).toMatchObject({
      id: started.sessionId,
      site_id: 'demo',
      page_url: 'https://example.com/pricing',
      first_message: 'Do you work weekends?',
    });
    const roles = (w.db.raw.prepare('SELECT role FROM messages ORDER BY ts').all() as { role: string }[]).map((r) => r.role);
    expect(roles.filter((r) => r === 'user')).toHaveLength(2);
    expect(roles.filter((r) => r === 'agent').length).toBeGreaterThan(0);

    const lead = w.db.raw.prepare('SELECT * FROM leads').get() as Record<string, unknown>;
    // The form's name and email, and the phone typed later, on one lead.
    expect(lead).toMatchObject({ name: 'Ada', email: 'ada@example.com', phone: '0412 345 678', source: 'form', status: 'new' });
  });

  it('records nothing, and changes nothing, without a database', async () => {
    const h = harness();
    const response = await h.post('/v1/sites/demo/sessions', startBody);
    expect(response.status).toBe(200);
  });

  it('finds contact details a visitor typed', () => {
    expect(contactIn('reach me at Ada@Example.com please')).toEqual({ email: 'ada@example.com' });
    expect(contactIn('my number is +61 412 345 678')).toEqual({ phone: '+61 412 345 678' });
    expect(contactIn('I have 3 kids and 2 dogs')).toEqual({});
  });
});

describe('sign-in', () => {
  it('accepts the owner, and refuses a wrong password or an unknown email alike', async () => {
    const w = await world();
    expect((await w.admin.post('/admin/api/login', { email: OWNER, password: 'nope' })).status).toBe(401);
    expect((await w.admin.post('/admin/api/login', { email: 'who@acme.com', password: PASSWORD })).status).toBe(401);
    const cookie = await login(w.admin, 'Owner@Acme.com');
    const me = await (await get(w.admin, '/admin/api/me', cookie)).json();
    expect(me).toMatchObject({ admin: { email: OWNER, owner: true }, sites: [{ id: 'demo' }] });
  });

  it('sets a strict, HttpOnly cookie scoped to /admin', async () => {
    const w = await world();
    const response = await w.admin.post('/admin/api/login', { email: OWNER, password: PASSWORD });
    const cookie = response.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/admin');
  });

  it('lets in an admin added to the table, and locks them out once removed', async () => {
    const w = await world();
    await w.settle();
    await w.admin.fetch('/admin/api/me'); // applies the schema
    w.db.raw
      .prepare('INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?)')
      .run('sam@acme.com', await hashPassword('sam-password-123', 10_000), Date.now());
    const cookie = await login(w.admin, 'sam@acme.com', 'sam-password-123');
    expect((await get(w.admin, '/admin/api/me', cookie)).status).toBe(200);
    w.db.raw.prepare('DELETE FROM admins').run();
    expect((await get(w.admin, '/admin/api/me', cookie)).status).toBe(401);
  });

  it('requires a session for every read', async () => {
    const w = await world();
    for (const path of ['/admin/api/me', '/admin/api/overview', '/admin/api/conversations', '/admin/api/leads', '/admin/api/leads.csv']) {
      expect((await w.admin.fetch(path)).status, path).toBe(401);
    }
    expect((await get(w.admin, '/admin/api/me', 'mm_admin=forged.token')).status).toBe(401);
  });

  it('refuses a cross-origin sign-in', async () => {
    const w = await world();
    const response = await w.admin.post('/admin/api/login', { email: OWNER, password: PASSWORD }, { headers: { Origin: 'https://evil.test' } });
    expect(response.status).toBe(403);
  });

  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('s3cret-pass', 10_000);
    expect(hash).toMatch(/^pbkdf2\$10000\$/);
    expect(await verifyPassword(hash, 's3cret-pass')).toBe(true);
    expect(await verifyPassword(hash, 's3cret-pasS')).toBe(false);
    expect(await verifyPassword('garbage', 'x')).toBe(false);
  });
});

describe('the dashboard API', () => {
  async function seeded(env: Record<string, unknown> = {}) {
    const w = await world(env);
    const one = await startSession(w.h, { ...startBody, firstMessage: 'How much is a website?' });
    await startSession(w.h, { lead: { name: 'Bo' }, context: { pageUrl: 'https://example.com/' }, firstMessage: 'Hours?' });
    await w.settle();
    return { ...w, cookie: await login(w.admin), first: one.sessionId };
  }

  it('summarises the period with a zero-filled daily series', async () => {
    const w = await seeded();
    const overview = (await (await get(w.admin, '/admin/api/overview?days=7', w.cookie)).json()) as {
      totals: { conversations: number; leads: number; conversion: number };
      series: { conversations: number }[];
      topPages: { url: string; count: number }[];
    };
    expect(overview.totals).toMatchObject({ conversations: 2, leads: 2, conversion: 1 });
    expect(overview.series).toHaveLength(7);
    expect(overview.series.reduce((sum, d) => sum + d.conversations, 0)).toBe(2);
    expect(overview.topPages.map((p) => p.url)).toContain('https://example.com/pricing');
  });

  it('lists, searches and opens conversations', async () => {
    const w = await seeded();
    const list = (await (await get(w.admin, '/admin/api/conversations', w.cookie)).json()) as { items: { id: string; leadName: string }[] };
    expect(list.items).toHaveLength(2);
    const found = (await (await get(w.admin, '/admin/api/conversations?q=website', w.cookie)).json()) as { items: { id: string }[] };
    expect(found.items.map((i) => i.id)).toEqual([w.first]);
    const detail = (await (await get(w.admin, `/admin/api/conversations/${w.first}`, w.cookie)).json()) as {
      messages: { role: string }[];
      lead: { name: string };
    };
    expect(detail.lead.name).toBe('Ada');
    expect(detail.messages[0]?.role).toBe('user');
  });

  it('updates a lead and exports CSV that cannot run formulas', async () => {
    const w = await seeded();
    const leads = (await (await get(w.admin, '/admin/api/leads', w.cookie)).json()) as { items: { id: string }[] };
    const id = leads.items[0]!.id;
    const patched = await w.admin.fetch(`/admin/api/leads/${id}`, {
      method: 'PATCH',
      headers: { Cookie: w.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'contacted', notes: '=HYPERLINK("x")' }),
    });
    expect(((await patched.json()) as { status: string }).status).toBe('contacted');
    const csv = await (await get(w.admin, '/admin/api/leads.csv', w.cookie)).text();
    expect(csv.split('\n')[0]).toBe('created,name,email,phone,status,source,notes,site,conversation');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    const bad = await w.admin.fetch(`/admin/api/leads/${id}`, {
      method: 'PATCH',
      headers: { Cookie: w.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'bogus' }),
    });
    expect(bad.status).toBe(400);
  });

  it('summarises a conversation with Workers AI and keeps only contact details the visitor typed', async () => {
    const ai = {
      run: async () => ({
        response:
          'Sure: {"summary":"Asked about website pricing.","intent":"Pricing question","sentiment":"positive","followUp":"Send the price list","contact":{"name":"Ada","email":"invented@example.com","phone":""}}',
      }),
    };
    const w = await seeded({ AI: ai });
    const response = await w.admin.fetch(`/admin/api/conversations/${w.first}/summary`, { method: 'POST', headers: { Cookie: w.cookie } });
    const body = (await response.json()) as { summary: string; intent: string; lead: { email?: string } };
    expect(body).toMatchObject({ summary: 'Asked about website pricing.', intent: 'Pricing question' });
    // Not in the transcript, so not trusted.
    expect(body.lead.email).toBeUndefined();
    const stored = w.db.raw.prepare('SELECT summary, intent FROM conversations WHERE id = ?').get(w.first) as { summary: string; intent: string };
    expect(JSON.parse(stored.summary)).toMatchObject({ followUp: 'Send the price list' });
  });

  it('says clearly when summaries are not available', async () => {
    const w = await seeded();
    const response = await w.admin.fetch(`/admin/api/conversations/${w.first}/summary`, { method: 'POST', headers: { Cookie: w.cookie } });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain('Workers AI');
  });

  it('parses a JSON object wrapped in prose', () => {
    expect(extractJsonForTest('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonForTest('no json')).toBeNull();
  });
});

describe('the owner testing from the CLI', () => {
  it('is exempt from per-IP limits, but only with the right token', async () => {
    const { ownerToken, OWNER_HEADER } = await import('../src/core/request.js');
    const config = testConfig({ security: { limits: { sessionsPerIpPerHour: 1 } } });
    const env = testEnv();
    const h = harness(config, env);
    expect((await h.post('/v1/sites/demo/sessions', startBody)).status).toBe(200);
    expect((await h.post('/v1/sites/demo/sessions', startBody)).status).toBe(429);

    const owner = { headers: { [OWNER_HEADER]: await ownerToken(String(env.MURMUR_SECRET)) } };
    expect((await h.post('/v1/sites/demo/sessions', startBody, owner)).status).toBe(200);
    expect((await h.post('/v1/sites/demo/sessions', startBody, owner)).status).toBe(200);

    const forged = { headers: { [OWNER_HEADER]: 'a'.repeat(64) } };
    expect((await h.post('/v1/sites/demo/sessions', startBody, forged)).status).toBe(429);
  });

  it('still counts toward the daily cost cap', async () => {
    const { ownerToken, OWNER_HEADER } = await import('../src/core/request.js');
    const env = testEnv();
    const h = harness(testConfig({ security: { limits: { messagesPerSitePerDay: 1 } } }), env);
    const owner = { headers: { [OWNER_HEADER]: await ownerToken(String(env.MURMUR_SECRET)) } };
    expect((await h.post('/v1/sites/demo/sessions', startBody, owner)).status).toBe(200);
    expect((await h.post('/v1/sites/demo/sessions', startBody, owner)).status).toBe(429);
  });
});

describe('prompt versions', () => {
  const PROMPT = 'You are the assistant for Acme.';

  async function promptWorld(connector: Record<string, unknown> = { type: 'cloudflare', options: { binding: 'AI_SEARCH', instructions: PROMPT } }) {
    resetSchemaMemo();
    const db = d1();
    const kv = memoryKv();
    const bindings = testEnv({ MURMUR_DB: db, MURMUR_KV: kv, ADMIN_EMAIL: OWNER, ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD, 10_000) });
    const admin = harness(testConfig({ connector: connector as never }), bindings, ADMIN_ORIGIN);
    const cookie = await login(admin);
    const state = async () => (await (await get(admin, '/admin/api/prompt', cookie)).json()) as PromptView;
    const publish = (body: Record<string, unknown>) =>
      admin.fetch('/admin/api/prompt', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const restore = (body: Record<string, unknown>) =>
      admin.fetch('/admin/api/prompt/restore', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const stored = async () => JSON.parse((await kv.get('config:demo'))!) as { connector: { options: Record<string, unknown> }; prompt: Record<string, unknown>; widget?: unknown };
    return { admin, cookie, db, kv, state, publish, restore, stored };
  }
  type PromptView = { editable: boolean; reason: string | null; text: string; version: number; versions: { version: number; source: string; author: string | null; restoredFrom: number | null }[] };

  it('shows the deployed prompt before anything is versioned', async () => {
    const w = await promptWorld();
    expect(await w.state()).toMatchObject({ editable: true, text: PROMPT, version: 0, versions: [] });
  });

  it('keeps the pre-versioning prompt as version 1 and publishes the edit live', async () => {
    const w = await promptWorld();
    const response = await w.publish({ text: 'Be brief.', baseVersion: 0, note: 'shorter' });
    expect(await response.json()).toMatchObject({ status: 'published', version: 2 });

    const after = await w.state();
    expect(after).toMatchObject({ text: 'Be brief.', version: 2 });
    expect(after.versions.map((v) => [v.version, v.source, v.author])).toEqual([
      [2, 'dashboard', OWNER],
      [1, 'cli', null],
    ]);
    const stored = await w.stored();
    expect(stored.connector.options['instructions']).toBe('Be brief.');
    expect(stored.connector.options['binding']).toBe('AI_SEARCH');
    expect(stored.prompt).toMatchObject({ version: 2, source: 'dashboard', by: OWNER });
  });

  it('keeps the other stored sections when it publishes', async () => {
    const w = await promptWorld();
    await w.kv.put('config:demo', JSON.stringify({ widget: { brand: { name: 'Stored name' } } }));
    await w.publish({ text: 'Be brief.', baseVersion: 0 });
    expect((await w.stored()).widget).toMatchObject({ brand: { name: 'Stored name' } });
  });

  it('refuses an edit that started from an older version', async () => {
    const w = await promptWorld();
    await w.publish({ text: 'First edit.', baseVersion: 0 });
    const stale = await w.publish({ text: 'Stale edit.', baseVersion: 0 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ status: 'conflict', version: 2 });
    expect((await w.state()).text).toBe('First edit.');
  });

  it('does not make a version when nothing changed', async () => {
    const w = await promptWorld();
    expect(await (await w.publish({ text: `  ${PROMPT}\r\n`, baseVersion: 0 })).json()).toMatchObject({ status: 'unchanged', version: 0 });
    expect((await w.state()).versions).toEqual([]);
  });

  it('restores an old version as a new one, so the restore can be undone too', async () => {
    const w = await promptWorld();
    await w.publish({ text: 'Be brief.', baseVersion: 0 });
    const response = await w.restore({ version: 1, baseVersion: 2 });
    expect(await response.json()).toMatchObject({ status: 'published', version: 3 });
    const after = await w.state();
    expect(after.text).toBe(PROMPT);
    expect(after.versions[0]).toMatchObject({ version: 3, source: 'restore', restoredFrom: 1 });

    const old = await get(w.admin, '/admin/api/prompt/versions/2', w.cookie);
    expect(await old.json()).toMatchObject({ version: 2, text: 'Be brief.' });
  });

  it('will not edit a prompt Murmur does not own', async () => {
    const w = await promptWorld({ type: 'echo' });
    const view = await w.state();
    expect(view.editable).toBe(false);
    expect(view.reason).toContain('echo');
    expect((await w.publish({ text: 'Hi', baseVersion: 0 })).status).toBe(400);
  });

  it('will not replace a prompt that comes from another source', async () => {
    const w = await promptWorld({ type: 'cloudflare', options: { binding: 'AI_SEARCH', instructions: { kv: 'prompt:demo' } } });
    expect((await w.state()).editable).toBe(false);
  });

  it('needs a session and a same-origin request', async () => {
    const w = await promptWorld();
    expect((await w.admin.fetch('/admin/api/prompt')).status).toBe(401);
    const cross = await w.admin.fetch('/admin/api/prompt', {
      method: 'POST',
      headers: { Cookie: w.cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x', baseVersion: 0 }),
    });
    expect(cross.status).toBe(403);
  });
});
