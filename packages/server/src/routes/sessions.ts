import { Hono } from 'hono';
import { startSessionRequestSchema, type StartSessionResponse } from '@murmur/protocol';
import { resolveSite } from '../config/site.js';
import { MurmurError } from '../core/errors.js';
import { validateLead } from '../core/lead.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { dbFrom } from '../db/d1.js';
import { capabilitiesOf, connectorContext, prepareConnector, runConnector } from '../core/run.js';
import { streamResponse, textRelay, wantsStream } from '../core/stream.js';
import { sanitizeConnectorMessages } from '../core/sanitize.js';
import { issueToken, newSessionId } from '../core/token.js';
import { hitDaily, hitWindow, rateLimited, quotaExceeded, recordedCaps } from '../core/ratelimit.js';
import { assertTurnstile } from '../core/turnstile.js';
import { resolveSecrets } from '../config/load.js';
import { dispatchLead } from '../core/sinks.js';
import { recordLead, recordStart } from '../admin/record.js';

export const sessionRoutes = new Hono<HonoEnv>();

/**
 * Cheap rejections first, anything that costs money or writes data last.
 */
sessionRoutes.post('/v1/sites/:siteId/sessions', async (c) => {
  const ctx = c.get('mm');
  const siteId = c.req.param('siteId');

  // 1. Resolve site.
  const site = await ctx.timing.span('site', () => resolveSite(ctx, siteId));

  // 2. Origin allowlist.
  assertAllowedOrigin(ctx.origin, site.origins);

  // 3. Body shape.
  const parsed = startSessionRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    throw new MurmurError('bad_request', { detail: 'session_body_invalid' });
  }
  const input = parsed.data;

  // 4. Lead fields against the site's configured form.
  const lead = site.widget.leadForm.enabled
    ? validateLead(input.lead, site.widget.leadForm.fields)
    : {};

  if (input.firstMessage && input.firstMessage.length > site.security.limits.maxMessageLength) {
    throw new MurmurError('bad_request', {
      message: 'That message is a little too long.',
      detail: 'first_message_too_long',
    });
  }

  // 5. Rate limits, before anything that costs money.
  const limits = site.security.limits;
  const ipKey = await ctx.ipKey();

  // Scoped by site: each site configures its own limit and its own budget,
  // so one site's traffic must not consume another's.
  // Read together; the counter writes happen after the response (see messages.ts).
  // The daily count comes from the database when there is one (no KV write);
  // sessions an hour stay in KV, a window longer than the Rate Limiting binding's.
  const db = dbFrom(ctx.env);
  // Limits and the captcha make one verdict; a gated connector overlaps its
  // cheap preparation with it and waits for it before the model.
  const defer = ctx.platform.waitUntil;
  const verdict = (async () => {
    const owner = await ctx.isOwner();
    const [perIp, daily] = await ctx.timing.span('limits', () =>
      Promise.all([
        owner
          ? Promise.resolve({ allowed: true, count: 0 })
          : hitWindow(ctx.platform.kv, 'sess', `${siteId}:${ipKey}`, limits.sessionsPerIpPerHour, 3600, undefined, defer),
        db
          ? recordedCaps(db, siteId, null, { perSession: limits.messagesPerSession, perDay: limits.messagesPerSitePerDay }).then((caps) => caps.daily)
          : hitDaily(ctx.platform.kv, siteId, limits.messagesPerSitePerDay, undefined, defer),
      ]),
    );
    if (!perIp.allowed) {
      ctx.platform.log('limit.sessions_per_ip', { siteId });
      throw rateLimited(perIp, 'sessions_per_ip_per_hour');
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

    const messages = sanitizeConnectorMessages(started.messages, ctx.platform, { allowEmpty: true });

    // 8. Sign and respond.
    const { token, expiresAt } = await issueToken(secret, {
      siteId,
      sessionId,
      state: started.state,
      count: 0,
      ttlMs: site.security.sessionTtlHours * 3600_000,
    });

    ctx.platform.log('session.started', { siteId, sessionId, messages: messages.length });

    // 9. The dashboard's copy, when a database is bound — also never blocking.
    recordStart(ctx, {
      siteId,
      sessionId,
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

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new MurmurError('bad_request', { detail: 'body_not_json' });
  }
}
