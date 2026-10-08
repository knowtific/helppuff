import type { HelpPuffConfig, SiteConfig } from './config/schema.js';
import { resolveSite } from './config/site.js';
import { createApp } from './app.js';
import { resilientKv } from './core/platform.js';
import { setExtensions, type Extensions, type KvStore } from '@helppuff/connector-types';
import { knowledgeEnv } from './knowledge/env.js';
import { runScheduledCrawls } from './knowledge/crawl.js';
import { ensureSchema } from './db/d1.js';

type Ctx = { waitUntil(promise: Promise<unknown>): void };

/**
 * The Worker: the HTTP app, plus the cron that keeps each site's knowledge
 * base fresh. The crawl itself is the `CrawlWorkflow` export, which only the
 * Worker entry (`index.ts` / `runtime.ts`) can import.
 *
 * `extensions` are the site's own models and knowledge bases (`custom` in
 * helppuff.json), imported from its TypeScript files by the generated entry.
 */
export function createWorker(config: HelpPuffConfig, extensions: Extensions = {}) {
  setExtensions(extensions);
  const app = createApp(config);
  return {
    fetch: app.fetch,
    async scheduled(_controller: unknown, env: Record<string, unknown>, ctx: Ctx): Promise<void> {
      const knowledge = knowledgeEnv(env);
      if (!knowledge) return;
      const kv = resilientKv(env['HELPPUFF_KV'] as KvStore | undefined, () => {});
      const platform = { kv, log: () => {} };
      ctx.waitUntil(
        (async () => {
          await ensureSchema(knowledge.db);
          const sites: Record<string, SiteConfig> = {};
          for (const id of Object.keys(config.sites)) sites[id] = await resolveSite({ config, platform }, id);
          await runScheduledCrawls(knowledge, sites, Date.now());
        })().catch(() => {}),
      );
    },
  };
}
