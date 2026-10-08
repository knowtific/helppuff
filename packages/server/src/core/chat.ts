import type { Context } from 'hono';
import { cleanText, HANDOVER_ACTION, stripChatTokens, type Message, type SendRequest, type StartSessionRequest } from '@helppuff/protocol';
import { isCallbackForm, notice } from '@helppuff/connector-types';
import type { SiteConfig } from '../config/schema.js';
import { resolveSecrets } from '../config/load.js';
import { formLead, recordLead, recordStart, recordTurn } from '../admin/record.js';
import { dbFrom } from '../db/d1.js';
import { emit } from '../webhooks/deliver.js';
import { HelpPuffError } from './errors.js';
import { formWasOffered, isFormSubmission, offeredForms } from './forms.js';
import { validateLead } from './lead.js';
import { hitDaily, hitLimiter, hitTotal, hitWindow, ipLimiter, quotaExceeded, rateLimited, recordedCaps, sessionMessageKey } from './ratelimit.js';
import type { HonoEnv, RequestCtx } from './request.js';
import { connectorContext, runConnector, type PreparedConnector } from './run.js';
import { guardReplies, sanitizeConnectorMessages } from './sanitize.js';
import { dispatchLead } from './sinks.js';
import { streamResponse, textRelay, wantsStream } from './stream.js';
import { newSessionId } from './token.js';
import { assertTurnstile } from './turnstile.js';
import type { Standing } from './visitor.js';
import { COPY, isLive, LIVE_CALLBACK_FORM, liveDeps, noHandover, readLiveState, relayVisitorMessage, startHandover, type HandoverResult } from '../live/service.js';
import type { TurnStatus } from '../admin/record.js';

/**
 * A conversation with the assistant, whoever holds it: the widget (a browser
 * on an allowed site, state in the signed session token) or the public API
 * (a server with an API key, state in D1 `api_sessions`). One pipeline, so
 * the limits, cleaning, guardrails, recording, leads and webhooks are the
 * same on both; each route supplies only how it was authenticated and how
 * the state is kept (`respond`).
 *
 * Cheap rejections first, anything that costs money or writes data last.
 */

export type Channel = {
  kind: 'widget' | 'api';
  /** `exempt` skips the per-visitor limits (the owner, `allowIps`, API keys: they have their own per-key limit). */
  standing: Standing;
  /** The salted IP hash the per-visitor limits count by. */
  visitor: string;
  /** Turnstile is checked on the widget's new chats only: an API key is its own proof. */
  captchaToken?: string | undefined;
  /** Where a lead came from, for the lead destinations. */
  pageUrl: string;
};

export type ChatSession = {
  siteId: string;
  sessionId: string;
  site: SiteConfig;
  prepared: PreparedConnector;
  /** The connector's state from the last turn. */
  state: unknown;
  /** Forms this conversation was shown (core/forms.ts). */
  forms?: readonly string[] | undefined;
  /** Seconds the conversation may still run: the KV counters' lifetime when there is no database. */
  ttlSeconds: number;
};

/** What a turn produced: what the route keeps (token or row) and answers with. */
export type ChatTurn = { sessionId: string; messages: Message[]; state: unknown; forms: string[]; count: number };
export type Respond<T> = (turn: ChatTurn, streaming: boolean) => Promise<{ body: T; headers?: Record<string, string> }>;

/** A new chat's text, cleaned: the first message as typed text, the rest single lines. */
export function cleanStart(input: StartSessionRequest): StartSessionRequest {
  const line = (value: string | undefined) => (value === undefined ? undefined : cleanText(value, 'line'));
  const context = input.context;
  return {
    ...input,
    ...(input.firstMessage === undefined ? {} : { firstMessage: stripChatTokens(cleanText(input.firstMessage, 'input')) || undefined }),
    ...(input.lead ? { lead: Object.fromEntries(Object.entries(input.lead).map(([key, value]) => [key, typeof value === 'string' ? cleanText(value, 'input') : value])) } : {}),
    context: {
      ...context,
      pageUrl: line(context.pageUrl) || context.pageUrl,
      ...(context.pageTitle === undefined ? {} : { pageTitle: line(context.pageTitle) }),
      ...(context.referrer === undefined ? {} : { referrer: line(context.referrer) }),
      ...(context.utm ? { utm: Object.fromEntries(Object.entries(context.utm).map(([key, value]) => [key, typeof value === 'string' ? cleanText(value, 'line') : value])) } : {}),
    },
  };
}

/** A visitor's message, cleaned: typed text as `input`, an action's label as one line, its value as given (form answers are JSON). */
export function cleanSend(input: SendRequest): SendRequest {
  if (input.kind === 'text') return { ...input, text: stripChatTokens(cleanText(input.text, 'input')) };
  return { ...input, label: cleanText(input.label, 'line'), value: cleanText(input.value, 'output') };
}

/** Send the turn as JSON, or as the stream the client asked for. */
async function answer<T>(c: Context<HonoEnv>, ctx: RequestCtx, streaming: boolean, relay: ReturnType<typeof textRelay>, work: Promise<ChatTurn>, respond: Respond<T>): Promise<Response> {
  if (streaming) {
    return streamResponse(ctx, c.req.path, async (onText) => {
      relay.attach(onText);
      return (await respond(await work, true)).body;
    });
  }
  const { body, headers } = await respond(await work, false);
  for (const [key, value] of Object.entries(headers ?? {})) c.header(key, value);
  c.header('Server-Timing', ctx.timing.header());
  return c.json(body as object);
}

/**
 * Run `finish` against the limits' verdict: a gated connector overlaps its
 * cheap preparation with it. Resolves once the verdict passed, with the work
 * still running (wrapped, so the stream can start before the reply is done).
 */
async function gated<T>(prepared: PreparedConnector, verdict: Promise<unknown>, finish: () => Promise<T>): Promise<{ work: Promise<T> }> {
  if (prepared.connector.gated) {
    const work = finish();
    work.catch(() => {});
    await verdict;
    return { work };
  }
  await verdict;
  return { work: finish() };
}

export async function startChat<T>(
  c: Context<HonoEnv>,
  options: { siteId: string; site: SiteConfig; prepared: PreparedConnector; input: StartSessionRequest; channel: Channel; respond: Respond<T> },
): Promise<Response> {
  const ctx = c.get('helppuff');
  const { siteId, site, prepared, channel } = options;
  const input = cleanStart(options.input);
  const limits = site.security.limits;

  // Lead fields against the site's configured form (the widget's pre-chat form); the API's contact is cleaned the same way.
  const lead = channel.kind === 'api' ? (input.lead ?? {}) : site.widget.leadForm.enabled ? validateLead(input.lead, site.widget.leadForm.fields, limits) : {};

  if (input.firstMessage && input.firstMessage.length > limits.maxMessageLength) {
    throw new HelpPuffError('bad_request', { message: 'That message is a little too long.', detail: 'first_message_too_long' });
  }

  // Rate limits, before anything that costs money. Scoped by site: each site
  // configures its own limit and its own budget. Read together; counter
  // writes happen after the response. With a database, every count is one
  // read of what it records (the visitor's chats carry their salted IP hash).
  const db = dbFrom(ctx.env);
  const defer = ctx.platform.waitUntil;
  const exempt = channel.standing === 'exempt';
  const verdict = (async () => {
    const pass = { allowed: true, count: 0 };
    const [perIp, perIpDay, daily] = await ctx.timing.span('limits', async () => {
      if (db) {
        const caps = await recordedCaps(
          db,
          siteId,
          null,
          { perSession: limits.messagesPerSession, perDay: limits.messagesPerSitePerDay, sessionsPerIpHour: limits.sessionsPerIpPerHour, sessionsPerIpDay: limits.sessionsPerIpPerDay },
          ctx.platform.now(),
          exempt ? null : channel.visitor,
        );
        return [caps.ipSessionsHour, caps.ipSessionsDay, caps.daily] as const;
      }
      return Promise.all([
        exempt ? pass : hitWindow(ctx.platform.kv, 'sess', `${siteId}:${channel.visitor}`, limits.sessionsPerIpPerHour, 3600, undefined, defer),
        exempt ? pass : hitWindow(ctx.platform.kv, 'sessd', `${siteId}:${channel.visitor}`, limits.sessionsPerIpPerDay, 86_400, undefined, defer),
        hitDaily(ctx.platform.kv, siteId, limits.messagesPerSitePerDay, undefined, defer),
      ]);
    });
    if (!perIp.allowed) {
      ctx.platform.log('limit.sessions_per_ip', { siteId });
      throw rateLimited(perIp, 'sessions_per_ip_per_hour');
    }
    if (!perIpDay.allowed) {
      ctx.platform.log('limit.sessions_per_ip_day', { siteId });
      throw rateLimited(perIpDay, 'sessions_per_ip_per_day');
    }
    // The cost backstop. When this trips the widget shows the fallback contact.
    if (!daily.allowed) {
      ctx.platform.log('limit.site_daily', { siteId });
      throw quotaExceeded('messages_per_site_per_day', 'Chat is unavailable right now.');
    }
    // Captcha, last before the connector — it costs a round trip.
    const captcha = site.security.captcha;
    if (captcha && channel.kind === 'widget') {
      await assertTurnstile(String(resolveSecrets(captcha.secret, ctx.env)), channel.captchaToken, ctx.platform);
    }
  })();
  const gate = verdict.then(() => undefined);
  gate.catch(() => {});

  const sessionId = newSessionId();
  const streaming = wantsStream(c.req.header('Accept'), prepared);
  const relay = textRelay();

  const finish = async (): Promise<ChatTurn> => {
    const cctx = connectorContext(ctx, prepared, siteId, sessionId, streaming ? relay.onText : undefined, (found) => {
      recordLead(ctx, { siteId, sessionId, lead: found, source: 'ai' });
      dispatchLead(ctx, site, siteId, { sessionId, lead: found, context: input.context });
    });
    if (prepared.connector.gated) cctx.gate = gate;
    const started = await ctx.timing.span('connector', () => runConnector(ctx, 'start', () => prepared.connector.start(cctx, { ...input, lead })));
    // Nothing is recorded for a request the limits refused.
    await verdict;

    const messages = guardReplies(sanitizeConnectorMessages(started.messages, ctx.platform, { allowEmpty: true }), prepared.guidance, ctx.platform);
    ctx.platform.log('session.started', { siteId, sessionId, messages: messages.length });

    // The dashboard's copy, when a database is bound — never blocking.
    recordStart(ctx, {
      siteId,
      sessionId,
      visitor: channel.visitor,
      channel: channel.kind,
      lead,
      context: input.context,
      firstMessage: input.firstMessage,
      messages,
      country: c.req.header('CF-IPCountry') ?? null,
    });
    // Lead destinations, after the response is decided and never blocking it.
    dispatchLead(ctx, site, siteId, { sessionId, lead, context: input.context, ...(input.firstMessage ? { firstMessage: input.firstMessage } : {}) });
    return { sessionId, messages, state: started.state, forms: offeredForms(undefined, messages), count: 0 };
  };

  const { work } = await gated(prepared, verdict, finish);
  return answer(c, ctx, streaming, relay, work, options.respond);
}

export async function sendChat<T>(c: Context<HonoEnv>, options: { session: ChatSession; input: SendRequest; channel: Channel; respond: Respond<T> }): Promise<Response> {
  const ctx = c.get('helppuff');
  const { session, channel } = options;
  const { site, siteId, sessionId, prepared } = session;
  const input = cleanSend(options.input);

  const length = input.kind === 'text' ? input.text.length : input.value.length;
  if (length === 0 || (input.kind === 'action' && !input.label)) throw new HelpPuffError('bad_request', { message: 'That message is empty.', detail: 'message_empty' });
  if (length > site.security.limits.maxMessageLength) {
    throw new HelpPuffError('bad_request', { message: 'That message is a little too long.', detail: 'message_too_long' });
  }
  // Live chat: whether a person has this conversation (one read, started now, awaited with the limits).
  const live = site.live.enabled ? liveDeps(ctx) : null;
  const liveRead = live ? readLiveState(live.db, sessionId) : Promise.resolve(null);
  liveRead.catch(() => {});
  // A form is answered only if this chat was shown it (see core/forms.ts). The callback form offered
  // over the live socket (nobody took the chat in time) is for a conversation that was handed over.
  if (isFormSubmission(input) && !formWasOffered(input.actionId, session.forms, site.widget.forms)) {
    const handedOver = input.actionId === LIVE_CALLBACK_FORM && Boolean((await liveRead)?.handover_at);
    if (!handedOver) {
      ctx.platform.log('form.not_offered', { siteId });
      throw new HelpPuffError('bad_request', { message: 'This form has expired. Please refresh the page and try again.', detail: 'form_not_offered' });
    }
  }

  /*
   * The limits are read together, and nothing here writes before the
   * response (see core/ratelimit.ts): per visitor by the Rate Limiting
   * binding, per conversation and per day from the database's record of the
   * turns, else KV counters written with `waitUntil`. The per-session cap is
   * counted server-side — a client chooses which token to send, so a
   * token-held count can be rewound.
   */
  const limits = site.security.limits;
  const defer = ctx.platform.waitUntil;
  const db = dbFrom(ctx.env);
  const limiter = ipLimiter(ctx.env, limits.messagesPerIpPerMinute);
  const ipBucket = `${siteId}:${channel.visitor}`;
  const exempt = channel.standing === 'exempt';
  const checkLimits = async (): Promise<number> => {
    const pass = Promise.resolve({ allowed: true, count: 0 });
    const [perIp, [perIpDay, perSession, daily]] = await ctx.timing.span('limits', () =>
      Promise.all([
        exempt ? pass : limiter ? hitLimiter(limiter, ipBucket) : hitWindow(ctx.platform.kv, 'msg', ipBucket, limits.messagesPerIpPerMinute, 60, undefined, defer),
        db
          ? recordedCaps(
              db,
              siteId,
              sessionId,
              { perSession: limits.messagesPerSession, perDay: limits.messagesPerSitePerDay, perIpDay: limits.messagesPerIpPerDay },
              ctx.platform.now(),
              exempt ? null : channel.visitor,
            ).then((caps) => [caps.ipDay, caps.session, caps.daily] as const)
          : Promise.all([
              exempt ? pass : hitWindow(ctx.platform.kv, 'msgd', ipBucket, limits.messagesPerIpPerDay, 86_400, undefined, defer),
              hitTotal(ctx.platform.kv, sessionMessageKey(sessionId), limits.messagesPerSession, session.ttlSeconds, defer),
              hitDaily(ctx.platform.kv, siteId, limits.messagesPerSitePerDay, undefined, defer),
            ]),
      ]),
    );
    if (!perIp.allowed) {
      ctx.platform.log('limit.messages_per_ip', { siteId });
      throw rateLimited(perIp, 'messages_per_ip_per_minute');
    }
    if (!perIpDay.allowed) {
      ctx.platform.log('limit.messages_per_ip_day', { siteId });
      throw rateLimited(perIpDay, 'messages_per_ip_per_day');
    }
    if (!perSession.allowed) {
      ctx.platform.log('limit.messages_per_session', { siteId });
      throw quotaExceeded('messages_per_session', 'This conversation has reached its limit. Start a new one to keep going.');
    }
    if (!daily.allowed) {
      ctx.platform.log('limit.site_daily', { siteId });
      throw quotaExceeded('messages_per_site_per_day', 'Chat is unavailable right now.');
    }
    return perSession.count;
  };

  // A lead the conversation produced: kept for the dashboard, sent to the lead destinations.
  const reportLead = (lead: Record<string, string>, source: 'form' | 'ai' = 'ai') => {
    recordLead(ctx, { siteId, sessionId, lead, source });
    dispatchLead(ctx, site, siteId, { sessionId, lead, context: { pageUrl: channel.pageUrl } });
  };

  const streaming = wantsStream(c.req.header('Accept'), prepared);
  const relay = textRelay();
  const verdict = checkLimits();
  const gate = verdict.then(() => undefined);
  gate.catch(() => {});
  const submitted = formLead(input, limits);
  const callbackLead = submitted && input.kind === 'action' && isCallbackForm(input.actionId) ? { ...submitted, request: 'callback' } : submitted;
  const visitorText = input.kind === 'text' ? input.text : input.label || input.value;

  // A person has this chat: the message goes to the team, not the assistant (unless the
  // site lets the assistant answer until someone takes it). No reply now; it comes over the live socket.
  const state = live ? await liveRead : null;
  const liveNow = live !== null && isLive(state, site.live, ctx.platform.now());
  if (live && liveNow && !(site.live.aiWhileWaiting && !state?.assigned_to)) {
    const count = await verdict;
    if (callbackLead) reportLead(callbackLead, 'form');
    const messages = callbackLead ? [notice(COPY.thanks)] : [];
    recordTurn(ctx, { siteId, sessionId, request: input, messages, status: 'live' });
    relayVisitorMessage(live, siteId, sessionId, visitorText);
    ctx.platform.log('message.live', { siteId, sessionId, count });
    return answer(c, ctx, false, relay, Promise.resolve({ sessionId, messages, state: session.state, forms: [...(session.forms ?? [])], count }), options.respond);
  }

  // "Talk to a person": the server's own, whichever backend runs the chat.
  if (input.kind === 'action' && input.actionId === HANDOVER_ACTION) {
    const count = await verdict;
    const result: HandoverResult = live
      ? await startHandover(live, site, { siteId, conversationId: sessionId, visitor: channel.visitor, exempt, reason: 'asked' })
      : noHandover('unavailable', ctx.platform.now());
    recordTurn(ctx, { siteId, sessionId, request: input, messages: result.messages, status: result.status === 'started' ? 'keep' : liveNow ? 'keep' : 'bot' });
    return answer(c, ctx, false, relay, Promise.resolve({ sessionId, messages: result.messages, state: session.state, forms: offeredForms(session.forms, result.messages), count }), options.respond);
  }

  const finish = async (): Promise<ChatTurn> => {
    const cctx = connectorContext(ctx, prepared, siteId, sessionId, streaming ? relay.onText : undefined, (lead) => reportLead(lead));
    if (prepared.connector.gated) cctx.gate = gate;
    // The assistant may hand over itself (workers-ai's `request_person`), once per turn.
    let handover: HandoverResult | null = null;
    if (live && !liveNow) {
      cctx.handover = async (reason) => {
        try {
          await verdict;
          handover ??= await startHandover(live, site, { siteId, conversationId: sessionId, visitor: channel.visitor, exempt, reason });
          return handover.status;
        } catch {
          return 'unavailable';
        }
      };
    }
    const result = await ctx.timing.span('connector', () => runConnector(ctx, 'send', () => prepared.connector.send(cctx, session.state, input)));
    const count = await verdict;
    const handed = handover as HandoverResult | null;
    const messages = [
      ...guardReplies(sanitizeConnectorMessages(result.messages, ctx.platform, { allowEmpty: Boolean(handed) }), prepared.guidance, ctx.platform),
      ...(handed?.messages ?? []),
    ];
    ctx.platform.log('message.sent', { siteId, sessionId, count });
    const status: TurnStatus = handed?.status === 'started' || liveNow ? 'keep' : 'bot';
    recordTurn(ctx, { siteId, sessionId, request: input, messages, status });
    if (liveNow && live) relayVisitorMessage(live, siteId, sessionId, visitorText);
    return { sessionId, messages, state: result.state === undefined ? session.state : result.state, forms: offeredForms(session.forms, messages), count };
  };

  const { work } = await gated(prepared, verdict, finish);
  // The callback form is itself the request: recorded once, here, whatever the model says next.
  if (callbackLead) reportLead(callbackLead, 'form');
  return answer(c, ctx, streaming, relay, work, options.respond);
}

/** Close a conversation: the connector's own end, then `conversation.ended` once (decided by the database). */
export function endChat(ctx: RequestCtx, session: Pick<ChatSession, 'siteId' | 'sessionId' | 'state' | 'prepared'>): void {
  const { siteId, sessionId, prepared } = session;
  const end = prepared.connector.end;
  if (end) {
    const cctx = connectorContext(ctx, prepared, siteId, sessionId);
    ctx.platform.waitUntil(end(cctx, session.state).catch(() => ctx.platform.log('connector.end_failed')));
  }
  ctx.platform.log('session.ended', { siteId, sessionId });
  const db = dbFrom(ctx.env);
  if (!db) return;
  const now = ctx.platform.now();
  ctx.platform.waitUntil(
    (async () => {
      const result = (await db
        .prepare(
          `INSERT INTO conversations (id, site_id, started_at, last_at, message_count, ended_at) VALUES (?, ?, ?, ?, 0, ?)
           ON CONFLICT (id) DO UPDATE SET ended_at = excluded.ended_at WHERE conversations.ended_at IS NULL`,
        )
        .bind(sessionId, siteId, now, now, now)
        .run()) as { meta?: { changes?: number }; changes?: number } | undefined;
      if ((result?.meta?.changes ?? result?.changes ?? 0) > 0) emit(ctx, siteId, 'conversation.ended', { conversationId: sessionId });
    })().catch(() => ctx.platform.log('record.failed')),
  );
}
