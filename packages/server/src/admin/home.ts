import { Hono } from 'hono';
import type { KvStore } from '@helppuff/connector-types';
import { resolveSite } from '../config/site.js';
import type { SiteConfig } from '../config/schema.js';
import type { HonoEnv, RequestCtx } from '../core/request.js';
import { dbFrom } from '../db/d1.js';
import { suggestAfterLearning, suggestHome } from '../home/suggest.js';
import { aiSettingsFor } from '../knowledge/env.js';
import { assertAdmin, assertSameOrigin, currentAdmin, jsonBody, siteParam } from './guard.js';

/**
 * The widget's home screen, suggested from the website (`home/suggest.ts`).
 * The home screen itself is saved with the rest of the settings
 * (`PUT /settings`, `home`), so `helppuff config pull` and deploy see it.
 */

export const homeRoutes = new Hono<HonoEnv>();

type Ai = { run(model: string, inputs: Record<string, unknown>, options?: unknown): Promise<unknown> };

function aiFor(env: Record<string, unknown>, site: SiteConfig) {
  const ai = env['AI'] as Partial<Ai> | undefined;
  const { chatModel, gateway } = aiSettingsFor(site);
  return { ai: ai && typeof ai.run === 'function' ? (ai as Ai) : undefined, model: chatModel, gateway };
}

/** Suggestions for the home screen, from what the site taught the assistant. Nothing is saved: the owner picks. */
homeRoutes.post('/home/suggest', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const ctx = c.get('helppuff');
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const site = await resolveSite(ctx, siteId);
  const db = dbFrom(ctx.env);
  if (!db) return c.json({ questions: [], links: null, contact: [], source: 'default' });
  return c.json(await suggestHome({ db, ...aiFor(ctx.env, site) }, siteId, site.widget.brand.name));
});

/**
 * In the background when the dashboard loads: a site learned before the
 * crawl made suggestions itself (an upgrade) gets them now. Once.
 */
export async function maybeSuggestHome(ctx: Pick<RequestCtx, 'env' | 'config' | 'platform'>, siteId: string): Promise<void> {
  const db = dbFrom(ctx.env);
  if (!db) return;
  const site = await resolveSite(ctx, siteId);
  if (site.connector.type !== 'workers-ai') return;
  const { ai, model } = aiFor(ctx.env, site);
  await suggestAfterLearning({ db, ai, kv: ctx.env['HELPPUFF_KV'] as KvStore | undefined, model, now: () => ctx.platform.now() }, siteId, site.widget.brand.name);
}
