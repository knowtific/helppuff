import { describe, expect, it } from 'vitest';
import { HANDOVER_ACTION } from '@helppuff/protocol';
import { memberMay } from '../src/admin/guard.js';
import { mergeAttributes } from '../src/admin/inbox.js';
import { open, seal } from '../src/core/secretbox.js';
import { resetSchemaMemo } from '../src/db/d1.js';
import { HubCore } from '../src/live/hub.js';
import { LIVE_CALLBACK_FORM } from '../src/live/service.js';
import { readUpdate, type Telegram } from '../src/live/telegram.js';
import { summarizeConversation } from '../src/conversations/summary.js';
import { chat, d1, memoryHub, OWNER, say, world } from './inbox-helpers.js';

/**
 * The inbox: roles, statuses, attributes, labels, notes, and live chat from
 * a visitor's "Talk to a person" to the team's reply, against real SQLite
 * and an in-memory hub.
 */

describe('roles', () => {
  it('keeps members to the inbox', () => {
    expect(memberMay('GET', '/admin/api/conversations')).toBe(true);
    expect(memberMay('POST', '/admin/api/conversations/abc/reply')).toBe(true);
    expect(memberMay('PATCH', '/admin/api/leads/lead_1')).toBe(true);
    expect(memberMay('DELETE', '/admin/api/notes/note_1')).toBe(true);
    for (const [method, path] of [
      ['GET', '/admin/api/settings'],
      ['PUT', '/admin/api/settings'],
      ['GET', '/admin/api/knowledge/status'],
      ['POST', '/admin/api/prompt'],
      ['GET', '/admin/api/webhooks'],
      ['POST', '/admin/api/labels'],
      ['DELETE', '/admin/api/leads/lead_1'],
      ['DELETE', '/admin/api/conversations/abc'],
      ['GET', '/admin/api/overview'],
      ['GET', '/admin/api/live/telegram'],
    ]) {
      expect(memberMay(method!, path!), `${method} ${path}`).toBe(false);
    }
  });

  it('adds a member who sees conversations but not settings, and lets an admin change the role', async () => {
    const w = await world();
    const mo = await w.member();
    const me = (await (await mo.get('/me')).json()) as { admin: { role: string; name: string } };
    expect(me.admin).toMatchObject({ role: 'member', name: 'Mo Lee' });
    expect((await mo.get('/conversations')).status).toBe(200);
    expect((await mo.get('/settings')).status).toBe(403);
    expect((await mo.send('PATCH', '/admins/mo%40acme.com', { role: 'admin' })).status).toBe(403);
    expect((await w.owner.send('PATCH', '/admins/owner%40acme.com', { role: 'member' })).status).toBe(400);
    const changed = await w.owner.send('PATCH', '/admins/mo%40acme.com', { role: 'admin' });
    expect(await changed.json()).toMatchObject({ email: 'mo@acme.com', role: 'admin' });
    expect((await mo.get('/settings')).status).toBe(200);
    const team = (await (await w.owner.get('/admins')).json()) as { admins: { email: string; role: string }[] };
    expect(team.admins).toEqual([expect.objectContaining({ email: 'mo@acme.com', role: 'admin' })]);
  });
});

describe('attributes, labels and notes', () => {
  it('merges attributes: set, keep, and null removes', () => {
    expect(mergeAttributes({ plan: 'pro', seats: '3' }, { seats: 5, region: 'EU', plan: null })).toEqual({ seats: '5', region: 'EU' });
    expect(() => mergeAttributes({}, { 'bad/key': 'x' })).toThrow(/attribute/);
    expect(() => mergeAttributes({}, { ok: { nested: true } })).toThrow(/string/);
    expect(() => mergeAttributes({}, Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'v'])))).toThrow(/50/);
  });

  it('labels a conversation, filters by label, and keeps attributes and notes on it', async () => {
    const w = await world();
    const { id } = await chat(w.h);
    await w.settle();
    const label = await w.owner.send('POST', '/labels', { name: 'Urgent', color: '#ef4444', description: 'Needs an answer today' });
    expect(label.status).toBe(201);
    expect((await w.owner.send('POST', '/labels', { name: 'urgent' })).status).toBe(409);
    const patched = await w.owner.send('PATCH', `/conversations/${id}`, { addLabels: ['URGENT'], attributes: { orderId: 'A-1042', coupon: 'X' } });
    expect(patched.status).toBe(200);
    await w.owner.send('PATCH', `/conversations/${id}`, { attributes: { coupon: null } });
    expect((await w.owner.send('PATCH', `/conversations/${id}`, { addLabels: ['Nope'] })).status).toBe(400);

    const list = (await (await w.owner.get('/conversations?label=Urgent')).json()) as { items: { id: string; labels: { name: string }[]; attributes: Record<string, string> }[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id, labels: [{ name: 'Urgent' }], attributes: { orderId: 'A-1042' } });

    const note = await w.owner.send('POST', `/conversations/${id}/notes`, { text: 'Called back.' });
    expect(note.status).toBe(201);
    const detail = (await (await w.owner.get(`/conversations/${id}`)).json()) as { labels: unknown[]; notes: { text: string }[]; conversation: { attributes: unknown; status: string } };
    expect(detail.notes.map((n) => n.text)).toEqual(['Called back.']);
    expect(detail.conversation).toMatchObject({ attributes: { orderId: 'A-1042' }, status: 'bot' });

    // Deleting a label takes it off the conversation.
    await w.owner.send('DELETE', `/labels/${((await label.json()) as { id: string }).id}`);
    expect(((await (await w.owner.get('/conversations?label=Urgent')).json()) as { items: unknown[] }).items).toEqual([]);
  });

  it('gives contacts details, attributes and notes, and members edit only their own notes', async () => {
    const w = await world();
    const created = (await (await w.owner.send('POST', '/leads', { name: 'Grace', email: 'grace@example.com', company: 'Navy', attributes: { plan: 'pro' } })).json()) as { id: string; attributes: unknown; company: string };
    expect(created).toMatchObject({ company: 'Navy', attributes: { plan: 'pro' } });
    const updated = (await (await w.owner.send('PATCH', `/leads/${created.id}`, { address: '1 Main St', phone: '0400 000 000', attributes: { plan: null, tier: 'gold' } })).json()) as Record<string, unknown>;
    expect(updated).toMatchObject({ address: '1 Main St', phone: '0400 000 000', attributes: { tier: 'gold' } });
    const ownerNote = (await (await w.owner.send('POST', `/leads/${created.id}/notes`, { text: 'Prefers email.' })).json()) as { id: string };
    const mo = await w.member();
    const moNote = (await (await mo.send('POST', `/leads/${created.id}/notes`, { text: 'Spoke on the phone.' })).json()) as { id: string };
    expect((await mo.send('PATCH', `/notes/${ownerNote.id}`, { text: 'mine now' })).status).toBe(403);
    expect((await mo.send('PATCH', `/notes/${moNote.id}`, { text: 'Spoke twice.' })).status).toBe(200);
    expect((await mo.send('DELETE', `/leads/${created.id}`)).status).toBe(403);
    const detail = (await (await mo.get(`/leads/${created.id}`)).json()) as { teamNotes: { text: string; authorName: string | null }[] };
    expect(detail.teamNotes.map((n) => n.text).sort()).toEqual(['Prefers email.', 'Spoke twice.']);
  });

  it('lets the AI apply only the labels it may use', async () => {
    const w = await world();
    const { id } = await chat(w.h, 'My order never arrived, I want a refund');
    await w.settle();
    await w.owner.send('POST', '/labels', { name: 'Refund', description: 'Asks for money back' });
    await w.owner.send('POST', '/labels', { name: 'VIP', ai: false });
    const ai = {
      run: async (_model: string, input: { messages: { content: string }[] }) => {
        expect(input.messages[0]!.content).toContain('"Refund": Asks for money back');
        expect(input.messages[0]!.content).not.toContain('VIP');
        return { response: JSON.stringify({ summary: 'Wants a refund.', labels: ['refund', 'VIP', 'Made up'] }) };
      },
    };
    const result = await summarizeConversation({ db: w.db, ai, now: Date.now }, id, '@cf/test');
    expect(result?.summary.labels).toEqual(['Refund']);
    const list = (await (await w.owner.get('/conversations')).json()) as { items: { labels: { name: string }[] }[] };
    expect(list.items[0]!.labels.map((l) => l.name)).toEqual(['Refund']);
  });
});

describe('conversation status', () => {
  it('closes by hand or after going quiet, and reopens with the assistant when the visitor writes', async () => {
    const w = await world();
    const { id, token } = await chat(w.h);
    await w.settle();
    expect((await (await w.owner.get('/conversations?status=bot')).json()) as { items: unknown[] }).toMatchObject({ items: [{ id, status: 'bot' }] });
    await w.owner.send('POST', `/conversations/${id}/close`);
    expect((await (await w.owner.get('/conversations?status=closed')).json()) as { items: unknown[] }).toMatchObject({ items: [{ id, status: 'closed' }] });
    expect(((await (await w.owner.get('/conversations?status=bot')).json()) as { items: unknown[] }).items).toEqual([]);

    const again = await say(w.h, token, { kind: 'text', text: 'One more thing' });
    expect(again.status).toBe(200);
    await w.settle();
    expect((await (await w.owner.get(`/conversations/${id}`)).json()) as { conversation: unknown }).toMatchObject({ conversation: { status: 'bot' } });

    // Quiet for longer than live.closeAfterMinutes: closed, without a write.
    w.db.raw.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').run(Date.now() - 61 * 60_000, id);
    expect((await (await w.owner.get('/conversations')).json()) as { items: unknown[] }).toMatchObject({ items: [{ id, status: 'closed' }] });
  });
});

describe('live chat', () => {
  const live = { live: { enabled: true } };

  it('is off by default: no capability, and "talk to a person" gets the callback form', async () => {
    const w = await world();
    const config = (await (await w.h.fetch('/v1/sites/demo/config')).json()) as { capabilities: { live?: boolean } };
    expect(config.capabilities.live).toBeUndefined();
    const { token } = await chat(w.h);
    const response = (await (await say(w.h, token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'person', label: 'Talk to a person' })).json()) as { messages: { type: string }[] };
    expect(response.messages.map((m) => m.type)).toEqual(['handover', 'form']);
    expect(w.hub.events).toEqual([]);
  });

  it('offers the callback form when nobody is available', async () => {
    const w = await world(live);
    expect(((await (await w.h.fetch('/v1/sites/demo/config')).json()) as { capabilities: { live?: boolean } }).capabilities.live).toBe(true);
    const { token, id } = await chat(w.h);
    const response = (await (await say(w.h, token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'person', label: 'Talk to a person' })).json()) as { messages: { type: string; status?: string }[] };
    expect(response.messages).toMatchObject([{ type: 'handover', status: 'missed' }, { type: 'form' }]);
    await w.settle();
    expect((await (await w.owner.get(`/conversations/${id}`)).json()) as { conversation: unknown }).toMatchObject({ conversation: { status: 'bot' } });
  });

  it('hands a visitor to the team, relays both ways, and hands back to the assistant', async () => {
    const w = await world(live);
    const agent = w.hub.connect(HubCore.agent('owner@acme.com', 'Olivia', true));
    const { token, id } = await chat(w.h);
    await w.settle();

    const asked = (await (await say(w.h, token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'person', label: 'Talk to a person' })).json()) as { messages: { type: string; status?: string }[] };
    expect(asked.messages).toMatchObject([{ type: 'handover', status: 'waiting' }]);
    await w.settle();
    expect(w.hub.events.map((e) => e.type)).toEqual(['handover']);
    expect(agent.sent).toContainEqual(expect.objectContaining({ t: 'handover', conversationId: id }));
    const status = (await (await w.owner.get('/live/status')).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ enabled: true, available: 1, live: 1, unassigned: 1, waiting: 1 });

    // The visitor writes: no reply from the assistant; the team sees it.
    const visitor = w.hub.connect(HubCore.visitor(id, 'ip'));
    const quiet = (await (await say(w.h, token, { kind: 'text', text: 'Are you there?' })).json()) as { messages: unknown[] };
    expect(quiet.messages).toEqual([]);
    await w.settle();
    expect(agent.sent).toContainEqual(expect.objectContaining({ t: 'message', conversationId: id }));
    expect(((await (await w.owner.get('/conversations?filter=waiting')).json()) as { items: { id: string }[] }).items.map((c) => c.id)).toEqual([id]);

    // The team answers: it takes the chat, the visitor sees who joined and the reply.
    const reply = await w.owner.send('POST', `/conversations/${id}/reply`, { text: 'Hi, Olivia here.' });
    expect(reply.status).toBe(201);
    expect(await reply.json()).toMatchObject({ role: 'agent', text: 'Hi, Olivia here.', meta: { human: true, agentName: 'Owner' } });
    await w.settle();
    expect(visitor.sent).toContainEqual({ t: 'status', status: 'joined', agentName: 'Owner' });
    expect(visitor.sent).toContainEqual(expect.objectContaining({ t: 'msg', message: expect.objectContaining({ text: 'Hi, Olivia here.' }) }));
    const detail = (await (await w.owner.get(`/conversations/${id}`)).json()) as { conversation: Record<string, unknown>; messages: { text: string | null; author: string | null }[] };
    expect(detail.conversation).toMatchObject({ status: 'live', assigned_to: OWNER, waiting_since: null });
    expect(detail.messages.find((m) => m.text === 'Hi, Olivia here.')?.author).toBe(OWNER);

    // A visitor whose socket cannot connect polls for it.
    const polled = (await (await w.h.fetch('/v1/sessions/messages?after=0', { headers: { Authorization: `Bearer ${token}` } })).json()) as { messages: { text?: string }[] };
    expect(polled.messages.map((m) => m.text)).toContain('Hi, Olivia here.');

    // Back to the assistant: the visitor is told and stays connected; the next message gets an answer.
    expect((await w.owner.send('POST', `/conversations/${id}/handback`)).status).toBe(200);
    await w.settle();
    expect(visitor.sent).toContainEqual({ t: 'status', status: 'left' });
    expect(visitor.closed).toBe(false);
    const answered = (await (await say(w.h, token, { kind: 'text', text: 'Thanks!' })).json()) as { messages: unknown[] };
    expect(answered.messages.length).toBeGreaterThan(0);
  });

  it('lets a person take over a chat the assistant has, at once, and hand it back and take it again', async () => {
    const w = await world(live);
    const { token, id } = await chat(w.h);
    await w.settle();
    // An open chat is connected even before anyone asks for a person.
    const visitor = w.hub.connect(HubCore.visitor(id, 'ip'));
    const taken = await w.owner.send('POST', `/conversations/${id}/takeover`);
    expect(await taken.json()).toMatchObject({ status: 'live', assignedTo: OWNER, assignedName: 'Owner' });
    await w.settle();
    expect(visitor.sent).toContainEqual({ t: 'status', status: 'joined', agentName: 'Owner' });
    expect(visitor.sent).toContainEqual(expect.objectContaining({ t: 'msg', message: expect.objectContaining({ type: 'handover', status: 'joined', text: 'Owner joined the chat.' }) }));
    // The visitor writes: it goes to the team, not the assistant.
    expect(((await (await say(w.h, token, { kind: 'text', text: 'Oh hi' })).json()) as { messages: unknown[] }).messages).toEqual([]);
    // Taking it again changes nothing.
    await w.owner.send('POST', `/conversations/${id}/takeover`);
    await w.settle();
    expect(visitor.sent.filter((f) => (f as { t: string; status?: string }).status === 'joined')).toHaveLength(1);
    // A mistake: back to the assistant, then taken again.
    await w.owner.send('POST', `/conversations/${id}/handback`);
    await w.settle();
    expect((await (await w.owner.get(`/conversations/${id}`)).json()) as { conversation: unknown }).toMatchObject({ conversation: { status: 'bot' } });
    await w.owner.send('POST', `/conversations/${id}/takeover`);
    await w.settle();
    expect((await (await w.owner.get(`/conversations/${id}`)).json()) as { conversation: unknown }).toMatchObject({ conversation: { status: 'live', assigned_to: OWNER } });
  });

  it('reopens a closed chat, with a person or with the assistant', async () => {
    const w = await world(live);
    const { token, id } = await chat(w.h);
    await w.settle();
    await w.owner.send('POST', `/conversations/${id}/close`);
    expect((await (await w.owner.get(`/conversations/${id}`)).json()) as { conversation: unknown }).toMatchObject({ conversation: { status: 'closed' } });

    // Reopened for the assistant.
    expect((await w.owner.send('POST', `/conversations/${id}/handback`)).status).toBe(200);
    expect((await (await w.owner.get(`/conversations/${id}`)).json()) as { conversation: unknown }).toMatchObject({ conversation: { status: 'bot', closed_at: null } });
    expect((await w.owner.send('POST', `/conversations/${id}/handback`)).status).toBe(409);

    // Closed again (even just by going quiet), then reopened with a person by replying.
    w.db.raw.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').run(Date.now() - 61 * 60_000, id);
    const reply = await w.owner.send('POST', `/conversations/${id}/reply`, { text: 'Hi, following up on your question.' });
    expect(reply.status).toBe(201);
    await w.settle();
    const detail = (await (await w.owner.get(`/conversations/${id}`)).json()) as { conversation: Record<string, unknown>; messages: { type: string; text: string | null }[] };
    expect(detail.conversation).toMatchObject({ status: 'live', assigned_to: OWNER, closed_at: null });
    expect(detail.messages.map((m) => m.text)).toEqual(expect.arrayContaining(['Owner joined the chat.', 'Hi, following up on your question.']));
    // A visitor who was away gets it when they come back (the poll, or the socket's catch-up).
    const polled = (await (await w.h.fetch('/v1/sessions/messages?after=0', { headers: { Authorization: `Bearer ${token}` } })).json()) as { messages: { text?: string }[] };
    expect(polled.messages.map((m) => m.text)).toContain('Hi, following up on your question.');
  });

  it('lets a member take over, but needs live chat on', async () => {
    const off = await world();
    const quiet = await chat(off.h);
    await off.settle();
    expect((await off.owner.send('POST', `/conversations/${quiet.id}/takeover`)).status).toBe(400);
    expect((await off.owner.send('POST', `/conversations/${quiet.id}/reply`, { text: 'hi' })).status).toBe(400);

    const w = await world(live);
    const { id } = await chat(w.h);
    await w.settle();
    const mo = await w.member();
    expect(await (await mo.send('POST', `/conversations/${id}/takeover`)).json()).toMatchObject({ status: 'live', assignedTo: 'mo@acme.com' });
  });

  it('accepts the callback form offered when nobody took the chat in time', async () => {
    const w = await world(live);
    w.hub.connect(HubCore.agent('owner@acme.com', null, true));
    const { token, id } = await chat(w.h);
    await say(w.h, token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'person', label: 'Talk to a person' });
    await w.settle();
    const form = await say(w.h, token, { kind: 'action', actionId: LIVE_CALLBACK_FORM, value: JSON.stringify({ name: 'Ada', phone: '0400 111 222' }), label: 'Request callback' });
    expect(form.status).toBe(200);
    await w.settle();
    const callbacks = w.db.raw.prepare('SELECT conversation_id FROM callbacks').all() as { conversation_id: string }[];
    expect(callbacks.map((c) => c.conversation_id)).toEqual([id]);
  });

  it('lets members take a chat but not give it away', async () => {
    const w = await world(live);
    w.hub.connect(HubCore.agent('owner@acme.com', null, true));
    const { token, id } = await chat(w.h);
    await say(w.h, token, { kind: 'action', actionId: HANDOVER_ACTION, value: 'person', label: 'Talk to a person' });
    await w.settle();
    const mo = await w.member();
    expect((await mo.send('POST', `/conversations/${id}/assign`, { to: OWNER })).status).toBe(403);
    expect(await (await mo.send('POST', `/conversations/${id}/assign`, { to: 'me' })).json()).toMatchObject({ assignedTo: 'mo@acme.com', assignedName: 'Mo Lee' });
    expect(await (await w.owner.send('POST', `/conversations/${id}/assign`, { to: OWNER })).json()).toMatchObject({ assignedTo: OWNER });
    expect((await w.owner.send('POST', `/conversations/${id}/assign`, { to: 'stranger@x.com' })).status).toBe(400);
  });
});

describe('the live hub', () => {
  it('times out a wait once, then closes a quiet chat', async () => {
    const hub = memoryHub();
    await hub.core.publish({ type: 'handover', siteId: 'demo', conversationId: 'c1', conversation: {}, settings: { waitSeconds: 60, closeAfterMinutes: 60 } });
    expect(hub.alarm()).not.toBeNull();
    hub.tick(61_000);
    expect(await hub.core.due()).toEqual({ missed: ['c1'], stale: [] });
    expect(await hub.core.due()).toEqual({ missed: [], stale: [] });
    hub.tick(60 * 60_000);
    expect(await hub.core.due()).toEqual({ missed: [], stale: ['c1'] });
    await hub.core.schedule();
    expect(hub.alarm()).toBeNull();
  });

  it('counts people, not tabs, and relays typing to the right visitor', async () => {
    const hub = memoryHub();
    const tab1 = hub.connect(HubCore.agent('sam@x.com', 'Sam', false));
    hub.connect(HubCore.agent('sam@x.com', 'Sam', true));
    hub.connect(HubCore.agent('mo@x.com', 'Mo', false));
    expect(hub.core.presence().available).toBe(1);
    const visitor = hub.connect(HubCore.visitor('c1', 'ip'));
    const other = hub.connect(HubCore.visitor('c2', 'ip'));
    hub.core.onMessage(tab1, JSON.stringify({ t: 'typing', conversationId: 'c1', on: true }));
    expect(visitor.sent).toEqual([{ t: 'typing', on: true }]);
    expect(other.sent).toEqual([]);
    expect(hub.core.visitorSocketsFrom('ip')).toBe(2);
    hub.core.onMessage(visitor, 'not json');
  });
});

describe('telegram', () => {
  it('seals secrets so only the same HELPPUFF_SECRET opens them', async () => {
    const sealed = await seal('a'.repeat(32), 'purpose', '123:token');
    expect(sealed).not.toContain('token');
    expect(await open('a'.repeat(32), 'purpose', sealed)).toBe('123:token');
    expect(await open('b'.repeat(32), 'purpose', sealed)).toBeNull();
  });

  it('reads links, replies in a thread and commands, and ignores other chats', async () => {
    resetSchemaMemo();
    const db = d1();
    const { migrate } = await import('../src/db/migrations.js');
    await migrate(async (sql, params = []) => db.raw.prepare(sql).all(...(params as never[])) as Record<string, unknown>[]);
    db.raw.prepare("INSERT INTO telegram_threads VALUES ('demo', '-100', '42', 'conv1', 0)").run();
    const telegram = { token: 't', secret: 's', config: { chatId: '-100', topics: true } } as unknown as Telegram;
    const from = { id: 7, first_name: 'Sam' };
    const message = (extra: Record<string, unknown>) => ({ message: { message_id: 1, from, chat: { id: -100, type: 'supergroup', is_forum: true }, ...extra } });
    expect(await readUpdate(db, telegram, 'demo', message({ text: '/link abc123' }))).toMatchObject({ kind: 'link', code: 'abc123', forum: true });
    expect(await readUpdate(db, telegram, 'demo', message({ text: 'On my way', is_topic_message: true, message_thread_id: 42 }))).toEqual({
      kind: 'reply',
      conversationId: 'conv1',
      text: 'On my way',
      from: { id: 'telegram:7', name: 'Sam' },
    });
    expect(await readUpdate(db, telegram, 'demo', message({ text: '/close@acme_bot', is_topic_message: true, message_thread_id: 42 }))).toMatchObject({ kind: 'command', command: 'close' });
    expect(await readUpdate(db, telegram, 'demo', { message: { message_id: 2, from, chat: { id: -999, type: 'group' }, text: 'hi' } })).toEqual({ kind: 'ignore' });
    expect(await readUpdate(db, telegram, 'demo', message({ text: 'general chatter' }))).toMatchObject({ kind: 'unrouted' });
  });
});
