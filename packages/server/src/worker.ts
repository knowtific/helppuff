import type { MurmurConfig, SiteConfig } from './config/schema.js';
import { resolveSite } from './config/site.js';
import { createApp } from './app.js';
import { resilientKv } from './core/platform.js';
import type { KvStore } from '@murmur/connector-types';
import { knowledgeEnv } from './knowledge/env.js';
import { runScheduledCrawls } from './knowledge/crawl.js';
import { ensureSchema } from './db/d1.js';

type Ctx = { waitUntil(promise: Promise<unknown>): void };

/**
 * The Worker: the HTTP app, plus the cron that keeps each site's knowledge
 * base fresh. The crawl itself is the `CrawlWorkflow` export, which only the
 * Worker entry (`index.ts` / `runtime.ts`) can import.
 */
export function createWorker(config: MurmurConfig) {
  const app = createApp(config);
  return {
    fetch: app.fetch,
    async scheduled(_controller: unknown, env: Record<string, unknown>, ctx: Ctx): Promise<void> {
      const knowledge = knowledgeEnv(env);
      if (!knowledge) return;
      const kv = resilientKv(env['MURMUR_KV'] as KvStore | undefined, () => {});
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
