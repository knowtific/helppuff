import { CALLBACK_FORM, messageId } from '@helppuff/connector-types';
import { cleanText, type HandoverStatus, type Message } from '@helppuff/protocol';
import type { LiveConfig, SiteConfig } from '../config/schema.js';
import type { RequestCtx } from '../core/request.js';
import { dbFrom, type D1Like, type D1Statement } from '../db/d1.js';
import { emitTo, workflowRetry } from '../webhooks/deliver.js';
import type { HubCore, HubEvent, HubSettings } from './hub.js';
import { closeThread, openThread, postToThread, readTelegram, telegramReady, type Telegram } from './telegram.js';

/**
 * Live chat, the Worker's side: handing a visitor over to the team, the
 * team's replies, taking, closing and handing back. Every message is written
 * to D1 (the same `messages` table the dashboard, webhooks, summaries and the
 * assistant's history read), then published to the site's hub
 * (`live/hub.ts`), which passes it to the open sockets, and mirrored to
 * Telegram when it is linked.
 *
 * On the visitor's path every write and publish goes through `waitUntil`
 * (the visitor waits for no write); only reads are awaited.
 */

export type LiveDeps = {
  db: D1Like;
  env: Record<string, unknown>;
  secret: string;
  now: () => number;
  fetch: typeof fetch;
  waitUntil: (promise: Promise<unknown>) => void;
  log: (event: string, data?: object) => void;
  /** Send an event to the site's hub. Inside the hub itself, a direct call. */
  publish?: (siteId: string, event: HubEvent) => Promise<void>;
};

export function liveDeps(ctx: RequestCtx): LiveDeps | null {
  const db = dbFrom(ctx.env);
  if (!db) return null;
  return {
    db,
    env: ctx.env,
    secret: ctx.secret,
    now: () => ctx.platform.now(),
    fetch: globalThis.fetch.bind(globalThis),
    waitUntil: (p) => ctx.platform.waitUntil(p),
    log: (event, data) => ctx.platform.log(event, data),
  };
}

// ---------------------------------------------------------------------- hub

type HubStub = { fetch(input: string, init?: RequestInit): Promise<Response> };
type HubNamespace = { idFromName(name: string): unknown; get(id: unknown): HubStub };

export const HUB_BINDING = 'LIVE_HUB';

/** The site's hub, or null when the deployment has no Durable Object binding (older deploys, tests). */
export function hubOf(env: Record<string, unknown>, siteId: string): HubStub | null {
  const ns = env[HUB_BINDING] as Partial<HubNamespace> | undefined;
  if (!ns || typeof ns.idFromName !== 'function' || typeof ns.get !== 'function') return null;
  return ns.get(ns.idFromName(siteId));
}

/** Live chat is on and can run: the setting, the database and the hub binding. */
export function liveAvailable(env: Record<string, unknown>, site: Pick<SiteConfig, 'live'>, siteId: string): boolean {
  return site.live.enabled && Boolean(dbFrom(env)) && Boolean(hubOf(env, siteId));
}

/** Internal requests to the hub carry this host; the hub itself is never reachable from outside. */
export const HUB_ORIGIN = 'https://live-hub.internal';

export async function publish(deps: LiveDeps, siteId: string, event: HubEvent): Promise<void> {
  if (deps.publish) return deps.publish(siteId, event);
  const hub = hubOf(deps.env, siteId);
  if (!hub) return;
  const response = await hub.fetch(`${HUB_ORIGIN}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  if (!response.ok) deps.log('live.publish_failed', { status: response.status });
}

/** People on the team who can take a chat right now (an open dashboard, set to available). */
export async function presence(env: Record<string, unknown>, siteId: string): Promise<{ available: number; agents: { email: string; name: string | null; available: boolean }[] }> {
  const hub = hubOf(env, siteId);
  if (!hub) return { available: 0, agents: [] };
  try {
    const response = await hub.fetch(`${HUB_ORIGIN}/presence`);
    return (await response.json()) as { available: number; agents: { email: string; name: string | null; available: boolean }[] };
  } catch {
    return { available: 0, agents: [] };
  }
}

const hubSettings = (live: LiveConfig): HubSettings => ({ waitSeconds: live.waitSeconds, closeAfterMinutes: live.closeAfterMinutes });

// ----------------------------------------------------------------- messages

/** A status line in the visitor's thread ("Sam joined"), recorded like any message. */
export function handoverMessage(status: HandoverStatus, text: string, agentName?: string | null, now = Date.now()): Message {
  return { id: messageId('ho'), ts: now, role: 'system', type: 'handover', status, text, ...(agentName ? { agentName } : {}) };
}

/** The name the visitor sees for a person: their first name, or "the team". */
export function shownName(live: Pick<LiveConfig, 'showAgentName'>, name: string | null | undefined): string | null {
  if (!live.showAgentName || !name) return null;
  return name.trim().split(/\s+/)[0]!.slice(0, 40) || null;
}

/** The callback form, as offered when nobody was free in time (an id the send route accepts for a handed-over chat). */
export const LIVE_CALLBACK_FORM = `${CALLBACK_FORM}_live`;

export function callbackFormMessage(now = Date.now()): Message {
  return {
    id: LIVE_CALLBACK_FORM,
    ts: now,
    role: 'agent',
    type: 'form',
    title: 'Request a callback',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, autocomplete: 'name' },
      { name: 'phone', label: 'Phone', type: 'tel', autocomplete: 'tel' },
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
      { name: 'message', label: 'What can we help with?', type: 'textarea' },
    ],
    submitLabel: 'Request callback',
  };
}

export const COPY = {
  waiting: 'Connecting you with someone from the team. They’ll reply right here.',
  unavailable: 'Nobody from the team is free right now. Leave your details and we’ll get back to you.',
  limited: 'The team is busy right now. Leave your details and we’ll get back to you.',
  missed: 'Sorry for the wait — nobody is free just now. Leave your details and we’ll get back to you, or keep waiting here.',
  joined: (name: string | null) => (name ? `${name} joined the chat.` : 'Someone from the team joined the chat.'),
  left: 'You’re back with the assistant. Ask anything.',
  closed: 'This chat was closed. Write again any time and the assistant will help.',
  thanks: 'Thanks — the team will get back to you.',
};

/** Statements recording messages the visitor sees, in order, `author` set for a person's. */
export function messageStatements(db: D1Like, conversationId: string, messages: Message[], at: number, author: string | null = null): D1Statement[] {
  return messages.map((m, index) => {
    const text = 'text' in m && typeof m.text === 'string' ? m.text : 'title' in m && typeof m.title === 'string' ? m.title : null;
    const { id: _id, ts: _ts, role: _role, type: _type, ...payload } = m as Message & Record<string, unknown>;
    return db
      .prepare('INSERT OR IGNORE INTO messages (id, conversation_id, role, type, text, payload, ts, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(`${conversationId}:${m.id}`, conversationId, m.role, m.type, text, JSON.stringify(payload), at + index, author);
  });
}

/** Messages recorded after `after` (ms) that the visitor did not write: the polling fallback when the live socket cannot connect. */
export async function messagesSince(db: D1Like, conversationId: string, after: number): Promise<Message[]> {
  const rows = await db
    .prepare("SELECT id, role, type, payload, ts FROM messages WHERE conversation_id = ? AND ts > ? AND role != 'user' ORDER BY ts, id LIMIT 20")
    .bind(conversationId, after)
    .all<{ id: string; role: string; type: string; payload: string | null; ts: number }>();
  return rows.results.flatMap((row) => {
    try {
      const payload = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
      return [{ ...payload, id: row.id.slice(conversationId.length + 1), ts: row.ts, role: row.role, type: row.type } as Message];
    } catch {
      return [];
    }
  });
}

// ----------------------------------------------------------------- webhooks

function emit(deps: LiveDeps, siteId: string, type: Parameters<typeof emitTo>[2], data: Record<string, unknown>): Promise<void> {
  return emitTo({ db: deps.db, fetch: deps.fetch, now: deps.now, log: deps.log, retry: workflowRetry(deps.env) }, siteId, type, data).catch(() => {
    deps.log('webhook.emit_failed', { type });
  });
}

async function telegramOf(deps: LiveDeps, siteId: string): Promise<Telegram | null> {
  return deps.secret.length >= 32 ? readTelegram(deps.db, deps.secret, siteId) : null;
}

// ----------------------------------------------------------------- handover

export type HandoverResult = { status: 'started' | 'unavailable' | 'limited'; messages: Message[] };

type ConversationRow = {
  status: string | null;
  last_at: number;
  assigned_to: string | null;
  assigned_name: string | null;
  handover_at: number | null;
  site_id: string;
};

/** The conversation's live state: read early on the visitor's path, with the limits. */
export async function readLiveState(db: D1Like, conversationId: string): Promise<ConversationRow | null> {
  return db
    .prepare('SELECT status, last_at, assigned_to, assigned_name, handover_at, site_id FROM conversations WHERE id = ?')
    .bind(conversationId)
    .first<ConversationRow>()
    .catch(() => null);
}

/** Whether a conversation is live now: handed to a person and not gone quiet. */
export function isLive(row: Pick<ConversationRow, 'status' | 'last_at'> | null, live: LiveConfig, now: number): boolean {
  return row?.status === 'live' && row.last_at >= now - live.closeAfterMinutes * 60_000;
}

/**
 * A visitor asked for a person. Reads only (who is available, the limits);
 * the hand-over itself is written and announced after the response.
 */
/** No hand-over: the callback form instead (nobody free, live chat off, or a limit). */
export function noHandover(status: 'unavailable' | 'limited', now: number): HandoverResult {
  return { status, messages: [handoverMessage('missed', status === 'limited' ? COPY.limited : COPY.unavailable, null, now), callbackFormMessage(now + 1)] };
}

export async function startHandover(
  deps: LiveDeps,
  site: SiteConfig,
  input: { siteId: string; conversationId: string; visitor: string; exempt: boolean; reason?: string | undefined },
): Promise<HandoverResult> {
  const now = deps.now();
  const unavailable = (status: 'unavailable' | 'limited') => noHandover(status, now);
  if (!site.live.enabled) return unavailable('unavailable');
  const limits = site.security.limits;
  const dayStart = now - (now % 86_400_000);
  const cutoff = now - site.live.closeAfterMinutes * 60_000;
  const [people, telegram, waiting, mine] = await Promise.all([
    presence(deps.env, input.siteId),
    telegramOf(deps, input.siteId).catch(() => null),
    deps.db
      .prepare("SELECT COUNT(*) AS n FROM conversations WHERE site_id = ? AND status = 'live' AND assigned_to IS NULL AND last_at >= ?")
      .bind(input.siteId, cutoff)
      .first<{ n: number }>(),
    input.exempt
      ? null
      : deps.db
          .prepare('SELECT COUNT(*) AS n FROM conversations WHERE site_id = ? AND visitor = ? AND handover_at >= ?')
          .bind(input.siteId, input.visitor, dayStart)
          .first<{ n: number }>(),
  ]);
  if ((mine?.n ?? 0) >= limits.handoversPerIpPerDay || (waiting?.n ?? 0) >= limits.waitingPerSite) {
    deps.log('limit.handover', { siteId: input.siteId });
    return unavailable('limited');
  }
  if (people.available === 0 && !telegramReady(telegram)) return unavailable('unavailable');

  const message = handoverMessage('waiting', COPY.waiting, null, now);
  deps.waitUntil(
    (async () => {
      await deps.db.batch([
        deps.db
          .prepare(
            `UPDATE conversations SET status = 'live', handover_at = ?, waiting_since = ?, assigned_to = NULL, assigned_name = NULL, closed_at = NULL, last_at = MAX(last_at, ?) WHERE id = ?`,
          )
          .bind(now, now, now, input.conversationId),
      ]);
      const card = await handoverCard(deps.db, input.conversationId);
      await publish(deps, input.siteId, { type: 'handover', siteId: input.siteId, conversationId: input.conversationId, conversation: card, settings: hubSettings(site.live) });
      await emit(deps, input.siteId, 'handover.requested', { conversationId: input.conversationId, reason: input.reason ?? null, page: card['pageUrl'] ?? null });
      if (telegramReady(telegram)) {
        await openThread({ db: deps.db, fetch: deps.fetch, now }, telegram, input.siteId, input.conversationId, threadTitle(card), await threadIntro(deps.db, input.conversationId, card, telegram)).catch(
          () => deps.log('telegram.thread_failed'),
        );
      }
    })().catch(() => deps.log('live.handover_failed')),
  );
  return { status: 'started', messages: [message] };
}

/** What the team's notification shows: who, where, what they asked. */
async function handoverCard(db: D1Like, conversationId: string): Promise<Record<string, unknown>> {
  const row = await db
    .prepare(
      `SELECT c.id, c.page_url AS pageUrl, c.first_message AS firstMessage, c.last_at AS lastAt, l.name AS leadName, l.email AS leadEmail, l.phone AS leadPhone
       FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = ?`,
    )
    .bind(conversationId)
    .first<Record<string, unknown>>();
  return row ?? { id: conversationId };
}

function pathOf(url: unknown): string {
  try {
    return new URL(String(url)).pathname;
  } catch {
    return '';
  }
}

const threadTitle = (card: Record<string, unknown>) => `${String(card['leadName'] ?? card['leadEmail'] ?? 'Visitor')}${pathOf(card['pageUrl']) ? ` · ${pathOf(card['pageUrl'])}` : ''}`;

async function threadIntro(db: D1Like, conversationId: string, card: Record<string, unknown>, telegram: Telegram): Promise<string> {
  const turns = (
    await db
      .prepare("SELECT role, text, author FROM messages WHERE conversation_id = ? AND text IS NOT NULL AND type IN ('text', 'options') ORDER BY ts DESC, id DESC LIMIT 6")
      .bind(conversationId)
      .all<{ role: string; text: string; author: string | null }>()
  ).results.reverse();
  const contact = telegram.config.shareContact ? [card['leadEmail'], card['leadPhone']].filter(Boolean).join(' · ') : '';
  return [
    '🙋 A visitor asked for a person.',
    card['pageUrl'] ? `Page: ${String(card['pageUrl'])}` : '',
    contact ? `Contact: ${contact}` : '',
    turns.length ? `\n${turns.map((t) => `${t.role === 'user' ? '👤' : t.author ? '💬' : '🤖'} ${t.text.slice(0, 400)}`).join('\n')}` : '',
    '\nWrite here to answer. /close · /ai (back to the assistant) · /info',
  ]
    .filter(Boolean)
    .join('\n');
}

// --------------------------------------------------------- the visitor writes

/**
 * A visitor's message in a live chat (recorded by `recordTurn`): to the team's
 * dashboards, with whose chat it is and who wrote it (each dashboard decides
 * whether to alert its person), and to Telegram.
 */
export function relayVisitorMessage(deps: LiveDeps, siteId: string, conversationId: string, text: string): void {
  const now = deps.now();
  const message: Message = { id: messageId('u'), ts: now, role: 'user', type: 'text', text: text.slice(0, 8000) || '…' };
  deps.waitUntil(
    (async () => {
      const row = await deps.db
        .prepare('SELECT c.assigned_to AS assignedTo, l.name, l.email FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = ?')
        .bind(conversationId)
        .first<{ assignedTo: string | null; name: string | null; email: string | null }>()
        .catch(() => null);
      await publish(deps, siteId, { type: 'visitor', conversationId, message, assignedTo: row?.assignedTo ?? null, who: row?.name ?? row?.email ?? null });
      const telegram = await telegramOf(deps, siteId);
      if (telegramReady(telegram)) await postToThread({ db: deps.db, fetch: deps.fetch, now }, telegram, siteId, conversationId, `👤 ${text}`);
    })().catch(() => deps.log('live.relay_failed')),
  );
}

// ------------------------------------------------------------ the team writes

export type Author = { id: string; name: string | null };

async function liveRow(db: D1Like, conversationId: string) {
  return db
    .prepare('SELECT id, site_id, status, last_at, assigned_to, assigned_name FROM conversations WHERE id = ?')
    .bind(conversationId)
    .first<{ id: string; site_id: string; status: string | null; last_at: number; assigned_to: string | null; assigned_name: string | null }>();
}

export class LiveError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_live' | 'empty',
    message: string,
  ) {
    super(message);
  }
}

/**
 * A person on the team answers. A reply takes the chat if nobody has it, and
 * takes it over if the assistant has it or it closed (`takeOver`). Written,
 * then sent to the visitor, the other dashboards and (unless it came from
 * there) Telegram.
 */
export async function sendAgentMessage(
  deps: LiveDeps,
  live: LiveConfig,
  input: { conversationId: string; text: string; author: Author; from?: 'dashboard' | 'telegram' },
): Promise<Message> {
  const text = cleanText(input.text, 'input').trim().slice(0, 4000);
  if (!text) throw new LiveError('empty', 'Write a message first.');
  let row = await liveRow(deps.db, input.conversationId);
  if (!row) throw new LiveError('not_found', 'No such conversation.');
  // Writing to a chat the assistant has (or a closed one) takes it over first.
  if (!isLive(row, live, deps.now())) {
    await takeOver(deps, live, { conversationId: input.conversationId, author: input.author });
    row = (await liveRow(deps.db, input.conversationId))!;
  }
  const now = deps.now();
  const name = shownName(live, input.author.name);
  const message: Message = { id: messageId('h'), ts: now, role: 'agent', type: 'text', text, meta: { human: true, ...(name ? { agentName: name } : {}) } };
  const taking = !row.assigned_to;
  const joined = taking ? [handoverMessage('joined', COPY.joined(name), name, now - 1)] : [];
  await deps.db.batch([
    ...messageStatements(deps.db, input.conversationId, joined, now - 1),
    ...messageStatements(deps.db, input.conversationId, [message], now, input.author.id),
    deps.db
      .prepare(
        `UPDATE conversations SET last_at = ?, message_count = message_count + 1, waiting_since = NULL, completed_at = NULL,
           assigned_to = COALESCE(assigned_to, ?), assigned_name = COALESCE(assigned_name, ?) WHERE id = ?`,
      )
      .bind(now, input.author.id, input.author.name, input.conversationId),
  ]);
  deps.waitUntil(
    (async () => {
      if (taking) {
        await publish(deps, row.site_id, { type: 'assigned', conversationId: input.conversationId, to: input.author.id, name, by: input.author.id, messages: joined });
        await emit(deps, row.site_id, 'conversation.assigned', { conversationId: input.conversationId, assignedTo: input.author.id, name: input.author.name, by: input.author.id });
      }
      await publish(deps, row.site_id, { type: 'agent', conversationId: input.conversationId, message, by: input.author.id });
      await emit(deps, row.site_id, 'message.sent', { conversationId: input.conversationId, text, messages: [message], author: { kind: 'human', id: input.author.id, name: input.author.name } });
      if (input.from !== 'telegram') {
        const telegram = await telegramOf(deps, row.site_id);
        if (telegramReady(telegram)) await postToThread({ db: deps.db, fetch: deps.fetch, now }, telegram, row.site_id, input.conversationId, `💬 ${input.author.name ?? input.author.id}: ${text}`);
      }
    })().catch(() => deps.log('live.agent_publish_failed')),
  );
  return message;
}

/** Take a chat, give it to someone, or (null) unassign it. The visitor sees who joined. */
export async function assignConversation(deps: LiveDeps, live: LiveConfig, input: { conversationId: string; to: Author | null; by: string }) {
  const row = await liveRow(deps.db, input.conversationId);
  if (!row) throw new LiveError('not_found', 'No such conversation.');
  const now = deps.now();
  const changed = row.assigned_to !== (input.to?.id ?? null);
  const name = input.to ? shownName(live, input.to.name) : null;
  // The visitor hears about it only in a live chat, and only when the person changes.
  const announce = changed && input.to && isLive(row, live, now) ? [handoverMessage('joined', COPY.joined(name), name, now)] : [];
  await deps.db.batch([
    ...messageStatements(deps.db, input.conversationId, announce, now),
    deps.db.prepare('UPDATE conversations SET assigned_to = ?, assigned_name = ? WHERE id = ?').bind(input.to?.id ?? null, input.to?.name ?? null, input.conversationId),
  ]);
  if (changed) {
    deps.waitUntil(
      (async () => {
        await publish(deps, row.site_id, { type: 'assigned', conversationId: input.conversationId, to: input.to?.id ?? null, name, by: input.by, messages: announce });
        await emit(deps, row.site_id, 'conversation.assigned', { conversationId: input.conversationId, assignedTo: input.to?.id ?? null, name: input.to?.name ?? null, by: input.by });
        const telegram = await telegramOf(deps, row.site_id);
        if (telegramReady(telegram) && input.by !== input.to?.id) {
          await postToThread({ db: deps.db, fetch: deps.fetch, now }, telegram, row.site_id, input.conversationId, input.to ? `➡️ ${input.to.name ?? input.to.id} has this chat.` : '↩️ Nobody has this chat now.');
        }
      })().catch(() => deps.log('live.assign_publish_failed')),
    );
  }
  return { conversationId: input.conversationId, assignedTo: input.to?.id ?? null, assignedName: input.to?.name ?? null };
}

/**
 * Close a conversation (the team, or the hub when it went quiet). A live chat
 * tells the visitor; whoever writes next is answered by the assistant.
 */
export async function closeConversation(deps: LiveDeps, input: { siteId?: string; conversationId: string; by: string; reason: 'team' | 'idle' }) {
  const row = await liveRow(deps.db, input.conversationId);
  if (!row) throw new LiveError('not_found', 'No such conversation.');
  const now = deps.now();
  const wasLive = row.status === 'live';
  // The hub's timer: only a chat still live (a visitor back with the assistant is not closed under them).
  if (input.reason === 'idle' && !wasLive) return { conversationId: input.conversationId, status: 'closed' as const, closedAt: now };
  const notice = wasLive ? [handoverMessage('closed', COPY.closed, null, now)] : [];
  await deps.db.batch([
    ...messageStatements(deps.db, input.conversationId, notice, now),
    deps.db.prepare("UPDATE conversations SET status = 'closed', closed_at = ?, waiting_since = NULL WHERE id = ?").bind(now, input.conversationId),
  ]);
  deps.waitUntil(
    (async () => {
      if (wasLive) await publish(deps, row.site_id, { type: 'ended', conversationId: input.conversationId, status: 'closed', messages: notice });
      await emit(deps, row.site_id, 'conversation.closed', { conversationId: input.conversationId, by: input.by, reason: input.reason, wasLive });
      const telegram = await telegramOf(deps, row.site_id);
      if (wasLive && telegramReady(telegram)) {
        await closeThread({ db: deps.db, fetch: deps.fetch }, telegram, input.conversationId, input.reason === 'idle' ? '✅ Closed: no messages for a while.' : `✅ Closed by ${input.by.replace(/^telegram:/, 'Telegram ')}.`);
      }
    })().catch(() => deps.log('live.close_publish_failed')),
  );
  return { conversationId: input.conversationId, status: 'closed' as const, closedAt: now };
}

/**
 * Back to the assistant: it answers the visitor's next message. From a live
 * chat, or a closed one (reopened for the assistant).
 */
export async function handBack(deps: LiveDeps, live: LiveConfig, input: { conversationId: string; by: string }) {
  const row = await liveRow(deps.db, input.conversationId);
  if (!row) throw new LiveError('not_found', 'No such conversation.');
  const now = deps.now();
  const closed = row.status === 'closed' || row.last_at < now - live.closeAfterMinutes * 60_000;
  if (row.status !== 'live' && !closed) throw new LiveError('not_live', 'The assistant already has this chat.');
  const notice = [handoverMessage('left', COPY.left, null, now)];
  await deps.db.batch([
    ...messageStatements(deps.db, input.conversationId, notice, now),
    deps.db.prepare("UPDATE conversations SET status = 'bot', waiting_since = NULL, closed_at = NULL, last_at = ? WHERE id = ?").bind(now, input.conversationId),
  ]);
  deps.waitUntil(
    (async () => {
      await publish(deps, row.site_id, { type: 'ended', conversationId: input.conversationId, status: 'left', messages: notice });
      await emit(deps, row.site_id, 'handover.ended', { conversationId: input.conversationId, by: input.by, outcome: 'back_to_ai' });
      const telegram = await telegramOf(deps, row.site_id);
      if (telegramReady(telegram)) await closeThread({ db: deps.db, fetch: deps.fetch }, telegram, input.conversationId, '🤖 Handed back to the assistant.');
    })().catch(() => deps.log('live.handback_publish_failed')),
  );
  return { conversationId: input.conversationId, status: 'bot' as const };
}

/**
 * A person takes a chat, whatever it was doing: the assistant had it, someone
 * else had it, or it closed (this reopens it). It becomes live and theirs;
 * the visitor sees who joined, at once if their chat is open, or when they
 * come back. Taking a chat you already have changes nothing.
 */
export async function takeOver(deps: LiveDeps, live: LiveConfig, input: { conversationId: string; author: Author }) {
  const row = await liveRow(deps.db, input.conversationId);
  if (!row) throw new LiveError('not_found', 'No such conversation.');
  const now = deps.now();
  const result = { conversationId: input.conversationId, status: 'live' as const, assignedTo: input.author.id, assignedName: input.author.name };
  if (isLive(row, live, now) && row.assigned_to === input.author.id) return result;
  const name = shownName(live, input.author.name);
  const joined = [handoverMessage('joined', COPY.joined(name), name, now)];
  await deps.db.batch([
    ...messageStatements(deps.db, input.conversationId, joined, now),
    deps.db
      .prepare(
        `UPDATE conversations SET status = 'live', handover_at = COALESCE(handover_at, ?), waiting_since = NULL, closed_at = NULL, completed_at = NULL,
           assigned_to = ?, assigned_name = ?, last_at = ? WHERE id = ?`,
      )
      .bind(now, input.author.id, input.author.name, now, input.conversationId),
  ]);
  deps.waitUntil(
    (async () => {
      await publish(deps, row.site_id, { type: 'takeover', siteId: row.site_id, conversationId: input.conversationId, to: input.author.id, name, messages: joined, settings: hubSettings(live) });
      await emit(deps, row.site_id, 'conversation.assigned', { conversationId: input.conversationId, assignedTo: input.author.id, name: input.author.name, by: input.author.id, takeover: true });
      const telegram = await telegramOf(deps, row.site_id);
      if (telegramReady(telegram)) await postToThread({ db: deps.db, fetch: deps.fetch, now }, telegram, row.site_id, input.conversationId, `➡️ ${input.author.name ?? input.author.id} took this chat.`);
    })().catch(() => deps.log('live.takeover_publish_failed')),
  );
  return result;
}

/** Nobody took a chat in time: the visitor gets the callback form (and may keep waiting). Returns what they see. */
export async function recordMissed(deps: LiveDeps, siteId: string, conversationId: string): Promise<Message[]> {
  const now = deps.now();
  const messages = [handoverMessage('missed', COPY.missed, null, now), callbackFormMessage(now + 1)];
  const row = await liveRow(deps.db, conversationId);
  if (!row || row.status !== 'live' || row.assigned_to) return [];
  await deps.db.batch(messageStatements(deps.db, conversationId, messages, now));
  await emit(deps, siteId, 'handover.missed', { conversationId });
  return messages;
}

/**
 * The hub's alarm: waits that ran out get the callback form, live chats gone
 * quiet are closed, then the alarm points at the next deadline. Publishes go
 * straight to `core` (this runs inside the hub). Without a database it only
 * reschedules.
 */
export async function runDue(core: HubCore, deps: LiveDeps | null, siteId: string | undefined): Promise<void> {
  const due = await core.due();
  if (deps) {
    const inHub: LiveDeps = { ...deps, publish: (_site, event) => core.publish(event) };
    for (const conversationId of due.missed) {
      const messages = await recordMissed(inHub, siteId ?? '', conversationId).catch(() => []);
      if (messages.length) core.missed(conversationId, messages);
    }
    for (const conversationId of due.stale) {
      await closeConversation(inHub, { conversationId, by: 'idle', reason: 'idle' }).catch(() => {});
    }
  }
  await core.schedule();
}
