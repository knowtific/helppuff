import { z } from 'zod';
import { widgetConfigSchema } from '@helppuff/protocol';
import { isIpOrRange } from '../core/ip.js';

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

/**
 * Every abuse bound the Worker enforces. Defaults are deliberately
 * conservative — a site that sets nothing is still bounded. Per-visitor
 * limits are keyed by a salted hash of the IP and scoped by site; the
 * per-site ones bound cost. `wiki/Security.md` lists them all.
 */
export const limitsSchema = z.object({
  messagesPerIpPerMinute: z.number().int().min(1).max(600).default(10).describe('Messages one visitor (IP) may send a minute.'),
  messagesPerIpPerDay: z.number().int().min(1).max(100_000).default(100).describe('Messages one visitor (IP) may send a day (UTC), so one visitor cannot use up the daily cap.'),
  sessionsPerIpPerHour: z.number().int().min(1).max(1000).default(5).describe('New chats one visitor (IP) may start an hour.'),
  sessionsPerIpPerDay: z.number().int().min(1).max(10_000).default(20).describe('New chats one visitor (IP) may start a day (UTC).'),
  messagesPerSession: z.number().int().min(1).max(1000).default(60).describe('Messages in one chat before the visitor must start another.'),
  messagesPerSitePerDay: z.number().int().min(1).max(1_000_000).default(500).describe('The cost backstop. Always set this.'),
  maxMessageLength: z.number().int().min(1).max(4000).default(1000).describe('The longest message a visitor may send, in characters.'),
  maxLeadFieldLength: z.number().int().min(20).max(2000).default(200).describe('The longest answer to one form field, in characters (a message box gets `maxLeadMessageLength`).'),
  maxLeadMessageLength: z.number().int().min(20).max(4000).default(2000).describe('The longest answer to a message box in a form, in characters.'),
  feedbackPerIpPerMinute: z.number().int().min(1).max(600).default(30).describe('Thumbs up or down one visitor (IP) may give a minute.'),
  pollsPerIpPerMinute: z.number().int().min(1).max(600).default(120).describe('Checks for new messages one visitor (IP) may make a minute (backends that reply later, like Retell).'),
  endsPerIpPerMinute: z.number().int().min(1).max(600).default(10).describe('Chats one visitor (IP) may close a minute.'),
  retellLookupsPerMinute: z.number().int().min(1).max(6000).default(120).describe('Knowledge-base lookups a Retell agent may make a minute, for the whole site.'),
  apiRequestsPerKeyPerMinute: z.number().int().min(1).max(6000).default(120).describe('Requests a new API key may make a minute (each key can have its own). Chat requests also count against the daily cap.'),
  apiKeysPerSite: z.number().int().min(1).max(500).default(50).describe('Active API keys a site may have.'),
  handoversPerIpPerDay: z.number().int().min(1).max(1000).default(3).describe('Times one visitor (IP) may ask for a person a day (live chat).'),
  waitingPerSite: z.number().int().min(1).max(1000).default(20).describe('Live chats that may wait for a person at once; past it, visitors get the callback form.'),
  liveSocketsPerIp: z.number().int().min(1).max(100).default(3).describe('Live chat connections one visitor (IP) may hold open at once.'),
});
export type Limits = z.infer<typeof limitsSchema>;

/** Dashboard sign-in: the bounds on guessing a password, and Turnstile on the form. */
export const signInSchema = z.object({
  attemptsPerIp: z.number().int().min(1).max(1000).default(10).describe('Sign-in attempts (and one-time link checks) one IP may make per window.'),
  attemptsPerAccount: z.number().int().min(1).max(1000).default(5).describe('Failed sign-ins one email may have per window, from anywhere. Counts failures only.'),
  windowMinutes: z.number().int().min(1).max(1440).default(15).describe('The window both sign-in limits count over, in minutes.'),
  captcha: z.boolean().default(true).describe('Ask for Turnstile on the sign-in form when `security.captcha` is set. Add the dashboard\'s hostname to the Turnstile widget.'),
});
export type SignInLimits = z.infer<typeof signInSchema>;

const ipListSchema = z
  .array(z.string().trim().min(1).max(64).refine(isIpOrRange, { message: 'an IP address or CIDR range, like 203.0.113.7 or 2001:db8::/32' }))
  .max(500);

export const captchaSchema = z.object({
  provider: z.literal('turnstile').describe('Cloudflare Turnstile.'),
  siteKey: z.string().min(1).max(200).describe('The Turnstile site key (public).'),
  secret: secretRefSchema.describe('The Turnstile secret key, by environment variable name.'),
});

export const securitySchema = z.object({
  captcha: captchaSchema.optional().describe('Check new chats (and dashboard sign-ins) with Cloudflare Turnstile (invisible for most visitors). Strongly recommended: without it, a script can start chats.'),
  limits: limitsSchema.default({}).describe('Per-visitor and per-site limits. The daily cap is the cost backstop.'),
  signIn: signInSchema.default({}).describe('Dashboard sign-in limits.'),
  allowIps: ipListSchema.default([]).describe('IP addresses or CIDR ranges exempt from the per-visitor limits (your office, a monitor). The per-chat and daily caps still apply.'),
  blockIps: ipListSchema.default([]).describe('IP addresses or CIDR ranges refused by the chat. The dashboard is not affected.'),
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

/**
 * How the assistant behaves: settings, not prompt text. HelpPuff writes them
 * into the instructions it adds around the owner's prompt (`core/guidance.ts`),
 * so the prompt the owner edits never has to repeat them, or fight them.
 */
export const assistantConfigSchema = z
  .object({
    goal: z.enum(['callbacks', 'answers', 'bookings']).default('callbacks').describe('What the assistant is for: `callbacks` (help, then get the team in touch), `answers`, or `bookings` (help, then send them to `bookingUrl`: a booking, sign-up or quote page).'),
    tone: z.enum(['friendly', 'professional', 'casual']).default('friendly').describe('How it sounds.'),
    length: z.enum(['short', 'detailed']).default('short').describe('`short`: a few sentences; `detailed`: complete answers with short lists.'),
    prices: z
      .enum(['share', 'quote'])
      .default('share')
      .describe('`share`: give prices exactly as the site and documents state them; `quote`: never give a price or estimate, offer a quote from the team instead.'),
    bookingUrl: z.string().url().max(2000).optional().describe('The page the `bookings` goal sends visitors to: booking, sign-up or a quote form.'),
  })
  .strict();
export type AssistantConfig = z.infer<typeof assistantConfigSchema>;

/**
 * Live chat: a visitor is handed from the assistant to a person on the team,
 * who answers from the dashboard or Telegram. Off by default; when off,
 * nothing changes and the widget loads no live-chat code.
 */
export const liveConfigSchema = z
  .object({
    enabled: z.boolean().default(false).describe('Let visitors talk to a person on the team. When nobody is available they get the callback form instead.'),
    waitSeconds: z.number().int().min(15).max(3600).default(120).describe('How long a visitor waits for someone to take the chat before they are offered the callback form (they can keep waiting).'),
    closeAfterMinutes: z.number().int().min(5).max(1440).default(60).describe('A conversation with no message for this long is closed. A visitor who writes again is answered by the assistant.'),
    showAgentName: z.boolean().default(true).describe('Show visitors the first name of the person answering ("Sam joined"); off: "Someone from the team".'),
    aiWhileWaiting: z.boolean().default(false).describe('Let the assistant keep answering until someone takes the chat.'),
  })
  .strict();
export type LiveConfig = z.infer<typeof liveConfigSchema>;

export const siteConfigSchema = z.object({
  origins: z.array(z.string().min(1).max(300)).min(1),
  connector: connectorConfigSchema,
  sinks: z.array(sinkConfigSchema).max(10).default([]),
  security: securitySchema.default({}),
  widget: widgetConfigSchema.default({}),
  knowledge: knowledgeConfigSchema.default({}),
  assistant: assistantConfigSchema.default({}),
  live: liveConfigSchema.default({}),
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
 * `helppuff deploy` and by the dashboard whenever either publishes a prompt,
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
    assistant: assistantConfigSchema.optional(),
    live: liveConfigSchema.optional(),
    prompt: promptMetaSchema.optional(),
    /** Retired: the instructions form's choices, from when it wrote them into the prompt. Read as `assistant` when that is missing. */
    profile: z.record(z.string(), z.unknown()).optional(),
    /** Who last changed settings from the dashboard, so `helppuff deploy` does not overwrite them unseen. */
    settings: z
      .object({ at: z.number().int().nonnegative(), by: z.string().max(200).nullable().default(null), hash: z.string().max(64) })
      .strict()
      .optional(),
  })
  .strict();
export type StoredSiteConfig = z.infer<typeof storedSiteConfigSchema>;

export const helppuffConfigSchema = z.object({
  sites: z.record(z.string().min(1).max(64), siteConfigSchema),
});
export type HelpPuffConfig = z.infer<typeof helppuffConfigSchema>;

/** The shape a user writes in `helppuff.config.ts` — defaults not yet applied. */
export type HelpPuffConfigInput = z.input<typeof helppuffConfigSchema>;
