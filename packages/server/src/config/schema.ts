import { z } from 'zod';
import { BOOKING_MODES, CALENDAR_SYNCS, FILE_CHAT_MODES, widgetConfigSchema } from '@helppuff/protocol';
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
  slotLookupsPerIpPerMinute: z.number().int().min(1).max(600).default(30).describe('Times one visitor (IP) may load free times in the booking calendar a minute.'),
  bookingsPerIpPerHour: z.number().int().min(1).max(100).default(5).describe('Appointments one visitor (IP) may book, move or cancel an hour, from the chat.'),
  uploadsPerIpPerHour: z.number().int().min(1).max(1000).default(20).describe('Photos and files one visitor (IP) may send an hour, when visitors can send files (`files.chat`).'),
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

/**
 * Files (photos, documents) on R2: visitors sending them in the chat, and
 * the team attaching them to jobs. Both off by default, turned on separately.
 * Needs the site's bucket, which `helppuff deploy` makes when R2 is on for
 * the Cloudflare account.
 */
export const DEFAULT_VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const filesConfigSchema = z
  .object({
    chat: z.enum(FILE_CHAT_MODES).default('off').describe('Visitors send photos and PDFs in the chat: `off`, `live` (only while a person has the chat) or `always` (to the assistant too).'),
    jobs: z.boolean().default(false).describe('The team attaches photos and files to jobs (installation photos, plans, quotes).'),
    maxChatMb: z.number().min(1).max(25).default(10).describe('The largest file a visitor may send, in MB. Photos are made smaller in the browser first, so most are well under 1 MB.'),
    maxJobMb: z.number().min(1).max(95).default(25).describe('The largest file the team may attach to a job, in MB.'),
    perConversation: z.number().int().min(1).max(100).default(10).describe('Files one conversation may send.'),
    keepChatDays: z.number().int().min(1).max(3650).default(90).describe('Days a file sent in the chat is kept, then deleted. Files on jobs are kept until they are removed.'),
    aiSeesPhotos: z.boolean().default(false).describe('The assistant learns what is in photos visitors send (`files.chat: always`): a vision model describes each one once. Costs more AI usage per photo.'),
    visionModel: z.string().min(1).max(200).default(DEFAULT_VISION_MODEL).describe('The Workers AI model that describes photos for the assistant (`aiSeesPhotos`). It must accept images.'),
  })
  .strict();
export type FilesConfig = z.infer<typeof filesConfigSchema>;

/** `HH:MM-HH:MM`, 24-hour, local to the bookings time zone. */
const hoursRange = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d$/, 'a range like 09:00-17:00')
  .refine((range) => range.slice(0, 5) < range.slice(6), 'the end comes after the start');
const dayHours = z.array(hoursRange).max(4);
export const DEFAULT_BOOKING_HOURS = { mon: ['09:00-17:00'], tue: ['09:00-17:00'], wed: ['09:00-17:00'], thu: ['09:00-17:00'], fri: ['09:00-17:00'], sat: [], sun: [] };

/**
 * Appointments (Settings → Bookings). How visitors book: nothing, a link to
 * another site, or a date picker in the chat that HelpPuff books (the
 * assistant never books: wiki AI-Booking-Tests). With the picker, which
 * calendar it syncs with, what is booked and when.
 */
export const bookingsConfigSchema = z
  .object({
    mode: z
      .enum(BOOKING_MODES)
      .optional()
      .describe('`none`, `link` (offer `link`: the booking happens on another site) or `picker` (a date picker in the chat; HelpPuff books and keeps the appointment). Left out, the website decides: a booking link found on it is offered, else nothing.'),
    link: z.string().url().max(2000).optional().describe('The booking page `link` offers (Calendly, Cal.com, your own). Left out: the one found on the website.'),
    label: z.string().trim().min(1).max(40).default('Book a time').describe('The button on the home screen and after an answer about booking.'),
    sync: z.enum(CALENDAR_SYNCS).default('none').describe('The calendar the picker syncs with: `none` (HelpPuff keeps the appointments, free time from `hours`), `calcom`, `calendly`, `google` or `outlook` (the last two through Composio). Keys live in Settings → Integrations (`helppuff integrations`).'),
    account: z.string().max(200).optional().describe('`google` / `outlook`: the Composio connected account to use. Left out: the site\'s only one.'),
    calendar: z.string().max(300).optional().describe('`google` / `outlook`: the calendar id. Left out: the primary calendar.'),
    createMeetingLink: z.boolean().default(true).describe('`google`: create a Google Meet link for new bookings when no location is set. Turn off for appointments without an online meeting. Cal.com uses its event type location instead.'),
    eventType: z.string().max(500).optional().describe('`calcom`: the event type id; `calendly`: the event type URI. Their slots, length and rules are used.'),
    title: z.string().trim().min(1).max(120).default('Appointment').describe('What is booked, as the visitor and the calendar see it.'),
    duration: z.number().int().min(5).max(480).default(30).describe('Minutes (`none`, `google`, `outlook`; the event type decides for Cal.com and Calendly).'),
    hours: z
      .object({ mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours, sun: dayHours })
      .strict()
      .default(DEFAULT_BOOKING_HOURS)
      .describe('When appointments can start and end, per weekday: up to four ranges like `09:00-12:00`. An empty list: closed that day.'),
    buffer: z.number().int().min(0).max(240).default(0).describe('Minutes kept free after each appointment.'),
    notice: z.number().int().min(0).max(43_200).default(120).describe('Minutes ahead the earliest time must be (120: nothing in the next two hours).'),
    daysAhead: z.number().int().min(1).max(365).default(30).describe('How many days ahead visitors can book.'),
    timezone: z.string().max(64).optional().describe('The business\'s time zone for `hours` (IANA, e.g. `Australia/Melbourne`). Left out: the assistant\'s, else UTC.'),
    phone: z.enum(['off', 'optional', 'required']).default('optional').describe('Ask for a phone number when booking.'),
    location: z.string().trim().max(300).optional().describe('Where it happens, or the meeting link, shown on the confirmation (`none`; the calendar sets its own).'),
    syncMinutes: z.number().int().min(5).max(1440).default(15).describe('How often the synced calendar is read for changes (the cron); also on opening the Calendar and after each change.'),
  })
  .strict();
export type BookingsConfig = z.infer<typeof bookingsConfigSchema>;

export const siteConfigSchema = z.object({
  origins: z.array(z.string().min(1).max(300)).min(1),
  connector: connectorConfigSchema,
  sinks: z.array(sinkConfigSchema).max(10).default([]),
  autoSummary: z.boolean().default(true).describe('Automatically summarise and label finished conversations. Off keeps transcripts, after-chat tools and webhooks running.'),
  security: securitySchema.default({}),
  widget: widgetConfigSchema.default({}),
  knowledge: knowledgeConfigSchema.default({}),
  assistant: assistantConfigSchema.default({}),
  live: liveConfigSchema.default({}),
  bookings: bookingsConfigSchema.default({}),
  files: filesConfigSchema.default({}),
  /** Runtime only: the booking link learned from the website (`bookings/found.ts`), while `bookings.mode` is unset. Never configured. */
  bookingFound: z.object({ url: z.string().url(), provider: z.string().nullable(), page: z.string().nullable(), at: z.number() }).optional(),
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
    autoSummary: z.boolean().optional(),
    security: securitySchema.optional(),
    widget: widgetConfigSchema.optional(),
    knowledge: knowledgeConfigSchema.optional(),
    assistant: assistantConfigSchema.optional(),
    live: liveConfigSchema.optional(),
    bookings: bookingsConfigSchema.optional(),
    files: filesConfigSchema.optional(),
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
