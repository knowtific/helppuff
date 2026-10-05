import { boilerplateFrom, stripBoilerplate } from './boilerplate.js';
import { categorise } from './categorise.js';
import { extractPage, type Fact } from './extract.js';
import { factsFromText, storeFacts } from './facts.js';
import { DEFAULT_USER_AGENT, fetchPage, fetchText, renderPage } from './fetch.js';
import { sha256Hex } from './hash.js';
import { FACTS_URL, factsMarkdown, indexDocument, type IndexDeps } from './pipeline.js';
import { neurons as costOf, usageDay } from './pricing.js';
import { EMPTY_ROBOTS, parseRobots, robotsAllows, type Robots } from './robots.js';
import { deletePageChunks, nextQueued, pageIdFor, readFacts, updatePage, type PageRow, type PageStatus } from './store.js';
import type { FileParams } from './files.js';
import type { BrowserLike, Log, Notify } from './types.js';
import { canonicalUrl } from './url.js';

/**
 * The crawl, as a sequence of durable steps.
 *
 * It runs inside a Cloudflare Workflow, so it carries on after the person
 * who started it closes the dashboard or the terminal, and a step that fails
 * (a timeout, a Workers AI hiccup) is retried on its own without redoing the
 * pages before it. Progress lives in D1 (`crawl_runs`, `pages`), which is
 * all the dashboard and `murmur status` read.
 *
 * Shaped for the Workers Free plan:
 *  - one page per step, so each step stays well inside the CPU limit;
 *  - at most `batchSize` pages per Workflow instance, after which the
 *    instance starts the next one — the free plan allows 50 external
 *    fetches per invocation, and a chain of short instances never nears it;
 *  - no step returns more than a few hundred bytes.
 *
 * Written against `StepLike` rather than the Workflows API, so it runs (and
 * is tested) anywhere; `server/src/workflows/crawl.ts` adapts the real one.
 */

export interface StepLike {
  do<T>(name: string, run: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
}

export type CrawlOptions = {
  embeddingModel: string;
  /** The site's chat model: reads business details the structured data does not give. */
  chatModel?: string;
  gateway?: string | null;
  userAgent?: string;
  renderJs?: 'auto' | 'always' | 'never';
  /** Pages per Workflow instance. */
  batchSize?: number;
};

export type CrawlParams = { siteId: string; runId: string; part: number; options: CrawlOptions };

export type CrawlDeps = IndexDeps & {
  browser?: BrowserLike | undefined;
  fetch?: typeof fetch;
  log?: Log;
  /** Start the next Workflow instance of this run. */
  startNext: (params: CrawlParams) => Promise<void>;
  /** Re-embed an uploaded file (its own Workflow instance), when the embedding model has changed. */
  startFile?: (params: FileParams) => Promise<void>;
  notify?: Notify;
};

export type CrawlRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export const DEFAULT_BATCH = 15;
const SAMPLE_PAGES = 5;

type PageResult = { status: PageStatus; chunks: number; neurons: number };

const now = (deps: CrawlDeps) => (deps.now ?? Date.now)();

async function runRow(deps: CrawlDeps, runId: string) {
  return deps.db.prepare('SELECT status, robots, boilerplate FROM crawl_runs WHERE id = ?').bind(runId).first<{
    status: CrawlRunStatus;
    robots: string | null;
    boilerplate: string | null;
  }>();
}

export async function addUsage(deps: Pick<IndexDeps, 'db' | 'now'>, siteId: string, neurons: number, messages = 0): Promise<void> {
  if (!neurons && !messages) return;
  await deps.db
    .prepare(
      `INSERT INTO usage_daily (day, site_id, neurons_est, messages) VALUES (?, ?, ?, ?)
       ON CONFLICT (day, site_id) DO UPDATE SET neurons_est = neurons_est + excluded.neurons_est, messages = messages + excluded.messages`,
    )
    .bind(usageDay((deps.now ?? Date.now)()), siteId, neurons, messages)
    .run();
}

/** Run one Workflow instance's share of a crawl. */
export async function runCrawlPart(step: StepLike, deps: CrawlDeps, params: CrawlParams): Promise<{ finished: boolean }> {
  const { siteId, runId } = params;
  const userAgent = params.options.userAgent ?? DEFAULT_USER_AGENT;
  const io = { userAgent, ...(deps.fetch ? { fetch: deps.fetch } : {}) };

  if (params.part === 0) {
    await step.do('prepare', async () => {
      const queued = await nextQueued(deps.db, siteId, runId, SAMPLE_PAGES);
      const origin = queued[0] ? new URL(queued[0].url).origin : null;
      const robotsText = origin ? await fetchText(`${origin}/robots.txt`, io) : null;
      const robots = robotsText ? parseRobots(robotsText, userAgent) : EMPTY_ROBOTS;

      // A small sample decides what is site-wide furniture: anything on
      // most of these pages is on most pages.
      const sample: string[] = [];
      for (const page of queued) {
        const fetched = await fetchPage(page.url, io);
        if (fetched.ok) sample.push(extractPage(fetched.html, fetched.finalUrl).markdown);
      }
      const boilerplate = boilerplateFrom(sample);
      const siteWide = sample[0] ? stripBoilerplate(sample[0], boilerplate).siteWide : [];

      // Facts are re-learned on every crawl; what the owner typed is kept.
      await deps.db.prepare("DELETE FROM site_facts WHERE site_id = ? AND (source_url IS NULL OR source_url != 'owner')").bind(siteId).run();
      if (siteWide.length) await mergeFacts(deps, siteId, [{ key: 'footer' as Fact['key'], value: siteWide.join('\n\n').slice(0, 2000) }], origin ?? '');
      const total = (await deps.db.prepare("SELECT count(*) AS n FROM pages WHERE site_id = ? AND run_id = ? AND status = 'queued'").bind(siteId, runId).first<{ n: number }>())?.n ?? 0;
      await deps.db
        .prepare("UPDATE crawl_runs SET status = 'running', total = ?, robots = ?, boilerplate = ? WHERE id = ?")
        .bind(total, JSON.stringify(robots), JSON.stringify(boilerplate), runId)
        .run();
      return { total, boilerplate: boilerplate.length };
    });
  }

  const run = await step.do('load', async () => {
    const row = await runRow(deps, runId);
    const batch = await nextQueued(deps.db, siteId, runId, params.options.batchSize ?? DEFAULT_BATCH);
    return {
      status: row?.status ?? 'failed',
      robots: row?.robots ?? null,
      boilerplate: row?.boilerplate ?? null,
      pages: batch.map((p) => ({ id: p.id, url: p.url })),
    };
  });
  if (run.status === 'cancelled' || run.status === 'failed') return { finished: true };

  const robots = safeJson<Robots>(run.robots, EMPTY_ROBOTS);
  const boilerplate = safeJson<string[]>(run.boilerplate, []);
  const delayMs = Math.min(10, robots.crawlDelay ?? 0) * 1000;

  for (const [i, page] of run.pages.entries()) {
    if (i > 0 && delayMs >= 1000) await step.sleep(`delay:${page.id}`, delayMs);
    try {
      await step.do(`page:${page.id}`, async () => {
        const current = await runRow(deps, runId);
        if (current?.status === 'cancelled') return { status: 'skipped', chunks: 0, neurons: 0 } satisfies PageResult;
        return crawlOne(deps, params, page.url, { robots, boilerplate, userAgent });
      });
    } catch (thrown) {
      // Retries are spent: record the failure and move on; one bad page must not stop the crawl.
      await updatePage(deps.db, page.id, { status: 'error', error: String((thrown as Error)?.message ?? thrown).slice(0, 300), crawled_at: now(deps) });
    }
  }

  const remaining = await step.do('remaining', async () => {
    const row = await runRow(deps, runId);
    if (row?.status === 'cancelled') return 0;
    return (await deps.db.prepare("SELECT count(*) AS n FROM pages WHERE site_id = ? AND run_id = ? AND status = 'queued'").bind(siteId, runId).first<{ n: number }>())?.n ?? 0;
  });
  if (remaining > 0) {
    await step.do('next', async () => {
      await deps.startNext({ ...params, part: params.part + 1 });
      return true;
    });
    return { finished: false };
  }

  await step.do('facts', async () => {
    // What structured data did not give, the model reads from the contact and home pages.
    const known = new Set((await readFacts(deps.db, siteId)).map((f) => f.key));
    const missing = ['phone', 'email', 'address', 'hours'].filter((k) => !known.has(k));
    if (missing.length && params.options.chatModel) {
      const pages = (
        await deps.db
          .prepare(
            `SELECT url, group_concat(content, '

') AS markdown FROM (
               SELECT c.url, c.content FROM chunks c JOIN pages p ON p.id = c.page_id
               WHERE c.site_id = ? AND p.category IN ('contact', 'home') ORDER BY p.category = 'contact' DESC, c.ordinal
             ) GROUP BY url LIMIT 2`,
          )
          .bind(siteId)
          .all<{ url: string; markdown: string }>()
      ).results;
      const read = await factsFromText(deps.ai, params.options.chatModel, pages, params.options);
      await storeFacts(deps.db, siteId, read.facts.filter((f) => missing.includes(f.key)).map((f) => ({ ...f, sourceUrl: pages[0]?.url ?? '' })), now(deps));
      await addUsage(deps, siteId, read.neurons);
    }
    const facts = await readFacts(deps.db, siteId);
    const markdown = factsMarkdown(facts);
    const pageId = await pageIdFor(siteId, FACTS_URL);
    if (!markdown) {
      await deletePageChunks(deps.db, deps.vectors, siteId, pageId);
      return 0;
    }
    const name = facts.find((f) => f.key === 'name')?.value ?? 'Business details';
    await deps.db
      .prepare(
        `INSERT INTO pages (id, site_id, url, title, category, status, selected, source, crawled_at) VALUES (?, ?, ?, ?, 'contact', 'indexed', 1, 'facts', ?)
         ON CONFLICT (site_id, url) DO UPDATE SET title = excluded.title, status = 'indexed', crawled_at = excluded.crawled_at`,
      )
      .bind(pageId, siteId, FACTS_URL, name, now(deps))
      .run();
    const indexed = await indexDocument(deps, { siteId, url: FACTS_URL, title: name, category: 'contact', markdown }, params.options);
    await addUsage(deps, siteId, indexed.neurons);
    return indexed.chunks;
  });

  await step.do('files', async () => {
    // Uploaded files keep their Markdown; one embedded with another model is re-embedded from it.
    if (!deps.startFile) return 0;
    const stale = (
      await deps.db
        .prepare("SELECT id FROM knowledge_files WHERE site_id = ? AND status = 'indexed' AND (embedding_model IS NULL OR embedding_model != ?)")
        .bind(siteId, params.options.embeddingModel)
        .all<{ id: string }>()
    ).results;
    for (const file of stale) {
      await deps.startFile({ kind: 'file', siteId, fileId: file.id, options: { embeddingModel: params.options.embeddingModel, gateway: params.options.gateway ?? null } });
    }
    return stale.length;
  });

  await step.do('cleanup', async () => {
    // Pages the owner unticked, and pages that are gone, leave the knowledge base.
    const stale = (
      await deps.db
        .prepare(
          `SELECT id FROM pages WHERE site_id = ? AND source NOT IN ('facts', 'manual', 'file')
           AND (selected = 0 OR http_status IN (404, 410)) AND id IN (SELECT DISTINCT page_id FROM chunks WHERE site_id = ?)`,
        )
        .bind(siteId, siteId)
        .all<{ id: string }>()
    ).results;
    let removed = 0;
    for (const page of stale) removed += await deletePageChunks(deps.db, deps.vectors, siteId, page.id);
    return removed;
  });

  await step.do('finish', async () => {
    const counts = await deps.db
      .prepare(
        `SELECT
           sum(CASE WHEN status IN ('indexed', 'unchanged') THEN 1 ELSE 0 END) AS done,
           sum(CASE WHEN status IN ('error', 'blocked', 'skipped') THEN 1 ELSE 0 END) AS failed
         FROM pages WHERE site_id = ? AND run_id = ?`,
      )
      .bind(siteId, runId)
      .first<{ done: number | null; failed: number | null }>();
    const chunks = (await deps.db.prepare('SELECT count(*) AS n FROM chunks WHERE site_id = ?').bind(siteId).first<{ n: number }>())?.n ?? 0;
    await deps.db
      .prepare("UPDATE crawl_runs SET status = CASE WHEN status = 'cancelled' THEN status ELSE 'done' END, done = ?, failed = ?, chunks = ?, finished_at = ? WHERE id = ?")
      .bind(counts?.done ?? 0, counts?.failed ?? 0, chunks, now(deps), runId)
      .run();
    return { done: counts?.done ?? 0, failed: counts?.failed ?? 0, chunks };
  });
  if (deps.notify) {
    await step.do('notify', async () => {
      const run = await deps.db.prepare('SELECT status, done, failed, chunks, trigger FROM crawl_runs WHERE id = ?').bind(runId).first<Record<string, unknown>>();
      await deps.notify!('knowledge.crawl.finished', {
        runId,
        status: run?.['status'] ?? 'done',
        trigger: run?.['trigger'] ?? null,
        pages: { learned: run?.['done'] ?? 0, failed: run?.['failed'] ?? 0 },
        passages: run?.['chunks'] ?? 0,
      });
      return true;
    });
  }
  return { finished: true };
}

function safeJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Store a page's facts; phones and emails accumulate (up to three), the rest keep the first value seen. */
async function mergeFacts(deps: CrawlDeps, siteId: string, facts: Fact[], sourceUrl: string): Promise<void> {
  if (!facts.length) return;
  await deps.db.batch(
    facts.map((f) =>
      deps.db
        .prepare(
          `INSERT INTO site_facts (site_id, key, value, source_url, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (site_id, key) DO UPDATE SET value = CASE
             WHEN site_facts.key IN ('phone', 'email')
               AND instr(lower(replace(site_facts.value, ' ', '')), lower(replace(excluded.value, ' ', ''))) = 0
               AND length(site_facts.value) - length(replace(site_facts.value, ',', '')) < 2
             THEN site_facts.value || ', ' || excluded.value
             ELSE site_facts.value END
           WHERE site_facts.source_url IS NULL OR site_facts.source_url != 'owner'`,
        )
        .bind(siteId, f.key, f.value, sourceUrl, now(deps)),
    ),
  );
}

async function crawlOne(
  deps: CrawlDeps,
  params: CrawlParams,
  url: string,
  context: { robots: Robots; boilerplate: string[]; userAgent: string },
): Promise<PageResult> {
  const { siteId } = params;
  const pageId = await pageIdFor(siteId, url);
  const crawledAt = now(deps);
  const done = async (status: PageStatus, fields: Partial<PageRow> = {}, chunks = 0, neurons = 0): Promise<PageResult> => {
    await updatePage(deps.db, pageId, { status, crawled_at: crawledAt, ...fields });
    return { status, chunks, neurons };
  };

  if (!robotsAllows(context.robots, url)) return done('blocked', { error: 'disallowed by robots.txt' });

  const fetched = await fetchPage(url, { userAgent: context.userAgent, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  if (!fetched.ok) {
    return done(fetched.blocked ? 'blocked' : 'error', { http_status: fetched.status, error: fetched.error, final_url: fetched.finalUrl });
  }
  let html = fetched.html;
  let page = extractPage(html, fetched.finalUrl);
  const renderJs = params.options.renderJs ?? 'auto';
  let browserNote: string | null = null;
  if (renderJs === 'always' || (renderJs === 'auto' && page.looksRendered)) {
    const rendered = await renderPage(deps.browser, url);
    if (rendered) {
      html = rendered.html;
      page = extractPage(html, fetched.finalUrl);
    } else if (page.looksRendered) {
      browserNote = deps.browser
        ? 'drawn by JavaScript and the browser was unavailable (the free plan allows 10 minutes a day)'
        : 'drawn by JavaScript; add a Browser Rendering binding to read it';
    }
  }

  const { markdown } = stripBoilerplate(page.markdown, context.boilerplate);
  const category = categorise({ url, title: page.title, h1: page.h1 });
  const base = {
    http_status: fetched.status,
    final_url: canonicalUrl(fetched.finalUrl) ?? fetched.finalUrl,
    title: page.title,
    category,
    error: null,
  };
  await mergeFacts(deps, siteId, page.facts, url);

  if (page.textLength < 50 || !markdown.trim()) {
    return done('skipped', { ...base, error: browserNote ?? 'no readable text on the page' });
  }

  // The embedding model is part of the hash: switching models re-embeds every page on the next crawl.
  const contentHash = await sha256Hex(`${page.title}\n${category}\n${params.options.embeddingModel}\n${markdown}`);
  const previous = await deps.db.prepare('SELECT content_hash FROM pages WHERE id = ?').bind(pageId).first<{ content_hash: string | null }>();
  const hasChunks = await deps.db.prepare('SELECT 1 AS x FROM chunks WHERE site_id = ? AND page_id = ? LIMIT 1').bind(siteId, pageId).first();
  if (previous?.content_hash === contentHash && hasChunks) return done('unchanged', base);

  const indexed = await indexDocument(deps, { siteId, url, title: page.title, category, markdown }, params.options);
  await addUsage(deps, siteId, indexed.neurons);
  return done('indexed', { ...base, content_hash: contentHash, error: browserNote }, indexed.chunks, indexed.neurons);
}

/** Neurons a crawl of `pages` typical pages will cost, for the dashboard's estimate. */
export function estimateCrawlNeurons(pages: number, embeddingModel: string): number {
  return costOf(embeddingModel, pages * 2500);
}
