import { Hono } from 'hono';
import { TOKEN_HEADER, feedbackRequestSchema, sendRequestSchema, type PollResponse, type SendResponse, type StreamedSendDone } from '@helppuff/protocol';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type RequestCtx, type HonoEnv } from '../core/request.js';
import { connectorContext, prepareConnector, runConnector, type PreparedConnector } from '../core/run.js';
import { guardReplies, sanitizeConnectorMessages } from '../core/sanitize.js';
import { issueToken, verifyToken, type SessionTokenPayload } from '../core/token.js';
import { hitMemory, rateLimited } from '../core/ratelimit.js';
import type { SiteConfig } from '../config/schema.js';
import { readJsonBody } from './sessions.js';
import { recordFeedback } from '../admin/record.js';
import { dbFrom } from '../db/d1.js';
import { emit } from '../webhooks/deliver.js';
import { endChat, sendChat } from '../core/chat.js';
import { visitorStanding } from '../core/visitor.js';

export const messageRoutes = new Hono<HonoEnv>();

type Session = {
  payload: SessionTokenPayload;
  site: SiteConfig;
  prepared: PreparedConnector;
  secret: string;
};

/** Steps 1-2 of the send pipeline: token, then origin against the token's site. */
async function authenticate(ctx: RequestCtx, authorization: string | undefined): Promise<Session> {
  const secret = requireSecret(ctx);

  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) throw new HelpPuffError('unauthorized', { detail: 'token_missing' });

  const payload = await verifyToken(secret, token, ctx.platform.now());
  const site = await resolveSite(ctx, payload.siteId);
  assertAllowedOrigin(ctx.origin, site.origins);

  return { payload, site, prepared: prepareConnector(ctx, site), secret };
}

async function refreshToken(ctx: RequestCtx, session: Session, state: unknown, count: number, forms: string[]): Promise<string> {
  const { token } = await issueToken(session.secret, {
    siteId: session.payload.siteId,
    sessionId: session.payload.sessionId,
    state,
    count,
    forms,
    // Keep the original expiry — a session cannot extend itself indefinitely.
    ttlMs: Math.max(session.payload.exp - ctx.platform.now(), 1000),
  });
  return token;
}

/** The widget sends a message: the token's session, the pipeline shared with the public API (`core/chat.ts`). */
messageRoutes.post('/v1/sessions/messages', async (c) => {
  const ctx = c.get('helppuff');
  const session = await ctx.timing.span('auth', () => authenticate(ctx, c.req.header('Authorization')));
  const { site, payload } = session;
  const parsed = sendRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) throw new HelpPuffError('bad_request', { detail: 'send_body_invalid' });

  return sendChat<SendResponse | StreamedSendDone>(c, {
    session: {
      siteId: payload.siteId,
      sessionId: payload.sessionId,
      site,
      prepared: session.prepared,
      state: payload.state,
      forms: payload.forms,
      ttlSeconds: Math.max(60, Math.ceil((payload.exp - ctx.platform.now()) / 1000)),
    },
    input: parsed.data,
    channel: { kind: 'widget', standing: await visitorStanding(ctx, site.security), visitor: await ctx.ipKey(), pageUrl: ctx.origin ?? 'unknown' },
    respond: async (turn, streaming) => {
      const token = await refreshToken(ctx, session, turn.state, turn.count, turn.forms);
      // A streamed response's headers are gone before the new state exists, so the token rides in `done`.
      return streaming ? { body: { messages: turn.messages, token } } : { body: { messages: turn.messages }, headers: { [TOKEN_HEADER]: token } };
    },
  });
});

messageRoutes.get('/v1/sessions/messages', async (c) => {
  const ctx = c.get('helppuff');
  const session = await authenticate(ctx, c.req.header('Authorization'));
  const poll = session.prepared.connector.poll;

  if (!poll) {
    throw new HelpPuffError('bad_request', { detail: 'poll_not_supported' });
  }

  // In memory: a KV write per poll would cost more than the poll.
  if ((await visitorStanding(ctx, session.site.security)) === 'limited') {
    const perIp = hitMemory('poll', `${session.payload.siteId}:${await ctx.ipKey()}`, session.site.security.limits.pollsPerIpPerMinute, 60, ctx.platform.now());
    if (!perIp.allowed) throw rateLimited(perIp, 'polls_per_ip');
  }

  // Forms delivered here are not added to the token (a poll returns none); backends that poll send text.
  const after = c.req.query('after');
  const cctx = connectorContext(ctx, session.prepared, session.payload.siteId, session.payload.sessionId);
  const result = await runConnector(ctx, 'poll', () => poll(cctx, session.payload.state, after));

  const body: PollResponse = {
    messages: guardReplies(sanitizeConnectorMessages(result.messages, ctx.platform, { allowEmpty: true }), session.prepared.guidance, ctx.platform),
  };
  return c.json(body);
});

/** Best effort, fire-and-forget: the visitor's response never waits on it. */
messageRoutes.post('/v1/sessions/end', async (c) => {
  const ctx = c.get('helppuff');
  const session = await authenticate(ctx, c.req.header('Authorization'));
  const { siteId, sessionId } = session.payload;
  if ((await visitorStanding(ctx, session.site.security)) === 'limited') {
    const perIp = hitMemory('end', `${siteId}:${await ctx.ipKey()}`, session.site.security.limits.endsPerIpPerMinute, 60, ctx.platform.now());
    if (!perIp.allowed) throw rateLimited(perIp, 'ends_per_ip');
  }
  endChat(ctx, { siteId, sessionId, state: session.payload.state, prepared: session.prepared });
  return c.body(null, 204);
});

/** Thumbs up or down on a reply. Stored with the conversation for the dashboard. */
messageRoutes.post('/v1/sessions/feedback', async (c) => {
  const ctx = c.get('helppuff');
  const session = await authenticate(ctx, c.req.header('Authorization'));
  const parsed = feedbackRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) throw new HelpPuffError('bad_request', { detail: 'feedback_body_invalid' });
  const db = dbFrom(ctx.env);
  if (!db) throw new HelpPuffError('not_found', { detail: 'feedback_not_recorded' });
  if ((await visitorStanding(ctx, session.site.security)) === 'limited') {
    const perIp = hitMemory('fb', `${session.payload.siteId}:${await ctx.ipKey()}`, session.site.security.limits.feedbackPerIpPerMinute, 60, ctx.platform.now());
    if (!perIp.allowed) throw rateLimited(perIp, 'feedback_per_ip');
  }
  const found = await recordFeedback(db, session.payload.sessionId, parsed.data.messageId, parsed.data.value);
  if (!found) throw new HelpPuffError('not_found', { detail: 'feedback_message_unknown' });
  emit(ctx, session.payload.siteId, 'feedback.received', {
    conversationId: session.payload.sessionId,
    messageId: parsed.data.messageId,
    rating: parsed.data.value === 1 ? 'up' : parsed.data.value === -1 ? 'down' : 'cleared',
  });
  return c.body(null, 204);
});
