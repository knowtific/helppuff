import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { utmSchema, type Message, type SendRequest } from '@helppuff/protocol';
import { resolveSite } from '../config/site.js';
import { endChat, sendChat, startChat } from '../core/chat.js';
import { HelpPuffError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import { prepareConnector } from '../core/run.js';
import { assertSameOrigin, assertSiteAccess, currentAdmin, db, jsonBody, siteParam } from './guard.js';

/**
 * Talking to the assistant over the API: the same pipeline as the widget
 * (`core/chat.ts`: limits, cleaning, guardrails, recording, leads, webhooks),
 * held by a server instead of a browser. No Origin or Turnstile — the API key
 * is the proof — and no per-IP limits (the key has its own per-minute limit);
 * the per-conversation and daily caps apply as always. The connector's state
 * lives in D1 `api_sessions` instead of a signed token.
 */

export const chatRoutes = new Hono<HonoEnv>();

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

export const startConversationSchema = z
  .object({
    site: z.string().min(1).max(64).optional().describe('The site; defaults to the key\'s (or the only) site.'),
    message: z.string().min(1).max(4000).optional().describe('The visitor\'s first message. Without one, the reply is the greeting (if any).'),
    contact: z
      .record(z.string().regex(/^[\w-]{1,64}$/), z.string().max(2000))
      .refine((value) => Object.keys(value).length <= 20, 'at most 20 fields')
      .optional()
      .describe('What you know about the visitor: name, email, phone and any other fields. Becomes (or joins, by email) a lead.'),
    context: z
      .object({
        pageUrl: z.string().min(1).max(2048).optional(),
        pageTitle: z.string().max(300).optional(),
        referrer: z.string().max(2048).optional(),
        utm: utmSchema.optional(),
        locale: z.string().max(35).optional(),
        timezone: z.string().max(64).optional(),
      })
      .strict()
      .optional()
      .describe('Where the visitor is: the assistant may use it.'),
    externalId: z.string().min(1).max(128).optional().describe('Your own id for this conversation or visitor, to find it again.'),
    metadata: z
      .record(z.string().max(64), z.string().max(500))
      .refine((value) => Object.keys(value).length <= 20, 'at most 20 keys')
      .optional()
      .describe('Anything you want back later. Stored and returned; never shown to the assistant.'),
  })
  .strict();

export const sendMessageSchema = z.union([
  z.object({ text: z.string().min(1).max(4000).describe('What the visitor typed.') }).strict(),
  z
    .object({
      action: z
        .object({
          id: z.string().min(1).max(64).describe('The id of the message (or action) being answered: an option list, a card button, a form.'),
          value: z.string().min(1).max(2000).describe('The chosen value, or a form\'s answers as a JSON object string.'),
          label: z.string().min(1).max(200).optional().describe('What the visitor saw (defaults to the value).'),
        })
        .strict(),
    })
    .strict(),
]);

type ApiSessionRow = { id: string; site_id: string; key_id: string | null; state: string | null; forms: string | null; external_id: string | null; metadata: string | null };

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HelpPuffError('bad_request', { message: `Check ${issue?.path.join('.') || 'the body'}: ${issue?.message ?? 'invalid'}.`, detail: 'api_body_invalid' });
  }
  return parsed.data;
}

const json = (value: string | null): unknown => {
  try {
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
};

async function apiSession(c: Context<HonoEnv>, id: string): Promise<ApiSessionRow> {
  const row = await db(c).prepare('SELECT * FROM api_sessions WHERE id = ?').bind(id).first<ApiSessionRow>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such conversation (only conversations started over the API can be continued here).', detail: 'api_session_missing' });
  assertSiteAccess(c, row.site_id, 'conversation');
  siteParam(c, row.site_id);
  return row;
}

const apiChannel = (c: Context<HonoEnv>, pageUrl: string) => ({
  kind: 'api' as const,
  // The key has its own per-minute limit (api/auth.ts); the per-IP limits are for browsers.
  standing: 'exempt' as const,
  visitor: c.get('apiKey')?.id ?? 'admin-key',
  pageUrl,
});

/** Start a conversation, optionally with the visitor's first message, and answer with the assistant's reply. */
chatRoutes.post('/conversations', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = parse(startConversationSchema, await jsonBody(c));
  const ctx = c.get('helppuff');
  const siteId = siteParam(c, body.site);
  const site = await resolveSite(ctx, siteId);
  const email = body.contact?.['email'];
  if (email !== undefined && !EMAIL.test(email.trim())) throw new HelpPuffError('bad_request', { message: 'Check contact.email: not an email address.', detail: 'api_bad_email' });
  const pageUrl = body.context?.pageUrl ?? 'api';
  const prepared = prepareConnector(ctx, site);
  const d = db(c);
  return startChat<{ id: string; messages: Message[]; externalId: string | null; metadata: Record<string, string> | null }>(c, {
    siteId,
    site,
    prepared,
    input: {
      context: { ...body.context, pageUrl },
      ...(body.message ? { firstMessage: body.message } : {}),
      ...(body.contact ? { lead: body.contact } : {}),
    },
    channel: apiChannel(c, pageUrl),
    respond: async (turn) => {
      const now = ctx.platform.now();
      // Awaited: the next message needs this state. (The widget keeps it in its token instead.)
      await d
        .prepare('INSERT INTO api_sessions (id, site_id, key_id, state, forms, external_id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(turn.sessionId, siteId, c.get('apiKey')?.id ?? null, JSON.stringify(turn.state ?? null), JSON.stringify(turn.forms), body.externalId ?? null, body.metadata ? JSON.stringify(body.metadata) : null, now, now)
        .run();
      c.status(201);
      return { body: { id: turn.sessionId, messages: turn.messages, externalId: body.externalId ?? null, metadata: body.metadata ?? null } };
    },
  });
});

/** The visitor's next message (typed text, or an answer to options, a card or a form). */
chatRoutes.post('/conversations/:id/messages', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = parse(sendMessageSchema, await jsonBody(c));
  const ctx = c.get('helppuff');
  const row = await apiSession(c, c.req.param('id'));
  const site = await resolveSite(ctx, row.site_id);
  const clientId = crypto.randomUUID();
  const input: SendRequest =
    'text' in body
      ? { kind: 'text', text: body.text, clientId }
      : { kind: 'action', actionId: body.action.id, value: body.action.value, label: body.action.label ?? body.action.value.slice(0, 200), clientId };
  const d = db(c);
  return sendChat<{ id: string; messages: Message[] }>(c, {
    session: {
      siteId: row.site_id,
      sessionId: row.id,
      site,
      prepared: prepareConnector(ctx, site),
      state: json(row.state),
      forms: (json(row.forms) as string[] | null) ?? [],
      ttlSeconds: site.security.sessionTtlHours * 3600,
    },
    input,
    channel: apiChannel(c, 'api'),
    respond: async (turn) => {
      await d
        .prepare('UPDATE api_sessions SET state = ?, forms = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(turn.state ?? null), JSON.stringify(turn.forms), ctx.platform.now(), row.id)
        .run();
      return { body: { id: row.id, messages: turn.messages } };
    },
  });
});

/** Close a conversation: the backend's own end, then `conversation.ended` (once). It stays readable. */
chatRoutes.post('/conversations/:id/end', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const ctx = c.get('helppuff');
  const row = await apiSession(c, c.req.param('id'));
  const site = await resolveSite(ctx, row.site_id);
  endChat(ctx, { siteId: row.site_id, sessionId: row.id, state: json(row.state), prepared: prepareConnector(ctx, site) });
  return c.json({ id: row.id, ended: true });
});

/** Delete a conversation and everything recorded with it (messages, callback requests). The lead it made stays. */
chatRoutes.delete('/conversations/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const id = c.req.param('id');
  const d = db(c);
  const row = await d.prepare('SELECT site_id FROM conversations WHERE id = ?').bind(id).first<{ site_id: string }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such conversation.', detail: 'admin_conversation_missing' });
  assertSiteAccess(c, row.site_id, 'conversation');
  await deleteConversations(d, [id]);
  return c.json({ id, deleted: true });
});

/** Remove conversations and what hangs off them. Leads are separate (a lead outlives a conversation). */
export async function deleteConversations(d: ReturnType<typeof db>, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const marks = ids.map(() => '?').join(', ');
  await d.batch([
    d.prepare(`DELETE FROM messages WHERE conversation_id IN (${marks})`).bind(...ids),
    d.prepare(`DELETE FROM callbacks WHERE conversation_id IN (${marks})`).bind(...ids),
    d.prepare(`DELETE FROM api_sessions WHERE id IN (${marks})`).bind(...ids),
    d.prepare(`DELETE FROM notes WHERE conversation_id IN (${marks})`).bind(...ids),
    d.prepare(`DELETE FROM conversation_labels WHERE conversation_id IN (${marks})`).bind(...ids),
    d.prepare(`DELETE FROM telegram_threads WHERE conversation_id IN (${marks})`).bind(...ids),
    d.prepare(`UPDATE leads SET conversation_id = NULL WHERE conversation_id IN (${marks})`).bind(...ids),
    d.prepare(`DELETE FROM conversations WHERE id IN (${marks})`).bind(...ids),
  ]);
}
