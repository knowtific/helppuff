import { Hono } from 'hono';
import type { ConfigResponse } from '@murmur/protocol';
import { resolveSite } from '../config/site.js';
import { getConnector } from '../core/registry.js';
import { dbFrom } from '../db/d1.js';
import { capabilitiesOf, prepareConnector } from '../core/run.js';
import type { HonoEnv, RequestCtx } from '../core/request.js';
import type { SiteConfig } from '../config/schema.js';
import type { Platform } from '../core/platform.js';

/** Public config is cacheable at the edge for 5 minutes. */
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300';

/**
 * The widget's captcha block is derived from `security.captcha`, never
 * configured separately.
 *
 * The two used to be independent, which gave the site key two homes and made
 * both half-configurations silent failures: a server-only captcha rejects
 * every session with `captcha_failed`, because the widget never renders a
 * challenge and so never sends a token; a widget-only captcha renders a
 * challenge nobody verifies, which is theatre. Deriving one from the other
 * makes the broken states unreachable.
 */
function captchaFor(
  site: SiteConfig,
  log: Platform['log'],
  siteId: string,
): { captcha?: { provider: 'turnstile'; siteKey: string } } {
  const configured = site.security.captcha;
  if (configured) {
    return { captcha: { provider: configured.provider, siteKey: configured.siteKey } };
  }
  if (site.widget.captcha) {
    // Asked for a challenge with nothing verifying it; drop it and say so.
    log('config.captcha_unverified', { siteId });
  }
  return { captcha: undefined };
}

/**
 * Streaming depends on the connector's options, so they are parsed here too.
 * Options that do not parse are reported when a session starts, where the
 * visitor can be told; the config itself still loads, just without streaming.
 */
function capabilitiesFor(ctx: RequestCtx, site: SiteConfig): ConfigResponse['capabilities'] {
  try {
    return capabilitiesOf(prepareConnector(ctx, site), Boolean(dbFrom(ctx.env)));
  } catch {
    return { ...getConnector(site.connector.type).capabilities, stream: false };
  }
}

export const configRoutes = new Hono<HonoEnv>();

configRoutes.get('/v1/sites/:siteId/config', async (c) => {
  const ctx = c.get('mm');
  const siteId = c.req.param('siteId');
  const site = await resolveSite(ctx, siteId);

  const body: ConfigResponse = {
    siteId,
    widget: { ...site.widget, ...captchaFor(site, ctx.platform.log, siteId) },
    capabilities: capabilitiesFor(ctx, site),
  };

  ctx.platform.log('config.served', { siteId });
  c.header('Cache-Control', CACHE_CONTROL);
  return c.json(body);
});
