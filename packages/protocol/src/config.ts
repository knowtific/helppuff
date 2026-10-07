import { z } from 'zod';
import { actionSchema } from './actions.js';
import { capabilitiesSchema } from './api.js';
import { fieldSchema, linkItemSchema } from './messages.js';
import { httpUrl, safeUrl } from './url-schema.js';

/**
 * Every CSS custom property a site may override, without the `--hp-` prefix.
 * An unknown key is ignored rather than written into the stylesheet.
 */
export const THEME_TOKENS = [
  'accent', 'accent-fg', 'accent-soft',
  'bg', 'surface', 'surface-2', 'border',
  'text', 'text-2', 'text-3', 'danger',
  'font', 'text-xs', 'text-sm', 'text-md', 'text-lg', 'text-xl',
  'leading', 'tracking-tight',
  'radius-sm', 'radius-md', 'radius-lg', 'radius-panel',
  'shadow-panel', 'shadow-orb',
  'ease-out', 'ease-spring', 'dur-fast', 'dur', 'dur-slow',
  'panel-w', 'panel-h', 'z',
] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];

/**
 * Token values land in a stylesheet, so they may not close a declaration or
 * pull in a remote resource.
 */
export const themeTokenValueSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !/[;{}<>]|url\s*\(|expression\s*\(|@import/i.test(v), {
    message: 'token value contains characters that are not allowed in a declaration',
  });

export const themeTokensSchema = z.record(z.enum(THEME_TOKENS), themeTokenValueSchema);
export type ThemeTokens = z.infer<typeof themeTokensSchema>;

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);

/** A glob pattern matched against `location.pathname`. */
const pathGlob = z.string().min(1).max(200).describe('A path pattern, e.g. `/services/*` or `/blog/**`.');

export const iconNames = [
  'chat', 'phone', 'mail', 'calendar', 'quote', 'pin', 'clock', 'wrench', 'heart',
  'info', 'book', 'arrow-right', 'arrow-left', 'close', 'send', 'menu',
  'sound', 'sound-off', 'check', 'external',
] as const;
export type IconName = (typeof iconNames)[number];

/**
 * Any built-in icon may sit on the launcher. The list was briefly trimmed to
 * save bytes in the loader, which excluded `wrench`, `pin` and `clock` —
 * obvious choices for a trade business — for about 330 bytes gzipped. That
 * was the wrong trade: the whole set costs a few milliseconds on a slow
 * connection, on a script that is already off the critical path.
 */
export type LauncherIconName = IconName;

export const shortcutSchema = z.object({
  id: z.string().min(1).max(64).describe('Unique among the shortcuts.'),
  label: z.string().min(1).max(80).describe('What the shortcut says.'),
  description: z.string().max(160).optional().describe('A line under the label.'),
  icon: z.enum(iconNames).optional().describe('A built-in icon.'),
  action: actionSchema,
  paths: z.array(pathGlob).max(20).optional().describe('Show it only on these pages.'),
});
export type Shortcut = z.infer<typeof shortcutSchema>;

export const flowStepSchema = z.object({
  field: z.string().min(1).max(64).describe('The name the answer is kept under, for the template.'),
  ask: z.string().min(1).max(400).describe('The question, shown as the assistant\'s message.'),
  input: z.enum(['text', 'choice', 'phone', 'email']).describe('How the visitor answers.'),
  choices: z.array(z.string().min(1).max(120)).max(12).optional().describe('The buttons of a `choice` step.'),
  required: z.boolean().optional().describe('The step cannot be skipped.'),
});
export type FlowStep = z.infer<typeof flowStepSchema>;

export const flowSchema = z.object({
  id: z.string().min(1).max(64).describe('What a `flow` action or shortcut starts it by.'),
  steps: z.array(flowStepSchema).min(1).max(10).describe('Questions asked one at a time, in the widget, before anything is sent.'),
  submit: z
    .object({
      as: z.literal('message').describe('Sent as one visitor message.'),
      template: z.string().min(1).max(1000).describe('The message, with `{{field}}` for each answer, e.g. "Quote for {{service}} in {{suburb}}".'),
    })
    .describe('What happens with the answers.'),
});
export type Flow = z.infer<typeof flowSchema>;

export const brandSchema = z.object({
  name: z.string().min(1).max(60).default('Chat').describe('The business name in the widget.'),
  agentName: z.string().min(1).max(60).default('Assistant').describe('The assistant\'s name, in its header and messages.'),
  avatar: httpUrl.optional().describe('The assistant\'s picture: a square image URL.'),
  accent: hexColor.default('#5B5BF7').describe('The main colour (hex). Text on it is made readable automatically.'),
  theme: z.enum(['light', 'dark', 'auto']).default('auto').describe('`auto` follows the visitor\'s system setting.'),
  tokens: themeTokensSchema.optional().describe('Fine-grained styling: CSS custom properties without the `--hp-` prefix, e.g. `{ "radius-panel": "12px", "font": "Inter, sans-serif" }`.'),
});
export type Brand = z.infer<typeof brandSchema>;

export const launcherSchema = z.object({
  position: z.enum(['bottom-right', 'bottom-left']).default('bottom-right').describe('Which corner the button sits in.'),
  offset: z
    .object({ x: z.number().min(0).max(200).describe('Pixels from the side.'), y: z.number().min(0).max(200).describe('Pixels from the bottom.') })
    .optional()
    .describe('Move the button away from the corner, e.g. above a cookie banner.'),
  label: z.string().max(40).optional().describe('Text beside the orb, or inside it when `shape` is `pill`. For example "Chat with us".'),
  icon: z.enum(iconNames).default('chat').describe('Which of the built-in icons the launcher shows.'),
  shape: z.enum(['orb', 'pill']).default('orb').describe('`orb` is the signature circle. `pill` widens it to sit the label inside the button, which reads as a clearer invitation on a busy page.'),
  hideOnPaths: z.array(pathGlob).max(50).optional().describe('Pages where the widget does not appear, e.g. `/checkout/**`.'),
});

export const homeSchema = z.object({
  title: z.string().max(120).default('Hi there').describe('The heading of the first screen.'),
  subtitle: z.string().max(240).default('Ask anything, or pick a shortcut.').describe('The line under it.'),
  shortcuts: z.array(shortcutSchema).max(8).optional().describe('Buttons on the first screen: suggested questions, a call button, a form…'),
  links: z
    .object({ title: z.string().max(120).describe('The list\'s heading.'), items: z.array(linkItemSchema).min(1).max(10).describe('The links.') })
    .optional()
    .describe('A list of useful pages on the first screen.'),
});

/** Default lead form used when a site configures none, or configures a broken one. */
export const DEFAULT_LEAD_FIELDS = [
  { name: 'name', label: 'Name', type: 'text', required: true, autocomplete: 'name' },
  { name: 'phone', label: 'Phone', type: 'tel', required: true, autocomplete: 'tel' },
] as const satisfies readonly z.infer<typeof fieldSchema>[];

export const leadFormSchema = z.object({
  enabled: z.boolean().default(true).describe('Ask for details before the chat starts.'),
  title: z.string().max(120).optional().describe('The form\'s heading.'),
  fields: z
    .array(fieldSchema)
    .min(1)
    .max(12)
    .catch([...DEFAULT_LEAD_FIELDS])
    .default([...DEFAULT_LEAD_FIELDS])
    .describe('The questions, in order. Add your own; each answer is kept on the lead and shown to the assistant.'),
  submitLabel: z.string().max(60).optional().describe('The button\'s text.'),
  privacy: z
    .object({ text: z.string().min(1).max(300).describe('The notice, e.g. "We only use this to reply to you."'), url: safeUrl.describe('Your privacy policy.') })
    .optional()
    .describe('A privacy note under the form.'),
  askFirstMessage: z.boolean().optional().describe('Add a box for the visitor\'s first message to the form. A field named `message` does the same and can be labelled.'),
});

export const chatSchema = z.object({
  placeholder: z.string().max(120).optional().describe('Hint text in the message box.'),
  initialMessages: z.array(z.string().min(1).max(2000)).max(3).optional().describe('The assistant\'s greeting, before the visitor writes.'),
  shortcuts: z.array(shortcutSchema).max(8).optional().describe('Buttons above the message box during the chat.'),
  fallbackContact: z
    .object({
      phone: z.string().max(40).optional().describe('Shown when the assistant cannot answer.'),
      email: z.string().max(200).optional().describe('Shown when the assistant cannot answer.'),
    })
    .optional()
    .describe('How to reach a person when the assistant is unavailable (an outage, or the daily budget is spent).'),
});

/** How long to wait before the teaser appears, when no trigger is configured. */
export const DEFAULT_TEASER_DELAY_MS = 8000;

export const teaserSchema = z
  .object({
    text: z.string().min(1).max(200).describe('The message, e.g. "Need a quote? Ask me."'),
    delayMs: z.number().int().min(2000).max(120000).optional().describe('Time on the page. Omit to rely on `afterScroll` alone.'),
    afterScroll: z.number().int().min(1).max(100).optional().describe('Percentage of the page scrolled, 1–100. Whichever trigger fires first shows the teaser; a visitor who reads rather than waits still sees it.'),
    paths: z.array(pathGlob).max(50).optional().describe('Show it only on these pages.'),
    oncePerSession: z.boolean().default(true).describe('Show it once per visit, not on every page.'),
  })
  // A teaser with no trigger at all would never appear, which is never what
  // was meant — fall back to the default delay.
  .transform((teaser) =>
    teaser.delayMs === undefined && teaser.afterScroll === undefined
      ? { ...teaser, delayMs: DEFAULT_TEASER_DELAY_MS }
      : teaser,
  );

/**
 * The footer credit. `true` shows the HelpPuff credit, `false` hides it, and an
 * object whitelabels it: `text` replaces the wording and `url`, when given,
 * is where it links. Without a `url` the credit is plain text.
 */
export const poweredBySchema = z.union([
  z.boolean(),
  z.object({ text: z.string().min(1).max(60).describe('Your own credit text.'), url: safeUrl.optional().describe('Where it links. Without one it is plain text.') }),
]);
export type PoweredBy = z.infer<typeof poweredBySchema>;

export const widgetConfigSchema = z.object({
  brand: brandSchema.default({}).describe('Names, colour and theme.'),
  launcher: launcherSchema.default({}).describe('The button that opens the chat.'),
  home: homeSchema.default({}).describe('The first screen visitors see.'),
  leadForm: leadFormSchema.default({}).describe('The short form before the chat.'),
  chat: chatSchema.default({}).describe('The conversation screen.'),
  teaser: teaserSchema.optional().describe('A message that pops up beside the button to invite a chat.'),
  flows: z.array(flowSchema).max(20).optional().describe('Guided questions asked in the widget (no AI), sent as one message at the end.'),
  forms: z
    .record(
      z.string().min(1).max(64),
      z.object({
        title: z.string().max(120).optional().describe('The form\'s heading.'),
        fields: z.array(fieldSchema).min(1).max(12).describe('The questions.'),
        submitLabel: z.string().max(60).optional().describe('The button\'s text.'),
      }),
    )
    .optional()
    .describe('Inline forms by id, opened by a `form` action or shortcut. Submitting one sends its answers to the assistant.'),
  sound: z.object({ enabled: z.boolean().describe('Play it.') }).optional().describe('A soft sound when a reply arrives.'),
  captcha: z
    .object({ provider: z.literal('turnstile').describe('Cloudflare Turnstile.'), siteKey: z.string().min(1).max(200).describe('The Turnstile site key.') })
    .optional()
    .describe('Set by `security.captcha`; you do not need to set it here.'),
  poweredBy: poweredBySchema.default(true).describe('The footer credit: `true`, `false`, or `{ text, url }` for your own.'),
  strings: z.record(z.string().min(1).max(64), z.string().max(300)).optional().describe('UI string overrides. Keys are validated by the widget, not here.'),
});

export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

/** The `/config` response: the public config plus the capabilities of the site's connector. */
export const configResponseSchema = z.object({
  siteId: z.string().min(1).max(64),
  widget: widgetConfigSchema,
  capabilities: capabilitiesSchema,
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;
