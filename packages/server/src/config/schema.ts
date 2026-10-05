import { z } from 'zod';
import { widgetConfigSchema } from '@murmur/protocol';

/**
 * A reference to an environment variable. Secrets are never written into the
 * config file.
 */
export const secretRefSchema = z.object({ env: z.string().min(1).max(128).describe('The environment variable name.') }).strict();
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
  messagesPerIpPerMinute: z.number().int().min(1).max(600).default(10).describe('Messages one visitor (IP) may send a minute.'),
  sessionsPerIpPerHour: z.number().int().min(1).max(1000).default(5).describe('New chats one visitor (IP) may start an hour.'),
  messagesPerSession: z.number().int().min(1).max(1000).default(60).describe('Messages in one chat before the visitor must start another.'),
  messagesPerSitePerDay: z.number().int().min(1).max(1_000_000).default(500).describe('The cost backstop. Always set this.'),
  maxMessageLength: z.number().int().min(1).max(4000).default(1000).describe('The longest message a visitor may send, in characters.'),
});
export type Limits = z.infer<typeof limitsSchema>;

export const captchaSchema = z.object({
  provider: z.literal('turnstile').describe('Cloudflare Turnstile.'),
  siteKey: z.string().min(1).max(200).describe('The Turnstile site key (public).'),
  secret: secretRefSchema.describe('The Turnstile secret key, by environment variable name.'),
});

export const securitySchema = z.object({
  captcha: captchaSchema.optional().describe('Check new chats with Cloudflare Turnstile (invisible for most visitors).'),
  limits: limitsSchema.default({}).describe('Per-visitor and per-site limits. The daily cap is the cost backstop.'),
  sessionTtlHours: z.number().min(0.25).max(720).default(24).describe('How long a chat can be continued (the widget keeps it across pages and reloads).'),
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

/**
 * The site's own knowledge base (`workers-ai`): what to crawl and when. The
 * crawl runs in the Worker's Workflow; see `knowledge/crawl.ts`.
 */
export const DEFAULT_CRAWL_EXCLUDE = ['**/privacy**', '**/terms**', '**/tag/**', '**/page/*', '**/author/**', '**/cart**', '**/checkout**', '**/my-account**'];
export const knowledgeConfigSchema = z
  .object({
    website: z.string().url().max(2000).optional().describe('The public site to crawl. Defaults to the first allowed origin.'),
    include: z.array(z.string().min(1).max(200)).max(50).default([]),
    exclude: z.array(z.string().min(1).max(200)).max(50).default(DEFAULT_CRAWL_EXCLUDE),
    maxPages: z.number().int().min(1).max(1000).default(300),
    renderJs: z.enum(['auto', 'always', 'never']).default('auto').describe('`auto` renders a page in Browser Rendering only when its HTML has no readable text.'),
    schedule: z.enum(['off', 'daily', 'weekly', 'monthly']).default('weekly').describe('Re-crawl the selected pages on this schedule (from the Worker\'s cron).'),
  })
  .strict();
export type KnowledgeConfig = z.infer<typeof knowledgeConfigSchema>;

export const siteConfigSchema = z.object({
  origins: z.array(z.string().min(1).max(300)).min(1),
  connector: connectorConfigSchema,
  sinks: z.array(sinkConfigSchema).max(10).default([]),
  security: securitySchema.default({}),
  widget: widgetConfigSchema.default({}),
  knowledge: knowledgeConfigSchema.default({}),
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
/**
 * Which prompt version the stored connector options carry. Written by
 * `murmur deploy` and by the dashboard whenever either publishes a prompt,
 * so each can tell whether the other has moved on since it last looked.
 * The text itself stays in the connector's own option; history is in D1.
 */
export const promptMetaSchema = z
  .object({
    version: z.number().int().min(1),
    hash: z.string().min(1).max(64),
    at: z.number().int().nonnegative(),
    by: z.string().max(200).nullable().default(null),
    source: z.enum(['cli', 'dashboard', 'restore']),
  })
  .strict();
export type PromptMeta = z.infer<typeof promptMetaSchema>;

export const storedSiteConfigSchema = z
  .object({
    connector: connectorConfigSchema.optional(),
    sinks: z.array(sinkConfigSchema).max(10).optional(),
    security: securitySchema.optional(),
    widget: widgetConfigSchema.optional(),
    knowledge: knowledgeConfigSchema.optional(),
    prompt: promptMetaSchema.optional(),
    profile: z.record(z.string(), z.unknown()).optional().describe('The instructions form\'s choices (validated in `admin/profile.ts`); the prompt they made is in the connector options.'),
    /** Who last changed settings from the dashboard, so `murmur deploy` does not overwrite them unseen. */
    settings: z
      .object({ at: z.number().int().nonnegative(), by: z.string().max(200).nullable().default(null), hash: z.string().max(64) })
      .strict()
      .optional(),
  })
  .strict();
export type StoredSiteConfig = z.infer<typeof storedSiteConfigSchema>;

export const murmurConfigSchema = z.object({
  sites: z.record(z.string().min(1).max(64), siteConfigSchema),
});
export type MurmurConfig = z.infer<typeof murmurConfigSchema>;

/** The shape a user writes in `murmur.config.ts` — defaults not yet applied. */
export type MurmurConfigInput = z.input<typeof murmurConfigSchema>;
