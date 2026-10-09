import {
  canonicalUrl,
  categorise,
  DEFAULT_USER_AGENT,
  discover,
  queueRun,
  recordDiscovered,
  sameSite,
  selectedBy,
  type CrawlParams,
  type Discovery,
} from '@helppuff/rag';
import type { SiteConfig } from '../config/schema.js';
import { HelpPuffError } from '../core/errors.js';
import { aiSettingsFor, ownsKnowledge, websiteFor, type KnowledgeEnv } from './env.js';

/**
 * Starting, listing and cancelling crawls — shared by the admin API (the
 * dashboard and the CLI) and the scheduled re-crawl. The crawl itself runs
 * in the `CrawlWorkflow`; this only queues pages and starts it.
 */

export type CrawlTrigger = 'dashboard' | 'cli' | 'schedule' | 'setup';

export type StartCrawl = {
  /** Exact pages; otherwise the pages already selected, or (first time) the suggested ones. */
  urls?: string[];
  include?: string[];
  exclude?: string[];
  trigger: CrawlTrigger;
  workerUrl?: string;
};

export const userAgentFor = (workerUrl?: string) =>
  workerUrl ? DEFAULT_USER_AGENT.replace(/\(\+[^)]*\)/, `(+${workerUrl.replace(/\/$/, '')}/bot)`) : DEFAULT_USER_AGENT;

export async function discoverSite(env: KnowledgeEnv, siteId: string, site: SiteConfig, workerUrl?: string): Promise<Discovery> {
  const website = websiteFor(site);
  if (!website) {
    throw new HelpPuffError('bad_request', { message: 'Set the website address first (knowledge.website).', detail: 'knowledge_no_website' });
  }
  const found = await discover(website, { userAgent: userAgentFor(workerUrl), maxUrls: 1000 });
  // The configured exclusions untick (but still list) matching pages.
  const urls = found.urls.map((u) => (u.suggested && !selectedBy(u.url, site.knowledge.include, site.knowledge.exclude) ? { ...u, suggested: false } : u));
  await recordDiscovered(env.db, siteId, urls);
  return { ...found, urls };
}

async function selectedPages(env: KnowledgeEnv, siteId: string): Promise<{ url: string; category: string }[]> {
  return (
    await env.db
      .prepare("SELECT url, COALESCE(category, 'other') AS category FROM pages WHERE site_id = ? AND selected = 1 AND source NOT IN ('facts', 'manual', 'file') ORDER BY length(url), url")
      .bind(siteId)
      .all<{ url: string; category: string }>()
  ).results;
}

/**
 * Try the pages that failed again, by hand: a small run of just those (or of
 * the given ones among them). Unlike `startCrawl` with `urls`, it leaves which
 * pages are ticked alone, and it starts past the first part: robots.txt and
 * the site-wide furniture come from the last run, and the business details
 * read from every page are kept.
 */
export async function retryFailed(env: KnowledgeEnv, siteId: string, site: SiteConfig, request: { urls?: string[]; trigger: CrawlTrigger; workerUrl?: string }, now: number): Promise<{ runId: string; total: number }> {
  if (!env.workflow) {
    throw new HelpPuffError('internal', { message: 'This deployment has no crawl workflow. Run `helppuff deploy` again.', detail: 'knowledge_no_workflow' });
  }
  const busy = await env.db.prepare("SELECT 1 AS x FROM crawl_runs WHERE site_id = ? AND status IN ('queued', 'running') LIMIT 1").bind(siteId).first();
  if (busy) throw new HelpPuffError('conflict', { message: 'Learning is running now. Try the failed pages again when it finishes.', detail: 'knowledge_crawl_running' });
  const wanted = request.urls?.length ? new Set(request.urls.map((u) => canonicalUrl(u)).filter(Boolean)) : null;
  const failed = (
    await env.db
      .prepare("SELECT id, url FROM pages WHERE site_id = ? AND selected = 1 AND status IN ('error', 'blocked') AND source NOT IN ('facts', 'manual', 'file') ORDER BY length(url), url")
      .bind(siteId)
      .all<{ id: string; url: string }>()
  ).results.filter((p) => !wanted || wanted.has(p.url));
  if (!failed.length) throw new HelpPuffError('bad_request', { message: 'No failed pages to try again.', detail: 'knowledge_nothing_failed' });

  const last = await env.db
    .prepare('SELECT robots, boilerplate FROM crawl_runs WHERE site_id = ? AND boilerplate IS NOT NULL ORDER BY started_at DESC, rowid DESC LIMIT 1')
    .bind(siteId)
    .first<{ robots: string | null; boilerplate: string | null }>();
  const runId = `crawl-${now.toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await env.db
    .prepare("INSERT INTO crawl_runs (id, site_id, status, total, started_at, trigger, robots, boilerplate) VALUES (?, ?, 'running', ?, ?, ?, ?, ?)")
    .bind(runId, siteId, failed.length, now, request.trigger, last?.robots ?? null, last?.boilerplate ?? null)
    .run();
  const statements = failed.map((p) => env.db.prepare("UPDATE pages SET status = 'queued', error = NULL, run_id = ? WHERE id = ?").bind(runId, p.id));
  for (let i = 0; i < statements.length; i += 50) await env.db.batch(statements.slice(i, i + 50));

  const ai = aiSettingsFor(site);
  // Part 1: past the first part's robots.txt, sample and business-details reset.
  const params: CrawlParams = {
    siteId,
    runId,
    part: 1,
    options: { embeddingModel: ai.embeddingModel, chatModel: ai.chatModel, gateway: ai.gateway, renderJs: site.knowledge.renderJs, userAgent: userAgentFor(request.workerUrl) },
  };
  try {
    await env.workflow.create({ id: `${runId}-1`, params });
  } catch (thrown) {
    await env.db.prepare("UPDATE crawl_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").bind(String((thrown as Error)?.message ?? thrown).slice(0, 300), now, runId).run();
    throw new HelpPuffError('internal', { message: 'The retry could not start. Try again in a minute.', detail: 'knowledge_workflow_create_failed' });
  }
  return { runId, total: failed.length };
}

export async function startCrawl(env: KnowledgeEnv, siteId: string, site: SiteConfig, request: StartCrawl, now: number): Promise<{ runId: string; total: number }> {
  if (!env.workflow) {
    throw new HelpPuffError('internal', { message: 'This deployment has no crawl workflow. Run `helppuff deploy` again.', detail: 'knowledge_no_workflow' });
  }
  const website = websiteFor(site);
  let pages: { url: string; category: string }[];
  if (request.urls?.length) {
    pages = request.urls
      .map((u) => canonicalUrl(u))
      .filter((u): u is string => Boolean(u) && (!website || sameSite(u!, website)))
      .map((url) => ({ url, category: categorise({ url }) }));
    if (!pages.length) throw new HelpPuffError('bad_request', { message: 'None of those addresses are pages of this website.', detail: 'knowledge_bad_urls' });
  } else {
    pages = await selectedPages(env, siteId);
    if (!pages.length) {
      const found = await discoverSite(env, siteId, site, request.workerUrl);
      pages = found.urls.filter((u) => u.suggested);
    }
  }
  if (request.include?.length || request.exclude?.length) pages = pages.filter((p) => selectedBy(p.url, request.include, request.exclude));
  pages = [...new Map(pages.map((p) => [p.url, p])).values()].slice(0, site.knowledge.maxPages);
  if (!pages.length) throw new HelpPuffError('bad_request', { message: 'No pages are selected to crawl.', detail: 'knowledge_nothing_selected' });

  // One crawl at a time per site: a new one supersedes whatever is running.
  await env.db.prepare("UPDATE crawl_runs SET status = 'cancelled', finished_at = ? WHERE site_id = ? AND status IN ('queued', 'running')").bind(now, siteId).run();

  const runId = `crawl-${now.toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await env.db
    .prepare("INSERT INTO crawl_runs (id, site_id, status, total, started_at, trigger) VALUES (?, ?, 'queued', ?, ?, ?)")
    .bind(runId, siteId, pages.length, now, request.trigger)
    .run();
  await queueRun(env.db, siteId, runId, pages);

  const ai = aiSettingsFor(site);
  const params: CrawlParams = {
    siteId,
    runId,
    part: 0,
    options: {
      embeddingModel: ai.embeddingModel,
      chatModel: ai.chatModel,
      gateway: ai.gateway,
      renderJs: site.knowledge.renderJs,
      userAgent: userAgentFor(request.workerUrl),
    },
  };
  try {
    await env.workflow.create({ id: `${runId}-0`, params });
  } catch (thrown) {
    await env.db.prepare("UPDATE crawl_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").bind(String((thrown as Error)?.message ?? thrown).slice(0, 300), now, runId).run();
    throw new HelpPuffError('internal', { message: 'The crawl could not start. Try again in a minute.', detail: 'knowledge_workflow_create_failed' });
  }
  return { runId, total: pages.length };
}

export async function cancelCrawl(env: KnowledgeEnv, siteId: string, runId: string, now: number): Promise<boolean> {
  const result = (await env.db
    .prepare("UPDATE crawl_runs SET status = 'cancelled', finished_at = ? WHERE id = ? AND site_id = ? AND status IN ('queued', 'running')")
    .bind(now, runId, siteId)
    .run()) as { meta?: { changes?: number } } | undefined;
  await env.db.prepare("UPDATE pages SET status = 'discovered' WHERE site_id = ? AND run_id = ? AND status = 'queued'").bind(siteId, runId).run();
  return (result?.meta?.changes ?? 1) > 0;
}

export type CrawlStatus = {
  run: Record<string, unknown> | null;
  pages: Record<string, number>;
  chunks: number;
  lastIndexedAt: number | null;
};

export async function crawlStatus(env: Pick<KnowledgeEnv, 'db'>, siteId: string): Promise<CrawlStatus> {
  const [run, counts, chunks, last] = await Promise.all([
    env.db
      .prepare('SELECT id, status, trigger, total, done, failed, chunks, error, started_at AS startedAt, finished_at AS finishedAt FROM crawl_runs WHERE site_id = ? ORDER BY started_at DESC LIMIT 1')
      .bind(siteId)
      .first<Record<string, unknown>>(),
    env.db.prepare("SELECT status, count(*) AS n FROM pages WHERE site_id = ? AND source NOT IN ('facts', 'manual', 'file') GROUP BY status").bind(siteId).all<{ status: string; n: number }>(),
    env.db.prepare('SELECT count(*) AS n FROM chunks WHERE site_id = ?').bind(siteId).first<{ n: number }>(),
    env.db.prepare("SELECT max(crawled_at) AS at FROM pages WHERE site_id = ? AND status IN ('indexed', 'unchanged')").bind(siteId).first<{ at: number | null }>(),
  ]);
  // Live progress of the current run, counted from its pages rather than trusted from the run row.
  if (run && (run['status'] === 'running' || run['status'] === 'queued')) {
    const progress = await env.db
      .prepare(
        `SELECT sum(CASE WHEN status IN ('indexed', 'unchanged') THEN 1 ELSE 0 END) AS done,
                sum(CASE WHEN status IN ('error', 'blocked', 'skipped') THEN 1 ELSE 0 END) AS failed
         FROM pages WHERE site_id = ? AND run_id = ?`,
      )
      .bind(siteId, run['id'])
      .first<{ done: number | null; failed: number | null }>();
    run['done'] = progress?.done ?? 0;
    run['failed'] = progress?.failed ?? 0;
  }
  return {
    run,
    pages: Object.fromEntries(counts.results.map((r) => [r.status, r.n])),
    chunks: chunks?.n ?? 0,
    lastIndexedAt: last?.at ?? null,
  };
}

const PERIOD: Record<string, number> = { daily: 86_400_000, weekly: 7 * 86_400_000, monthly: 30 * 86_400_000 };

/** Re-crawl every site whose schedule is due. Called from the Worker's cron. */
export async function runScheduledCrawls(env: KnowledgeEnv, sites: Record<string, SiteConfig>, now: number): Promise<string[]> {
  const started: string[] = [];
  for (const [siteId, site] of Object.entries(sites)) {
    const period = PERIOD[site.knowledge.schedule];
    if (!period || !ownsKnowledge(site)) continue;
    const last = await env.db.prepare('SELECT max(started_at) AS at FROM crawl_runs WHERE site_id = ?').bind(siteId).first<{ at: number | null }>();
    // Never crawled: the owner has not picked pages yet; that is onboarding's job, not the cron's.
    if (!last?.at || now - last.at < period - 3_600_000) continue;
    try {
      await startCrawl(env, siteId, site, { trigger: 'schedule' }, now);
      started.push(siteId);
    } catch {
      // Nothing selected, or the workflow refused: try again tomorrow.
    }
  }
  return started;
}
