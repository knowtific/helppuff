import { Hono } from 'hono';
import { z } from 'zod';
import { iconNames, type WidgetConfig } from '@murmur/protocol';
import type { KvStore } from '@murmur/connector-types';
import { storedSiteConfigSchema, type SiteConfig, type StoredSiteConfig } from '../config/schema.js';
import { resolveSite, siteConfigKey } from '../config/site.js';
import { MurmurError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import { assertSameOrigin, currentAdmin, jsonBody, siteParam } from './guard.js';

/**
 * The assistant's settings as one flat object — what the onboarding
 * screens confirm and the Settings page edits, and what `murmur config pull`
 * writes back into murmur.json. Each field lives in exactly one place in the
 * site config; `readSettings` and `applySettings` are the only mapping.
 *
 * Saved to KV (`config:<site>`), which is live within a minute and survives
 * redeploys only if the CLI has pulled it: `murmur deploy` refuses to
 * overwrite settings changed here since it last looked (`settings` meta).
 */

const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
/** A pre-chat form field: the built-in ones (name, email, phone, message) or any the owner adds. */
const leadFieldSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, 'lowercase letters, digits and _'),
    label: z.string().trim().min(1).max(160),
    type: z.enum(['text', 'email', 'tel', 'textarea', 'select']),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  })
  .strict();
export type LeadField = z.infer<typeof leadFieldSchema>;

const AUTOCOMPLETE: Record<string, string> = { name: 'name', email: 'email', phone: 'tel' };

/** The built-in fields, as an older dashboard named them: just `name`, `email`, `phone`, `message`. */
const LEGACY_FIELDS: Record<string, LeadField> = {
  name: { name: 'name', label: 'Name', type: 'text', required: true },
  email: { name: 'email', label: 'Email', type: 'email', required: true },
  phone: { name: 'phone', label: 'Phone (optional)', type: 'tel', required: false },
  message: { name: 'message', label: 'How can we help?', type: 'textarea', required: true },
};

/**
 * Settings as an older Worker returned them — lead fields as bare names, the
 * assistant with business / handoff / tools — in today's shape, so a CLI can
 * pull from a deployment it is about to upgrade.
 */
export function upgradeSettings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const s = { ...(raw as Record<string, unknown>) };
  const leads = s['leads'] as { enabled?: unknown; fields?: unknown[] } | undefined;
  if (leads && Array.isArray(leads.fields)) {
    s['leads'] = {
      ...leads,
      fields: leads.fields.flatMap((f) => (typeof f === 'string' ? (LEGACY_FIELDS[f] ? [LEGACY_FIELDS[f]] : []) : [f])),
    };
  }
  const assistant = s['assistant'] as Record<string, unknown> | null | undefined;
  if (assistant) s['assistant'] = { model: assistant['model'], locale: assistant['locale'] ?? null, timezone: assistant['timezone'] ?? null, rerank: assistant['rerank'] ?? true };
  return s;
}

export const settingsSchema = z
  .object({
    botName: z.string().trim().min(1).max(60),
    businessName: z.string().trim().min(1).max(60),
    welcomeMessage: z.string().trim().max(2000),
    starterQuestions: z.array(z.string().trim().min(1).max(80)).max(6),
    accent: hex,
    position: z.enum(['bottom-right', 'bottom-left']),
    launcherIcon: z.enum(iconNames),
    leads: z
      .object({
        enabled: z.boolean(),
        fields: z
          .array(leadFieldSchema)
          .min(1)
          .max(12)
          .refine((fields) => new Set(fields.map((f) => f.name)).size === fields.length, 'two fields have the same name'),
      })
      .strict(),
    /** Only for the `workers-ai` backend; null otherwise. Business details are the site facts (`/knowledge/facts`). */
    assistant: z
      .object({
        model: z.string().min(1).max(200),
        locale: z.string().max(35).nullable(),
        timezone: z.string().max(64).nullable(),
        /** Re-score the passages search found before answering (`retrieval.rerankerModel`; null turns it off). */
        rerank: z.boolean(),
      })
      .strict()
      .nullable(),
    crawl: z
      .object({
        schedule: z.enum(['off', 'daily', 'weekly', 'monthly']),
        include: z.array(z.string().min(1).max(200)).max(50),
        exclude: z.array(z.string().min(1).max(200)).max(50),
        renderJs: z.enum(['auto', 'always', 'never']),
      })
      .strict(),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;

/** A partial update: any top-level section may be left out; nested objects are merged one level deep. */
export const settingsPatchSchema = settingsSchema.partial().extend({
  leads: settingsSchema.shape.leads.partial().optional(),
  assistant: z
    .object({
      model: z.string().min(1).max(200).optional(),
      locale: z.string().max(35).nullable().optional(),
      timezone: z.string().max(64).nullable().optional(),
      rerank: z.boolean().optional(),
    })
    .strict()
    // Null (a backend other than workers-ai) changes nothing.
    .nullable()
    .optional(),
  crawl: settingsSchema.shape.crawl.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

type Opts = Record<string, unknown>;
const obj = (value: unknown): Opts => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Opts) : {});
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export function readSettings(site: SiteConfig): Settings {
  const w = site.widget;
  const questions = (w.home.shortcuts ?? []).filter((s) => s.action.kind === 'reply').map((s) => s.label);
  const fields: LeadField[] = w.leadForm.fields.map((f) => ({
    name: /^[a-z][a-z0-9_]{0,40}$/.test(f.name) ? f.name : f.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, 'f_').slice(0, 41),
    label: f.label,
    type: f.type,
    required: Boolean(f.required),
    ...(f.options ? { options: f.options } : {}),
  }));
  const o = obj(site.connector.options);
  return {
    botName: w.brand.agentName,
    businessName: w.brand.name,
    welcomeMessage: w.chat.initialMessages?.[0] ?? '',
    starterQuestions: questions,
    accent: /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(w.brand.accent) ? w.brand.accent : '#5B5BF7',
    position: w.launcher.position,
    launcherIcon: w.launcher.icon,
    leads: { enabled: w.leadForm.enabled, fields },
    assistant:
      site.connector.type === 'workers-ai'
        ? { model: str(o['model']) ?? '@cf/zai-org/glm-4.7-flash', locale: str(o['locale']), timezone: str(o['timezone']), rerank: obj(o['retrieval'])['rerankerModel'] !== null }
        : null,
    crawl: { schedule: site.knowledge.schedule, include: site.knowledge.include, exclude: site.knowledge.exclude, renderJs: site.knowledge.renderJs },
  };
}

/** Drop nulls and empty strings, so an unset field is absent rather than stored as "". */
const compact = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)));

/** The site config sections that carry these settings, rewritten. */
export function applySettings(site: SiteConfig, patch: SettingsPatch): Pick<SiteConfig, 'widget' | 'connector' | 'knowledge'> {
  const current = readSettings(site);
  const s: Settings = {
    ...current,
    ...patch,
    leads: { ...current.leads, ...patch.leads },
    assistant: current.assistant && { ...current.assistant, ...(patch.assistant ?? {}) },
    crawl: { ...current.crawl, ...patch.crawl },
  } as Settings;

  const widget: WidgetConfig = structuredClone(site.widget);
  widget.brand = { ...widget.brand, agentName: s.botName, name: s.businessName, accent: s.accent };
  widget.launcher = { ...widget.launcher, position: s.position, icon: s.launcherIcon };
  const others = (widget.home.shortcuts ?? []).filter((x) => x.action.kind !== 'reply');
  const starters = s.starterQuestions.map((q, i) => ({ id: `ask-${i + 1}`, label: q, icon: 'chat' as const, action: { id: `ask-${i + 1}`, kind: 'reply' as const, label: q, value: q } }));
  widget.home = { ...widget.home, shortcuts: [...starters, ...others].slice(0, 8) };
  widget.chat = { ...widget.chat, initialMessages: s.welcomeMessage ? [s.welcomeMessage] : [] };
  widget.leadForm = {
    ...widget.leadForm,
    enabled: s.leads.enabled,
    fields: s.leads.fields.map((f) => ({ ...f, ...(AUTOCOMPLETE[f.name] ? { autocomplete: AUTOCOMPLETE[f.name] } : {}) })),
  };

  let connector = site.connector;
  if (s.assistant && site.connector.type === 'workers-ai') {
    const { locale: _locale, timezone: _timezone, retrieval: _retrieval, ...rest } = obj(site.connector.options);
    // Off is an explicit null; on keeps a chosen reranker, or drops the key for the default.
    const { rerankerModel, ...retrieval } = obj(_retrieval);
    if (!s.assistant.rerank) retrieval['rerankerModel'] = null;
    else if (typeof rerankerModel === 'string') retrieval['rerankerModel'] = rerankerModel;
    connector = {
      type: 'workers-ai',
      options: {
        ...rest,
        model: s.assistant.model,
        ...compact({ locale: s.assistant.locale, timezone: s.assistant.timezone }),
        ...(Object.keys(retrieval).length ? { retrieval } : {}),
      },
    };
  }
  const knowledge = { ...site.knowledge, ...s.crawl };
  return { widget, connector, knowledge };
}

export async function settingsHash(settings: Settings): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(settings)));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export const settingsRoutes = new Hono<HonoEnv>();

settingsRoutes.get('/admin/api/settings', async (c) => {
  await currentAdmin(c);
  const ctx = c.get('mm');
  const siteId = siteParam(c, c.req.query('site'));
  const site = await resolveSite(ctx, siteId);
  const settings = readSettings(site);
  const stored = await readStored(ctx.env, siteId);
  return c.json({ site: siteId, connector: site.connector.type, settings, hash: await settingsHash(settings), meta: stored?.settings ?? null });
});

async function readStored(env: Record<string, unknown>, siteId: string): Promise<StoredSiteConfig | null> {
  const kv = env['MURMUR_KV'] as KvStore | undefined;
  const raw = await kv?.get(siteConfigKey(siteId));
  if (!raw) return null;
  try {
    const parsed = storedSiteConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

settingsRoutes.put('/admin/api/settings', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const ctx = c.get('mm');
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const parsed = settingsPatchSchema.safeParse(body['settings']);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new MurmurError('bad_request', { message: `Check ${issue?.path.join('.') || 'the settings'}: ${issue?.message ?? 'invalid'}.`, detail: 'settings_invalid' });
  }
  const kv = ctx.env['MURMUR_KV'] as KvStore | undefined;
  if (!kv) throw new MurmurError('internal', { message: 'This deployment has no KV namespace.', detail: 'admin_no_kv' });

  const site = await resolveSite(ctx, siteId);
  const next = applySettings(site, parsed.data);
  const settings = readSettings({ ...site, ...next });
  const hash = await settingsHash(settings);
  const stored = (await readStored(ctx.env, siteId)) ?? {};
  const record = storedSiteConfigSchema.parse({
    ...stored,
    widget: next.widget,
    connector: next.connector,
    knowledge: next.knowledge,
    settings: { at: ctx.platform.now(), by: admin.via === 'api-key' ? 'cli' : admin.email, hash },
  });
  await kv.put(siteConfigKey(siteId), JSON.stringify(record));
  return c.json({ site: siteId, settings, hash, meta: record.settings });
});
