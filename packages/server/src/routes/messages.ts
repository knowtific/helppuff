import { Hono } from 'hono';
import {
  TOKEN_HEADER,
  feedbackRequestSchema,
  sendRequestSchema,
  type Message,
  type PollResponse,
  type SendResponse,
  type StreamedSendDone,
} from '@murmur/protocol';
import { isCallbackForm } from '@murmur/connector-types';
import { resolveSite } from '../config/site.js';
import { MurmurError } from '../core/errors.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type RequestCtx, type HonoEnv } from '../core/request.js';
import { connectorContext, prepareConnector, runConnector, type PreparedConnector } from '../core/run.js';
import { streamResponse, textRelay, wantsStream } from '../core/stream.js';
import { sanitizeConnectorMessages } from '../core/sanitize.js';
import { issueToken, verifyToken, type SessionTokenPayload } from '../core/token.js';
import { hitDaily, hitLimiter, hitTotal, hitWindow, ipLimiter, rateLimited, quotaExceeded, recordedCaps, sessionMessageKey } from '../core/ratelimit.js';
import type { SiteConfig } from '../config/schema.js';
import { readJsonBody } from './sessions.js';
import { formLead, recordFeedback, recordLead, recordTurn } from '../admin/record.js';
import { dbFrom } from '../db/d1.js';
import { dispatchLead } from '../core/sinks.js';
import { emit } from '../webhooks/deliver.js';

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
  const session = await ctx.timing.span('auth', () => authenticate(ctx, c.req.header('Authorization')));
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

  /*
   * The three limits are read together, and nothing here writes before the
   * response (see core/ratelimit.ts): per visitor by the Rate Limiting
   * binding, per conversation and per day from the database's record of the
   * turns, else KV counters written with `waitUntil`. The per-session cap is
   * counted server-side, not from the token — a client chooses which token to
   * send, so a token-held count can be rewound.
   */
  const ttlSeconds = Math.max(60, Math.ceil((payload.exp - ctx.platform.now()) / 1000));
  const defer = ctx.platform.waitUntil;
  const db = dbFrom(ctx.env);
  const limiter = ipLimiter(ctx.env, limits.messagesPerIpPerMinute);
  const ipBucket = `${payload.siteId}:${ipKey}`;
  const checkLimits = async (): Promise<number> => {
    const owner = await ctx.isOwner();
    const [perIp, [perSession, daily]] = await ctx.timing.span('limits', () =>
      Promise.all([
        owner
          ? Promise.resolve({ allowed: true, count: 0 })
          : limiter
            ? hitLimiter(limiter, ipBucket)
            : hitWindow(ctx.platform.kv, 'msg', ipBucket, limits.messagesPerIpPerMinute, 60, undefined, defer),
        db
          ? recordedCaps(db, payload.siteId, payload.sessionId, { perSession: limits.messagesPerSession, perDay: limits.messagesPerSitePerDay }).then(
              (caps) => [caps.session, caps.daily] as const,
            )
          : Promise.all([
              hitTotal(ctx.platform.kv, sessionMessageKey(payload.sessionId), limits.messagesPerSession, ttlSeconds, defer),
              hitDaily(ctx.platform.kv, payload.siteId, limits.messagesPerSitePerDay, undefined, defer),
            ]),
      ]),
    );
    // Scoped by site, as with sessions.
    if (!perIp.allowed) {
      ctx.platform.log('limit.messages_per_ip', { siteId: payload.siteId });
      throw rateLimited(perIp, 'messages_per_ip_per_minute');
    }
    if (!perSession.allowed) {
      ctx.platform.log('limit.messages_per_session', { siteId: payload.siteId });
      throw quotaExceeded('messages_per_session', 'This conversation has reached its limit. Start a new one to keep going.');
    }
    if (!daily.allowed) {
      ctx.platform.log('limit.site_daily', { siteId: payload.siteId });
      throw quotaExceeded('messages_per_site_per_day', 'Chat is unavailable right now.');
    }
    return perSession.count;
  };

  // A lead the conversation produced: kept for the dashboard, sent to the lead destinations.
  const reportLead = (lead: Record<string, string>, source: 'form' | 'ai' = 'ai') => {
    recordLead(ctx, { siteId: payload.siteId, sessionId: payload.sessionId, lead, source });
    dispatchLead(ctx, site, payload.siteId, { sessionId: payload.sessionId, lead, context: { pageUrl: ctx.origin ?? 'unknown' } });
  };

  /*
   * A gated connector starts at once and waits for the limits only before its
   * expensive call (the model), so the counter reads overlap its retrieval. A
   * blocked request still gets its 429: the connector stops at the gate, and
   * nothing is recorded. Other connectors run after the limits, as before.
   */
  const streaming = wantsStream(c.req.header('Accept'), session.prepared);
  const relay = textRelay();
  const verdict = checkLimits();
  const gate = verdict.then(() => undefined);
  gate.catch(() => {});
  const gated = session.prepared.connector.gated;

  // Steps 5-7, shared by the JSON and the streamed response.
  const finish = async () => {
    const cctx = connectorContext(ctx, session.prepared, payload.siteId, payload.sessionId, streaming ? relay.onText : undefined, (lead) => reportLead(lead));
    if (gated) cctx.gate = gate;
    // 5. Connector.
    const result = await ctx.timing.span('connector', () =>
      runConnector(ctx, 'send', () => session.prepared.connector.send(cctx, payload.state, input)),
    );
    const count = await verdict;

    // 6. Sanitize.
    const messages = sanitizeConnectorMessages(result.messages, ctx.platform);

    // 7. Refresh the token whenever state or the message count changed.
    const state = result.state === undefined ? payload.state : result.state;
    const token = await refreshToken(ctx, session, state, count);

    ctx.platform.log('message.sent', { siteId: payload.siteId, sessionId: payload.sessionId, count });
    recordTurn(ctx, { siteId: payload.siteId, sessionId: payload.sessionId, request: input, messages });
    return { messages, token };
  };

  let work: Promise<{ messages: Message[]; token: string }>;
  if (gated) {
    work = finish();
    work.catch(() => {});
    await verdict;
  } else {
    await verdict;
    work = finish();
  }
  const submitted = formLead(input);
  // The callback form is itself the request: recorded once, here, whatever the model says next.
  if (submitted) reportLead(input.kind === 'action' && isCallbackForm(input.actionId) ? { ...submitted, request: 'callback' } : submitted, 'form');

  if (streaming) {
    // The headers are gone before the new state exists, so the token rides in `done`.
    return streamResponse(ctx, c.req.path, async (onText) => {
      relay.attach(onText);
      const { messages, token } = await work;
      const done: StreamedSendDone = { messages, token };
      return done;
    });
  }

  const { messages, token } = await work;
  c.header(TOKEN_HEADER, token);
  c.header('Server-Timing', ctx.timing.header());
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
  emit(ctx, session.payload.siteId, 'conversation.ended', { conversationId: session.payload.sessionId });
  return c.body(null, 204);
});

/** Thumbs up or down on a reply. Stored with the conversation for the dashboard. */
messageRoutes.post('/v1/sessions/feedback', async (c) => {
  const ctx = c.get('mm');
  const session = await authenticate(ctx, c.req.header('Authorization'));
  const parsed = feedbackRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) throw new MurmurError('bad_request', { detail: 'feedback_body_invalid' });
  const db = dbFrom(ctx.env);
  if (!db) throw new MurmurError('not_found', { detail: 'feedback_not_recorded' });
  const perIp = await hitWindow(ctx.platform.kv, 'fb', `${session.payload.siteId}:${await ctx.ipKey()}`, 30, 60);
  if (!perIp.allowed) throw rateLimited(perIp, 'feedback_per_ip');
  const found = await recordFeedback(db, session.payload.sessionId, parsed.data.messageId, parsed.data.value);
  if (!found) throw new MurmurError('not_found', { detail: 'feedback_message_unknown' });
  emit(ctx, session.payload.siteId, 'feedback.received', {
    conversationId: session.payload.sessionId,
    messageId: parsed.data.messageId,
    rating: parsed.data.value === 1 ? 'up' : parsed.data.value === -1 ? 'down' : 'cleared',
  });
  return c.body(null, 204);
});
