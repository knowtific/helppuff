import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/admin/auth.js';
import { createKey } from '../src/api/keys.js';
import { findEndpoint, PUBLIC_ENDPOINTS, type Endpoint } from '../src/api/registry.js';
import { ALL_SCOPES, type Scope } from '../src/api/scopes.js';
import { memoryKv } from '../src/core/platform.js';
import { resetMemoryLimits } from '../src/core/ratelimit.js';
import { resetSchemaMemo, type D1Like, type D1Statement } from '../src/db/d1.js';
import type { HelpPuffConfigInput } from '../src/config/schema.js';
import { harness, SECRET, testConfig, testEnv } from './helpers.js';
import { defineConfig } from '../src/config/load.js';
import { fakeAi, fakeVectors, sqliteD1 } from '../../rag/test/helpers.js';

/**
 * Every public endpoint, called through `/api/v1` with scoped keys:
 *
 *  - the scope matrix: for each route, a key without its scope is refused
 *    (403) and a key with it gets through the door;
 *  - the main flows of each area, end to end;
 *  - the contract: each answer has the fields its documented example has
 *    (api/registry.ts), so the API reference cannot drift from what the API
 *    really returns.
 */

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

type Json = Record<string, any>;
type Site = Partial<HelpPuffConfigInput['sites'][string]>;

const summaryAi = {
  run: async () => ({
    choices: [{ message: { content: JSON.stringify({ summary: 'Asked about weekends.', intent: 'Opening hours', sentiment: 'neutral', leadQuality: 'warm', outcome: 'answered', topics: ['hours'], unanswered: [], followUp: '', contact: { name: 'Ada Lovelace', email: '', phone: '0400 111 222' } }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 40 },
  }),
};

async function world(site: Site = {}) {
  resetSchemaMemo();
  resetMemoryLimits();
  const db = d1();
  const kv = memoryKv();
  const pending: Promise<unknown>[] = [];
  const env = testEnv({ HELPPUFF_DB: db, HELPPUFF_KV: kv, AI: summaryAi, ADMIN_EMAIL: 'owner@acme.com', ADMIN_PASSWORD_HASH: await hashPassword('correct horse battery', 10_000) });
  const h = harness(testConfig(site), env, null, (p) => pending.push(p));
  const settle = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };
  await h.fetch('/admin/api/me'); // applies the schema
  /** A key straight into D1 (no per-site cap: the matrix makes many). */
  const key = async (scopes: Scope[]) => (await createKey(db, SECRET, { name: 'test', siteId: 'demo', scopes, allowIps: [], ratePerMinute: 1000, expiresAt: null, createdBy: 'test' }, Date.now())).key;
  const call = async (method: string, path: string, apiKey: string, body?: unknown, headers: Record<string, string> = {}) => {
    const raw = body instanceof Uint8Array;
    const response = await h.fetch(`/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: raw ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: Json = {};
    try {
      json = JSON.parse(text) as Json;
    } catch {
      // Text, CSV or a stream.
    }
    return { status: response.status, json, text, headers: response.headers };
  };
  return { db, kv, h, key, call, settle };
}

/** Maps whose keys are data (counts by status, custom fields…), not part of the shape. */
const MAPS = new Set(['pages', 'counts', 'facts', 'metadata', 'fields', 'ms', 'embedding', 'utm', 'limits', 'contact']);

/** Top-level fields of `actual` against the documented example (and of the first item of each list). */
function shapeOf(value: unknown, depth = 0, key = ''): unknown {
  if (MAPS.has(key)) return true;
  if (Array.isArray(value)) return value.length && depth < 2 ? [shapeOf(value[0], depth + 1)] : [];
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Json).sort().map((k) => [k, depth < 1 ? shapeOf((value as Json)[k], depth + 1, k) : true]));
  }
  return true;
}
function expectDocumented(method: string, path: string, actual: unknown): void {
  const endpoint = findEndpoint(method, path.split('?')[0]!);
  expect(endpoint, `${method} ${path} is registered`).not.toBeNull();
  const documented = shapeOf(endpoint!.response);
  const real = shapeOf(actual);
  // Lists compare their first item only when both have one.
  const trim = (a: unknown, b: unknown): [unknown, unknown] => {
    if (Array.isArray(a) && Array.isArray(b)) return a.length && b.length ? trim(a[0], b[0]) : [[], []];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      const left: Json = {};
      const right: Json = {};
      for (const k of keys) [left[k], right[k]] = k in (a as Json) && k in (b as Json) ? trim((a as Json)[k], (b as Json)[k]) : [(a as Json)[k] === undefined ? 'missing' : 'present', (b as Json)[k] === undefined ? 'missing' : 'present'];
      return [left, right];
    }
    return [true, true];
  };
  const [docs, api] = trim(documented, real);
  expect(api, `${method} ${endpoint!.path}: the API's fields match the documented example`).toEqual(docs);
}

afterEach(() => vi.restoreAllMocks());

describe('the scope matrix', () => {
  const concrete = (e: Endpoint) =>
    `${e.path.replace(/:id/g, 'x1').replace(':email', 'sam%40acme.com').replace(':version', '1')}${(e.query ?? []).filter((q) => q.required).length ? '?name=notes.txt' : ''}`;
  const bodyOf = (e: Endpoint) => (e.raw ? new TextEncoder().encode('Opening hours: 8–5.') : e.body);

  it('refuses every route to a key without its scope, and lets a key with it through', async () => {
    const w = await world();
    // Calls out to the network; their scope is still checked below.
    const offline = new Set(['GET /install-check']);
    for (const e of PUBLIC_ENDPOINTS) {
      if (e.scope === null || e.scope === 'any') continue;
      const scope = e.scope;
      const route = `${e.method} ${e.path}`;
      const others = ALL_SCOPES.filter((s) => s !== scope && s !== scope.replace(/:read$/, ':write'));
      const refused = await w.call(e.method, concrete(e), await w.key(others), bodyOf(e));
      expect([refused.status, refused.json['error']?.['code']], `${route} without ${scope}`).toEqual([403, 'forbidden']);
      if (offline.has(route)) continue;
      // A key making keys needs the scopes it hands out.
      const granted = scope === 'keys:write' ? [scope, 'chat' as Scope] : [scope];
      const allowed = await w.call(e.method, concrete(e), await w.key(granted), bodyOf(e));
      expect([401, 403], `${route} with ${scope}: ${JSON.stringify(allowed.json)}`).not.toContain(allowed.status);
    }
  });
});

describe('every area, end to end through /api/v1', () => {
  it('chat: starts, continues, streams and closes a conversation', async () => {
    const w = await world({ connector: { type: 'echo', options: { greeting: 'Hello from echo', stream: true } } });
    const chat = await w.key(['chat']);
    const started = await w.call('POST', '/conversations', chat, { message: 'Do you work weekends?', externalId: 'user-1' });
    expect(started.status).toBe(201);
    expectDocumented('POST', '/conversations', started.json);
    const id = started.json['id'] as string;
    const sent = await w.call('POST', `/conversations/${id}/messages`, chat, { text: 'And Sundays?' });
    expectDocumented('POST', `/conversations/${id}/messages`, sent.json);

    const streamed = await w.call('POST', `/conversations/${id}/messages`, chat, { text: 'Streamed please' }, { Accept: 'text/event-stream' });
    expect(streamed.headers.get('Content-Type')).toContain('text/event-stream');
    expect(streamed.text).toContain('event: delta');
    const done = /event: done\ndata: (.*)\n/.exec(streamed.text)?.[1];
    expect(JSON.parse(done!)).toMatchObject({ id, messages: expect.any(Array) });

    const ended = await w.call('POST', `/conversations/${id}/end`, chat);
    expectDocumented('POST', `/conversations/${id}/end`, ended.json);
  });

  it('conversations: lists, reads, summarises and deletes', async () => {
    const w = await world();
    // The summary keeps contact details only when they are in the transcript.
    const id = (await w.call('POST', '/conversations', await w.key(['chat']), { message: "Do you work weekends? I'm Ada Lovelace, 0400 111 222" })).json['id'] as string;
    await w.settle();
    const writer = await w.key(['conversations:write']);
    const list = await w.call('GET', '/conversations', writer);
    expectDocumented('GET', '/conversations', list.json);
    expect(list.json['items'].map((c: Json) => c['id'])).toEqual([id]);
    const one = await w.call('GET', `/conversations/${id}`, writer);
    expectDocumented('GET', `/conversations/${id}`, one.json);
    const summary = await w.call('POST', `/conversations/${id}/summary`, writer);
    expect(summary.status, JSON.stringify(summary.json)).toBe(200);
    expectDocumented('POST', `/conversations/${id}/summary`, summary.json);
    const deleted = await w.call('DELETE', `/conversations/${id}`, writer);
    expectDocumented('DELETE', `/conversations/${id}`, deleted.json);
    expect((await w.call('GET', `/conversations/${id}`, writer)).status).toBe(404);
  });

  it('leads: create, list, read, update, export and delete', async () => {
    const w = await world();
    const crm = await w.key(['leads:write']);
    const made = await w.call('POST', '/leads', crm, { name: 'Grace', email: 'grace@example.com', phone: '0400 333 444', fields: { company: 'Navy' }, notes: 'Expo' });
    expect(made.status).toBe(201);
    expectDocumented('POST', '/leads', made.json);
    const id = made.json['id'] as string;
    expectDocumented('GET', '/leads', (await w.call('GET', '/leads', crm)).json);
    expectDocumented('GET', `/leads/${id}`, (await w.call('GET', `/leads/${id}`, crm)).json);
    const updated = await w.call('PATCH', `/leads/${id}`, crm, { status: 'contacted' });
    expect(updated.json['status']).toBe('contacted');
    expectDocumented('PATCH', `/leads/${id}`, updated.json);
    const csv = await w.call('GET', '/leads.csv', crm);
    expect(csv.headers.get('Content-Type')).toContain('text/csv');
    expect(csv.text.split('\n')[1]).toContain('grace@example.com');
    const deleted = await w.call('DELETE', `/leads/${id}`, crm);
    expectDocumented('DELETE', `/leads/${id}`, deleted.json);
  });

  it('callbacks: lists the waiting requests and closes one', async () => {
    const w = await world();
    const now = Date.now();
    w.db.raw.prepare("INSERT INTO conversations (id, site_id, started_at, last_at, message_count) VALUES ('c1', 'demo', ?, ?, 1)").run(now, now);
    w.db.raw.prepare("INSERT INTO callbacks (id, site_id, conversation_id, name, phone, reason, status, requested_at) VALUES ('cb_1', 'demo', 'c1', 'Ada', '0400 111 222', 'A quote', 'open', ?)").run(now);
    const key = await w.key(['callbacks:write']);
    const list = await w.call('GET', '/callbacks', key);
    expectDocumented('GET', '/callbacks', list.json);
    expect(list.json['items'].map((c: Json) => c['id'])).toEqual(['cb_1']);
    const done = await w.call('PATCH', '/callbacks/cb_1', key, { status: 'done', note: 'Booked' });
    expect(done.json).toMatchObject({ status: 'done', note: 'Booked', closedBy: expect.stringMatching(/^key:/) });
    expectDocumented('PATCH', '/callbacks/cb_1', done.json);
  });

  it('settings: reads them and changes them, live at once', async () => {
    const w = await world();
    const key = await w.key(['settings:write']);
    const read = await w.call('GET', '/settings', key);
    expectDocumented('GET', '/settings', read.json);
    const saved = await w.call('PUT', '/settings', key, { settings: { welcomeMessage: 'Hi from the API', security: { limits: { messagesPerSitePerDay: 800 } } } });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expectDocumented('PUT', '/settings', saved.json);
    const again = await w.call('GET', '/settings', key);
    expect(again.json['settings']).toMatchObject({ welcomeMessage: 'Hi from the API', security: { limits: { messagesPerSitePerDay: 800 } } });
  });

  it('prompt: reads, publishes, reads a version and restores it', async () => {
    const w = await world({ connector: { type: 'cloudflare', options: { binding: 'AI_SEARCH', instructions: 'You help Acme.' } } as never });
    const key = await w.key(['prompt:write']);
    const read = await w.call('GET', '/prompt', key);
    expectDocumented('GET', '/prompt', read.json);
    const published = await w.call('POST', '/prompt', key, { text: 'You help Acme, in the Inner West only.', baseVersion: read.json['version'], note: 'Area' });
    expect(published.json).toMatchObject({ status: 'published' });
    expectDocumented('POST', '/prompt', published.json);
    const versions = (await w.call('GET', '/prompt', key)).json;
    expectDocumented('GET', '/prompt', versions);
    const first = await w.call('GET', '/prompt/versions/1', key);
    expect(first.json['text']).toBe('You help Acme.');
    expectDocumented('GET', '/prompt/versions/1', first.json);
    const restored = await w.call('POST', '/prompt/restore', key, { version: 1, baseVersion: published.json['version'] });
    expect(restored.json).toMatchObject({ status: 'published' });
    expectDocumented('POST', '/prompt/restore', restored.json);
  });

  it('webhooks: adds, lists, tests, reads deliveries, disables and removes', async () => {
    const w = await world();
    const key = await w.key(['webhooks:write']);
    const added = await w.call('POST', '/webhooks', key, { url: 'https://hooks.example.com/helppuff', events: ['lead.captured'], description: 'CRM' });
    expect(added.status).toBe(201);
    expect(added.json['secret']).toMatch(/^whsec_/);
    expectDocumented('POST', '/webhooks', added.json);
    const id = added.json['id'] as string;
    expectDocumented('GET', '/webhooks', (await w.call('GET', '/webhooks', key)).json);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    const tested = await w.call('POST', `/webhooks/${id}/test`, key, {});
    expect(tested.json).toMatchObject({ ok: true, status: 200 });
    expectDocumented('POST', `/webhooks/${id}/test`, tested.json);
    const deliveries = await w.call('GET', `/webhooks/${id}/deliveries`, key);
    expect(deliveries.json['deliveries']).toHaveLength(1);
    expectDocumented('GET', `/webhooks/${id}/deliveries`, deliveries.json);
    const off = await w.call('PATCH', `/webhooks/${id}`, key, { enabled: false });
    expect(off.json['enabled']).toBe(false);
    expectDocumented('PATCH', `/webhooks/${id}`, off.json);
    expectDocumented('DELETE', `/webhooks/${id}`, (await w.call('DELETE', `/webhooks/${id}`, key)).json);
  });

  it('analytics: overview and version', async () => {
    const w = await world();
    await w.call('POST', '/conversations', await w.key(['chat']), { message: 'Hello' });
    await w.settle();
    const key = await w.key(['analytics:read']);
    const overview = await w.call('GET', '/overview?days=7', key);
    expect(overview.json['totals']['conversations']).toBe(1);
    expectDocumented('GET', '/overview', overview.json);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 }));
    const version = await w.call('GET', '/version', key);
    expectDocumented('GET', '/version', version.json);
  });

  it('team: adds, lists, makes a sign-in link and removes', async () => {
    const w = await world();
    const key = await w.key(['team:write']);
    const added = await w.call('POST', '/admins', key, { email: 'sam@acme.com', name: 'Sam' });
    expectDocumented('POST', '/admins', added.json);
    expectDocumented('GET', '/admins', (await w.call('GET', '/admins', key)).json);
    const link = await w.call('POST', '/admins/sam%40acme.com/sign-in-link', key);
    expectDocumented('POST', '/admins/x/sign-in-link', link.json);
    expectDocumented('DELETE', '/admins/x', (await w.call('DELETE', '/admins/sam%40acme.com', key)).json);
  });

  it('keys and audit: a key makes, lists and revokes keys, and every change is in the log', async () => {
    const w = await world();
    const admin = await w.key(['keys:write', 'audit:read', 'chat']);
    const made = await w.call('POST', '/keys', admin, { name: 'Website', preset: 'chat', expiresInDays: 30 });
    expect(made.status).toBe(201);
    expectDocumented('POST', '/keys', made.json);
    expectDocumented('GET', '/keys', (await w.call('GET', '/keys', admin)).json);
    const revoked = await w.call('DELETE', `/keys/${made.json['id']}`, admin);
    expectDocumented('DELETE', `/keys/${made.json['id']}`, revoked.json);
    expect((await w.call('GET', '/me', made.json['key'])).status).toBe(401);
    await w.settle();
    const log = await w.call('GET', '/audit?limit=1', admin);
    expectDocumented('GET', '/audit', log.json);
    expect(log.json['items']).toHaveLength(1);
    expect(log.json['next']).toEqual(expect.any(Number));
    const older = await w.call('GET', `/audit?before=${log.json['next']}`, admin);
    expect(older.json['items'].map((i: Json) => i['action'])).toContain('POST /keys');
  });

  it('account: who the key is', async () => {
    const w = await world();
    const me = await w.call('GET', '/me', await w.key(['chat']));
    expectDocumented('GET', '/me', me.json);
  });
});

describe('knowledge, end to end through /api/v1', () => {
  it('adds hand-written knowledge, finds it, sets business details, uploads a file and reports status', async () => {
    resetSchemaMemo();
    resetMemoryLimits();
    const db = sqliteD1();
    const created: unknown[] = [];
    const config = defineConfig({
      sites: {
        demo: {
          origins: ['https://acme.test'],
          connector: { type: 'workers-ai', options: { instructions: 'You help Acme.' } },
          knowledge: { website: 'https://acme.test' },
        },
      },
    });
    const env = testEnv({ HELPPUFF_DB: db, AI: fakeAi(), VECTORS: fakeVectors(), CRAWL_WORKFLOW: { create: async (o: unknown) => void created.push(o) } });
    const h = harness(config, env, null, () => {});
    await h.fetch('/admin/api/me');
    const key = (await createKey(db, SECRET, { name: 't', siteId: 'demo', scopes: ['knowledge:write'], allowIps: [], ratePerMinute: 1000, expiresAt: null, createdBy: 't' }, Date.now())).key;
    const call = async (method: string, path: string, body?: unknown) => {
      const raw = body instanceof Uint8Array;
      const response = await h.fetch(`/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }) },
        ...(body === undefined ? {} : { body: raw ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body) }),
      });
      return { status: response.status, json: (await response.json()) as Json };
    };

    const added = await call('POST', '/knowledge/manual', { id: 'holiday-hours', title: 'Holiday hours', content: 'We are closed on 25 and 26 December.' });
    expect(added.status, JSON.stringify(added.json)).toBe(200);
    expectDocumented('POST', '/knowledge/manual', added.json);
    expectDocumented('GET', '/knowledge/manual', (await call('GET', '/knowledge/manual')).json);
    const found = await call('POST', '/knowledge/search', { query: 'closed in December', k: 3 });
    expect(found.json['chunks'].map((c: Json) => c['title'])).toContain('Holiday hours');
    expectDocumented('POST', '/knowledge/search', found.json);

    const facts = await call('PUT', '/knowledge/facts', { facts: { phone: '1300 000 000' } });
    expect(facts.json['facts']).toContainEqual({ key: 'phone', value: '1300 000 000' });
    expectDocumented('PUT', '/knowledge/facts', facts.json);
    expectDocumented('GET', '/knowledge/facts', (await call('GET', '/knowledge/facts')).json);

    const upload = await call('POST', '/knowledge/files?name=notes.txt', new TextEncoder().encode('Opening hours: 8am to 5pm.'));
    expect(upload.status).toBe(202);
    expect(created).toHaveLength(1);
    expectDocumented('POST', '/knowledge/files', upload.json);
    expectDocumented('GET', '/knowledge/files', (await call('GET', '/knowledge/files')).json);
    expectDocumented('GET', '/knowledge/pages', (await call('GET', '/knowledge/pages')).json);
    expectDocumented('GET', '/knowledge/status', (await call('GET', '/knowledge/status')).json);
    expectDocumented('DELETE', '/knowledge/manual/holiday-hours', (await call('DELETE', '/knowledge/manual/holiday-hours')).json);
  });
});
