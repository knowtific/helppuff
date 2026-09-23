import type { z } from 'zod';
import type { Lead, VisitorContext } from '@murmur/protocol';

/**
 * A lead destination (§6.6). Sinks run after the lead is accepted, via
 * `waitUntil`, so they never block the visitor — and a failure is logged and
 * never surfaces to them.
 */

export type LeadEvent = {
  siteId: string;
  sessionId: string;
  lead: Lead;
  context: VisitorContext;
  firstMessage?: string;
  /** Epoch ms. */
  at: number;
};

export type SinkContext<Opts> = {
  options: Opts;
  siteId: string;
  fetch: typeof fetch;
  /** Structured logging. Never receives lead data (§7.2). */
  log: (event: string, data?: object) => void;
};

export interface Sink<Opts = unknown> {
  type: string;
  optionsSchema: z.ZodType<Opts, z.ZodTypeDef, unknown>;
  onLead(ctx: SinkContext<Opts>, lead: LeadEvent): Promise<void>;
}

/** The registry holds sinks of differing option types, so they are erased. */
export interface ErasedSink {
  readonly type: string;
  parseOptions(input: unknown): unknown;
  onLead(ctx: SinkContext<unknown>, lead: LeadEvent): Promise<void>;
}

export function defineSink<Opts>(sink: Sink<Opts>): ErasedSink {
  return {
    type: sink.type,
    parseOptions: (input) => sink.optionsSchema.parse(input),
    onLead: (ctx, lead) => sink.onLead(ctx as SinkContext<Opts>, lead),
  };
}

/** HMAC-SHA256 of the body, so a receiver can verify it came from us (§6.4). */
export async function signBody(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `sha256=${[...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
