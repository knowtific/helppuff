import type { Message, SendRequest, VisitorContext } from '@murmur/protocol';
import type { RequestCtx } from '../core/request.js';
import { dbFrom, ensureSchema, type D1Like, type D1Statement } from './db.js';

/**
 * Writes the conversation to D1 for the dashboard, after the response.
 *
 * Every call is scheduled with `waitUntil` and swallows its own failures:
 * the dashboard missing a row is a small loss; a visitor's reply waiting
 * on, or failing because of, a database write is not acceptable (§8.3).
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

/** Create or enrich the conversation's lead. One lead per conversation. */
export function leadUpsert(
  db: D1Like,
  siteId: string,
  conversationId: string,
  lead: { name?: string; email?: string; phone?: string; fields?: Record<string, string> },
  source: 'form' | 'chat' | 'ai',
  now: number,
): D1Statement {
  const id = `lead_${conversationId}`;
  return db
    .prepare(
      `INSERT INTO leads (id, site_id, conversation_id, name, email, phone, fields, source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         name = COALESCE(leads.name, excluded.name),
         email = COALESCE(leads.email, excluded.email),
         phone = COALESCE(leads.phone, excluded.phone),
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      siteId,
      conversationId,
      lead.name ?? null,
      lead.email ?? null,
      lead.phone ?? null,
      lead.fields ? JSON.stringify(lead.fields) : null,
      source,
      now,
      now,
    );
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
        leadUpsert(
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
      statements.push(
        db.prepare('UPDATE conversations SET lead_id = ? WHERE id = ?').bind(`lead_${input.sessionId}`, input.sessionId),
      );
    }
    await db.batch(statements);
  });
}

export function recordTurn(
  ctx: RequestCtx,
  input: { siteId: string; sessionId: string; request: SendRequest; messages: Message[] },
): void {
  schedule(ctx, async (db) => {
    const now = ctx.platform.now();
    const text = input.request.kind === 'text' ? input.request.text : input.request.label || input.request.value;
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
    const typed = input.request.kind === 'text' ? contactIn(text) : {};
    if (typed.email || typed.phone) {
      statements.push(leadUpsert(db, input.siteId, input.sessionId, typed, 'chat', now));
      statements.push(
        db.prepare('UPDATE conversations SET lead_id = ? WHERE id = ?').bind(`lead_${input.sessionId}`, input.sessionId),
      );
    }
    await db.batch(statements);
  });
}
