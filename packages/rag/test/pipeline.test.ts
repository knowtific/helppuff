import { describe, expect, it } from 'vitest';
import { discover } from '../src/discover.js';
import { runCrawlPart, type CrawlParams } from '../src/crawl.js';
import { queueRun, readFacts, recordDiscovered } from '../src/store.js';
import { DEFAULT_RETRIEVAL, retrieve, rrf, standaloneQuery, subQueries } from '../src/retrieve.js';
import { neurons, usageDay } from '../src/pricing.js';
import { fakeAi, fakeVectors, inlineSteps, site, sqliteD1 } from './helpers.js';

const shell = (title: string, body: string) => `<!doctype html><html><head><title>${title} | Acme Plumbing</title></head><body>
<header><nav><a href="/">Home</a> <a href="/services/hot-water">Hot water</a> <a href="/contact">Contact</a> <a href="/faq">FAQ</a> <a href="/privacy">Privacy</a></nav></header>
<main>${body}<p>Licensed plumbers serving the Yarra Valley since 1990, fully insured.</p></main>
<footer><a href="tel:0398765432">03 9876 5432</a></footer></body></html>`;

const PAGES: Record<string, string | number> = {
  '/robots.txt': 'User-agent: *\nDisallow: /secret\nSitemap: https://acme.test/sitemap.xml',
  '/sitemap.xml': `<urlset><url><loc>https://acme.test/</loc></url><url><loc>https://acme.test/services/hot-water</loc></url>
    <url><loc>https://acme.test/contact</loc></url><url><loc>https://acme.test/faq</loc></url><url><loc>https://acme.test/privacy</loc></url>
    <url><loc>https://acme.test/secret/plans</loc></url><url><loc>https://acme.test/gone</loc></url></urlset>`,
  '/': shell('Home', '<h1>Plumbers in Lilydale</h1><p>Emergency plumbing, gas fitting and hot water across the Yarra Valley.</p>'),
  '/services/hot-water': shell(
    'Hot water',
    '<h1>Hot water repairs</h1><p>We repair and replace Rinnai, Rheem and Dux hot water systems, gas and electric, usually same day.</p><h2>Prices</h2><table><tr><th>Job</th><th>From</th></tr><tr><td>Service call</td><td>$99</td></tr><tr><td>New system installed</td><td>$1,450</td></tr></table>',
  ),
  '/contact': shell('Contact', '<h1>Contact us</h1><p>Office open Monday to Friday 7am to 5pm. Email hello@acme.test for quotes.</p>'),
  '/faq': shell(
    'FAQ',
    '<h1>Questions</h1><details><summary>Do you service Mooroolbark?</summary><p>Yes, we cover Mooroolbark, Montrose and Kilsyth.</p></details><details><summary>Do you charge a call-out fee?</summary><p>No call-out fee on weekdays.</p></details>',
  ),
  '/privacy': shell('Privacy', '<h1>Privacy</h1><p>We keep your details private.</p>'),
  '/gone': 404,
};

async function crawled() {
  const db = sqliteD1();
  const ai = fakeAi();
  const vectors = fakeVectors();
  const fetch = site(PAGES);
  const found = await discover('https://acme.test', { fetch });
  await recordDiscovered(db, 'acme', found.urls);
  const selected = found.urls.filter((u) => u.suggested);
  await db.prepare("INSERT INTO crawl_runs (id, site_id, status, started_at) VALUES ('run1', 'acme', 'queued', 1)").run();
  await queueRun(db, 'acme', 'run1', selected);

  const params: CrawlParams = { siteId: 'acme', runId: 'run1', part: 0, options: { embeddingModel: DEFAULT_RETRIEVAL.embeddingModel, batchSize: 2 } };
  const steps = inlineSteps();
  const queue: CrawlParams[] = [params];
  let parts = 0;
  while (queue.length) {
    const next = queue.shift()!;
    parts++;
    await runCrawlPart(steps, { db, ai, vectors, fetch, now: () => Date.UTC(2026, 9, 4), startNext: async (p) => void queue.push(p) }, next);
  }
  return { db, ai, vectors, found, steps, parts, fetch };
}

describe('discover', () => {
  it('lists pages from the sitemap and links, honours robots.txt and pre-ticks the useful ones', async () => {
    const found = await discover('https://acme.test', { fetch: site(PAGES) });
    const byUrl = Object.fromEntries(found.urls.map((u) => [u.url, u]));
    expect(found.urls[0]).toMatchObject({ url: 'https://acme.test/', source: 'home', category: 'home' });
    expect(byUrl['https://acme.test/services/hot-water']).toMatchObject({ category: 'service', suggested: true, source: 'sitemap' });
    expect(byUrl['https://acme.test/privacy']).toMatchObject({ category: 'legal', suggested: false });
    expect(byUrl['https://acme.test/secret/plans']).toBeUndefined();
    expect(found.sitemaps).toEqual(['https://acme.test/sitemap.xml']);
    expect(found.warnings).toEqual([]);
  });

  it('warns, rather than fails, when the site blocks bots', async () => {
    const found = await discover('https://acme.test', { fetch: site({ '/': 403 }) });
    expect(found.reachable).toBe(false);
    expect(found.warnings.join(' ')).toMatch(/refused our crawler/);
  });
});

describe('crawl', () => {
  it('indexes every selected page, in chained batches, and records what happened', async () => {
    const { db, parts, vectors } = await crawled();
    expect(parts).toBeGreaterThan(1);
    const pages = db.raw.prepare("SELECT url, status, category, http_status FROM pages WHERE site_id = 'acme' AND source != 'facts' ORDER BY url").all();
    expect(pages).toEqual([
      { url: 'https://acme.test/', status: 'indexed', category: 'home', http_status: 200 },
      { url: 'https://acme.test/contact', status: 'indexed', category: 'contact', http_status: 200 },
      { url: 'https://acme.test/faq', status: 'indexed', category: 'faq', http_status: 200 },
      { url: 'https://acme.test/gone', status: 'error', category: 'other', http_status: 404 },
      { url: 'https://acme.test/privacy', status: 'discovered', category: 'legal', http_status: null },
      { url: 'https://acme.test/services/hot-water', status: 'indexed', category: 'service', http_status: 200 },
    ]);
    const run = db.raw.prepare("SELECT status, total, done, failed, chunks FROM crawl_runs WHERE id = 'run1'").get() as Record<string, number | string>;
    expect(run).toMatchObject({ status: 'done', total: 5, done: 4, failed: 1 });
    const chunkCount = (db.raw.prepare('SELECT count(*) AS n FROM chunks').get() as { n: number }).n;
    expect(run['chunks']).toBe(chunkCount);
    expect(vectors.store.size).toBe(chunkCount);
    // The sentence on every page is boilerplate: stored once at most, not five times.
    const repeated = (db.raw.prepare("SELECT count(*) AS n FROM chunks WHERE content LIKE '%Licensed plumbers serving%'").get() as { n: number }).n;
    expect(repeated).toBeLessThanOrEqual(1);
  });

  it('learns site facts and indexes them as their own passage', async () => {
    const { db } = await crawled();
    const facts = Object.fromEntries((await readFacts(db, 'acme')).map((f) => [f.key, f.value]));
    expect(facts['phone']).toBe('03 9876 5432');
    const factsChunk = db.raw.prepare("SELECT content FROM chunks WHERE url = 'helppuff://facts'").get() as { content: string };
    expect(factsChunk.content).toContain('Phone: 03 9876 5432');
  });

  it('skips re-embedding pages that did not change', async () => {
    const { db, ai, vectors, fetch } = await crawled();
    const embeds = () => ai.calls.filter((c) => 'documents' in c.inputs || ('text' in c.inputs && Array.isArray(c.inputs['text']) && (c.inputs['text'] as string[]).some((t) => t.startsWith('Page:')))).length;
    const embedCalls = embeds();
    await db.prepare("INSERT INTO crawl_runs (id, site_id, status, started_at) VALUES ('run2', 'acme', 'queued', 2)").run();
    const urls = db.raw.prepare("SELECT url, category FROM pages WHERE site_id = 'acme' AND selected = 1 AND source != 'facts'").all() as { url: string; category: string }[];
    await queueRun(db, 'acme', 'run2', urls);
    const queue: CrawlParams[] = [{ siteId: 'acme', runId: 'run2', part: 0, options: { embeddingModel: DEFAULT_RETRIEVAL.embeddingModel } }];
    while (queue.length) await runCrawlPart(inlineSteps(), { db, ai, vectors, fetch, startNext: async (p) => void queue.push(p) }, queue.shift()!);
    const statuses = db.raw.prepare("SELECT DISTINCT status FROM pages WHERE run_id = 'run2' AND http_status = 200").all();
    expect(statuses).toEqual([{ status: 'unchanged' }]);
    // Only the facts passage is embedded again.
    expect(embeds()).toBe(embedCalls + 1);
  });

  it('removes pages that were unticked on the next crawl', async () => {
    const { db, ai, vectors, fetch } = await crawled();
    await db.prepare("INSERT INTO crawl_runs (id, site_id, status, started_at) VALUES ('run3', 'acme', 'queued', 3)").run();
    await queueRun(db, 'acme', 'run3', [{ url: 'https://acme.test/contact', category: 'contact' }]);
    const queue: CrawlParams[] = [{ siteId: 'acme', runId: 'run3', part: 0, options: { embeddingModel: DEFAULT_RETRIEVAL.embeddingModel } }];
    while (queue.length) await runCrawlPart(inlineSteps(), { db, ai, vectors, fetch, startNext: async (p) => void queue.push(p) }, queue.shift()!);
    const urls = (db.raw.prepare('SELECT DISTINCT url FROM chunks ORDER BY url').all() as { url: string }[]).map((r) => r.url);
    expect(urls).toEqual(['helppuff://facts', 'https://acme.test/contact']);
    expect(vectors.store.size).toBe((db.raw.prepare('SELECT count(*) AS n FROM chunks').get() as { n: number }).n);
  });

  it('stops when the run is cancelled', async () => {
    const db = sqliteD1();
    await db.prepare("INSERT INTO crawl_runs (id, site_id, status, started_at) VALUES ('r', 'acme', 'cancelled', 1)").run();
    await queueRun(db, 'acme', 'r', [{ url: 'https://acme.test/', category: 'home' }]);
    const steps = inlineSteps();
    await runCrawlPart(steps, { db, ai: fakeAi(), vectors: fakeVectors(), fetch: site(PAGES), startNext: async () => {} }, {
      siteId: 'acme',
      runId: 'r',
      part: 1,
      options: { embeddingModel: 'm' },
    });
    expect(steps.names).toEqual(['load']);
  });

  it('records the embedding cost against today’s budget', async () => {
    const { db } = await crawled();
    const usage = db.raw.prepare('SELECT day, neurons_est FROM usage_daily').get() as { day: string; neurons_est: number };
    expect(usage.day).toBe(usageDay(Date.UTC(2026, 9, 4)));
    expect(usage.neurons_est).toBeGreaterThan(0);
  });
});

describe('retrieve', () => {
  it('finds the passage that answers, with its source', async () => {
    const { db, ai, vectors } = await crawled();
    const result = await retrieve({ db, ai, vectors }, 'acme', 'Do you service Mooroolbark?');
    expect(result.chunks[0]).toMatchObject({ url: 'https://acme.test/faq' });
    expect(result.chunks[0]!.content).toContain('Mooroolbark, Montrose and Kilsyth');
    expect(result.trace.reranked).toBe(true);
    expect(result.neurons).toBeGreaterThan(0);
  });

  it('answers pricing questions from the table', async () => {
    const { db, ai, vectors } = await crawled();
    const result = await retrieve({ db, ai, vectors }, 'acme', 'how much to install a new hot water system');
    expect(result.chunks.map((c) => c.url)).toContain('https://acme.test/services/hot-water');
    expect(result.chunks.find((c) => c.url.endsWith('hot-water'))!.content).toContain('$1,450');
  });

  it('finds the question inside a long message, by searching its sentences too', async () => {
    const { db, ai, vectors } = await crawled();
    const message = 'My partner and I just bought an older weatherboard house near the station with three bedrooms and a garden shed. Does anyone do Mooroolbark?';
    const result = await retrieve({ db, ai, vectors }, 'acme', message);
    expect(result.trace.parts).toBe(2);
    expect(result.chunks[0]?.content).toContain('Mooroolbark, Montrose and Kilsyth');
  });

  it('returns nothing when nothing is relevant', async () => {
    const { db, ai, vectors } = await crawled();
    const result = await retrieve({ db, ai, vectors }, 'acme', 'quantum chromodynamics lecture notes');
    expect(result.chunks).toEqual([]);
  });

  it('still works on keywords alone when the reranker and vectors fail', async () => {
    const { db } = await crawled();
    const ai = fakeAi({ failRerank: true });
    const result = await retrieve({ db, ai, vectors: null }, 'acme', 'Rinnai hot water');
    expect(result.chunks[0]!.url).toBe('https://acme.test/services/hot-water');
    expect(result.trace.reranked).toBe(false);
    expect(result.trace.errors).toEqual(['rerank: reranker down']);
  });
});

describe('helpers', () => {
  it('builds a standalone query for elliptical follow-ups only', () => {
    expect(standaloneQuery('how much is it?', ['Do you install Rinnai hot water?'])).toBe('Do you install Rinnai hot water? how much is it?');
    expect(standaloneQuery('What are your opening hours on public holidays?', ['Do you install Rinnai?'])).toBe(
      'What are your opening hours on public holidays?',
    );
    expect(standaloneQuery('hi there', [])).toBe('hi there');
  });

  it('splits only long messages into sentences to search', () => {
    expect(subQueries('Do you service Mooroolbark?')).toEqual([]);
    expect(subQueries('My living room is 4m x 5m and my bedroom is 3m x 3.5m. Roughly what would installation cost for both?')).toEqual([
      'My living room is 4m x 5m and my bedroom is 3m x 3.5m.',
      'Roughly what would installation cost for both?',
    ]);
  });

  it('fuses rankings with RRF', () => {
    const scores = rrf([
      ['a', 'b', 'c'],
      ['c', 'a'],
    ]);
    expect([...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id)).toEqual(['a', 'c', 'b']);
  });

  it('prices calls in neurons', () => {
    expect(neurons('@cf/zai-org/glm-4.7-flash', 4000, 250)).toBeCloseTo(31.1, 1);
    expect(neurons('@cf/unknown/model', 1_000_000)).toBe(40_000);
  });
});

describe('intent model', () => {
  it('adds the categories Clef picks to the boost, and survives it failing', async () => {
    const { classifyIntent } = await import('../src/ai.js');
    const ai = {
      run: async (_m: string, inputs: Record<string, unknown>) => {
        expect(inputs).toMatchObject({ model: 'clef-flash', questions: { intent: { type: 'choice' } } });
        return { answers: { intent: { choice: 'contact', probabilities: { contact: 0.7, location: 0.32, general: 0.9, pricing: 0.01 }, confidence: 0.8 } } };
      },
    };
    expect((await classifyIntent(ai, '@cf/cloudflare/clef-flash', 'where are you')).categories).toEqual(['contact', 'location']);

    const { db, vectors } = await crawled();
    const failing = fakeAi();
    const run = failing.run.bind(failing);
    failing.run = async (model, inputs, o) => (model.includes('clef') ? Promise.reject(new Error('no clef')) : run(model, inputs, o));
    const result = await retrieve({ db, ai: failing, vectors }, 'acme', 'Do you service Mooroolbark?', { ...DEFAULT_RETRIEVAL, intentModel: '@cf/cloudflare/clef-flash' });
    expect(result.chunks[0]!.url).toBe('https://acme.test/faq');
    expect(result.trace.errors).toEqual(['intent: no clef']);
  });
});

describe('early embedding', () => {
  it('reuses an embedding started before the conversation loaded, when the query is that text', async () => {
    const { db, vectors, ai } = await crawled();
    const { embedQuery } = await import('../src/ai.js');
    const before = ai.calls.length;
    const embedding = embedQuery(ai, DEFAULT_RETRIEVAL.embeddingModel, 'Do you service Mooroolbark?');
    await retrieve({ db, ai, vectors }, 'acme', 'Do you service Mooroolbark?', { ...DEFAULT_RETRIEVAL, precomputed: { text: 'Do you service Mooroolbark?', embedding } });
    const embedsAfter = ai.calls.slice(before).filter((c) => 'text' in c.inputs || 'queries' in c.inputs).length;
    expect(embedsAfter).toBe(1);
    // A follow-up searched with the previous question is embedded afresh.
    const stale = embedQuery(ai, DEFAULT_RETRIEVAL.embeddingModel, 'how much?');
    const n = ai.calls.length;
    await retrieve({ db, ai, vectors }, 'acme', 'Hot water? how much?', { ...DEFAULT_RETRIEVAL, precomputed: { text: 'how much?', embedding: stale } });
    expect(ai.calls.slice(n).filter((c) => 'text' in c.inputs).length).toBe(1);
  });
});

describe('time budgets', () => {
  it('answers from the fused order when the reranker is slow, and from keywords when embedding is', async () => {
    const { db, vectors } = await crawled();
    const slow = fakeAi();
    const run = slow.run.bind(slow);
    slow.run = async (model, inputs, o) => {
      if ('contexts' in inputs || 'text' in inputs) await new Promise((r) => setTimeout(r, 200));
      return run(model, inputs, o);
    };
    const result = await retrieve({ db, ai: slow, vectors }, 'acme', 'Rinnai hot water', { ...DEFAULT_RETRIEVAL, rerankTimeoutMs: 50, embedTimeoutMs: 50 });
    expect(result.trace.reranked).toBe(false);
    expect(result.trace.errors).toEqual(['vector: embedding timed out', 'rerank: rerank timed out']);
    expect(result.chunks[0]!.url).toBe('https://acme.test/services/hot-water');
  });
});

describe('Clef as the reranker', () => {
  it('asks one yes/no question per passage in a single call and uses the probabilities as scores', async () => {
    const { rerank } = await import('../src/ai.js');
    const calls: Record<string, unknown>[] = [];
    const ai = {
      run: async (_m: string, inputs: Record<string, unknown>) => {
        calls.push(inputs);
        return { answers: { p0: { type: 'noul', noul: 0.1 }, p1: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 1000, output_tokens: 0 } };
      },
    };
    const result = await rerank(ai, '@cf/cloudflare/clef-flash', 'do you sell carpet?', ['Hybrid only.', 'We do not sell carpet.']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: 'clef-flash', state: { visitorQuestion: 'do you sell carpet?', passages: { p1: 'We do not sell carpet.' } }, questions: { p0: { type: 'noul' }, p1: { type: 'noul' } } });
    expect(result.scores).toEqual([0.1, 0.9]);
    expect(result.neurons).toBeCloseTo(neurons('@cf/cloudflare/clef-flash', 1000));

    // Jev takes the same questions through the same binding, without Clef's size selector.
    await rerank(ai, 'typesafe/jev', 'do you sell carpet?', ['Hybrid only.', 'We do not sell carpet.']);
    expect(calls[1]).not.toHaveProperty('model');
    expect(calls[1]).toMatchObject({ questions: { p0: { type: 'noul' }, p1: { type: 'noul' } } });
  });
});
