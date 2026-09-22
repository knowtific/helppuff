import { z } from 'zod';
import { actionSchema } from './actions.js';
import { fieldSchema, linkItemSchema } from './messages.js';
import { httpUrl, safeUrl } from './url-schema.js';

/**
 * Every CSS custom property a site may override, without the `--mm-` prefix
 * (§9.3). An unknown key is ignored rather than written into the stylesheet.
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
const pathGlob = z.string().min(1).max(200);

export const iconNames = [
  'chat', 'phone', 'mail', 'calendar', 'quote', 'pin', 'clock', 'wrench', 'heart',
  'info', 'book', 'arrow-right', 'arrow-left', 'close', 'send', 'menu',
  'sound', 'sound-off', 'check', 'external',
] as const;
export type IconName = (typeof iconNames)[number];

export const shortcutSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  description: z.string().max(160).optional(),
  icon: z.enum(iconNames).optional(),
  action: actionSchema,
  paths: z.array(pathGlob).max(20).optional(),
});
export type Shortcut = z.infer<typeof shortcutSchema>;

export const flowStepSchema = z.object({
  field: z.string().min(1).max(64),
  ask: z.string().min(1).max(400),
  input: z.enum(['text', 'choice', 'phone', 'email']),
  choices: z.array(z.string().min(1).max(120)).max(12).optional(),
  required: z.boolean().optional(),
});
export type FlowStep = z.infer<typeof flowStepSchema>;

export const flowSchema = z.object({
  id: z.string().min(1).max(64),
  steps: z.array(flowStepSchema).min(1).max(10),
  submit: z.object({ as: z.literal('message'), template: z.string().min(1).max(1000) }),
});
export type Flow = z.infer<typeof flowSchema>;

export const brandSchema = z.object({
  name: z.string().min(1).max(60).default('Chat'),
  agentName: z.string().min(1).max(60).default('Assistant'),
  avatar: httpUrl.optional(),
  accent: hexColor.default('#5B5BF7'),
  theme: z.enum(['light', 'dark', 'auto']).default('auto'),
  tokens: themeTokensSchema.optional(),
});
export type Brand = z.infer<typeof brandSchema>;

export const launcherSchema = z.object({
  position: z.enum(['bottom-right', 'bottom-left']).default('bottom-right'),
  offset: z.object({ x: z.number().min(0).max(200), y: z.number().min(0).max(200) }).optional(),
  label: z.string().max(40).optional(),
  hideOnPaths: z.array(pathGlob).max(50).optional(),
});

export const homeSchema = z.object({
  title: z.string().max(120).default('Hi there'),
  subtitle: z.string().max(240).default('Ask anything, or pick a shortcut.'),
  shortcuts: z.array(shortcutSchema).max(8).optional(),
  links: z
    .object({ title: z.string().max(120), items: z.array(linkItemSchema).min(1).max(10) })
    .optional(),
});

/** Default lead form used when a site configures none, or configures a broken one (§8.3). */
export const DEFAULT_LEAD_FIELDS = [
  { name: 'name', label: 'Name', type: 'text', required: true, autocomplete: 'name' },
  { name: 'phone', label: 'Phone', type: 'tel', required: true, autocomplete: 'tel' },
] as const satisfies readonly z.infer<typeof fieldSchema>[];

export const leadFormSchema = z.object({
  enabled: z.boolean().default(true),
  title: z.string().max(120).optional(),
  fields: z.array(fieldSchema).min(1).max(12).catch([...DEFAULT_LEAD_FIELDS]).default([...DEFAULT_LEAD_FIELDS]),
  submitLabel: z.string().max(60).optional(),
  privacy: z.object({ text: z.string().min(1).max(300), url: safeUrl }).optional(),
  askFirstMessage: z.boolean().optional(),
});

export const chatSchema = z.object({
  placeholder: z.string().max(120).optional(),
  initialMessages: z.array(z.string().min(1).max(2000)).max(3).optional(),
  shortcuts: z.array(shortcutSchema).max(8).optional(),
  fallbackContact: z
    .object({
      phone: z.string().max(40).optional(),
      email: z.string().max(200).optional(),
    })
    .optional(),
});

export const teaserSchema = z.object({
  text: z.string().min(1).max(200),
  delayMs: z.number().int().min(2000).max(120000),
  paths: z.array(pathGlob).max(50).optional(),
  oncePerSession: z.boolean().default(true),
});

export const widgetConfigSchema = z.object({
  brand: brandSchema.default({}),
  launcher: launcherSchema.default({}),
  home: homeSchema.default({}),
  leadForm: leadFormSchema.default({}),
  chat: chatSchema.default({}),
  teaser: teaserSchema.optional(),
  flows: z.array(flowSchema).max(20).optional(),
  forms: z
    .record(
      z.string().min(1).max(64),
      z.object({
        title: z.string().max(120).optional(),
        fields: z.array(fieldSchema).min(1).max(12),
        submitLabel: z.string().max(60).optional(),
      }),
    )
    .optional(),
  sound: z.object({ enabled: z.boolean() }).optional(),
  captcha: z.object({ provider: z.literal('turnstile'), siteKey: z.string().min(1).max(200) }).optional(),
  poweredBy: z.boolean().default(true),
  /** UI string overrides (§8.7). Keys are validated by the widget, not here. */
  strings: z.record(z.string().min(1).max(64), z.string().max(300)).optional(),
});

export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

/** The `/config` response: the public config plus the capabilities of the site's connector. */
export const configResponseSchema = z.object({
  siteId: z.string().min(1).max(64),
  widget: widgetConfigSchema,
  capabilities: z.object({ poll: z.boolean(), end: z.boolean() }),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;
