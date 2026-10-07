import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/admin/auth.js';
import { ENDPOINTS, findEndpoint } from '../src/api/registry.js';
import { apiReferencePages } from '../src/api/openapi.js';
import { forgetKey } from '../src/api/keys.js';
import { resetMemoryLimits } from '../src/core/ratelimit.js';
import { resetSchemaMemo, type D1Like, type D1Statement } from '../src/db/d1.js';
import { harness, testConfig, testEnv } from './helpers.js';

function d1(): D1Like & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const statement = (sql: string, values: unknown[] = []): D1Statement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...(values as never[])).changes) } }),
    all: async <T,>() => ({ results: raw.prepare(sql).all(...(values as never[])) as T[] }),
    first: async <T,>() => (raw.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
  });
  return { raw, prepare: (sql) => statement(sql), batch: async (statements) => Promise.all(statements.map((s) => s.run())) };
}

const ADMIN_KEY = 'admin-key-that-is-at-least-32-characters-long';
const OWNER = 'owner@acme.com';
type Json = Record<string, any>;

async function world() {
  resetSchemaMemo();
  resetMemoryLimits();
  const db = d1();
  const pending: Promise<unknown>[] = [];
  const env = testEnv({ HELPPUFF_DB: db, ADMIN_API_KEY: ADMIN_KEY, ADMIN_EMAIL: OWNER, ADMIN_PASSWORD_HASH: await hashPassword('correct horse battery', 10_000) });
  // A server calling the API: no Origin header.
  const h = harness(testConfig(), env, null, (p) => pending.push(p));
  const settle = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };
  const call = async (method: string, path: string, key: string | null, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await h.fetch(`/api/v1${path}`, {
      method,
      headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: Json = {};
    try {
      json = JSON.parse(text) as Json;
    } catch {
      // CSV or empty.
    }
    return { status: response.status, json, text, headers: response.headers };
  };
  const createKey = async (body: Json) => {
    const made = await call('POST', '/keys', ADMIN_KEY, body);
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    return made.json as Json & { key: string; id: string };
  };
  return { db, h, call, createKey, settle };
}

describe('the route registry', () => {
  it('lists every route the API serves, and every listed route exists', () => {
    const app = createApp(testConfig());
    const served = new Set(
      app.routes
        .filter((r) => r.path.startsWith('/api/v1/') && r.method !== 'ALL' && r.path !== '/api/v1/openapi.json')
        .map((r) => `${r.method} ${r.path.slice('/api/v1'.length)}`),
    );
    const listed = new Set(ENDPOINTS.map((e) => `${e.method} ${e.path}`));
    expect([...served].filter((route) => !listed.has(route))).toEqual([]);
    expect([...listed].filter((route) => !served.has(route))).toEqual([]);
  });

  it('finds literal paths before parameters', () => {
    expect(findEndpoint('GET', '/leads.csv')?.path).toBe('/leads.csv');
    expect(findEndpoint('GET', '/leads/lead_1')?.path).toBe('/leads/:id');
    expect(findEndpoint('POST', '/login')?.scope).toBeNull();
  });

  it('documents every public endpoint with a curl command and an example response', () => {
    const reference = Object.values(apiReferencePages()).join('\n');
    for (const e of ENDPOINTS.filter((x) => x.scope !== null)) {
      expect(reference, `${e.method} ${e.path}`).toContain(`\`${e.method} ${e.path}\``);
      expect(e.response ?? e.csv, `${e.method} ${e.path} has an example response`).toBeDefined();
    }
    expect(reference).toContain('curl -X POST "$HELPPUFF_URL/api/v1/conversations"');
    expect(reference).toContain('-H "Authorization: Bearer $HELPPUFF_API_KEY"');
    // A TypeScript tab beside each curl one, with the request and response types.
    expect(reference).toContain('```ts [TypeScript]');
    expect(reference).toContain('} satisfies StartConversationRequest),');
    expect(reference).toContain('const data = (await response.json()) as StartConversationResponse;');
  });
});

describe('the door', () => {
  it('needs a key, refuses a key in the URL, hides dashboard-only routes, and sends no CORS headers', async () => {
    const w = await world();
    expect((await w.call('GET', '/me', null)).status).toBe(401);
    expect((await w.call('GET', '/me?api_key=hp_live_x', null)).status).toBe(400);
    expect((await w.call('POST', '/login', ADMIN_KEY, { email: OWNER, password: 'x' })).status).toBe(404);
    expect((await w.call('GET', '/nope', ADMIN_KEY)).status).toBe(404);
    const me = await w.call('GET', '/me', ADMIN_KEY, undefined, { Origin: 'https://example.com' });
    expect(me.status).toBe(200);
    expect(me.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(me.headers.get('X-Request-Id')).toMatch(/^req_/);
  });

  it('never accepts a dashboard cookie', async () => {
    const w = await world();
    const login = await w.h.fetch('/admin/api/login', { method: 'POST', headers: { Origin: 'http://server.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER, password: 'correct horse battery' }) });
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]!;
    expect((await w.h.fetch('/admin/api/me', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await w.h.fetch('/api/v1/me', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it('serves its OpenAPI description to anyone', async () => {
    const w = await world();
    const spec = await w.call('GET', '/openapi.json', null);
    expect(spec.status).toBe(200);
    expect(spec.json['openapi']).toBe('3.1.0');
    expect(spec.json['paths']['/conversations']['post']['x-scope']).toBe('chat');
    expect(spec.json['paths']['/login']).toBeUndefined();
  });
});

describe('API keys', () => {
  it('shows a key once, stores only a hash of it, and lists it without its secret', async () => {
    const w = await world();
    const made = await w.createKey({ name: 'Backend', preset: 'chat' });
    expect(made.key).toMatch(/^hp_live_[a-z2-9]{12}_[\w-]{43}$/);
    expect(made.scopes).toEqual(['chat']);
    const secret = made.key.split('_').slice(3).join('_');
    const row = w.db.raw.prepare('SELECT * FROM api_keys').get() as Record<string, string>;
    expect(JSON.stringify(row)).not.toContain(secret);
    const list = await w.call('GET', '/keys', ADMIN_KEY);
    expect(JSON.stringify(list.json)).not.toContain(secret);
    expect(JSON.stringify(list.json)).not.toContain(row['secret_hash']!);
    expect(list.json['keys'][0]).toMatchObject({ name: 'Backend', prefix: `hp_live_${made.id}`, site: 'demo' });
  });

  it('enforces scopes, its one site, its addresses and its rate', async () => {
    const w = await world();
    const chat = await w.createKey({ name: 'Chat', scopes: ['chat'], ratePerMinute: 3 });
    expect((await w.call('GET', '/me', chat.key)).json['key']).toMatchObject({ scopes: ['chat'], site: 'demo' });
    expect((await w.call('GET', '/leads', chat.key)).status).toBe(403);
    expect((await w.call('POST', '/conversations', chat.key, { site: 'other' })).status).toBe(403);
    // Refused requests count too.
    expect((await w.call('GET', '/me', chat.key)).status).toBe(429);

    const office = await w.createKey({ name: 'Office', scopes: ['leads:read'], allowIps: ['198.51.100.0/24'] });
    expect((await w.call('GET', '/leads', office.key, undefined, { 'CF-Connecting-IP': '203.0.113.7' })).status).toBe(403);
    expect((await w.call('GET', '/leads', office.key, undefined, { 'CF-Connecting-IP': '198.51.100.20' })).status).toBe(200);
    // `:write` includes `:read`.
    const writer = await w.createKey({ name: 'Writer', scopes: ['leads:write'] });
    expect((await w.call('GET', '/leads', writer.key)).status).toBe(200);
  });

  it('stops working when revoked or expired, and a key cannot hand out more than it has', async () => {
    const w = await world();
    const made = await w.createKey({ name: 'Temp', scopes: ['keys:write', 'keys:read'] });
    expect((await w.call('GET', '/keys', made.key)).status).toBe(200);
    expect((await w.call('POST', '/keys', made.key, { name: 'More', scopes: ['chat'] })).status).toBe(403);
    expect((await w.call('POST', '/keys', made.key, { name: 'Same', scopes: ['keys:read'] })).status).toBe(201);
    expect((await w.call('DELETE', `/keys/${made.id}`, ADMIN_KEY)).json).toMatchObject({ revoked: true });
    expect((await w.call('GET', '/keys', made.key)).status).toBe(401);

    const old = await w.createKey({ name: 'Old', scopes: ['chat'] });
    expect((await w.call('GET', '/me', old.key)).status).toBe(200);
    w.db.raw.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').run(Date.now() - 1, old.id);
    // Rows are cached for up to 30 s per isolate; past that, the expiry applies.
    forgetKey(old.id);
    expect((await w.call('GET', '/me', old.key)).status).toBe(401);
    expect((await w.call('GET', '/me', 'hp_live_aaaaaaaaaaaa_' + 'x'.repeat(43))).status).toBe(401);
  });
});

describe('chat over the API', () => {
  it('starts a conversation, answers, records it with its contact, continues it and closes it', async () => {
    const w = await world();
    const chat = await w.createKey({ name: 'Chat', preset: 'chat' });
    const started = await w.call('POST', '/conversations', chat.key, {
      message: 'Hello from my app',
      contact: { name: 'Ada', email: 'ada@example.com' },
      externalId: 'user-123',
      metadata: { plan: 'pro' },
    });
    expect(started.status, JSON.stringify(started.json)).toBe(201);
    expect(started.json).toMatchObject({ externalId: 'user-123', metadata: { plan: 'pro' } });
    expect(started.json['messages'].length).toBeGreaterThan(0);
    const id = started.json['id'] as string;

    const next = await w.call('POST', `/conversations/${id}/messages`, chat.key, { text: 'And a second message' });
    expect(next.status, JSON.stringify(next.json)).toBe(200);
    expect(JSON.stringify(next.json['messages'])).toContain('And a second message');
    expect((await w.call('POST', `/conversations/${id}/end`, chat.key)).json).toEqual({ id, ended: true });
    await w.settle();

    const reader = await w.createKey({ name: 'Reader', preset: 'read' });
    const read = await w.call('GET', `/conversations/${id}`, reader.key);
    expect(read.json['conversation']).toMatchObject({ channel: 'api' });
    expect(read.json['lead']).toMatchObject({ name: 'Ada', email: 'ada@example.com' });
    expect(read.json['messages'].filter((m: Json) => m['role'] === 'user').map((m: Json) => m['text'])).toEqual(['Hello from my app', 'And a second message']);
    expect((await w.call('GET', '/conversations?externalId=user-123', reader.key)).json['items'].map((c: Json) => c['id'])).toEqual([id]);
  });

  it('refuses forms the conversation was not shown, and continues only API conversations', async () => {
    const w = await world();
    const chat = await w.createKey({ name: 'Chat', preset: 'chat' });
    const { json } = await w.call('POST', '/conversations', chat.key, {});
    const forged = await w.call('POST', `/conversations/${json['id']}/messages`, chat.key, { action: { id: 'callback_x', value: '{"phone":"0400 111 222"}' } });
    expect(forged.status).toBe(400);
    expect((await w.call('POST', '/conversations/not-an-api-one/messages', chat.key, { text: 'hi' })).status).toBe(404);
    expect((await w.call('POST', '/conversations', chat.key, { contact: { email: 'not-an-email' } })).status).toBe(400);
  });
});

describe('leads, team and audit', () => {
  it('creates a lead, refuses a second with the same email, and erases one with its conversations', async () => {
    const w = await world();
    const crm = await w.createKey({ name: 'CRM', preset: 'crm' });
    const made = await w.call('POST', '/leads', crm.key, { name: 'Grace', email: 'Grace@Example.com', fields: { company: 'Navy' } });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ email: 'grace@example.com', source: 'api', status: 'new' });
    expect((await w.call('POST', '/leads', crm.key, { email: 'grace@example.com' })).status).toBe(409);

    const chat = await w.createKey({ name: 'Chat', preset: 'chat' });
    const conversation = await w.call('POST', '/conversations', chat.key, { message: 'hi', contact: { email: 'grace@example.com' } });
    await w.settle();
    const lead = await w.call('GET', `/leads/${made.json['id']}`, crm.key);
    expect(lead.json['conversations'].map((c: Json) => c['id'])).toEqual([conversation.json['id']]);

    const erased = await w.call('DELETE', `/leads/${made.json['id']}?erase=conversations`, crm.key);
    expect(erased.json).toMatchObject({ deleted: true, conversationsDeleted: 1 });
    expect(w.db.raw.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 });
  });

  it('adds a teammate with a one-time sign-in link, and removes them', async () => {
    const w = await world();
    const team = await w.createKey({ name: 'Team', scopes: ['team:write'] });
    const added = await w.call('POST', '/admins', team.key, { email: 'sam@acme.com', name: 'Sam' });
    expect(added.status).toBe(201);
    expect(added.json['signInLink']).toMatch(/\/admin\/#\/signin\//);
    expect((await w.call('POST', '/admins', team.key, { email: 'sam@acme.com' })).status).toBe(409);
    expect((await w.call('GET', '/admins', team.key)).json['admins'].map((a: Json) => a['email'])).toEqual(['sam@acme.com']);
    expect((await w.call('DELETE', `/admins/${encodeURIComponent('sam@acme.com')}`, team.key)).json).toEqual({ email: 'sam@acme.com', deleted: true });
    expect((await w.call('DELETE', `/admins/${encodeURIComponent(OWNER)}`, team.key)).status).toBe(400);
  });

  it('records every change with who made it, and never a read', async () => {
    const w = await world();
    const crm = await w.createKey({ name: 'CRM', scopes: ['leads:write', 'audit:read'] });
    const made = await w.call('POST', '/leads', crm.key, { name: 'Ada' });
    await w.call('PATCH', `/leads/${made.json['id']}`, crm.key, { status: 'won' });
    await w.call('GET', '/leads', crm.key);
    await w.settle();
    const log = await w.call('GET', '/audit', crm.key);
    expect(log.json['items'].map((i: Json) => [i['actor'], i['action'], i['target']])).toEqual([
      [`key:${crm.id}`, 'PATCH /leads/:id', made.json['id']],
      [`key:${crm.id}`, 'POST /leads', null],
    ]);
  });
});
