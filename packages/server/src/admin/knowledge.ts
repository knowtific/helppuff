import { Hono, type Context } from 'hono';
import {
  addUsage,
  detectFacts,
  fetchPage,
  FACTS_URL,
  FREE_DAILY_NEURONS,
  deletePageChunks,
  factsMarkdown,
  indexDocument,
  manualUrl,
  pageIdFor,
  readFacts,
  reasoningInputs,
  retrieve,
  DEFAULT_RETRIEVAL,
  MAX_FILE_BYTES,
  deleteFileChunks,
  fileKind,
  uploadKey,
  type FileParams,
  usageDay,
  writeFacts,
} from '@helppuff/rag';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import { aiSettingsFor, requireKnowledgeEnv, websiteFor, type KnowledgeEnv } from '../knowledge/env.js';
import { cancelCrawl, crawlStatus, discoverSite, startCrawl, userAgentFor, type CrawlTrigger } from '../knowledge/crawl.js';
import { assertSameOrigin, currentAdmin, jsonBody, siteParam } from './guard.js';

/**
 * The knowledge base, under `/admin/api/knowledge`: what the dashboard's
 * onboarding and Knowledge page use, and what `helppuff discover / crawl /
 * status / knowledge / ask` call with the admin API key. One API, two
 * front ends.
 */

export const knowledgeRoutes = new Hono<HonoEnv>();

const FACT_KEYS = ['name', 'phone', 'email', 'address', 'hours', 'serviceAreas', 'priceRange', 'description'] as const;

async function siteOf(c: Context<HonoEnv>, value: unknown) {
  const siteId = siteParam(c, value);
  const ctx = c.get('helppuff');
  return { siteId, site: await resolveSite(ctx, siteId), env: requireKnowledgeEnv(ctx.env), now: ctx.platform.now() };
}

const strings = (value: unknown, max = 1000): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, max) : undefined;

const workerUrl = (c: Context<HonoEnv>) => new URL(c.req.url).origin;

knowledgeRoutes.post('/admin/api/knowledge/discover', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, site, env } = await siteOf(c, body['site']);
  const found = await discoverSite(env, siteId, site, workerUrl(c));
  // Merge in what earlier crawls learned, so the checklist shows real state.
  const known = await env.db
    .prepare('SELECT url, status, selected, title, category, error FROM pages WHERE site_id = ?')
    .bind(siteId)
    .all<{ url: string; status: string; selected: number; title: string | null; category: string | null; error: string | null }>();
  const byUrl = new Map(known.results.map((r) => [r.url, r]));
  return c.json({
    site: siteId,
    origin: found.origin,
    reachable: found.reachable,
    sitemaps: found.sitemaps,
    warnings: found.warnings,
    urls: found.urls.map((u) => {
      const row = byUrl.get(u.url);
      const crawled = row && row.status !== 'discovered';
      return { ...u, status: row?.status ?? 'discovered', title: row?.title ?? null, error: row?.error ?? null, selected: crawled ? row.selected === 1 : u.suggested };
    }),
  });
});

knowledgeRoutes.get('/admin/api/knowledge/pages', async (c) => {
  await currentAdmin(c);
  const { siteId, env } = await siteOf(c, c.req.query('site'));
  const status = c.req.query('status');
  const rows = await env.db
    .prepare(
      `SELECT p.id, p.url, p.final_url AS finalUrl, p.title, p.category, p.status, p.http_status AS httpStatus, p.error,
              p.selected, p.source, p.crawled_at AS crawledAt, (SELECT count(*) FROM chunks c WHERE c.page_id = p.id) AS chunks
       FROM pages p WHERE p.site_id = ?${status ? ' AND p.status = ?' : ''} ORDER BY p.source = 'facts' DESC, length(p.url), p.url LIMIT 2000`,
    )
    .bind(...(status ? [siteId, status] : [siteId]))
    .all();
  return c.json({ site: siteId, pages: rows.results });
});

knowledgeRoutes.get('/admin/api/knowledge/pages/:id/chunks', async (c) => {
  await currentAdmin(c);
  const { siteId, env } = await siteOf(c, c.req.query('site'));
  const rows = await env.db
    .prepare('SELECT id, heading_path AS headingPath, ordinal, content, token_estimate AS tokens FROM chunks WHERE site_id = ? AND page_id = ? ORDER BY ordinal')
    .bind(siteId, c.req.param('id'))
    .all();
  return c.json({ chunks: rows.results });
});

knowledgeRoutes.post('/admin/api/knowledge/crawl', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, site, env, now } = await siteOf(c, body['site']);
  const urls = strings(body['urls']);
  const trigger: CrawlTrigger = body['trigger'] === 'setup' ? 'setup' : admin.via === 'api-key' ? 'cli' : 'dashboard';
  const started = await startCrawl(
    env,
    siteId,
    site,
    {
      ...(urls ? { urls } : {}),
      ...(strings(body['include']) ? { include: strings(body['include'])! } : {}),
      ...(strings(body['exclude']) ? { exclude: strings(body['exclude'])! } : {}),
      trigger,
      workerUrl: workerUrl(c),
    },
    now,
  );
  return c.json({ site: siteId, ...started }, 202);
});

knowledgeRoutes.post('/admin/api/knowledge/runs/:id/cancel', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, env, now } = await siteOf(c, body['site']);
  return c.json({ cancelled: await cancelCrawl(env, siteId, c.req.param('id'), now) });
});

async function usageToday(env: KnowledgeEnv, siteId: string, now: number, budget: number) {
  const row = await env.db
    .prepare('SELECT neurons_est AS neurons, messages FROM usage_daily WHERE day = ? AND site_id = ?')
    .bind(usageDay(now), siteId)
    .first<{ neurons: number; messages: number }>();
  const neurons = Math.round((row?.neurons ?? 0) * 10) / 10;
  const messages = row?.messages ?? 0;
  const perMessage = messages ? neurons / messages : 30;
  return {
    day: usageDay(now),
    neurons,
    messages,
    budget,
    freeAllocation: FREE_DAILY_NEURONS,
    /** At today's average cost per answer. */
    messagesLeft: Math.max(0, Math.floor((budget - neurons) / Math.max(perMessage, 1))),
    state: budget <= 0 ? 'unlimited' : neurons >= budget ? 'exhausted' : neurons >= budget * 0.8 ? 'tight' : 'ok',
  };
}

function budgetOf(site: { connector: { options?: unknown } }): number {
  const options = (site.connector.options ?? {}) as { budget?: { dailyNeurons?: unknown } };
  return typeof options.budget?.dailyNeurons === 'number' ? options.budget.dailyNeurons : 9000;
}

knowledgeRoutes.get('/admin/api/knowledge/status', async (c) => {
  await currentAdmin(c);
  const { siteId, site, env, now } = await siteOf(c, c.req.query('site'));
  const [status, usage] = await Promise.all([crawlStatus(env, siteId), usageToday(env, siteId, now, budgetOf(site))]);
  return c.json({
    site: siteId,
    connector: site.connector.type,
    browserRendering: Boolean(env.browser),
    workflow: Boolean(env.workflow),
    schedule: site.knowledge.schedule,
    ...status,
    usage,
  });
});

knowledgeRoutes.get('/admin/api/usage', async (c) => {
  await currentAdmin(c);
  const { siteId, site, env, now } = await siteOf(c, c.req.query('site'));
  const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 30) || 30));
  const rows = await env.db
    .prepare('SELECT day, neurons_est AS neurons, messages FROM usage_daily WHERE site_id = ? AND day >= ? ORDER BY day')
    .bind(siteId, usageDay(now - days * 86_400_000))
    .all();
  return c.json({ site: siteId, today: await usageToday(env, siteId, now, budgetOf(site)), days: rows.results });
});

/** What retrieval finds for a question, with scores: `helppuff ask` and the dashboard's test panel show it. */
knowledgeRoutes.post('/admin/api/knowledge/search', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, site, env } = await siteOf(c, body['site']);
  const query = typeof body['query'] === 'string' ? body['query'].trim().slice(0, 1000) : '';
  if (!query) throw new HelpPuffError('bad_request', { message: 'Send a query.', detail: 'knowledge_search_empty' });
  const options = (site.connector.options ?? {}) as { retrieval?: Record<string, unknown>; gateway?: string };
  const ai = aiSettingsFor(site);
  const retrieval = options.retrieval ?? {};
  // `rerank: false` answers "what would it find without the reranker?", and
  // `reranker: '<model>'` "what with this one?", for comparing them.
  const reranker = typeof body['reranker'] === 'string' && /^(@cf|typesafe)\/[\w./-]+$/.test(body['reranker']) ? body['reranker'] : body['rerank'] === false || retrieval['rerankerModel'] === null ? null : typeof retrieval['rerankerModel'] === 'string' ? retrieval['rerankerModel'] : DEFAULT_RETRIEVAL.rerankerModel;
  const result = await retrieve({ db: env.db, ai: env.ai, vectors: env.vectors }, siteId, query, {
    ...DEFAULT_RETRIEVAL,
    embeddingModel: ai.embeddingModel,
    rerankerModel: reranker,
    topKVector: Number(retrieval['topKVector'] ?? DEFAULT_RETRIEVAL.topKVector),
    topKKeyword: Number(retrieval['topKKeyword'] ?? DEFAULT_RETRIEVAL.topKKeyword),
    finalK: Number(body['k'] ?? retrieval['finalK'] ?? DEFAULT_RETRIEVAL.finalK),
    minScore: Number(retrieval['minScore'] ?? DEFAULT_RETRIEVAL.minScore),
    intentModel: typeof retrieval['intentModel'] === 'string' ? retrieval['intentModel'] : null,
    gateway: ai.gateway,
  });
  return c.json({ site: siteId, ...result });
});

// ------------------------------------------------------------ manual knowledge

knowledgeRoutes.get('/admin/api/knowledge/manual', async (c) => {
  await currentAdmin(c);
  const { siteId, env } = await siteOf(c, c.req.query('site'));
  const rows = await env.db
    .prepare('SELECT id, title, content, updated_at AS updatedAt FROM knowledge_manual WHERE site_id = ? ORDER BY updated_at DESC')
    .bind(siteId)
    .all();
  return c.json({ entries: rows.results });
});

/** Add or replace a hand-written entry (a Q&A, a policy, a price list). Indexed at once. */
knowledgeRoutes.post('/admin/api/knowledge/manual', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, site, env, now } = await siteOf(c, body['site']);
  const title = typeof body['title'] === 'string' ? body['title'].trim().slice(0, 200) : '';
  const content = typeof body['content'] === 'string' ? body['content'].trim().slice(0, 100_000) : '';
  if (!title || !content) throw new HelpPuffError('bad_request', { message: 'Give the entry a title and some text.', detail: 'manual_body' });
  const id = typeof body['id'] === 'string' && /^[a-z0-9-]{1,64}$/.test(body['id']) ? body['id'] : crypto.randomUUID();
  const url = manualUrl(id);
  await env.db
    .prepare(
      `INSERT INTO knowledge_manual (id, site_id, title, content, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, content = excluded.content, updated_at = excluded.updated_at`,
    )
    .bind(id, siteId, title, content, now)
    .run();
  const pageId = await pageIdFor(siteId, url);
  await env.db
    .prepare(
      `INSERT INTO pages (id, site_id, url, title, category, status, selected, source, crawled_at) VALUES (?, ?, ?, ?, 'faq', 'indexed', 1, 'manual', ?)
       ON CONFLICT (site_id, url) DO UPDATE SET title = excluded.title, crawled_at = excluded.crawled_at`,
    )
    .bind(pageId, siteId, url, title, now)
    .run();
  const markdown = /^#/.test(content) ? content : `# ${title}\n\n${content}`;
  const indexed = await indexDocument({ db: env.db, ai: env.ai, vectors: env.vectors }, { siteId, url, title, category: 'faq', markdown }, aiSettingsFor(site));
  return c.json({ id, chunks: indexed.chunks });
});

knowledgeRoutes.delete('/admin/api/knowledge/manual/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const { siteId, env } = await siteOf(c, c.req.query('site'));
  const id = c.req.param('id');
  const pageId = await pageIdFor(siteId, manualUrl(id));
  await deletePageChunks(env.db, env.vectors, siteId, pageId);
  await env.db.batch([
    env.db.prepare('DELETE FROM knowledge_manual WHERE id = ? AND site_id = ?').bind(id, siteId),
    env.db.prepare('DELETE FROM pages WHERE id = ?').bind(pageId),
  ]);
  return c.json({ deleted: true });
});

// ------------------------------------------------------------ uploaded files

/** A file still queued after this long never reached its job (a Worker mid-deploy, say): start it again. */
const STALLED_MS = 120_000;

knowledgeRoutes.get('/admin/api/knowledge/files', async (c) => {
  await currentAdmin(c);
  const { siteId, site, env, now } = await siteOf(c, c.req.query('site'));
  const stalled = (
    await env.db
      .prepare("SELECT id FROM knowledge_files WHERE site_id = ? AND status = 'queued' AND updated_at < ?")
      .bind(siteId, now - STALLED_MS)
      .all<{ id: string }>()
  ).results;
  if (stalled.length && env.workflow) {
    const ai = aiSettingsFor(site);
    for (const { id } of stalled) {
      await env.db.prepare('UPDATE knowledge_files SET updated_at = ? WHERE id = ?').bind(now, id).run();
      const params: FileParams = { kind: 'file', siteId, fileId: id, options: { embeddingModel: ai.embeddingModel, gateway: ai.gateway } };
      await env.workflow.create({ id: `file-${id}-${now.toString(36)}`, params }).catch(() => null);
    }
  }
  const rows = await env.db
    .prepare(
      `SELECT id, name, kind, size, status, error, chunks, truncated, created_at AS createdAt, updated_at AS updatedAt
       FROM knowledge_files WHERE site_id = ? ORDER BY created_at DESC`,
    )
    .bind(siteId)
    .all();
  return c.json({ files: rows.results });
});

/**
 * Upload a document: the raw bytes as the body, its name as `?name=`. It is
 * read, cleaned and learned in the background (the crawl's Workflow); the
 * list above shows its progress.
 */
knowledgeRoutes.post('/admin/api/knowledge/files', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const { siteId, site, env, now } = await siteOf(c, c.req.query('site'));
  const name = (c.req.query('name') ?? '').trim().replace(/[\\/]/g, '_').slice(0, 200);
  const kind = fileKind(name);
  if (!kind) throw new HelpPuffError('bad_request', { message: 'Upload a PDF, Word (.docx), Markdown or text file.', detail: 'file_type' });
  const declared = Number(c.req.header('Content-Length') ?? 0);
  if (declared > MAX_FILE_BYTES) throw new HelpPuffError('bad_request', { message: 'Files can be up to 10 MB.', detail: 'file_too_large' });
  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) throw new HelpPuffError('bad_request', { message: 'The file is empty.', detail: 'file_empty' });
  if (bytes.byteLength > MAX_FILE_BYTES) throw new HelpPuffError('bad_request', { message: 'Files can be up to 10 MB.', detail: 'file_too_large' });
  if (!env.workflow || !env.uploads) {
    throw new HelpPuffError('internal', { message: 'This deployment cannot process files yet. Run `helppuff deploy` again.', detail: 'knowledge_no_workflow' });
  }

  const id = crypto.randomUUID();
  await env.uploads.put(uploadKey(siteId, id), bytes, { expirationTtl: 86_400 });
  await env.db
    .prepare("INSERT INTO knowledge_files (id, site_id, name, kind, size, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)")
    .bind(id, siteId, name, kind, bytes.byteLength, now, now)
    .run();
  const ai = aiSettingsFor(site);
  const params: FileParams = { kind: 'file', siteId, fileId: id, options: { embeddingModel: ai.embeddingModel, gateway: ai.gateway } };
  try {
    await env.workflow.create({ id: `file-${id}`, params });
  } catch {
    await env.db.prepare("UPDATE knowledge_files SET status = 'error', error = ? WHERE id = ?").bind('Could not start reading it. Upload it again in a minute.', id).run();
    throw new HelpPuffError('internal', { message: 'The file could not be queued. Try again in a minute.', detail: 'file_workflow_create_failed' });
  }
  return c.json({ id, name, kind, size: bytes.byteLength, status: 'queued' }, 202);
});

knowledgeRoutes.delete('/admin/api/knowledge/files/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const { siteId, env } = await siteOf(c, c.req.query('site'));
  const id = c.req.param('id');
  const removed = await deleteFileChunks(env.db, env.vectors, siteId, id);
  await env.db.prepare('DELETE FROM knowledge_files WHERE id = ? AND site_id = ?').bind(id, siteId).run();
  await env.uploads?.delete(uploadKey(siteId, id));
  return c.json({ deleted: true, chunks: removed });
});

// ------------------------------------------------------------ site facts

knowledgeRoutes.get('/admin/api/knowledge/facts', async (c) => {
  await currentAdmin(c);
  const { siteId, env } = await siteOf(c, c.req.query('site'));
  const facts = await readFacts(env.db, siteId);
  return c.json({ facts: facts.map((f) => ({ key: f.key, value: f.value, source: f.source_url === 'owner' ? 'owner' : f.source_url ? 'crawl' : null, sourceUrl: f.source_url })) });
});

/** The owner confirms or corrects facts; theirs are never overwritten by a crawl. An empty value removes one. */
/** Read the home and contact pages now and fill in the business details (onboarding's first call). */
knowledgeRoutes.post('/admin/api/knowledge/facts/detect', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, site, env, now } = await siteOf(c, body['site']);
  const website = websiteFor(site);
  if (!website) throw new HelpPuffError('bad_request', { message: 'Set the website address first.', detail: 'knowledge_no_website' });
  const ai = aiSettingsFor(site);
  const contactUrl =
    (await env.db.prepare("SELECT url FROM pages WHERE site_id = ? AND category = 'contact' ORDER BY length(url) LIMIT 1").bind(siteId).first<{ url: string }>())?.url ?? null;
  const detected = await detectFacts(
    { db: env.db, ai: env.ai, now: () => now },
    { siteId, website, model: ai.chatModel, gateway: ai.gateway, userAgent: userAgentFor(new URL(c.req.url).origin), contactUrl },
  );
  await addUsage({ db: env.db, now: () => now }, siteId, detected.neurons);
  const facts = await readFacts(env.db, siteId);
  return c.json({ found: detected.found, facts: facts.map((f) => ({ key: f.key, value: f.value, source: f.source_url === 'owner' ? 'owner' : 'site' })) });
});

knowledgeRoutes.put('/admin/api/knowledge/facts', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, site, env, now } = await siteOf(c, body['site']);
  const input = body['facts'] && typeof body['facts'] === 'object' ? (body['facts'] as Record<string, unknown>) : {};
  const set: { key: string; value: string; sourceUrl: string }[] = [];
  const removed: string[] = [];
  for (const key of FACT_KEYS) {
    if (!(key in input)) continue;
    const value = typeof input[key] === 'string' ? (input[key] as string).trim().slice(0, 1000) : '';
    if (value) set.push({ key, value, sourceUrl: 'owner' });
    else removed.push(key);
  }
  await writeFacts(env.db, siteId, set, now);
  for (const key of removed) await env.db.prepare('DELETE FROM site_facts WHERE site_id = ? AND key = ?').bind(siteId, key).run();

  // Re-index the facts passage so answers use the corrected details at once.
  const facts = await readFacts(env.db, siteId);
  const markdown = factsMarkdown(facts);
  const pageId = await pageIdFor(siteId, FACTS_URL);
  if (markdown) {
    const title = facts.find((f) => f.key === 'name')?.value ?? 'Business details';
    await env.db
      .prepare(
        `INSERT INTO pages (id, site_id, url, title, category, status, selected, source, crawled_at) VALUES (?, ?, ?, ?, 'contact', 'indexed', 1, 'facts', ?)
         ON CONFLICT (site_id, url) DO UPDATE SET title = excluded.title, crawled_at = excluded.crawled_at`,
      )
      .bind(pageId, siteId, FACTS_URL, title, now)
      .run();
    await indexDocument({ db: env.db, ai: env.ai, vectors: env.vectors }, { siteId, url: FACTS_URL, title, category: 'contact', markdown }, aiSettingsFor(site));
  } else {
    await deletePageChunks(env.db, env.vectors, siteId, pageId);
  }
  return c.json({ facts: facts.map((f) => ({ key: f.key, value: f.value })) });
});

/**
 * "Is the widget on my site yet?" — fetch the site's home page and look for
 * the loader with this site's id. Best effort: a page that adds it with a
 * tag manager will not show it in its HTML.
 */
knowledgeRoutes.get('/admin/api/install-check', async (c) => {
  await currentAdmin(c);
  const ctx = c.get('helppuff');
  const siteId = siteParam(c, c.req.query('site'));
  const site = await resolveSite(ctx, siteId);
  const target = c.req.query('url') || site.knowledge.website || site.origins.find((o) => /^https:/.test(o) && !/workers\.dev/.test(o));
  if (!target || !/^https?:\/\//.test(target)) throw new HelpPuffError('bad_request', { message: 'Which page should be checked?', detail: 'install_no_url' });
  const page = await fetchPage(target, { timeoutMs: 10_000 });
  if (!page.ok) return c.json({ url: target, installed: false, reachable: false, reason: page.error });
  const origin = new URL(c.req.url).origin;
  const loader = page.html.includes(`${origin}/loader.js`) || /\/loader\.js["'][^>]*data-site/.test(page.html);
  const siteMatch = new RegExp(`data-site=["']${siteId}["']`).test(page.html);
  return c.json({
    url: page.finalUrl,
    reachable: true,
    installed: loader && siteMatch,
    reason: loader && siteMatch ? null : loader ? 'The loader is there, but with a different data-site.' : 'The snippet is not in the page’s HTML.',
  });
});

/**
 * Starter questions for the widget, written from what the crawl learned:
 * the section headings and the business facts, given to the
 * site's own model. About ten neurons. Falls back to plain defaults when the
 * model is unavailable or the knowledge base is still empty.
 */
knowledgeRoutes.post('/admin/api/knowledge/suggest-questions', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, site, env } = await siteOf(c, body['site']);
  const headings = (
    await env.db
      .prepare(
        `SELECT heading_path AS h, category FROM chunks WHERE site_id = ? AND url NOT LIKE 'helppuff://%'
         GROUP BY heading_path ORDER BY CASE category WHEN 'service' THEN 0 WHEN 'faq' THEN 1 WHEN 'pricing' THEN 2 WHEN 'location' THEN 3 ELSE 4 END LIMIT 60`,
      )
      .bind(siteId)
      .all<{ h: string; category: string }>()
  ).results.map((r) => r.h);
  const facts = await readFacts(env.db, siteId);
  const fallback = ['What services do you offer?', 'How much does it cost?', 'Which areas do you cover?', 'How do I book?'];
  if (!headings.length) return c.json({ questions: fallback, source: 'default' });

  const options = (site.connector.options ?? {}) as { model?: unknown; gateway?: unknown };
  const model = typeof options.model === 'string' ? options.model : '@cf/zai-org/glm-4.7-flash';
  try {
    const result = (await env.ai.run(
      model,
      {
        messages: [
          {
            role: 'system',
            content:
              'You write the suggested questions shown on a small business website chat. Reply with a JSON array of exactly 4 strings and nothing else. Each is a question a real customer would ask, at most 8 words, answerable from the sections listed. No numbering.',
          },
          {
            role: 'user',
            content: `Business: ${facts.find((f) => f.key === 'name')?.value ?? site.widget.brand.name}\nSections of the website:\n${headings.slice(0, 50).join('\n')}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.4,
        ...reasoningInputs(model, 'off'),
      },
      typeof options.gateway === 'string' ? { gateway: { id: options.gateway } } : undefined,
    )) as { choices?: { message?: { content?: string } }[]; response?: string };
    const text = result.choices?.[0]?.message?.content ?? result.response ?? '';
    const parsed = JSON.parse(/\[[\s\S]*\]/.exec(text)?.[0] ?? '[]') as unknown;
    const questions = Array.isArray(parsed)
      ? parsed.filter((q): q is string => typeof q === 'string' && q.trim().length > 3).map((q) => q.trim().slice(0, 80)).slice(0, 4)
      : [];
    if (questions.length >= 2) return c.json({ questions, source: 'model' });
  } catch {
    // The defaults below are always acceptable.
  }
  return c.json({ questions: fallback, source: 'default' });
});

/**
 * How fast the models answer from this Worker, right now: each candidate
 * embedding model twice (the second is the warm number), the reranker at
 * two sizes, and the chat model's time to first token. A few neurons; what
 * `helppuff doctor --speed` reads to pick models by data, not by guess.
 */
knowledgeRoutes.post('/admin/api/diagnostics/models', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const { site, env } = await siteOf(c, body['site']);
  const query = typeof body['query'] === 'string' && body['query'].trim() ? body['query'].trim().slice(0, 300) : 'Do you offer free quotes?';
  const timed = async (work: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      await work();
      return Date.now() - started;
    } catch (thrown) {
      return `error: ${String((thrown as Error)?.message ?? thrown).slice(0, 80)}`;
    }
  };
  const embedding: Record<string, (number | string)[]> = {};
  for (const model of ['@cf/qwen/qwen3-embedding-0.6b', '@cf/baai/bge-m3', '@cf/baai/bge-base-en-v1.5', '@cf/baai/bge-small-en-v1.5', '@cf/baai/bge-large-en-v1.5']) {
    const input = model.includes('qwen') ? { queries: [query] } : { text: [query] };
    embedding[model] = [await timed(() => env.ai.run(model, input)), await timed(() => env.ai.run(model, input))];
  }
  const passages = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Passage ${i}. We supply and install hybrid, laminate and timber flooring, with free measure and quote. `.repeat(8) }));
  const rerank = {
    '20 passages': [await timed(() => env.ai.run('@cf/baai/bge-reranker-base', { query, contexts: passages(20) })), await timed(() => env.ai.run('@cf/baai/bge-reranker-base', { query, contexts: passages(20) }))],
    '10 passages': [await timed(() => env.ai.run('@cf/baai/bge-reranker-base', { query, contexts: passages(10) }))],
  };
  const chatModel = aiSettingsFor(site).chatModel;
  let firstToken: number | string;
  const started = Date.now();
  try {
    const stream = (await env.ai.run(chatModel, {
      messages: [{ role: 'user', content: query }],
      max_tokens: 20,
      stream: true,
      ...reasoningInputs(chatModel, 'off'),
    })) as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    await reader.read();
    firstToken = Date.now() - started;
    await reader.cancel();
  } catch (thrown) {
    firstToken = `error: ${String((thrown as Error)?.message ?? thrown).slice(0, 80)}`;
  }
  return c.json({ embedding, rerank, chat: { model: chatModel, firstTokenMs: firstToken } });
});
