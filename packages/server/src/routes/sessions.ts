import { Hono } from 'hono';
import { startSessionRequestSchema, type StartSessionResponse } from '@helppuff/protocol';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { dbFrom } from '../db/d1.js';
import { capabilitiesOf, prepareConnector } from '../core/run.js';
import { chatFilesMode } from '../files/chat.js';
import { liveAvailable, visitorThread } from '../live/service.js';
import { issueToken } from '../core/token.js';
import { readResume } from '../notifications/customer.js';
import { hitWindow, rateLimited } from '../core/ratelimit.js';
import { offeredForms } from '../core/forms.js';
import { startChat } from '../core/chat.js';
import { visitorStanding } from '../core/visitor.js';

export const sessionRoutes = new Hono<HonoEnv>();

/**
 * The widget starts a chat: an allowed site's browser, Turnstile when the site
 * has it, state in the signed session token. The pipeline itself is shared
 * with the public API (`core/chat.ts`).
 */
sessionRoutes.post('/v1/sites/:siteId/sessions', async (c) => {
  const ctx = c.get('helppuff');
  const siteId = c.req.param('siteId');
  const site = await ctx.timing.span('site', () => resolveSite(ctx, siteId));
  assertAllowedOrigin(ctx.origin, site.origins, ctx.selfOrigin);

  const parsed = startSessionRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) throw new HelpPuffError('bad_request', { detail: 'session_body_invalid' });

  const secret = requireSecret(ctx);
  const prepared = prepareConnector(ctx, site);
  return startChat<StartSessionResponse>(c, {
    siteId,
    site,
    prepared,
    input: parsed.data,
    channel: {
      kind: 'widget',
      // A blocked IP stops here, before anything is counted.
      standing: await visitorStanding(ctx, site.security),
      visitor: await ctx.ipKey(),
      captchaToken: parsed.data.captchaToken,
      pageUrl: parsed.data.context.pageUrl,
    },
    respond: async (turn) => {
      const { token, expiresAt } = await issueToken(secret, {
        siteId,
        sessionId: turn.sessionId,
        state: turn.state,
        count: 0,
        forms: turn.forms,
        ttlMs: site.security.sessionTtlHours * 3600_000,
      });
      return {
        body: { sessionToken: token, sessionId: turn.sessionId, expiresAt, messages: turn.messages, capabilities: capabilitiesOf(prepared, Boolean(dbFrom(ctx.env)), liveAvailable(ctx.env, site, siteId), chatFilesMode(ctx.env, site, siteId)) },
      };
    },
  });
});

/**
 * Continue a chat from an email (Customer emails' "Continue the chat"): the
 * link's `#hp-resume` token, signed for this site and conversation, becomes
 * a session for that conversation, with what was said so far. Anyone with
 * the link sees that one conversation, as anyone with the email could.
 */
sessionRoutes.post('/v1/sites/:siteId/sessions/resume', async (c) => {
  const ctx = c.get('helppuff');
  const siteId = c.req.param('siteId');
  const site = await resolveSite(ctx, siteId);
  assertAllowedOrigin(ctx.origin, site.origins, ctx.selfOrigin);
  const body = (await readJsonBody(c.req.raw)) as { token?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  const secret = requireSecret(ctx);
  const standing = await visitorStanding(ctx, site.security);
  if (standing !== 'exempt') {
    // Counted like new chats: a resume is one.
    const verdict = await hitWindow(ctx.platform.kv, 'resume', `${siteId}:${await ctx.ipKey()}`, site.security.limits.sessionsPerIpPerHour, 3600, ctx.platform.now(), ctx.platform.waitUntil);
    if (!verdict.allowed) throw rateLimited(verdict, 'sessions_per_ip_per_hour');
  }
  const conversationId = token ? await readResume(secret, siteId, token, ctx.platform.now()) : null;
  const db = dbFrom(ctx.env);
  const row = conversationId && db ? await db.prepare('SELECT id FROM conversations WHERE id = ? AND site_id = ?').bind(conversationId, siteId).first<{ id: string }>() : null;
  if (!row || !db) throw new HelpPuffError('unauthorized', { message: 'This link has expired. Start a new chat any time.', detail: 'resume_invalid' });
  const messages = await visitorThread(db, row.id);
  const prepared = prepareConnector(ctx, site);
  const { token: sessionToken, expiresAt } = await issueToken(secret, {
    siteId,
    sessionId: row.id,
    state: null,
    count: 0,
    forms: offeredForms(undefined, messages),
    ttlMs: site.security.sessionTtlHours * 3600_000,
  });
  ctx.platform.log('session.resumed', { siteId, sessionId: row.id });
  return c.json({ sessionToken, sessionId: row.id, expiresAt, messages, capabilities: capabilitiesOf(prepared, true, liveAvailable(ctx.env, site, siteId), chatFilesMode(ctx.env, site, siteId)) } satisfies StartSessionResponse);
});

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HelpPuffError('bad_request', { detail: 'body_not_json' });
  }
}
