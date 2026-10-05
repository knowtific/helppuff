import { z } from 'zod';
import type { VisitorContext } from '@murmur/protocol';
import { renderTemplate } from './helpers.js';
import type { ConnectorContext } from './index.js';

/**
 * Where a system prompt comes from.
 *
 * Murmur carries transport and UI. A prompt is *content* — it changes on a
 * different clock from the code, it differs per site, and in a hosted
 * service it belongs to the customer rather than to this repository. So it
 * is never hard-coded: a connector asks for a `PromptSource` and this
 * resolves it.
 *
 * In order of preference:
 *
 *  1. **Provider-side, referenced by id.** Retell's `agent_id` and OpenAI's
 *     `prompt: { id, version }` keep the prompt in their dashboard, with
 *     their own versioning and no deploy of this project to change a word.
 *     Prefer this wherever the provider offers it.
 *  2. **`{ kv }` — a runtime source.** For providers with no stored prompts
 *     (Gemini). Edited live, keyed per site, no redeploy.
 *  3. **`{ url }` — fetched and cached.** When the prompt already lives in a
 *     CMS the customer edits.
 *  4. **`{ env }` — a Worker secret.** Keeps the text out of the repository
 *     while staying deploy-time.
 *  5. **An inline string.** Simplest, and right for a self-hoster with one
 *     site; every edit is a redeploy.
 */
export const promptSourceSchema = z.union([
  z.string().max(16_000),
  z.object({ env: z.string().min(1).max(128) }).strict(),
  z.object({ kv: z.string().min(1).max(256) }).strict(),
  z
    .object({
      url: z.string().url(),
      /** Cached in KV for this long, so every message is not a fetch. */
      ttlSeconds: z.number().int().min(30).max(86_400).default(300),
    })
    .strict(),
]);

export type PromptSource = z.infer<typeof promptSourceSchema>;

/** Everything a prompt template may interpolate. */
export type PromptScope = {
  lead?: Record<string, string> | undefined;
  context?: VisitorContext | undefined;
  site?: { id: string } | undefined;
};

const CACHE_PREFIX = 'prompt:cache:';

/**
 * Resolve a source to text, then interpolate `{{lead.name}}`,
 * `{{context.pageUrl}}`, `{{site.id}}` and friends.
 *
 * A source that cannot be read yields an empty prompt rather than an error:
 * an assistant with no system prompt still answers, where a failed request
 * answers nothing. The miss is logged so it is visible to the operator.
 */
export async function resolvePrompt(
  ctx: Pick<ConnectorContext<unknown>, 'kv' | 'env' | 'fetch' | 'log'> & Partial<Pick<ConnectorContext<unknown>, 'waitUntil'>>,
  source: PromptSource | undefined,
  scope: PromptScope,
): Promise<string | undefined> {
  if (source === undefined) return undefined;

  const template = await readSource(ctx, source);
  if (template === null) return undefined;

  const rendered = renderTemplate(template, scope as Record<string, unknown>).trim();
  return rendered || undefined;
}

async function readSource(
  ctx: Pick<ConnectorContext<unknown>, 'kv' | 'env' | 'fetch' | 'log'> & Partial<Pick<ConnectorContext<unknown>, 'waitUntil'>>,
  source: PromptSource,
): Promise<string | null> {
  if (typeof source === 'string') return source;

  if ('env' in source) {
    const value = ctx.env[source.env];
    if (typeof value === 'string' && value) return value;
    ctx.log('prompt.env_missing', { name: source.env });
    return null;
  }

  if ('kv' in source) {
    const value = await ctx.kv.get(source.kv);
    if (value) return value;
    ctx.log('prompt.kv_missing', { key: source.kv });
    return null;
  }

  return fetchPrompt(ctx, source.url, source.ttlSeconds);
}

/**
 * Fetch and cache. A stale cached copy is better than no prompt at all, so
 * the cache is written before the TTL is honoured and only refreshed on a
 * miss — a CMS being briefly down must not change how the assistant behaves.
 */
async function fetchPrompt(
  ctx: Pick<ConnectorContext<unknown>, 'kv' | 'fetch' | 'log'> & Partial<Pick<ConnectorContext<unknown>, 'waitUntil'>>,
  url: string,
  ttlSeconds: number,
): Promise<string | null> {
  const key = `${CACHE_PREFIX}${url}`;
  const cached = await ctx.kv.get(key);
  if (cached !== null) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await ctx.fetch(url, { signal: controller.signal });
    if (!response.ok) {
      ctx.log('prompt.fetch_status', { status: response.status });
      return null;
    }
    const text = (await response.text()).slice(0, 16_000);
    // Cached after the response when the platform allows it: the reply needs only the text.
    const cache = ctx.kv.put(key, text, { expirationTtl: ttlSeconds });
    if (ctx.waitUntil) ctx.waitUntil(cache.catch(() => {}));
    else await cache;
    return text;
  } catch {
    ctx.log('prompt.fetch_failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The variables a prompt or a provider-side template can reference. Kept
 * uniform across connectors so a prompt written for one reads the same on
 * another — Retell's dynamic variables, OpenAI's prompt variables and a
 * Gemini system instruction all draw on this.
 */
export function promptVariables(scope: PromptScope): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(scope.lead ?? {})) {
    if (typeof value === 'string' && value) out[`lead_${key}`] = value.slice(0, 500);
  }

  const context = scope.context;
  if (context) {
    if (context.pageUrl) out['page_url'] = context.pageUrl.slice(0, 500);
    if (context.pageTitle) out['page_title'] = context.pageTitle.slice(0, 300);
    if (context.referrer) out['referrer'] = context.referrer.slice(0, 500);
    if (context.locale) out['locale'] = context.locale;
    if (context.timezone) out['timezone'] = context.timezone;
    for (const [key, value] of Object.entries(context.utm ?? {})) {
      if (value) out[`utm_${key}`] = value.slice(0, 200);
    }
  }

  if (scope.site) out['site_id'] = scope.site.id;
  return out;
}
