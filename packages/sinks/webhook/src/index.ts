import { z } from 'zod';
import { defineSink, signBody, type Sink } from '@murmur/sink-types';

/**
 * POST the lead as JSON to any URL (§6.6). Covers Zapier, Make, n8n, a Google
 * Sheet via Apps Script, and most CRMs without writing a connector.
 */

const secretRef = z.object({ env: z.string().min(1) }).strict();
/** Resolved by the server before the sink sees it, so accept either shape. */
const resolvable = z.union([z.string().min(1), secretRef]);

export const webhookOptionsSchema = z.object({
  url: resolvable,
  /** Extra headers, for an API key the receiver expects. */
  headers: z.record(z.string().min(1).max(128), resolvable).optional(),
  /** When set, the body is signed so the receiver can verify the sender. */
  signingSecret: resolvable.optional(),
  timeoutMs: z.number().int().min(1000).max(20_000).default(8000),
});

export type WebhookOptions = z.infer<typeof webhookOptionsSchema>;

/** Secrets arrive already resolved; anything still a ref means a config slip. */
function value(input: string | { env: string }, what: string): string {
  if (typeof input === 'string') return input;
  throw new Error(`webhook sink: ${what} was never resolved (${input.env})`);
}

const webhook: Sink<WebhookOptions> = {
  type: 'webhook',
  optionsSchema: webhookOptionsSchema,

  async onLead(ctx, event) {
    const url = value(ctx.options.url, 'url');
    const body = JSON.stringify({
      siteId: event.siteId,
      sessionId: event.sessionId,
      lead: event.lead,
      context: event.context,
      ...(event.firstMessage ? { firstMessage: event.firstMessage } : {}),
      at: new Date(event.at).toISOString(),
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [name, raw] of Object.entries(ctx.options.headers ?? {})) {
      headers[name] = value(raw, `header ${name}`);
    }
    if (ctx.options.signingSecret) {
      headers['X-Murmur-Signature'] = await signBody(value(ctx.options.signingSecret, 'signingSecret'), body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.options.timeoutMs);

    try {
      const response = await ctx.fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      // The status is logged, not thrown — a sink failure must never reach
      // the visitor (§6.6). The lead is already in the conversation.
      if (!response.ok) ctx.log('sink.webhook_status', { status: response.status });
      else ctx.log('sink.webhook_ok');
    } catch {
      ctx.log('sink.webhook_failed');
    } finally {
      clearTimeout(timer);
    }
  },
};

export const webhookSink = defineSink(webhook);
export default webhookSink;
