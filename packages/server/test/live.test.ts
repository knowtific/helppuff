import { afterEach, describe, expect, it, vi } from 'vitest';
import { HANDOVER_ACTION } from '@helppuff/protocol';
import { HubCore } from '../src/live/hub.js';
import { liveDeps, runDue, type LiveDeps } from '../src/live/service.js';
import { TELEGRAM_SECRET_HEADER } from '../src/live/telegram.js';
import { chat, say, world } from './inbox-helpers.js';
import { ORIGIN, SECRET } from './helpers.js';

/**
 * Live chat's edges: Telegram end to end (against a fake Bot API), the hub's
 * alarm (a wait that runs out, a chat that goes quiet), the hand-over limits,
 * and the sockets' doors refusing what they should.
 */

const live = { live: { enabled: true } };
const ADMIN_KEY = 'admin-key-for-tests-0123456789abcdef';
const TOKEN = '7123456789:AAH3kTestTokenTestTokenTestToken12345';

/** Telegram's Bot API, in memory: every call is recorded; topics are numbered from 42. */
function fakeTelegram() {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  let topic = 41;
  let message = 100;
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.telegram.org/')) return new Response('not here', { status: 404 });
    const method = url.split('/').pop()!;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ method, body });
    const result =
      method === 'getMe'
        ? { id: 99, first_name: 'Acme Desk', username: 'acme_desk_bot' }
        : method === 'createForumTopic'
          ? { message_thread_id: ++topic, name: body['name'] }
          : method === 'sendMessage'
            ? { message_id: ++message }
            : true;
    return Response.json({ ok: true, result });
  });
  return { fetch, calls, of: (method: string) => calls.filter((c) => c.method === method) };
}

afterEach(() => vi.unstubAllGlobals());

describe('telegram, end to end', () => {
  it('connects, links a group, opens a thread per chat, relays replies and commands', async () => {
    const telegram = fakeTelegram();
    vi.stubGlobal('fetch', telegram.fetch);
    const w = await world(live, { ADMIN_API_KEY: ADMIN_KEY });
    const api = (method: string, path: string, body?: unknown) =>
      w.admin.fetch(`/admin/api${path}`, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

    // A bad token never reaches Telegram.
    expect((await api('POST', '/live/telegram', { token: 'nope' })).status).toBe(400);
    expect(telegram.calls).toEqual([]);

    const connected = (await (await api('POST', '/live/telegram', { token: TOKEN })).json()) as { connected: boolean; linked: boolean; linkCode: string; bot: { username: string } };
    expect(connected).toMatchObject({ connected: true, linked: false, bot: { username: 'acme_desk_bot' } });
    const webhook = telegram.of('setWebhook')[0]!.body;
    expect(webhook).toMatchObject({ url: 'http://server.test/v1/integrations/telegram/demo', allowed_updates: ['message'] });
    const secret = String(webhook['secret_token']);
    // The token is sealed in D1, never stored as given.
    expect(JSON.stringify(w.db.raw.prepare('SELECT config FROM integrations').all())).not.toContain(TOKEN);

    const update = (message: Record<string, unknown>, headerSecret = secret) =>
      w.h.fetch('/v1/integrations/telegram/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [TELEGRAM_SECRET_HEADER]: headerSecret },
        body: JSON.stringify({ update_id: 1, message: { message_id: 1, from: { id: 7, first_name: 'Sam' }, chat: { id: -100, type: 'supergroup', title: 'Acme team', is_forum: true }, ...message } }),
      });

    expect((await update({ text: `/link ${connected.linkCode}` }, 'wrong-secret')).status).toBe(401);
    expect((await update({ text: '/link 0000' })).status).toBe(200);
    await w.settle();
    expect((await (await api('GET', '/live/telegram')).json()) as { linked: boolean }).toMatchObject({ linked: false });
    await update({ text: `/link@acme_desk_bot ${connected.linkCode}` });
    await w.settle();
    expect((await (await api('GET', '/live/telegram')).json()) as Record<string, unknown>).toMatchObject({ linked: true, chat: { title: 'Acme team', topics: true }, linkCode: null });

    // Telegram linked counts as someone available: no dashboard needed.
    const { token, id } = await chat(w.h, 'Do you fix leaks?');
    await w.settle();
    const asked = (await (await say(w.h, token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'person', label: 'Talk to a person' })).json()) as { messages: { status?: string }[] };
    expect(asked.messages[0]?.status).toBe('waiting');
    await w.settle();
    expect(telegram.of('createForumTopic')[0]!.body).toMatchObject({ chat_id: '-100' });
    const intro = telegram.of('sendMessage').find((c) => c.body['message_thread_id'] === 42)!;
    expect(String(intro.body['text'])).toContain('Do you fix leaks?');

    // The visitor writes: it goes to the thread.
    await say(w.h, token, { kind: 'text', text: 'It is dripping' });
    await w.settle();
    expect(telegram.of('sendMessage').some((c) => c.body['message_thread_id'] === 42 && String(c.body['text']).includes('It is dripping'))).toBe(true);

    // Sam answers in the thread: recorded as the team's, and the chat is Sam's.
    await update({ text: 'On my way tomorrow at 9', is_topic_message: true, message_thread_id: 42 });
    await w.settle();
    const detail = (await (await api('GET', `/conversations/${id}`)).json()) as { conversation: Record<string, unknown>; messages: { text: string | null; author: string | null }[] };
    expect(detail.conversation).toMatchObject({ status: 'live', assigned_to: 'telegram:7', assigned_name: 'Sam' });
    expect(detail.messages.find((m) => m.text === 'On my way tomorrow at 9')?.author).toBe('telegram:7');

    // A message in another chat is ignored.
    await w.h.fetch('/v1/integrations/telegram/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [TELEGRAM_SECRET_HEADER]: secret },
      body: JSON.stringify({ message: { message_id: 5, from: { id: 8, first_name: 'Eve' }, chat: { id: -999, type: 'group' }, text: 'hello', is_topic_message: true, message_thread_id: 42 } }),
    });
    await w.settle();
    expect(((await (await api('GET', `/conversations/${id}`)).json()) as { messages: { text: string | null }[] }).messages.some((m) => m.text === 'hello')).toBe(false);

    // /close closes it, here and in Telegram.
    await update({ text: '/close', is_topic_message: true, message_thread_id: 42 });
    await w.settle();
    expect(((await (await api('GET', `/conversations/${id}`)).json()) as { conversation: { status: string } }).conversation.status).toBe('closed');
    expect(telegram.of('closeForumTopic')[0]!.body).toMatchObject({ chat_id: '-100', message_thread_id: 42 });

    // Disconnect forgets it and removes the webhook.
    await api('DELETE', '/live/telegram');
    expect(telegram.of('deleteWebhook')).toHaveLength(1);
    expect((await (await api('GET', '/live/telegram')).json()) as { connected: boolean }).toMatchObject({ connected: false });
  });
});

describe("the hub's alarm", () => {
  it('offers the callback form once a wait runs out, then closes the chat when it goes quiet', async () => {
    const w = await world({ live: { enabled: true, waitSeconds: 30, closeAfterMinutes: 30 } });
    w.hub.connect(HubCore.agent('owner@acme.com', null, true));
    const { token, id } = await chat(w.h);
    await say(w.h, token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'person', label: 'Talk to a person' });
    await w.settle();
    const visitor = w.hub.connect(HubCore.visitor(id, 'ip'));
    const deps: LiveDeps = { ...liveDeps({ env: w.env, secret: SECRET, platform: { now: Date.now, waitUntil: () => {}, log: () => {} } } as never)!, waitUntil: () => {} };

    // Not yet: nothing happens.
    await runDue(w.hub.core, deps, 'demo');
    expect(visitor.sent).toEqual([]);

    w.hub.tick(31_000);
    await runDue(w.hub.core, deps, 'demo');
    expect(visitor.sent).toEqual([
      expect.objectContaining({ t: 'msg', message: expect.objectContaining({ type: 'handover', status: 'missed' }) }),
      expect.objectContaining({ t: 'msg', message: expect.objectContaining({ type: 'form' }) }),
      { t: 'status', status: 'missed' },
    ]);
    const recorded = w.db.raw.prepare("SELECT type FROM messages WHERE conversation_id = ? AND role != 'user' ORDER BY ts").all(id) as { type: string }[];
    expect(recorded.map((r) => r.type).slice(-2)).toEqual(['handover', 'form']);
    // Still live: someone can still take it.
    expect((w.db.raw.prepare('SELECT status FROM conversations WHERE id = ?').get(id) as { status: string }).status).toBe('live');

    // Quiet past closeAfterMinutes (and the database agrees): closed, the visitor told and disconnected.
    w.db.raw.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').run(Date.now() - 31 * 60_000, id);
    w.hub.tick(31 * 60_000);
    await runDue(w.hub.core, deps, 'demo');
    expect((w.db.raw.prepare('SELECT status FROM conversations WHERE id = ?').get(id) as { status: string }).status).toBe('closed');
    expect(visitor.sent).toContainEqual({ t: 'status', status: 'closed' });
    expect(visitor.closed).toBe(true);
  });
});

describe('hand-over limits', () => {
  it('gives the callback form past handoversPerIpPerDay', async () => {
    const w = await world({ live: { enabled: true }, security: { limits: { handoversPerIpPerDay: 1 } } });
    w.hub.connect(HubCore.agent('owner@acme.com', null, true));
    const first = await chat(w.h);
    const ok = (await (await say(w.h, first.token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'p', label: 'Talk to a person' })).json()) as { messages: { status?: string }[] };
    expect(ok.messages[0]?.status).toBe('waiting');
    await w.settle();
    const second = await chat(w.h);
    const refused = (await (await say(w.h, second.token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'p', label: 'Talk to a person' })).json()) as { messages: { type: string; status?: string }[] };
    expect(refused.messages.map((m) => m.type)).toEqual(['handover', 'form']);
    expect(refused.messages[0]?.status).toBe('missed');
  });

  it('gives the callback form when waitingPerSite chats already wait', async () => {
    const w = await world({ live: { enabled: true }, security: { limits: { waitingPerSite: 1 } } });
    w.hub.connect(HubCore.agent('owner@acme.com', null, true));
    const first = await chat(w.h);
    await say(w.h, first.token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'p', label: 'Talk to a person' });
    await w.settle();
    const second = await chat(w.h);
    const refused = (await (await say(w.h, second.token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'p', label: 'Talk to a person' })).json()) as { messages: { status?: string }[] };
    expect(refused.messages[0]?.status).toBe('missed');
  });

  it('lets the assistant keep answering until someone takes the chat, with aiWhileWaiting', async () => {
    const w = await world({ live: { enabled: true, aiWhileWaiting: true } });
    w.hub.connect(HubCore.agent('owner@acme.com', null, true));
    const { token, id } = await chat(w.h);
    await say(w.h, token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'p', label: 'Talk to a person' });
    await w.settle();
    const answered = (await (await say(w.h, token, { kind: 'text', text: 'Still here' })).json()) as { messages: unknown[] };
    expect(answered.messages.length).toBeGreaterThan(0);
    await w.settle();
    // Still live, and the team saw the message too.
    expect((w.db.raw.prepare('SELECT status FROM conversations WHERE id = ?').get(id) as { status: string }).status).toBe('live');
    expect(w.hub.events.some((e) => e.type === 'visitor')).toBe(true);
  });
});

describe("the sockets' doors", () => {
  const upgrade = { Upgrade: 'websocket' };

  it("refuses a visitor socket without a token, from another origin, or for a chat that is not live", async () => {
    const w = await world(live);
    const { token } = await chat(w.h);
    const open = (headers: Record<string, string>) => w.h.fetch('/v1/live/socket', { headers: { ...upgrade, ...headers } });
    expect((await open({ 'Sec-WebSocket-Protocol': 'helppuff.v1' })).status).toBe(401);
    expect((await open({ 'Sec-WebSocket-Protocol': `helppuff.v1, t.${token}`, Origin: 'https://evil.test' })).status).toBe(403);
    expect((await open({ 'Sec-WebSocket-Protocol': `helppuff.v1, t.${token}` })).status).toBe(409);
    expect((await open({ 'Sec-WebSocket-Protocol': 'helppuff.v1, t.forged.token' })).status).toBe(401);
  });

  it('refuses the team socket without a session or from another origin', async () => {
    const w = await world(live);
    const open = (headers: Record<string, string>) => w.admin.fetch('/admin/api/live/socket', { headers: { ...upgrade, ...headers } });
    expect((await open({})).status).toBe(401);
    expect((await open({ Origin: 'https://evil.test' })).status).toBe(403);
    expect((await w.admin.fetch('/admin/api/live/socket')).status).toBe(400);
  });

  it('has no live capability while live chat is off, and 404s its socket', async () => {
    const w = await world();
    const { token } = await chat(w.h);
    expect((await w.h.fetch('/v1/live/socket', { headers: { ...upgrade, 'Sec-WebSocket-Protocol': `helppuff.v1, t.${token}`, Origin: ORIGIN } })).status).toBe(404);
  });
});
