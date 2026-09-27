import { Hono } from 'hono';
import { startSessionRequestSchema, type StartSessionResponse } from '@murmur/protocol';
import { resolveSite } from '../config/site.js';
import { MurmurError } from '../core/errors.js';
import { validateLead } from '../core/lead.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { capabilitiesOf, connectorContext, prepareConnector, runConnector } from '../core/run.js';
import { streamResponse, wantsStream } from '../core/stream.js';
import { sanitizeConnectorMessages } from '../core/sanitize.js';
import { issueToken, newSessionId } from '../core/token.js';
import { hitDaily, hitWindow, rateLimited, quotaExceeded } from '../core/ratelimit.js';
import { assertTurnstile } from '../core/turnstile.js';
import { resolveSecrets } from '../config/load.js';
import { dispatchLead } from '../core/sinks.js';
import { recordStart } from '../admin/record.js';

export const sessionRoutes = new Hono<HonoEnv>();

/**
 * Cheap rejections first, anything that costs money or writes data last
 * (§7.1).
 */
sessionRoutes.post('/v1/sites/:siteId/sessions', async (c) => {
  const ctx = c.get('mm');
  const siteId = c.req.param('siteId');

  // 1. Resolve site.
  const site = await resolveSite(ctx, siteId);

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
  const perIp = (await ctx.isOwner())
    ? { allowed: true, count: 0 }
    : await hitWindow(ctx.platform.kv, 'sess', `${siteId}:${ipKey}`, limits.sessionsPerIpPerHour, 3600);
  if (!perIp.allowed) {
    ctx.platform.log('limit.sessions_per_ip', { siteId });
    throw rateLimited(perIp, 'sessions_per_ip_per_hour');
  }

  // The cost backstop. When this trips the widget shows the fallback contact.
  const daily = await hitDaily(ctx.platform.kv, siteId, limits.messagesPerSitePerDay);
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

  // 7. Connector.
  const secret = requireSecret(ctx);
  const sessionId = newSessionId();
  const prepared = prepareConnector(ctx, site);

  // Steps 7-9, shared by the JSON and the streamed response.
  const finish = async (onText?: (delta: string) => void): Promise<StartSessionResponse> => {
    const cctx = connectorContext(ctx, prepared, siteId, sessionId, onText);
    const started = await runConnector(ctx, 'start', () =>
      prepared.connector.start(cctx, { ...input, lead }),
    );

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

    return { sessionToken: token, sessionId, expiresAt, messages, capabilities: capabilitiesOf(prepared) };
  };

  if (wantsStream(c.req.header('Accept'), prepared)) return streamResponse(ctx, c.req.path, finish);
  return c.json(await finish());
});

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new MurmurError('bad_request', { detail: 'body_not_json' });
  }
}
