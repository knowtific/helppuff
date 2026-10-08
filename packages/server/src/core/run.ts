import { isConnectorError, type ConnectorContext, type ErasedConnector, type PromptGuidance } from '@helppuff/connector-types';
import { guidanceFor } from './guidance.js';
import type { Capabilities } from '@helppuff/protocol';
import type { SiteConfig } from '../config/schema.js';
import { resolveSecrets } from '../config/load.js';
import { HelpPuffError, toHelpPuffError } from './errors.js';
import { getConnector } from './registry.js';
import type { RequestCtx } from './request.js';
import { recordedHistory } from '../conversations/history.js';
import { dbFrom } from '../db/d1.js';
import { emit } from '../webhooks/deliver.js';

export type PreparedConnector = {
  connector: ErasedConnector;
  options: unknown;
  /** HelpPuff's words around the owner's prompt; absent when the backend owns its prompt (Retell, OpenAI `promptId`…). */
  guidance?: PromptGuidance;
};

/**
 * Resolve the site's connector and validate its options against the
 * connector's own schema, with `{ env }` secrets filled in from the runtime.
 */
export function prepareConnector(ctx: RequestCtx, site: SiteConfig): PreparedConnector {
  const connector = getConnector(site.connector.type);
  const resolved = resolveSecrets(site.connector.options ?? {}, ctx.env);
  try {
    const options = connector.parseOptions(resolved);
    return { connector, options, ...(connector.promptOption(options) ? { guidance: guidanceFor(site) } : {}) };
  } catch (thrown) {
    if (thrown instanceof HelpPuffError) throw thrown;
    ctx.platform.log('connector.bad_options', { type: site.connector.type });
    throw new HelpPuffError('internal', { detail: `connector_options_invalid:${site.connector.type}` });
  }
}

/** What the widget is told the connector can do, streaming included. */
export function capabilitiesOf(prepared: PreparedConnector, records = false, live = false): Capabilities {
  return {
    ...prepared.connector.capabilities,
    stream: prepared.connector.streams(prepared.options),
    ...(records ? { feedback: true } : {}),
    ...(live ? { live: true } : {}),
  };
}

export function connectorContext(
  ctx: RequestCtx,
  prepared: PreparedConnector,
  siteId: string,
  sessionId: string,
  onText?: (delta: string) => void,
  reportLead?: (lead: Record<string, string>) => void,
): ConnectorContext<unknown> {
  // Turns are recorded in the database after each response: a stateless backend reads its history from there.
  const db = dbFrom(ctx.env);
  return {
    ...(db ? { history: () => recordedHistory(db, sessionId) } : {}),
    ...(prepared.guidance ? { guidance: prepared.guidance } : {}),
    ...(onText ? { onText } : {}),
    ...(reportLead ? { reportLead } : {}),
    time: (stage, ms) => ctx.timing.add(stage, ms),
    notify: (type, data) => emit(ctx, siteId, type, data),
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
 * visitor.
 */
export async function runConnector<T>(ctx: RequestCtx, operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (thrown) {
    if (isConnectorError(thrown)) {
      ctx.platform.log('connector.error', { operation, detail: thrown.detail ?? 'unspecified' });
      throw new HelpPuffError(thrown.code, {
        message: thrown.message,
        ...(thrown.retryAfter !== undefined ? { retryAfter: thrown.retryAfter } : {}),
        ...(thrown.detail !== undefined ? { detail: thrown.detail } : {}),
      });
    }
    const error = toHelpPuffError(thrown);
    ctx.platform.log('connector.threw', { operation, detail: error.detail ?? 'unknown' });
    // Anything that is not a ConnectorError is a bug in the connector, not a
    // condition the visitor should see described.
    throw error.code === 'internal'
      ? new HelpPuffError('connector_error', { detail: error.detail ?? 'connector_threw' })
      : error;
  }
}
