import { Hono } from 'hono';
import { startSessionRequestSchema, type StartSessionResponse } from '@murmur/protocol';
import { getSite } from '../config/load.js';
import { MurmurError } from '../core/errors.js';
import { validateLead } from '../core/lead.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { connectorContext, prepareConnector, runConnector } from '../core/run.js';
import { sanitizeConnectorMessages } from '../core/sanitize.js';
import { issueToken, newSessionId } from '../core/token.js';

export const sessionRoutes = new Hono<HonoEnv>();

/**
 * Cheap rejections first, anything that costs money or writes data last
 * (§7.1).
 */
sessionRoutes.post('/v1/sites/:siteId/sessions', async (c) => {
  const ctx = c.get('mm');
  const siteId = c.req.param('siteId');

  // 1. Resolve site.
  const site = getSite(ctx.config, siteId);

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

  // 5-6. Rate limits and captcha are added in M3, before the connector call.

  // 7. Connector.
  const secret = requireSecret(ctx);
  const sessionId = newSessionId();
  const prepared = prepareConnector(ctx, site);
  const cctx = connectorContext(ctx, prepared, siteId, sessionId);

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

  // 9. Sinks run via waitUntil once they exist (M3) — never blocking here.

  const body: StartSessionResponse = {
    sessionToken: token,
    sessionId,
    expiresAt,
    messages,
    capabilities: prepared.connector.capabilities,
  };
  return c.json(body);
});

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new MurmurError('bad_request', { detail: 'body_not_json' });
  }
}
