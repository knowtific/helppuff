import { Hono } from 'hono';
import { TOKEN_HEADER, sendRequestSchema, type PollResponse, type SendResponse } from '@murmur/protocol';
import { resolveSite } from '../config/site.js';
import { MurmurError } from '../core/errors.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type RequestCtx, type HonoEnv } from '../core/request.js';
import { connectorContext, prepareConnector, runConnector, type PreparedConnector } from '../core/run.js';
import { sanitizeConnectorMessages } from '../core/sanitize.js';
import { issueToken, verifyToken, type SessionTokenPayload } from '../core/token.js';
import { hitDaily, hitTotal, hitWindow, rateLimited, quotaExceeded, sessionMessageKey } from '../core/ratelimit.js';
import type { SiteConfig } from '../config/schema.js';
import { readJsonBody } from './sessions.js';

export const messageRoutes = new Hono<HonoEnv>();

type Session = {
  payload: SessionTokenPayload;
  site: SiteConfig;
  prepared: PreparedConnector;
  secret: string;
};

/** Steps 1-2 of the send pipeline: token, then origin against the token's site (§7.1). */
async function authenticate(ctx: RequestCtx, authorization: string | undefined): Promise<Session> {
  const secret = requireSecret(ctx);

  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) throw new MurmurError('unauthorized', { detail: 'token_missing' });

  const payload = await verifyToken(secret, token, ctx.platform.now());
  const site = await resolveSite(ctx, payload.siteId);
  assertAllowedOrigin(ctx.origin, site.origins);

  return { payload, site, prepared: prepareConnector(ctx, site), secret };
}

async function refreshToken(ctx: RequestCtx, session: Session, state: unknown, count: number): Promise<string> {
  const { token } = await issueToken(session.secret, {
    siteId: session.payload.siteId,
    sessionId: session.payload.sessionId,
    state,
    count,
    // Keep the original expiry — a session cannot extend itself indefinitely.
    ttlMs: Math.max(session.payload.exp - ctx.platform.now(), 1000),
  });
  return token;
}

messageRoutes.post('/v1/sessions/messages', async (c) => {
  const ctx = c.get('mm');
  const session = await authenticate(ctx, c.req.header('Authorization'));
  const { site, payload } = session;

  // 3. Body shape and length cap.
  const parsed = sendRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) throw new MurmurError('bad_request', { detail: 'send_body_invalid' });
  const input = parsed.data;

  const length = input.kind === 'text' ? input.text.length : input.value.length;
  if (length > site.security.limits.maxMessageLength) {
    throw new MurmurError('bad_request', {
      message: 'That message is a little too long.',
      detail: 'message_too_long',
    });
  }

  // 4. Limits, cheapest first.
  const limits = site.security.limits;
  const ipKey = await ctx.ipKey();

  // Scoped by site, as with sessions.
  const perIp = await hitWindow(
    ctx.platform.kv,
    'msg',
    `${payload.siteId}:${ipKey}`,
    limits.messagesPerIpPerMinute,
    60,
  );
  if (!perIp.allowed) {
    ctx.platform.log('limit.messages_per_ip', { siteId: payload.siteId });
    throw rateLimited(perIp, 'messages_per_ip_per_minute');
  }

  /*
   * The per-session cap is counted in KV, not from the token.
   *
   * The token's `count` is chosen by the client: replaying an older token
   * rewinds it, so a token-held counter never trips. The token still carries
   * one, for the widget's own bookkeeping, but this is the number enforced.
   */
  const ttlSeconds = Math.max(60, Math.ceil((payload.exp - ctx.platform.now()) / 1000));
  const perSession = await hitTotal(
    ctx.platform.kv,
    sessionMessageKey(payload.sessionId),
    limits.messagesPerSession,
    ttlSeconds,
  );
  if (!perSession.allowed) {
    ctx.platform.log('limit.messages_per_session', { siteId: payload.siteId });
    throw quotaExceeded(
      'messages_per_session',
      'This conversation has reached its limit. Start a new one to keep going.',
    );
  }

  const daily = await hitDaily(ctx.platform.kv, payload.siteId, limits.messagesPerSitePerDay);
  if (!daily.allowed) {
    ctx.platform.log('limit.site_daily', { siteId: payload.siteId });
    throw quotaExceeded('messages_per_site_per_day', 'Chat is unavailable right now.');
  }

  const count = perSession.count;

  // 5. Connector.
  const cctx = connectorContext(ctx, session.prepared, payload.siteId, payload.sessionId);
  const result = await runConnector(ctx, 'send', () =>
    session.prepared.connector.send(cctx, payload.state, input),
  );

  // 6. Sanitize.
  const messages = sanitizeConnectorMessages(result.messages, ctx.platform);

  // 7. Refresh the token whenever state or the message count changed.
  const state = result.state === undefined ? payload.state : result.state;
  c.header(TOKEN_HEADER, await refreshToken(ctx, session, state, count));

  ctx.platform.log('message.sent', { siteId: payload.siteId, sessionId: payload.sessionId, count });

  const body: SendResponse = { messages };
  return c.json(body);
});

messageRoutes.get('/v1/sessions/messages', async (c) => {
  const ctx = c.get('mm');
  const session = await authenticate(ctx, c.req.header('Authorization'));
  const poll = session.prepared.connector.poll;

  if (!poll) {
    throw new MurmurError('bad_request', { detail: 'poll_not_supported' });
  }

  const after = c.req.query('after');
  const cctx = connectorContext(ctx, session.prepared, session.payload.siteId, session.payload.sessionId);
  const result = await runConnector(ctx, 'poll', () => poll(cctx, session.payload.state, after));

  const body: PollResponse = {
    messages: sanitizeConnectorMessages(result.messages, ctx.platform, { allowEmpty: true }),
  };
  return c.json(body);
});

/** Best effort, fire-and-forget: the visitor's response never waits on it. */
messageRoutes.post('/v1/sessions/end', async (c) => {
  const ctx = c.get('mm');
  const session = await authenticate(ctx, c.req.header('Authorization'));
  const end = session.prepared.connector.end;

  if (end) {
    const cctx = connectorContext(ctx, session.prepared, session.payload.siteId, session.payload.sessionId);
    ctx.platform.waitUntil(
      end(cctx, session.payload.state).catch(() => {
        ctx.platform.log('connector.end_failed');
      }),
    );
  }

  ctx.platform.log('session.ended', { siteId: session.payload.siteId, sessionId: session.payload.sessionId });
  return c.body(null, 204);
});
