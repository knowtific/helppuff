import type { MurmurConfig, SiteConfig } from './schema.js';
import { storedSiteConfigSchema } from './schema.js';
import { MurmurError } from '../core/errors.js';
import type { Platform } from '../core/platform.js';

/**
 * Site config, read from KV first and the bundled `murmur.config.ts` second.
 *
 * The bundled config is compiled into the Worker, so changing it is a deploy.
 * A `config:<siteId>` key in KV overrides it at runtime, which is what makes a
 * site's connector, copy, limits and lead destinations editable without one.
 * Prompts already work this way (`{ kv: '…' }`); this is the same idea for the
 * rest of the site.
 *
 * Two deliberate limits:
 *
 * - **`origins` is not overridable.** See `storedSiteConfigSchema`.
 * - **The site must already exist in the bundle**, since that is where its
 *   origins come from. Adding a site is still a deploy.
 *
 * A stored config that will not parse is ignored rather than fatal: the site
 * falls back to what shipped in the bundle. A bad paste into KV should degrade
 * to the last known-good config, never take a site offline.
 */

export const SITE_CONFIG_PREFIX = 'config:';

/** KV caches at the edge for this long, so a change takes up to a minute. */
export const SITE_CONFIG_CACHE_TTL = 60;

export function siteConfigKey(siteId: string): string {
  return `${SITE_CONFIG_PREFIX}${siteId}`;
}

type Ctx = { config: MurmurConfig; platform: Pick<Platform, 'kv' | 'log'> };

export async function resolveSite(ctx: Ctx, siteId: string): Promise<SiteConfig> {
  const bundled = ctx.config.sites[siteId];
  if (!bundled) throw new MurmurError('not_found', { detail: 'unknown_site' });

  const stored = await ctx.platform.kv.get(siteConfigKey(siteId), {
    cacheTtl: SITE_CONFIG_CACHE_TTL,
  });
  if (stored === null) return bundled;

  const overrides = parseStored(stored, siteId, ctx.platform.log);
  if (!overrides) return bundled;

  // Whole sections replace their bundled counterpart; anything left out keeps
  // the deployed value. Merging field by field would make what is actually in
  // force impossible to reason about from either source alone.
  return {
    ...bundled,
    ...(overrides.connector ? { connector: overrides.connector } : {}),
    ...(overrides.sinks ? { sinks: overrides.sinks } : {}),
    ...(overrides.security ? { security: overrides.security } : {}),
    ...(overrides.widget ? { widget: overrides.widget } : {}),
    ...(overrides.knowledge ? { knowledge: overrides.knowledge } : {}),
  };
}

function parseStored(stored: string, siteId: string, log: Platform['log']) {
  let json: unknown;
  try {
    json = JSON.parse(stored);
  } catch {
    log('config.kv_unparsable', { siteId });
    return null;
  }

  const result = storedSiteConfigSchema.safeParse(json);
  if (!result.success) {
    // Issue paths name the offending field without echoing its value, which
    // could be anything — so this stays safe to log.
    log('config.kv_invalid', {
      siteId,
      issues: result.error.issues.map((issue) => issue.path.join('.') || '(root)').slice(0, 10),
    });
    return null;
  }

  log('config.kv_hit', { siteId, sections: Object.keys(result.data) });
  return result.data;
}
