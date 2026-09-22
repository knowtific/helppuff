import { isConnectorError, type ConnectorContext, type ErasedConnector } from '@murmur/connector-types';
import type { SiteConfig } from '../config/schema.js';
import { resolveSecrets } from '../config/load.js';
import { MurmurError, toMurmurError } from './errors.js';
import { getConnector } from './registry.js';
import type { RequestCtx } from './request.js';

export type PreparedConnector = { connector: ErasedConnector; options: unknown };

/**
 * Resolve the site's connector and validate its options against the
 * connector's own schema, with `{ env }` secrets filled in from the runtime.
 */
export function prepareConnector(ctx: RequestCtx, site: SiteConfig): PreparedConnector {
  const connector = getConnector(site.connector.type);
  const resolved = resolveSecrets(site.connector.options ?? {}, ctx.env);
  try {
    return { connector, options: connector.parseOptions(resolved) };
  } catch (thrown) {
    if (thrown instanceof MurmurError) throw thrown;
    ctx.platform.log('connector.bad_options', { type: site.connector.type });
    throw new MurmurError('internal', { detail: `connector_options_invalid:${site.connector.type}` });
  }
}

export function connectorContext(
  ctx: RequestCtx,
  prepared: PreparedConnector,
  siteId: string,
  sessionId: string,
): ConnectorContext<unknown> {
  return {
    options: prepared.options,
    siteId,
    sessionId,
    env: ctx.env,
    kv: ctx.platform.kv,
    fetch: globalThis.fetch.bind(globalThis),
    log: (event, data) => ctx.platform.log(`connector.${event}`, data),
    waitUntil: ctx.platform.waitUntil,
  };
}

/**
 * Run a connector call, converting anything it throws into a clean error
 * envelope. A stack trace or a backend's error string never reaches the
 * visitor (§8.3).
 */
export async function runConnector<T>(ctx: RequestCtx, operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (thrown) {
    if (isConnectorError(thrown)) {
      ctx.platform.log('connector.error', { operation, detail: thrown.detail ?? 'unspecified' });
      throw new MurmurError(thrown.code, {
        message: thrown.message,
        ...(thrown.retryAfter !== undefined ? { retryAfter: thrown.retryAfter } : {}),
        ...(thrown.detail !== undefined ? { detail: thrown.detail } : {}),
      });
    }
    const error = toMurmurError(thrown);
    ctx.platform.log('connector.threw', { operation, detail: error.detail ?? 'unknown' });
    // Anything that is not a ConnectorError is a bug in the connector, not a
    // condition the visitor should see described.
    throw error.code === 'internal'
      ? new MurmurError('connector_error', { detail: error.detail ?? 'connector_threw' })
      : error;
  }
}
