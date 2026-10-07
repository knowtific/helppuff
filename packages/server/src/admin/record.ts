import { cleanText, type Message, type SendRequest, type VisitorContext } from '@helppuff/protocol';
import { usageDay } from '@helppuff/rag';
import type { RequestCtx } from '../core/request.js';
import { dbFrom, ensureSchema, type D1Like, type D1Statement } from '../db/d1.js';
import { conversationStarted, leadCaptured, turn } from '../webhooks/events.js';
import { emit } from '../webhooks/deliver.js';
import { startConversationJob } from '../conversations/complete.js';

/**
 * Writes the conversation to D1 for the dashboard, after the response.
 * The same record serves the per-conversation and daily limits
 * (`core/ratelimit.ts`) and the stateless backends' history
 * (`conversations/history.ts`), so none of those keep a copy in KV.
 *
 * Every call is scheduled with `waitUntil` and swallows its own failures:
 * the dashboard missing a row is a small loss; a visitor's reply waiting
 * on, or failing because of, a database write is not acceptable.
 */

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;

/** Contact details a visitor typed into the chat, if any. */
export function contactIn(text: string): { email?: string; phone?: string } {
  const email = EMAIL.exec(text)?.[0];
  const phoneMatch = PHONE.exec(text)?.[0];
  const digits = phoneMatch?.replace(/\D/g, '') ?? '';
  const phone = digits.length >= 8 && digits.length <= 15 ? phoneMatch!.trim() : undefined;
  return { ...(email ? { email: email.toLowerCase() } : {}), ...(phone ? { phone } : {}) };
}

/**
 * Rows for a batch of replies. Stored `ts` is the order they were shown in,
 * one millisecond apart after the visitor's message — connectors stamp
 * messages as they build them, which is not always display order.
 */
function messageRows(db: D1Like, conversationId: string, messages: Message[], at: number): D1Statement[] {
  return messages.map((m, index) => {
    const text = 'text' in m && typeof m.text === 'string' ? m.text : 'title' in m && typeof m.title === 'string' ? m.title : null;
    const { id: _id, ts: _ts, role: _role, type: _type, ...payload } = m as Message & Record<string, unknown>;
    return db
      .prepare('INSERT OR IGNORE INTO messages (id, conversation_id, role, type, text, payload, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(`${conversationId}:${m.id}`, conversationId, m.role, m.type, text, JSON.stringify(payload), at + index);
  });
}

/** A visitor's message. An action keeps its value (a chip's, a form's fields): the model's history reads it. */
function visitorMessage(conversationId: string, text: string, ts: number, db: D1Like, value?: string): D1Statement {
  return db
    .prepare('INSERT OR IGNORE INTO messages (id, conversation_id, role, type, text, payload, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      `${conversationId}:u${ts}${Math.random().toString(36).slice(2, 6)}`,
      conversationId,
      'user',
      'text',
      text,
      value === undefined ? null : JSON.stringify({ value }),
      ts,
    );
}

/** One visitor message on the site's day: the daily limit and the dashboard's usage both read it. */
function countMessage(db: D1Like, siteId: string, now: number): D1Statement {
  return db
    .prepare(
      `INSERT INTO usage_daily (day, site_id, neurons_est, messages) VALUES (?, ?, 0, 1)
       ON CONFLICT (day, site_id) DO UPDATE SET messages = messages + 1`,
    )
    .bind(usageDay(now), siteId);
}

/**
 * Record what a conversation told us about the visitor. A lead is a person:
 * the email is the key, so a visitor who comes back (or gives their email in
 * a second chat) enriches the lead they already have, and the conversation
 * points at it. Details are filled in, never overwritten: an email typed in a
 * chat proves nothing, so a stranger who types a customer's address can add
 * a conversation to that contact but cannot change their name, phone or
 * answers. Form fields merge the same way: new keys are added, existing
 * ones keep their first value (the new one stays in that conversation).
 *
 * Statements, for a `db.batch` (so they apply together, in order):
 *  - with an email that another lead already has, any email-less lead this
 *    conversation started (a phone typed earlier) is folded into that one;
 *  - an email-less lead of this conversation takes the email;
 *  - the upsert, which lands on the existing person if there is one;
 *  - the conversation is linked to the person.
 * Without an email, details go to the conversation's lead, made if missing.
 */
export function leadStatements(
  db: D1Like,
  siteId: string,
  conversationId: string,
  lead: { name?: string; email?: string; phone?: string; fields?: Record<string, string> },
  source: 'form' | 'chat' | 'ai',
  now: number,
): D1Statement[] {
  const own = `lead_${conversationId}`;
  const email = lead.email?.trim().toLowerCase() || null;
  const name = lead.name ?? null;
  const phone = lead.phone ?? null;
  const fields = lead.fields && Object.keys(lead.fields).length ? JSON.stringify(lead.fields) : null;
  const current = '(SELECT lead_id FROM conversations WHERE id = ?)';
  const merge = `name = COALESCE(leads.name, excluded.name),
         email = COALESCE(leads.email, excluded.email),
         phone = COALESCE(leads.phone, excluded.phone),
         fields = CASE WHEN leads.fields IS NULL THEN excluded.fields WHEN excluded.fields IS NULL THEN leads.fields ELSE json_patch(excluded.fields, leads.fields) END,
         updated_at = excluded.updated_at`;

  if (!email) {
    return [
      db
        .prepare(
          `UPDATE leads SET name = COALESCE(name, ?), phone = COALESCE(phone, ?),
             fields = CASE WHEN ? IS NULL THEN fields WHEN fields IS NULL THEN ? ELSE json_patch(?, fields) END, updated_at = ?
           WHERE id = ${current}`,
        )
        .bind(name, phone, fields, fields, fields, now, conversationId),
      db
        .prepare(
          `INSERT INTO leads (id, site_id, conversation_id, name, email, phone, fields, source, status, created_at, updated_at)
           SELECT ?, ?, ?, ?, NULL, ?, ?, ?, 'new', ?, ? WHERE ${current} IS NULL
           ON CONFLICT DO UPDATE SET ${merge}`,
        )
        .bind(own, siteId, conversationId, name, phone, fields, source, now, now, conversationId),
      db.prepare('UPDATE conversations SET lead_id = COALESCE(lead_id, ?) WHERE id = ?').bind(own, conversationId),
    ];
  }

  const taken = 'SELECT 1 FROM leads WHERE site_id = ? AND email = ?';
  return [
    db
      .prepare(
        `UPDATE leads SET
           name = COALESCE(name, (SELECT name FROM leads WHERE id = ${current})),
           phone = COALESCE(phone, (SELECT phone FROM leads WHERE id = ${current})),
           updated_at = ?
         WHERE site_id = ? AND email = ? AND EXISTS (SELECT 1 FROM leads WHERE id = ${current} AND email IS NULL)`,
      )
      .bind(conversationId, conversationId, now, siteId, email, conversationId),
    db
      .prepare(`DELETE FROM leads WHERE id = ${current} AND email IS NULL AND EXISTS (${taken})`)
      .bind(conversationId, siteId, email),
    db
      .prepare(`UPDATE leads SET email = ? WHERE id = ${current} AND email IS NULL AND NOT EXISTS (${taken})`)
      .bind(email, conversationId, siteId, email),
    db
      .prepare(
        `INSERT INTO leads (id, site_id, conversation_id, name, email, phone, fields, source, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
         ON CONFLICT DO UPDATE SET ${merge}`,
      )
      .bind(own, siteId, conversationId, name, email, phone, fields, source, now, now),
    db
      .prepare(`UPDATE conversations SET lead_id = COALESCE((SELECT id FROM leads WHERE site_id = ? AND email = ?), lead_id) WHERE id = ?`)
      .bind(siteId, email, conversationId),
  ];
}

function schedule(ctx: RequestCtx, work: (db: D1Like) => Promise<void>): void {
  const db = dbFrom(ctx.env);
  if (!db) return;
  ctx.platform.waitUntil(
    (async () => {
      try {
        await ensureSchema(db);
        await work(db);
      } catch {
        ctx.platform.log('record.failed');
      }
    })(),
  );
}

export function recordStart(
  ctx: RequestCtx,
  input: {
    siteId: string;
    sessionId: string;
    /** The salted IP hash the rate limits use (never the IP): per-visitor daily limits count from it. */
    visitor?: string;
    /** Who holds the conversation: the widget, or the public API. */
    channel?: 'widget' | 'api';
    lead: Record<string, string>;
    context: VisitorContext;
    firstMessage?: string | undefined;
    messages: Message[];
    country: string | null;
  },
): void {
  conversationStarted(ctx, { ...input, typed: input.firstMessage ? contactIn(input.firstMessage) : {} });
  schedule(ctx, async (db) => {
    const now = ctx.platform.now();
    const statements: D1Statement[] = [
      db
        .prepare(
          `INSERT OR IGNORE INTO conversations
           (id, site_id, started_at, last_at, page_url, page_title, referrer, utm, locale, country, first_message, message_count, visitor, channel)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.sessionId,
          input.siteId,
          now,
          now,
          input.context.pageUrl ?? null,
          input.context.pageTitle ?? null,
          input.context.referrer ?? null,
          input.context.utm ? JSON.stringify(input.context.utm) : null,
          input.context.locale ?? null,
          input.country,
          input.firstMessage?.slice(0, 500) ?? null,
          (input.firstMessage ? 1 : 0) + input.messages.length,
          input.visitor ?? null,
          input.channel ?? 'widget',
        ),
    ];
    if (input.firstMessage) statements.push(visitorMessage(input.sessionId, input.firstMessage, now - 1, db), countMessage(db, input.siteId, now));
    statements.push(...messageRows(db, input.sessionId, input.messages, now));

    const typed = input.firstMessage ? contactIn(input.firstMessage) : {};
    const fromForm = Object.keys(input.lead).length > 0;
    if (fromForm || typed.email || typed.phone) {
      const { name, email, phone, ...rest } = input.lead;
      statements.push(
        ...leadStatements(
          db,
          input.siteId,
          input.sessionId,
          {
            ...(name ? { name } : {}),
            ...((email ?? typed.email) ? { email: email ?? typed.email } : {}),
            ...((phone ?? typed.phone) ? { phone: phone ?? typed.phone } : {}),
            ...(Object.keys(rest).length ? { fields: rest } : {}),
          },
          fromForm ? 'form' : 'chat',
          now,
        ),
      );
    }
    await db.batch(statements);
    // The end-of-chat job: summary, labels and conversation.completed, once the visitor goes quiet.
    startConversationJob(ctx, input.siteId, input.sessionId);
  });
}

/**
 * Contact details in a submitted inline form: the widget sends the fields as
 * a JSON object in the action's value. Only plain string fields count.
 */
export function formLead(request: SendRequest, limits = { maxLeadFieldLength: 200, maxLeadMessageLength: 2000 }): Record<string, string> | null {
  if (request.kind !== 'action' || !request.value.trim().startsWith('{')) return null;
  try {
    const value = JSON.parse(request.value) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const lead: Record<string, string> = {};
    // A form has at most 12 fields (the protocol's limit), each named like a field.
    for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
      if (typeof raw !== 'string' || !/^[\w-]{1,64}$/.test(key)) continue;
      const text = cleanText(raw, key === 'message' ? 'input' : 'line').slice(0, key === 'message' ? limits.maxLeadMessageLength : limits.maxLeadFieldLength);
      if (text) lead[key] = text;
    }
    const typed = contactIn(`${lead['email'] ?? ''} ${lead['phone'] ?? ''}`);
    return typed.email || typed.phone ? lead : null;
  } catch {
    return null;
  }
}

/** A lead the conversation produced (a tool call, a submitted form): stored on the conversation. */
export function recordLead(
  ctx: RequestCtx,
  input: { siteId: string; sessionId: string; lead: Record<string, string>; source: 'form' | 'chat' | 'ai' },
): void {
  leadCaptured(ctx, input);
  schedule(ctx, async (db) => {
    const now = ctx.platform.now();
    const { name, email, phone, request, ...rest } = input.lead;
    // A callback request is its own record (the Callbacks page), not a field on the contact.
    if (request === 'callback') delete rest['message'];
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO conversations (id, site_id, started_at, last_at, message_count) VALUES (?, ?, ?, ?, 0)`,
        )
        .bind(input.sessionId, input.siteId, now, now),
      ...leadStatements(
        db,
        input.siteId,
        input.sessionId,
        {
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(Object.keys(rest).length ? { fields: rest } : {}),
        },
        input.source,
        now,
      ),
      ...(request === 'callback'
        ? [callbackStatement(db, input.siteId, input.sessionId, { name, email, phone, reason: input.lead['message'] }, now)]
        : []),
    ]);
    if (request === 'callback') {
      // After the save, so the event carries the request's id: the same id as callback.updated,
      // and the same again when the visitor asks twice in one chat (it is the same waiting request).
      const saved = await db
        .prepare("SELECT id, name, phone, email, reason, requested_at FROM callbacks WHERE conversation_id = ? AND status = 'open'")
        .bind(input.sessionId)
        .first<{ id: string; name: string | null; phone: string | null; email: string | null; reason: string | null; requested_at: number }>();
      if (saved) {
        emit(ctx, input.siteId, 'callback.requested', {
          callbackId: saved.id,
          conversationId: input.sessionId,
          name: saved.name,
          email: saved.email,
          phone: saved.phone,
          ...(saved.reason ? { message: saved.reason } : {}),
          requestedAt: new Date(saved.requested_at).toISOString(),
        });
      }
    }
  });
}

/**
 * The conversation's open callback request: made, or (asked again) brought up
 * to date. Runs after the lead statements, so it links the contact they settled on.
 */
export function callbackStatement(
  db: D1Like,
  siteId: string,
  conversationId: string,
  input: { name?: string | undefined; email?: string | undefined; phone?: string | undefined; reason?: string | undefined },
  now: number,
): D1Statement {
  return db
    .prepare(
      `INSERT INTO callbacks (id, site_id, conversation_id, lead_id, name, phone, email, reason, status, requested_at)
       VALUES (?, ?, ?, (SELECT lead_id FROM conversations WHERE id = ?), ?, ?, ?, ?, 'open', ?)
       ON CONFLICT (conversation_id) WHERE status = 'open' DO UPDATE SET
         lead_id = excluded.lead_id,
         name = COALESCE(excluded.name, callbacks.name),
         phone = COALESCE(excluded.phone, callbacks.phone),
         email = COALESCE(excluded.email, callbacks.email),
         reason = COALESCE(excluded.reason, callbacks.reason),
         requested_at = excluded.requested_at`,
    )
    .bind(
      `cb_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      siteId,
      conversationId,
      conversationId,
      input.name ?? null,
      input.phone ?? null,
      input.email?.toLowerCase() ?? null,
      input.reason?.slice(0, 500) ?? null,
      now,
    );
}

/** Thumbs up (1) or down (-1) on one of the assistant's replies. Only messages of this conversation. */
export async function recordFeedback(db: D1Like, sessionId: string, messageId: string, value: 1 | -1 | 0): Promise<boolean> {
  await ensureSchema(db);
  const result = (await db
    .prepare("UPDATE messages SET feedback = ? WHERE id = ? AND conversation_id = ? AND role = 'agent'")
    .bind(value === 0 ? null : value, `${sessionId}:${messageId}`, sessionId)
    .run()) as { meta?: { changes?: number }; changes?: number } | undefined;
  const changes = result?.meta?.changes ?? result?.changes;
  return changes === undefined ? true : changes > 0;
}

export function recordTurn(
  ctx: RequestCtx,
  input: { siteId: string; sessionId: string; request: SendRequest; messages: Message[] },
): void {
  const text = input.request.kind === 'text' ? input.request.text : input.request.label || input.request.value;
  const typed = input.request.kind === 'text' ? contactIn(text) : {};
  turn(ctx, { ...input, text, typed });
  schedule(ctx, async (db) => {
    const now = ctx.platform.now();
    const statements: D1Statement[] = [
      // A session started before recording was on has no row yet; make one.
      db
        .prepare(
          `INSERT OR IGNORE INTO conversations (id, site_id, started_at, last_at, first_message, message_count)
           VALUES (?, ?, ?, ?, ?, 0)`,
        )
        .bind(input.sessionId, input.siteId, now, now, text.slice(0, 500)),
      visitorMessage(input.sessionId, text, now - 1, db, input.request.kind === 'action' ? input.request.value : undefined),
      ...messageRows(db, input.sessionId, input.messages, now),
      countMessage(db, input.siteId, now),
      db
        .prepare(
          `UPDATE conversations SET last_at = ?, message_count = message_count + ?,
             first_message = COALESCE(first_message, ?) WHERE id = ?`,
        )
        .bind(now, 1 + input.messages.length, text.slice(0, 500), input.sessionId),
    ];
    if (typed.email || typed.phone) {
      statements.push(...leadStatements(db, input.siteId, input.sessionId, typed, 'chat', now));
    }
    await db.batch(statements);
    // Back after the end-of-chat job ran: it runs again when this part ends.
    const reopened = (await db
      .prepare('UPDATE conversations SET completed_at = NULL WHERE id = ? AND completed_at IS NOT NULL')
      .bind(input.sessionId)
      .run()) as { meta?: { changes?: number }; changes?: number } | undefined;
    if ((reopened?.meta?.changes ?? reopened?.changes ?? 0) > 0) {
      startConversationJob(ctx, input.siteId, input.sessionId, `conv-${input.sessionId}-${now.toString(36)}`);
    }
  });
}
