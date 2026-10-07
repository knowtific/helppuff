import { Hono } from 'hono';
import { cleanText, startSessionRequestSchema, stripChatTokens, type StartSessionRequest, type StartSessionResponse } from '@helppuff/protocol';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { validateLead } from '../core/lead.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { dbFrom } from '../db/d1.js';
import { capabilitiesOf, connectorContext, prepareConnector, runConnector } from '../core/run.js';
import { streamResponse, textRelay, wantsStream } from '../core/stream.js';
import { guardReplies, sanitizeConnectorMessages } from '../core/sanitize.js';
import { issueToken, newSessionId } from '../core/token.js';
import { hitDaily, hitWindow, rateLimited, quotaExceeded, recordedCaps } from '../core/ratelimit.js';
import { assertTurnstile } from '../core/turnstile.js';
import { resolveSecrets } from '../config/load.js';
import { dispatchLead } from '../core/sinks.js';
import { recordLead, recordStart } from '../admin/record.js';
import { offeredForms } from '../core/forms.js';
import { visitorStanding } from '../core/visitor.js';

export const sessionRoutes = new Hono<HonoEnv>();

/**
 * Cheap rejections first, anything that costs money or writes data last.
 */
sessionRoutes.post('/v1/sites/:siteId/sessions', async (c) => {
  const ctx = c.get('helppuff');
  const siteId = c.req.param('siteId');

  // 1. Resolve site.
  const site = await ctx.timing.span('site', () => resolveSite(ctx, siteId));

  // 2. Origin allowlist.
  assertAllowedOrigin(ctx.origin, site.origins);

  // 3. Body shape, cleaned (`cleanText`: no control or hidden characters).
  const parsed = startSessionRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    throw new HelpPuffError('bad_request', { detail: 'session_body_invalid' });
  }
  const input = cleanStart(parsed.data);
  const limits = site.security.limits;

  // 4. Lead fields against the site's configured form.
  const lead = site.widget.leadForm.enabled
    ? validateLead(input.lead, site.widget.leadForm.fields, limits)
    : {};

  if (input.firstMessage && input.firstMessage.length > limits.maxMessageLength) {
    throw new HelpPuffError('bad_request', {
      message: 'That message is a little too long.',
      detail: 'first_message_too_long',
    });
  }

  // 5. Rate limits, before anything that costs money. A blocked IP stops here.
  const standing = await visitorStanding(ctx, site.security);
  const ipKey = await ctx.ipKey();

  // Scoped by site: each site configures its own limit and its own budget,
  // so one site's traffic must not consume another's.
  // Read together; the counter writes happen after the response (see messages.ts).
  // The daily count comes from the database when there is one (no KV write);
  const db = dbFrom(ctx.env);
  // Limits and the captcha make one verdict; a gated connector overlaps its
  // cheap preparation with it and waits for it before the model.
  const defer = ctx.platform.waitUntil;
  const verdict = (async () => {
    const exempt = standing === 'exempt';
    const pass = { allowed: true, count: 0 };
    // With a database, every count is one read of what it records (the visitor's chats carry their salted IP hash);
    // without one, KV counters written after the response.
    const [perIp, perIpDay, daily] = await ctx.timing.span('limits', async () => {
      if (db) {
        const caps = await recordedCaps(
          db,
          siteId,
          null,
          { perSession: limits.messagesPerSession, perDay: limits.messagesPerSitePerDay, sessionsPerIpHour: limits.sessionsPerIpPerHour, sessionsPerIpDay: limits.sessionsPerIpPerDay },
          ctx.platform.now(),
          exempt ? null : ipKey,
        );
        return [caps.ipSessionsHour, caps.ipSessionsDay, caps.daily] as const;
      }
      return Promise.all([
        exempt ? pass : hitWindow(ctx.platform.kv, 'sess', `${siteId}:${ipKey}`, limits.sessionsPerIpPerHour, 3600, undefined, defer),
        exempt ? pass : hitWindow(ctx.platform.kv, 'sessd', `${siteId}:${ipKey}`, limits.sessionsPerIpPerDay, 86_400, undefined, defer),
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
    // 6. Captcha, last before the connector — it costs a round trip.
    const captcha = site.security.captcha;
    if (captcha) {
      const secretValue = resolveSecrets(captcha.secret, ctx.env);
      await assertTurnstile(String(secretValue), input.captchaToken, ctx.platform);
    }
  })();
  const gate = verdict.then(() => undefined);
  gate.catch(() => {});

  // 7. Connector.
  const secret = requireSecret(ctx);
  const sessionId = newSessionId();
  const prepared = prepareConnector(ctx, site);

  const streaming = wantsStream(c.req.header('Accept'), prepared);
  const relay = textRelay();

  // Steps 7-9, shared by the JSON and the streamed response.
  const finish = async (): Promise<StartSessionResponse> => {
    const cctx = connectorContext(ctx, prepared, siteId, sessionId, streaming ? relay.onText : undefined, (found) => {
      recordLead(ctx, { siteId, sessionId, lead: found, source: 'ai' });
      dispatchLead(ctx, site, siteId, { sessionId, lead: found, context: input.context });
    });
    if (prepared.connector.gated) cctx.gate = gate;
    const started = await ctx.timing.span('connector', () =>
      runConnector(ctx, 'start', () => prepared.connector.start(cctx, { ...input, lead })),
    );
    // Nothing is recorded for a request the limits refused.
    await verdict;

    const messages = guardReplies(sanitizeConnectorMessages(started.messages, ctx.platform, { allowEmpty: true }), prepared.guidance, ctx.platform);

    // 8. Sign and respond.
    const { token, expiresAt } = await issueToken(secret, {
      siteId,
      sessionId,
      state: started.state,
      count: 0,
      forms: offeredForms(undefined, messages),
      ttlMs: site.security.sessionTtlHours * 3600_000,
    });

    ctx.platform.log('session.started', { siteId, sessionId, messages: messages.length });

    // 9. The dashboard's copy, when a database is bound — also never blocking.
    recordStart(ctx, {
      siteId,
      sessionId,
      visitor: ipKey,
      lead,
      context: input.context,
      firstMessage: input.firstMessage,
      messages,
      country: c.req.header('CF-IPCountry') ?? null,
    });

    // 10. Lead destinations, after the response is decided and never blocking it.
    dispatchLead(ctx, site, siteId, {
      sessionId,
      lead,
      context: input.context,
      ...(input.firstMessage ? { firstMessage: input.firstMessage } : {}),
    });

    return { sessionToken: token, sessionId, expiresAt, messages, capabilities: capabilitiesOf(prepared, Boolean(dbFrom(ctx.env))) };
  };

  let work: Promise<StartSessionResponse>;
  if (prepared.connector.gated) {
    work = finish();
    work.catch(() => {});
    await verdict;
  } else {
    await verdict;
    work = finish();
  }

  if (streaming) {
    return streamResponse(ctx, c.req.path, async (onText) => {
      relay.attach(onText);
      return work;
    });
  }
  const body = await work;
  c.header('Server-Timing', ctx.timing.header());
  return c.json(body);
});

/** A new chat's text, cleaned: the first message as typed text, the rest single lines. */
function cleanStart(input: StartSessionRequest): StartSessionRequest {
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

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HelpPuffError('bad_request', { detail: 'body_not_json' });
  }
}
