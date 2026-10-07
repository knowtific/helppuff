import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../src/admin/auth.js';
import { resetSchemaMemo, type D1Like, type D1Statement } from '../src/db/d1.js';
import { contactIn } from '../src/admin/record.js';
import { forgetWebhooks, signDelivery } from '../src/webhooks/deliver.js';
import { extractJson as extractJsonForTest } from '../src/admin/routes.js';
import { memoryKv } from '../src/core/platform.js';
import { recordedHistory } from '../src/conversations/history.js';
import { harness, ORIGIN, startBody, startSession, testConfig, testEnv, withForms, type Harness } from './helpers.js';

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
  const bindings = testEnv({ HELPPUFF_DB: db, ADMIN_EMAIL: OWNER, ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD, 10_000), ...env });
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

  it('keeps one lead per email: a returning visitor enriches it and both chats point at it', async () => {
    const first = await startSession(w.h, startBody);
    const second = await startSession(w.h, { ...startBody, lead: { name: 'Ada L', email: 'ADA@Example.com' } });
    await w.h.post(
      '/v1/sessions/messages',
      { kind: 'text', text: 'Call me on 0412 345 678', clientId: 'c1' },
      { headers: { Authorization: `Bearer ${second.sessionToken}` } },
    );
    await w.settle();

    const leads = w.db.raw.prepare('SELECT * FROM leads').all() as Record<string, unknown>[];
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: 'Ada', email: 'ada@example.com', phone: '0412 345 678' });
    const links = w.db.raw.prepare('SELECT id, lead_id FROM conversations ORDER BY started_at').all() as { id: string; lead_id: string }[];
    expect(new Set(links.map((l) => l.lead_id))).toEqual(new Set([leads[0]!['id']]));
    expect(links.map((l) => l.id).sort()).toEqual([first.sessionId, second.sessionId].sort());
  });

  it('folds a lead without an email into the person once the email turns out to be known', async () => {
    await startSession(w.h, startBody);
    const second = await startSession(w.h, { ...startBody, lead: { name: 'Bo' } });
    await w.settle();
    expect(w.db.raw.prepare('SELECT COUNT(*) AS n FROM leads').get()).toEqual({ n: 2 });

    await w.h.post(
      '/v1/sessions/messages',
      { kind: 'text', text: 'It is ada@example.com, ring 0412 345 678', clientId: 'c1' },
      { headers: { Authorization: `Bearer ${second.sessionToken}` } },
    );
    await w.settle();
    const leads = w.db.raw.prepare('SELECT name, email, phone FROM leads').all();
    expect(leads).toEqual([{ name: 'Ada', email: 'ada@example.com', phone: '0412 345 678' }]);
    expect(w.db.raw.prepare('SELECT COUNT(DISTINCT lead_id) AS n FROM conversations').get()).toEqual({ n: 1 });
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
    expect((await get(w.admin, '/admin/api/me', 'hp_admin=forged.token')).status).toBe(401);
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

    const owner = { headers: { [OWNER_HEADER]: await ownerToken(String(env.HELPPUFF_SECRET)) } };
    expect((await h.post('/v1/sites/demo/sessions', startBody, owner)).status).toBe(200);
    expect((await h.post('/v1/sites/demo/sessions', startBody, owner)).status).toBe(200);

    const forged = { headers: { [OWNER_HEADER]: 'a'.repeat(64) } };
    expect((await h.post('/v1/sites/demo/sessions', startBody, forged)).status).toBe(429);
  });

  it('still counts toward the daily cost cap', async () => {
    const { ownerToken, OWNER_HEADER } = await import('../src/core/request.js');
    const env = testEnv();
    const h = harness(testConfig({ security: { limits: { messagesPerSitePerDay: 1 } } }), env);
    const owner = { headers: { [OWNER_HEADER]: await ownerToken(String(env.HELPPUFF_SECRET)) } };
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
    const bindings = testEnv({ HELPPUFF_DB: db, HELPPUFF_KV: kv, ADMIN_EMAIL: OWNER, ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD, 10_000) });
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

  it('will not edit a prompt HelpPuff does not own', async () => {
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

describe('webhooks', () => {
  type Received = { headers: Headers; body: { id: string; type: string; site: string; data: Record<string, unknown> } };
  let received: Received[];
  let answer: number;
  beforeEach(() => {
    received = [];
    answer = 200;
    forgetWebhooks('demo');
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://hooks.example.com/')) return real(input, init);
      received.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Received['body'] });
      return new Response('ok', { status: answer });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const call = (w: World & { cookie: string }, method: string, path: string, body?: unknown) =>
    w.admin.fetch(path, { method, headers: { Cookie: w.cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

  async function withHook(events?: string[]) {
    const w = await world();
    const cookie = await login(w.admin);
    const created = await call({ ...w, cookie }, 'POST', '/admin/api/webhooks', { url: 'https://hooks.example.com/helppuff', ...(events ? { events } : {}) });
    expect(created.status).toBe(201);
    const hook = (await created.json()) as { id: string; secret: string; events: string[] };
    return { ...w, cookie, hook };
  }

  it('counts a submitted callback form as one callback request, whatever the assistant says next', async () => {
    const w = await withHook(['lead.captured', 'callback.requested']);
    const started = await startSession(w.h);
    const token = await withForms(started.sessionToken, ['callback_abc123', 'm_other']);
    await w.settle();
    received = [];
    const form = { kind: 'action', actionId: 'callback_abc123', label: 'Request callback', value: JSON.stringify({ name: 'Sam', phone: '0400 111 222', message: 'A quote' }), clientId: 'c1' };
    expect((await w.h.post('/v1/sessions/messages', form, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    await w.settle();

    expect(received.map((r) => r.body.type).sort()).toEqual(['callback.requested', 'lead.captured']);
    expect(received.find((r) => r.body.type === 'callback.requested')!.body.data).toMatchObject({ callbackId: expect.stringMatching(/^cb_/), name: 'Sam', phone: '0400 111 222', message: 'A quote' });
    // Any other form is a lead, not a callback request.
    received = [];
    await w.h.post('/v1/sessions/messages', { ...form, actionId: 'm_other', clientId: 'c2' }, { headers: { Authorization: `Bearer ${token}` } });
    await w.settle();
    expect(received.map((r) => r.body.type)).toEqual(['lead.captured']);
  });

  it('keeps callback requests as tasks: one waiting per conversation, labelled on the contact and the conversation, closed with a note', async () => {
    const w = await withHook(['callback.requested', 'callback.updated']);
    const started = await startSession(w.h);
    const auth = { headers: { Authorization: `Bearer ${await withForms(started.sessionToken, ['callback_c1', 'callback_c2', 'callback_c3', 'callback_c4', 'callback_c5'])}` } };
    const form = (reason: string, clientId: string) => ({
      kind: 'action',
      actionId: `callback_${clientId}`,
      label: 'Request callback',
      value: JSON.stringify({ name: 'Ada', phone: '0400 111 222', message: reason }),
      clientId,
    });
    await w.h.post('/v1/sessions/messages', form('A quote for two rooms', 'c1'), auth);
    await w.settle();
    // Asking again updates the waiting request rather than adding one.
    await w.h.post('/v1/sessions/messages', form('A quote for three rooms', 'c2'), auth);
    await w.settle();

    type List = { items: { id: string; name: string; phone: string; reason: string; status: string; note: string | null; closedBy: string | null }[]; counts: Record<string, number> };
    const list = async (status = 'open') => (await (await call(w, 'GET', `/admin/api/callbacks?status=${status}`)).json()) as List;
    const waiting = await list();
    expect(waiting.items).toHaveLength(1);
    // Both requests name the one waiting task, so a CRM can match them, and later its update.
    const requested = received.filter((r) => r.body.type === 'callback.requested').map((r) => r.body.data);
    expect(requested.map((d) => d['callbackId'])).toEqual([waiting.items[0]!.id, waiting.items[0]!.id]);
    expect(requested[1]).toMatchObject({ message: 'A quote for three rooms', name: 'Ada' });
    received = [];
    expect(waiting.items[0]).toMatchObject({ name: 'Ada', phone: '0400 111 222', reason: 'A quote for three rooms', status: 'open' });

    const leads = (await (await call(w, 'GET', '/admin/api/leads')).json()) as { items: { openCallbacks: number }[] };
    expect(leads.items[0]!.openCallbacks).toBe(1);
    const flagged = (await (await call(w, 'GET', '/admin/api/conversations?filter=callbacks')).json()) as { items: { id: string; callback: string }[] };
    expect(flagged.items).toEqual([expect.objectContaining({ id: started.sessionId, callback: 'open' })]);
    const detail = (await (await call(w, 'GET', `/admin/api/conversations/${started.sessionId}`)).json()) as { callbacks: { status: string }[] };
    expect(detail.callbacks.map((cb) => cb.status)).toEqual(['open']);

    const done = await call(w, 'PATCH', `/admin/api/callbacks/${waiting.items[0]!.id}`, { status: 'done', note: 'Booked a measure for Tuesday' });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ status: 'done', note: 'Booked a measure for Tuesday', closedBy: OWNER });
    await w.settle();
    expect(received.map((r) => r.body.type)).toEqual(['callback.updated']);
    expect(received[0]!.body.data).toMatchObject({ previousStatus: 'open', callback: { id: waiting.items[0]!.id, status: 'done', pageUrl: 'https://example.com/pricing', leadId: expect.any(String) } });
    expect((await list()).counts).toEqual({ open: 0, done: 1, dismissed: 0 });

    // A new request after that is a new task; the old one cannot reopen beside it.
    await w.h.post('/v1/sessions/messages', form('Now about stairs', 'c3'), auth);
    await w.settle();
    expect((await list()).items.map((cb) => cb.reason)).toEqual(['Now about stairs']);
    expect((await call(w, 'PATCH', `/admin/api/callbacks/${waiting.items[0]!.id}`, { status: 'open' })).status).toBe(400);
  });

  it('signs every event of a conversation and sends it to the endpoint', async () => {
    const w = await withHook();
    expect(w.hook.events).toEqual(['*']);
    const started = await startSession(w.h, { ...startBody, firstMessage: 'Do you work weekends?' });
    await w.h.post('/v1/sessions/messages', { kind: 'text', text: 'Call me on 0412 345 678', clientId: 'c1' }, { headers: { Authorization: `Bearer ${started.sessionToken}` } });
    await w.settle();

    const types = received.map((r) => r.body.type);
    expect(types).toEqual(expect.arrayContaining(['conversation.started', 'message.received', 'message.sent', 'lead.captured']));
    expect(types.filter((t) => t === 'message.received')).toHaveLength(2);
    const lead = received.find((r) => r.body.type === 'lead.captured' && r.body.data['phone']);
    expect(lead?.body.data).toMatchObject({ conversationId: started.sessionId, source: 'chat', phone: '0412 345 678' });
    const first = received.find((r) => r.body.type === 'conversation.started')!;
    expect(first.body).toMatchObject({ site: 'demo', data: { conversationId: started.sessionId, firstMessage: 'Do you work weekends?', page: { url: 'https://example.com/pricing' } } });

    // The signature covers the timestamp and the exact body.
    const timestamp = Number(first.headers.get('X-HelpPuff-Timestamp'));
    expect(first.headers.get('X-HelpPuff-Signature')).toBe(await signDelivery(w.hook.secret, timestamp, JSON.stringify(first.body)));
    expect(first.headers.get('X-HelpPuff-Event')).toBe('conversation.started');
    expect(first.headers.get('X-HelpPuff-Delivery')).toBe(first.body.id);

    const log = (await (await get(w.admin, `/admin/api/webhooks/${w.hook.id}/deliveries`, w.cookie)).json()) as { deliveries: { ok: boolean; event: string }[] };
    expect(log.deliveries.length).toBe(received.length);
    expect(log.deliveries.every((d) => d.ok)).toBe(true);
  });

  it('sends only the chosen events, none once disabled, and tests on demand', async () => {
    const w = await withHook(['lead.captured']);
    await startSession(w.h, startBody);
    await w.settle();
    expect(received.map((r) => r.body.type)).toEqual(['lead.captured']);

    received.length = 0;
    answer = 410;
    const test = (await (await call(w, 'POST', `/admin/api/webhooks/${w.hook.id}/test`, {})).json()) as { ok: boolean; status: number; attempts: number };
    expect(test).toMatchObject({ ok: false, status: 410, attempts: 1 });
    expect(received[0]?.body.type).toBe('test.ping');

    await call(w, 'PATCH', `/admin/api/webhooks/${w.hook.id}`, { enabled: false });
    received.length = 0;
    await startSession(w.h, startBody);
    await w.settle();
    expect(received).toEqual([]);
  });

  it('refuses plain http, unknown events, and other sites’ hooks', async () => {
    const w = await withHook();
    expect((await call(w, 'POST', '/admin/api/webhooks', { url: 'http://hooks.example.com/x' })).status).toBe(400);
    expect((await call(w, 'POST', '/admin/api/webhooks', { url: 'https://hooks.example.com/x', events: ['lead.exploded'] })).status).toBe(400);
    expect((await call(w, 'DELETE', '/admin/api/webhooks/wh_nope')).status).toBe(404);
    expect((await call(w, 'DELETE', `/admin/api/webhooks/${w.hook.id}`)).status).toBe(200);
    const listed = (await (await get(w.admin, '/admin/api/webhooks', w.cookie)).json()) as { webhooks: unknown[]; events: { type: string }[] };
    expect(listed.webhooks).toEqual([]);
    expect(listed.events.map((e) => e.type)).toContain('callback.requested');
  });
});

describe('versions', () => {
  it('compares releases, pre-releases first', async () => {
    const { newer } = await import('../src/admin/version.js');
    expect(newer('1.10.0', '1.9.2')).toBe(true);
    expect(newer('1.9.2', '1.10.0')).toBe(false);
    expect(newer('1.0.0', '1.0.0')).toBe(false);
    expect(newer('1.0.0', '1.0.0-beta.2')).toBe(true);
    expect(newer('1.0.0-beta.2', '1.0.0')).toBe(false);
    expect(newer('garbage', '1.0.0')).toBe(false);
  });

  it('says what runs, what is newest, and the command to upgrade', async () => {
    const w = await world({ HELPPUFF_VERSION: '0.1.0' });
    const cookie = await login(w.admin);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
      String(input).startsWith('https://registry.npmjs.org/') ? Response.json({ version: '0.2.0' }) : new Response('no', { status: 500 }),
    );
    try {
      const health = (await (await w.h.fetch('/healthz')).json()) as { version: string; schema: number };
      expect(health.version).toBe('0.1.0');
      const info = (await (await get(w.admin, '/admin/api/version', cookie)).json()) as Record<string, unknown>;
      expect(info).toMatchObject({
        current: '0.1.0',
        latest: '0.2.0',
        upgradeAvailable: true,
        command: 'npx @knowtific/helppuff@latest upgrade',
        releaseNotes: 'https://github.com/knowtific/helppuff/blob/main/CHANGELOG.md',
        schema: { expected: health.schema },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('background jobs', () => {
  type Created = { id?: string; params: Record<string, unknown> };
  let received: { type: string; data: Record<string, unknown> }[];
  let answers: number[];
  beforeEach(() => {
    received = [];
    answers = [];
    forgetWebhooks('demo');
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://hooks.example.com/')) return real(input, init);
      const body = JSON.parse(String(init?.body)) as { type: string; data: Record<string, unknown> };
      received.push(body);
      return new Response('ok', { status: answers.shift() ?? 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Workflow steps run inline; `sleep` moves a fake clock instead of waiting. */
  function clockSteps(clock: { now: number }) {
    const names: string[] = [];
    return {
      names,
      do: async <T,>(name: string, run: () => Promise<T>) => {
        names.push(name);
        return run();
      },
      sleep: async (name: string, ms: number) => {
        names.push(name);
        clock.now += ms;
      },
    };
  }

  const summaryJson = {
    summary: 'Ada asked about weekend work and left her number for a callback.',
    intent: 'Weekend availability',
    sentiment: 'positive',
    leadQuality: 'hot',
    outcome: 'callback_requested',
    topics: ['weekends', 'callback'],
    unanswered: ['Do you work on public holidays?'],
    followUp: 'Call Ada back today.',
    contact: { name: 'Ada', email: '', phone: '0412 345 678' },
  };
  const ai = { run: async () => ({ choices: [{ message: { content: JSON.stringify(summaryJson) } }], usage: { prompt_tokens: 900, completion_tokens: 120 } }) };

  it('summarises a conversation once it goes quiet, labels it, and sends conversation.completed', async () => {
    const { runConversationJob } = await import('../src/conversations/complete.js');
    const created: Created[] = [];
    const w = await world({ AI: ai, CRAWL_WORKFLOW: { create: async (o: Created) => void created.push(o) } });
    const cookie = await login(w.admin);
    await w.admin.fetch('/admin/api/webhooks', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://hooks.example.com/helppuff', events: ['conversation.completed'] }),
    });
    const started = await startSession(w.h, { ...startBody, firstMessage: 'Do you work weekends?' });
    await w.h.post('/v1/sessions/messages', { kind: 'text', text: 'Call me on 0412 345 678', clientId: 'c1' }, { headers: { Authorization: `Bearer ${started.sessionToken}` } });
    await w.settle();

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ id: `conv-${started.sessionId}`, params: { kind: 'conversation', siteId: 'demo', conversationId: started.sessionId } });

    const lastAt = (w.db.raw.prepare('SELECT last_at FROM conversations WHERE id = ?').get(started.sessionId) as { last_at: number }).last_at;
    const clock = { now: lastAt + 60_000 };
    const steps = clockSteps(clock);
    const params = created[0]!.params as Parameters<typeof runConversationJob>[2];
    expect(await runConversationJob(steps, { db: w.db, ai, fetch: globalThis.fetch, now: () => clock.now }, params)).toEqual({ status: 'completed' });
    // It slept until five minutes after the last message, then checked again.
    expect(steps.names).toEqual(['check:0', 'idle:0', 'check:1', 'summarize', 'complete']);
    expect(clock.now).toBe(lastAt + 5 * 60_000);

    const stored = w.db.raw.prepare('SELECT summary, intent, completed_at FROM conversations WHERE id = ?').get(started.sessionId) as Record<string, unknown>;
    expect(JSON.parse(String(stored['summary']))).toMatchObject({ leadQuality: 'hot', outcome: 'callback_requested', unanswered: ['Do you work on public holidays?'] });
    expect(stored['completed_at']).toBe(clock.now);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'conversation.completed',
      data: {
        conversationId: started.sessionId,
        summary: summaryJson.summary,
        labels: { intent: 'Weekend availability', leadQuality: 'hot', outcome: 'callback_requested', topics: ['weekends', 'callback'] },
        unanswered: ['Do you work on public holidays?'],
        lead: { name: 'Ada', email: 'ada@example.com', phone: '0412 345 678' },
      },
    });
    expect((received[0]!.data['transcript'] as unknown[]).length).toBeGreaterThanOrEqual(3);

    // Run again (a retried instance): nothing is sent twice.
    expect((await runConversationJob(clockSteps(clock), { db: w.db, ai, fetch: globalThis.fetch, now: () => clock.now }, params)).status).toBe('skipped');
    expect(received).toHaveLength(1);

    // The visitor comes back: the conversation reopens, and a new job will complete it again.
    await w.h.post('/v1/sessions/messages', { kind: 'text', text: 'One more thing', clientId: 'c2' }, { headers: { Authorization: `Bearer ${started.sessionToken}` } });
    await w.settle();
    expect(w.db.raw.prepare('SELECT completed_at FROM conversations WHERE id = ?').get(started.sessionId)).toEqual({ completed_at: null });
    expect(created).toHaveLength(2);
    expect(created[1]!.id).toMatch(new RegExp(`^conv-${started.sessionId}-`));
  });

  it('retries a failed delivery later, through the Workflow, until it gets through', async () => {
    const { emitTo, runWebhookRetry, RETRY_SCHEDULE_MS } = await import('../src/webhooks/deliver.js');
    const w = await world();
    const cookie = await login(w.admin);
    const hook = (await (
      await w.admin.fetch('/admin/api/webhooks', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://hooks.example.com/helppuff' }),
      })
    ).json()) as { id: string };

    const handed: Parameters<NonNullable<Parameters<typeof emitTo>[0]['retry']>>[0][] = [];
    answers = [503];
    await emitTo({ db: w.db, fetch: globalThis.fetch, retry: async (p) => void handed.push(p) }, 'demo', 'lead.captured', { email: 'ada@example.com' });
    expect(received).toHaveLength(1);
    expect(handed).toMatchObject([{ kind: 'webhook', siteId: 'demo', hookId: hook.id, event: { type: 'lead.captured' } }]);
    expect(w.db.raw.prepare('SELECT last_status FROM webhooks WHERE id = ?').get(hook.id)).toEqual({ last_status: 'retrying' });

    // Still down at the next try, up at the one after.
    answers = [500, 200];
    const clock = { now: Date.now() };
    const steps = clockSteps(clock);
    expect(await runWebhookRetry(steps, { db: w.db, fetch: globalThis.fetch, now: () => clock.now }, handed[0]!)).toEqual({ delivered: true, tries: 3 });
    expect(steps.names).toEqual(['wait:0', 'try:2', 'wait:1', 'try:3']);
    expect(received.map((r) => r.type)).toEqual(['lead.captured', 'lead.captured', 'lead.captured']);
    expect(w.db.raw.prepare('SELECT last_status FROM webhooks WHERE id = ?').get(hook.id)).toEqual({ last_status: 'ok' });
    expect(RETRY_SCHEDULE_MS).toHaveLength(5);

    // A 4xx is the endpoint saying no: it is not retried.
    handed.length = 0;
    answers = [404];
    await emitTo({ db: w.db, fetch: globalThis.fetch, retry: async (p) => void handed.push(p) }, 'demo', 'lead.captured', {});
    expect(handed).toEqual([]);
    expect(w.db.raw.prepare('SELECT last_status FROM webhooks WHERE id = ?').get(hook.id)).toEqual({ last_status: 'failed' });
  });
});

describe('the reply waits for no write', () => {
  // Earlier tests leave webhooks cached for the site; these send none.
  beforeEach(() => forgetWebhooks('demo'));
  const send = (h: Harness, token: string, body: Record<string, unknown> = { kind: 'text', text: 'hi', clientId: 'c' }) =>
    h.post('/v1/sessions/messages', body, { headers: { Authorization: `Bearer ${token}` } });

  it('answers while every KV and database write hangs, and writes nothing to KV per message', async () => {
    resetSchemaMemo();
    const real = d1();
    const never = new Promise<never>(() => {});
    // Reads answer; writes never finish. A reply that awaited one would never come.
    const db: D1Like = {
      prepare: (sql) => {
        const wrap = (statement: D1Statement): D1Statement => ({ ...statement, bind: (...v: unknown[]) => wrap(statement.bind(...v)), run: () => never });
        return wrap(real.prepare(sql));
      },
      batch: () => never,
    };
    const kv = memoryKv();
    let puts = 0;
    const hangingKv = { ...kv, put: () => ((puts += 1), never) };
    const limited: string[] = [];
    const env = testEnv({
      HELPPUFF_DB: db,
      HELPPUFF_KV: hangingKv,
      HELPPUFF_IP_LIMITER: { limit: async ({ key }: { key: string }) => (limited.push(key), { success: true }) },
      HELPPUFF_IP_LIMIT: '10',
    });
    const h = harness(testConfig(), env);
    const started = await startSession(h);
    const afterStart = puts;
    for (let i = 0; i < 3; i += 1) expect((await send(h, started.sessionToken)).status).toBe(200);
    expect(puts).toBe(afterStart);
    expect(limited).toHaveLength(3);
  });

  it('refuses past the per-visitor minute limit when the binding says so', async () => {
    const env = testEnv({ HELPPUFF_IP_LIMITER: { limit: async () => ({ success: false }) }, HELPPUFF_IP_LIMIT: '10' });
    const h = harness(testConfig(), env);
    const started = await startSession(h);
    const blocked = await send(h, started.sessionToken);
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('ignores a binding deployed with a different limit than the live one', async () => {
    const env = testEnv({ HELPPUFF_IP_LIMITER: { limit: async () => ({ success: false }) }, HELPPUFF_IP_LIMIT: '99' });
    const h = harness(testConfig(), env);
    const started = await startSession(h);
    expect((await send(h, started.sessionToken)).status).toBe(200);
  });

  it('counts the conversation and daily caps from the recorded turns', async () => {
    resetSchemaMemo();
    const db = d1();
    const pending: Promise<unknown>[] = [];
    const settle = async () => void (await Promise.all(pending.splice(0)));
    const h = harness(testConfig({ security: { limits: { messagesPerSession: 2, messagesPerSitePerDay: 3 } } }), testEnv({ HELPPUFF_DB: db }), ORIGIN, (p) =>
      pending.push(p),
    );
    const message = async (r: Response) => ((await r.json()) as { error: { message: string } }).error.message;

    const first = await startSession(h);
    for (let i = 0; i < 2; i += 1) {
      expect((await send(h, first.sessionToken)).status).toBe(200);
      await settle();
    }
    const full = await send(h, first.sessionToken);
    expect(full.status).toBe(429);
    expect(await message(full)).toContain('This conversation has reached its limit');

    const second = await startSession(h);
    await settle();
    expect((await send(h, second.sessionToken)).status).toBe(200);
    await settle();
    expect(db.raw.prepare('SELECT messages FROM usage_daily').get()).toEqual({ messages: 3 });
    const spent = await send(h, second.sessionToken);
    expect(spent.status).toBe(429);
    expect(await message(spent)).toBe('Chat is unavailable right now.');
  });

  it("gives stateless backends their history from the record: the visitor's words, a form's fields, each reply", async () => {
    const w = await world();
    // Turns are ordered by their millisecond: a person is never quicker than this, a test can be.
    const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
    const started = await startSession(w.h, { ...startBody, firstMessage: 'Do you work weekends?' });
    await w.settle();
    await pause();
    await send(w.h, started.sessionToken, { kind: 'text', text: '/options', clientId: 'c1' });
    await w.settle();
    await pause();
    await send(w.h, await withForms(started.sessionToken, ['f']), { kind: 'action', actionId: 'f', label: 'Send', value: '{"email":"ada@example.com"}', clientId: 'c2' });
    await w.settle();

    const turns = await recordedHistory(w.db, started.sessionId);
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(turns[0]!.content).toBe('Do you work weekends?');
    expect(turns[2]!.content).toBe('/options');
    expect(turns[3]!.content).toContain('[Offered choices:');
    expect(turns[4]!.content).toBe('Send: email: ada@example.com');
  });
});
