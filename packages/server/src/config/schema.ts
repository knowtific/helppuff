import { z } from 'zod';
import { widgetConfigSchema } from '@murmur/protocol';

/**
 * A reference to an environment variable. Secrets are never written into the
 * config file (§5).
 */
export const secretRefSchema = z.object({ env: z.string().min(1).max(128) }).strict();
export type SecretRef = z.infer<typeof secretRefSchema>;

export function isSecretRef(value: unknown): value is SecretRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { env?: unknown }).env === 'string'
  );
}

/** Defaults are deliberately conservative — a site that sets nothing is still bounded. */
export const limitsSchema = z.object({
  messagesPerIpPerMinute: z.number().int().min(1).max(600).default(10),
  sessionsPerIpPerHour: z.number().int().min(1).max(1000).default(5),
  messagesPerSession: z.number().int().min(1).max(1000).default(60),
  /** The cost backstop. Always set this (§7.2). */
  messagesPerSitePerDay: z.number().int().min(1).max(1_000_000).default(500),
  maxMessageLength: z.number().int().min(1).max(4000).default(1000),
});
export type Limits = z.infer<typeof limitsSchema>;

export const captchaSchema = z.object({
  provider: z.literal('turnstile'),
  siteKey: z.string().min(1).max(200),
  secret: secretRefSchema,
});

export const securitySchema = z.object({
  captcha: captchaSchema.optional(),
  limits: limitsSchema.default({}),
  sessionTtlHours: z.number().min(0.25).max(720).default(24),
});
export type SecurityConfig = z.infer<typeof securitySchema>;

/** Connector and sink options stay opaque here — each one validates its own. */
export const connectorConfigSchema = z.object({
  type: z.string().min(1).max(64),
  options: z.unknown().optional(),
});
export type ConnectorConfig = z.infer<typeof connectorConfigSchema>;

export const sinkConfigSchema = z.object({
  type: z.string().min(1).max(64),
  options: z.unknown().optional(),
});
export type SinkConfig = z.infer<typeof sinkConfigSchema>;

export const siteConfigSchema = z.object({
  origins: z.array(z.string().min(1).max(300)).min(1),
  connector: connectorConfigSchema,
  sinks: z.array(sinkConfigSchema).max(10).default([]),
  security: securitySchema.default({}),
  widget: widgetConfigSchema.default({}),
});
export type SiteConfig = z.infer<typeof siteConfigSchema>;

/**
 * What may live in KV under `config:<siteId>`, overriding the bundled site.
 *
 * `origins` is deliberately not here. The CORS allowlist is built once when
 * the Worker starts, so an origin added in KV would pass the route check and
 * still be refused by the browser — a failure that curl cannot see. Keeping
 * the allowlist in the deploy also means write access to KV cannot widen who
 * may embed the widget.
 *
 * Strict, so a config that *does* carry `origins` is rejected outright rather
 * than silently ignored: believing you have locked a domain when you have not
 * is worse than a config that visibly did not take.
 */
export const storedSiteConfigSchema = z
  .object({
    connector: connectorConfigSchema.optional(),
    sinks: z.array(sinkConfigSchema).max(10).optional(),
    security: securitySchema.optional(),
    widget: widgetConfigSchema.optional(),
  })
  .strict();
export type StoredSiteConfig = z.infer<typeof storedSiteConfigSchema>;

export const murmurConfigSchema = z.object({
  sites: z.record(z.string().min(1).max(64), siteConfigSchema),
});
export type MurmurConfig = z.infer<typeof murmurConfigSchema>;

/** The shape a user writes in `murmur.config.ts` — defaults not yet applied. */
export type MurmurConfigInput = z.input<typeof murmurConfigSchema>;
