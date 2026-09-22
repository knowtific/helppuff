import { Hono } from 'hono';
import { TOKEN_HEADER, sendRequestSchema, type PollResponse, type SendResponse } from '@murmur/protocol';
import { getSite } from '../config/load.js';
import { MurmurError } from '../core/errors.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type RequestCtx, type HonoEnv } from '../core/request.js';
import { connectorContext, prepareConnector, runConnector, type PreparedConnector } from '../core/run.js';
import { sanitizeConnectorMessages } from '../core/sanitize.js';
import { issueToken, verifyToken, type SessionTokenPayload } from '../core/token.js';
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
  const site = getSite(ctx.config, payload.siteId);
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

  // 4. Per-session cap. IP and site-wide limits land in M3.
  const count = payload.count + 1;
  if (count > site.security.limits.messagesPerSession) {
    throw new MurmurError('quota_exceeded', {
      message: 'This conversation has reached its limit. Start a new one to keep going.',
      detail: 'messages_per_session',
    });
  }

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
