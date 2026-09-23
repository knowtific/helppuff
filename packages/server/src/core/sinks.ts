import type { LeadEvent, SinkContext } from '@murmur/sink-types';
import type { Lead, VisitorContext } from '@murmur/protocol';
import type { SiteConfig } from '../config/schema.js';
import { resolveSecrets } from '../config/load.js';
import { MurmurError } from './errors.js';
import { getSink } from './registry.js';
import type { RequestCtx } from './request.js';

/**
 * Run every configured lead destination (§6.6).
 *
 * Fire-and-forget through `waitUntil`: the visitor's reply never waits on a
 * CRM, and a sink that fails is logged and never surfaces to them. A broken
 * sink config is the site owner's problem to see in the logs, not the
 * visitor's to read in the panel.
 */
export function dispatchLead(
  ctx: RequestCtx,
  site: SiteConfig,
  siteId: string,
  event: { sessionId: string; lead: Lead; context: VisitorContext; firstMessage?: string },
): void {
  if (site.sinks.length === 0) return;
  // Nothing to forward if the site collects no lead at all.
  if (Object.keys(event.lead).length === 0) return;

  const payload: LeadEvent = {
    siteId,
    sessionId: event.sessionId,
    lead: event.lead,
    context: event.context,
    ...(event.firstMessage ? { firstMessage: event.firstMessage } : {}),
    at: ctx.platform.now(),
  };

  for (const configured of site.sinks) {
    ctx.platform.waitUntil(
      (async () => {
        try {
          const sink = getSink(configured.type);
          const options = sink.parseOptions(resolveSecrets(configured.options ?? {}, ctx.env));
          const sinkCtx: SinkContext<unknown> = {
            options,
            siteId,
            fetch: globalThis.fetch.bind(globalThis),
            log: (name: string, data?: object) => ctx.platform.log(name, data),
          };
          await sink.onLead(sinkCtx, payload);
        } catch (error) {
          /*
           * Includes an unknown sink type and an unresolved `{ env }` ref.
           * The detail names which — `missing_secret:LEAD_WEBHOOK_URL` — and
           * never carries a value, so it stays safe to log (§7.2). Without it
           * a misconfigured sink is indistinguishable from a receiver that is
           * simply down.
           */
          const detail =
            error instanceof MurmurError
              ? error.detail
              : error instanceof Error
                ? error.message.slice(0, 120)
                : undefined;
          ctx.platform.log('sink.failed', { type: configured.type, ...(detail ? { detail } : {}) });
        }
      })(),
    );
  }
}
