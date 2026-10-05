import type { Message, SendRequest, VisitorContext } from '@murmur/protocol';
import type { RequestCtx } from '../core/request.js';
import { dbFrom, ensureSchema, type D1Like, type D1Statement } from '../db/d1.js';
import { conversationStarted, leadCaptured, turn } from '../webhooks/events.js';

/**
 * Writes the conversation to D1 for the dashboard, after the response.
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

function visitorMessage(conversationId: string, text: string, ts: number, db: D1Like): D1Statement {
  return db
    .prepare('INSERT OR IGNORE INTO messages (id, conversation_id, role, type, text, payload, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(`${conversationId}:u${ts}${Math.random().toString(36).slice(2, 6)}`, conversationId, 'user', 'text', text, null, ts);
}

/**
 * Record what a conversation told us about the visitor. A lead is a person:
 * the email is the key, so a visitor who comes back (or gives their email in
 * a second chat) enriches the lead they already have, and the conversation
 * points at it. Details are filled in, never overwritten; form fields merge.
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
         fields = CASE WHEN leads.fields IS NULL THEN excluded.fields WHEN excluded.fields IS NULL THEN leads.fields ELSE json_patch(leads.fields, excluded.fields) END,
         updated_at = excluded.updated_at`;

  if (!email) {
    return [
      db
        .prepare(
          `UPDATE leads SET name = COALESCE(name, ?), phone = COALESCE(phone, ?),
             fields = CASE WHEN ? IS NULL THEN fields WHEN fields IS NULL THEN ? ELSE json_patch(fields, ?) END, updated_at = ?
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
           (id, site_id, started_at, last_at, page_url, page_title, referrer, utm, locale, country, first_message, message_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ),
    ];
    if (input.firstMessage) statements.push(visitorMessage(input.sessionId, input.firstMessage, now - 1, db));
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
  });
}

/**
 * Contact details in a submitted inline form: the widget sends the fields as
 * a JSON object in the action's value. Only plain string fields count.
 */
export function formLead(request: SendRequest): Record<string, string> | null {
  if (request.kind !== 'action' || !request.value.trim().startsWith('{')) return null;
  try {
    const value = JSON.parse(request.value) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const lead: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
      if (typeof raw === 'string' && raw.trim() && key.length <= 64) lead[key] = raw.trim().slice(0, 200);
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
    const { name, email, phone, ...rest } = input.lead;
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
    ]);
  });
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
      visitorMessage(input.sessionId, text, now - 1, db),
      ...messageRows(db, input.sessionId, input.messages, now),
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
  });
}
