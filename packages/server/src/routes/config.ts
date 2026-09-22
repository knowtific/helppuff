import { Hono } from 'hono';
import type { ConfigResponse } from '@murmur/protocol';
import { getSite } from '../config/load.js';
import { getConnector } from '../core/registry.js';
import type { HonoEnv } from '../core/request.js';

/** Public config is cacheable at the edge for 5 minutes (§5.1). */
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300';

export const configRoutes = new Hono<HonoEnv>();

configRoutes.get('/v1/sites/:siteId/config', (c) => {
  const ctx = c.get('mm');
  const siteId = c.req.param('siteId');
  const site = getSite(ctx.config, siteId);
  const connector = getConnector(site.connector.type);

  const body: ConfigResponse = {
    siteId,
    widget: site.widget,
    capabilities: connector.capabilities,
  };

  ctx.platform.log('config.served', { siteId });
  c.header('Cache-Control', CACHE_CONTROL);
  return c.json(body);
});
