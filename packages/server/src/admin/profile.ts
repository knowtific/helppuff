import { Hono } from 'hono';
import { z } from 'zod';
import type { KvStore } from '@murmur/connector-types';
import { storedSiteConfigSchema } from '../config/schema.js';
import { resolveSite, siteConfigKey } from '../config/site.js';
import { MurmurError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import { assertSameOrigin, currentAdmin, db, jsonBody, siteParam } from './guard.js';
import { promptHash, publishPrompt, readPromptState, type PromptCtx } from './prompts.js';

/**
 * The assistant's instructions as a few plain choices, instead of a prompt to
 * write: what it is for, how it sounds, how long it talks, what it must know
 * and must never say. Saving publishes the prompt they make as a new prompt
 * version (history, restore and `murmur prompt pull` all keep working); the
 * choices are kept beside it in KV so the form opens where it was left.
 *
 * Editing the full prompt by hand is still possible (Settings › Advanced);
 * the form then says the prompt has been customised.
 */

export const profileSchema = z
  .object({
    goal: z.enum(['callbacks', 'answers', 'bookings']).default('callbacks'),
    tone: z.enum(['friendly', 'professional', 'casual']).default('friendly'),
    length: z.enum(['short', 'detailed']).default('short'),
    mustKnow: z.string().max(2000).default(''),
    neverSay: z.string().max(2000).default(''),
    bookingUrl: z.string().url().max(2000).optional(),
  })
  .strict();
export type Profile = z.infer<typeof profileSchema>;
export const DEFAULT_PROFILE: Profile = profileSchema.parse({});

const GOAL: Record<Profile['goal'], (p: Profile) => string> = {
  callbacks: () =>
    'Your main job: help visitors with their questions and, when they are ready to go ahead or you cannot help, arrange a callback from the team. Offer it once, naturally, after you have been useful.',
  answers: () => 'Your main job: answer questions about the business clearly and accurately, so visitors find what they need without digging.',
  bookings: (p) =>
    `Your main job: help visitors book. Once you understand what they need, point them to booking${p.bookingUrl ? ` at ${p.bookingUrl}` : ''}, or arrange a callback if they prefer.`,
};
const TONE: Record<Profile['tone'], string> = {
  friendly: 'Be warm and friendly, like a helpful member of the team.',
  professional: 'Be professional, clear and courteous.',
  casual: 'Keep it relaxed and conversational.',
};
const LENGTH: Record<Profile['length'], string> = {
  short: 'Keep answers short: two or three sentences, or a short list.',
  detailed: 'Give complete answers; use short lists for steps or options.',
};

/** The prompt a profile makes. Deterministic, so "was it edited by hand?" is a hash comparison. */
export function buildPrompt(profile: Profile, site: { businessName: string; website?: string | null }): string {
  const lines = [
    `You are the website assistant for ${site.businessName}${site.website ? ` (${site.website})` : ''}.`,
    '',
    GOAL[profile.goal](profile),
    '',
    `${TONE[profile.tone]} ${LENGTH[profile.length]}`,
    `Speak as part of the ${site.businessName} team: "we" and "our".`,
    'Use plain Markdown only: paragraphs, **bold**, lists and links.',
  ];
  if (profile.mustKnow.trim()) lines.push('', 'Always keep in mind:', profile.mustKnow.trim());
  if (profile.neverSay.trim()) lines.push('', 'Never:', profile.neverSay.trim());
  lines.push('', 'The visitor is on {{context.pageUrl}}.');
  return lines.join('\n');
}

export const profileRoutes = new Hono<HonoEnv>();

function promptCtx(env: Record<string, unknown>, config: PromptCtx['config'], now: () => number): PromptCtx {
  const kv = env['MURMUR_KV'] as KvStore | undefined;
  if (!kv) throw new MurmurError('internal', { message: 'This deployment has no KV namespace.', detail: 'admin_no_kv' });
  return { config, kv, now };
}

profileRoutes.get('/admin/api/profile', async (c) => {
  await currentAdmin(c);
  const ctx = c.get('mm');
  const siteId = siteParam(c, c.req.query('site'));
  const site = await resolveSite(ctx, siteId);
  const pctx = promptCtx(ctx.env, ctx.config, () => ctx.platform.now());
  const state = await readPromptState(pctx, db(c), siteId);
  const profile = profileSchema.parse(state.stored?.profile ?? {});
  const generated = buildPrompt(profile, { businessName: site.widget.brand.name, website: site.knowledge.website ?? null });
  return c.json({
    site: siteId,
    profile,
    editable: state.editable,
    // Set up by hand (or from the CLI's prompt.md) rather than from these choices.
    custom: Boolean(state.text) && (await promptHash(generated)) !== state.hash,
    version: state.version,
  });
});

profileRoutes.put('/admin/api/profile', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const ctx = c.get('mm');
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const parsed = profileSchema.safeParse(body['profile'] ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new MurmurError('bad_request', { message: `Check ${issue?.path.join('.') || 'the instructions'}: ${issue?.message ?? 'invalid'}.`, detail: 'profile_invalid' });
  }
  const site = await resolveSite(ctx, siteId);
  const pctx = promptCtx(ctx.env, ctx.config, () => ctx.platform.now());
  const d = db(c);
  const state = await readPromptState(pctx, d, siteId);
  const text = buildPrompt(parsed.data, { businessName: site.widget.brand.name, website: site.knowledge.website ?? null });
  const result = await publishPrompt(pctx, d, siteId, {
    text,
    baseVersion: state.version,
    note: 'From the instructions form',
    source: 'dashboard',
    by: admin.via === 'api-key' ? 'cli' : admin.email,
  });
  if (result.status === 'conflict') {
    throw new MurmurError('bad_request', { message: 'The instructions changed while you were editing. Reload and try again.', detail: 'profile_conflict' });
  }
  // Keep the choices beside the prompt they made.
  const raw = await pctx.kv.get(siteConfigKey(siteId));
  const stored = storedSiteConfigSchema.parse({ ...(raw ? (JSON.parse(raw) as object) : {}), profile: parsed.data });
  await pctx.kv.put(siteConfigKey(siteId), JSON.stringify(stored));
  return c.json({ profile: parsed.data, version: result.version, status: result.status });
});
