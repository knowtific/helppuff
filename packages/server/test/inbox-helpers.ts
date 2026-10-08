import { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';
import { hashPassword } from '../src/admin/auth.js';
import { resetSchemaMemo, type D1Like, type D1Statement } from '../src/db/d1.js';
import { HubCore, type HubEvent, type HubSocket, type HubStorage } from '../src/live/hub.js';
import { harness, ORIGIN, startBody, startSession, testConfig, testEnv, type Harness } from './helpers.js';

/** The inbox and live chat's test world: real SQLite, an in-memory live hub, a signed-in owner. */

export function d1(): D1Like & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const statement = (sql: string, values: unknown[] = []): D1Statement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...(values as never[])).changes) } }),
    all: async <T,>() => ({ results: raw.prepare(sql).all(...(values as never[])) as T[] }),
    first: async <T,>() => (raw.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
  });
  return { raw, prepare: (sql) => statement(sql), batch: async (statements) => Promise.all(statements.map((s) => s.run())) };
}

/** Sockets and storage in memory: the hub as the Durable Object runs it, minus the runtime. */
export function memoryHub() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  const sockets: (HubSocket & { tags: string[]; sent: unknown[]; closed: boolean })[] = [];
  const storage: HubStorage = {
    get: async <T,>(key: string) => store.get(key) as T | undefined,
    put: async (key, value) => void store.set(key, structuredClone(value)),
    delete: async (key) => store.delete(key),
    list: async <T,>({ prefix }: { prefix: string }) => new Map([...store].filter(([k]) => k.startsWith(prefix)) as [string, T][]),
    setAlarm: async (at) => void (alarm = at),
    deleteAlarm: async () => void (alarm = null),
  };
  let now = Date.now();
  const core = new HubCore({ sockets: (tag) => sockets.filter((s) => !s.closed && (!tag || s.tags.includes(tag))), storage, now: () => now });
  const connect = (who: { tags: string[]; attachment: unknown }) => {
    let attachment = who.attachment;
    const socket = {
      tags: who.tags,
      sent: [] as unknown[],
      closed: false,
      send: (data: string) => void socket.sent.push(JSON.parse(data)),
      close: () => void (socket.closed = true),
      serializeAttachment: (value: unknown) => void (attachment = value),
      deserializeAttachment: () => attachment,
    };
    sockets.push(socket);
    return socket;
  };
  const events: HubEvent[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        if (path === '/presence') return Response.json(core.presence());
        if (path === '/publish') {
          const event = JSON.parse(String(init?.body)) as HubEvent;
          events.push(event);
          await core.publish(event);
          return new Response(null, { status: 204 });
        }
        return new Response('nope', { status: 404 });
      },
    }),
  };
  return { core, connect, namespace, events, store, alarm: () => alarm, tick: (ms: number) => void (now += ms) };
}

export const OWNER = 'owner@acme.com';
export const PASSWORD = 'correct horse battery staple';
const ADMIN_ORIGIN = 'http://server.test';

export async function world(site: Parameters<typeof testConfig>[0] = {}, extraEnv: Record<string, unknown> = {}) {
  resetSchemaMemo();
  const db = d1();
  const hub = memoryHub();
  const pending: Promise<unknown>[] = [];
  const env = testEnv({ HELPPUFF_DB: db, LIVE_HUB: hub.namespace, ADMIN_EMAIL: OWNER, ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD, 10_000), ...extraEnv });
  const config = testConfig({ widget: { leadForm: { enabled: false, fields: [] } }, ...site });
  const h = harness(config, env, ORIGIN, (p) => pending.push(p));
  const admin = harness(config, env, ADMIN_ORIGIN, (p) => pending.push(p));
  const settle = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };
  await admin.fetch('/admin/api/me'); // applies the schema
  const login = async (email = OWNER, password = PASSWORD) => {
    const response = await admin.post('/admin/api/login', { email, password });
    expect(response.status).toBe(200);
    return response.headers.get('Set-Cookie')!.split(';')[0]!;
  };
  const owner = await login();
  const as = (cookie: string) => ({
    get: async (path: string) => admin.fetch(`/admin/api${path}`, { headers: { Cookie: cookie } }),
    send: async (method: string, path: string, body?: unknown) =>
      admin.fetch(`/admin/api${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  });
  const member = async () => {
    await as(owner).send('POST', '/admins', { email: 'mo@acme.com', name: 'Mo Lee', password: 'member-password-1', role: 'member' });
    return as(await login('mo@acme.com', 'member-password-1'));
  };
  return { db, hub, h, admin, settle, env, owner: as(owner), member };
}

export async function chat(h: Harness, text = 'Hello there') {
  const started = await startSession(h, { ...startBody, firstMessage: text });
  return { token: started.sessionToken, id: started.sessionId };
}

export const say = (h: Harness, token: string, body: Record<string, unknown>) =>
  h.post('/v1/sessions/messages', { clientId: `c${Math.random()}`, ...body }, { headers: { Authorization: `Bearer ${token}` } });

