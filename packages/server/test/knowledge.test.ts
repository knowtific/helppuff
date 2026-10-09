import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCrawlPart, runFileJob, uploadKey, type CrawlParams, type FileParams } from '@helppuff/rag';
import { defineConfig } from '../src/config/load.js';
import { resetSchemaMemo } from '../src/db/d1.js';
import { memoryKv } from '../src/core/platform.js';
import { siteConfigKey } from '../src/config/site.js';
import { applySettings } from '../src/admin/settings.js';
import { harness, ORIGIN, SECRET, startSession, withForms, type Harness } from './helpers.js';
import { fakeAi, fakeVectors, inlineSteps, site as fakeSite, sqliteD1 } from '../../rag/test/helpers.js';

const API_KEY = 'k'.repeat(40);
const ADMIN = 'http://server.test';

const PAGES: Record<string, string | number> = {
  '/robots.txt': 'User-agent: *\nSitemap: https://acme.test/sitemap.xml',
  '/sitemap.xml': '<urlset><url><loc>https://acme.test/</loc></url><url><loc>https://acme.test/faq</loc></url><url><loc>https://acme.test/privacy</loc></url></urlset>',
  '/': '<html><head><title>Acme Plumbing</title></head><body><main><h1>Plumbers in Lilydale</h1><p>Emergency plumbing and hot water across the Yarra Valley, seven days.</p><a href="tel:0398765432">03 9876 5432</a></main></body></html>',
  '/faq': '<html><head><title>FAQ | Acme</title></head><body><main><h1>FAQ</h1><details><summary>Do you service Mooroolbark?</summary><p>Yes, Mooroolbark and Montrose.</p></details></main></body></html>',
  '/privacy': '<html><head><title>Privacy</title></head><body><main><h1>Privacy</h1><p>Your data is safe with us, always and forever.</p></main></body></html>',
};

function config() {
  return defineConfig({
    sites: {
      acme: {
        origins: [ORIGIN],
        connector: { type: 'workers-ai', options: { instructions: 'You help Acme.', business: { name: 'Acme Plumbing' } } },
        knowledge: { website: 'https://acme.test' },
      },
    },
  });
}

type World = {
  api: Harness;
  browser: Harness;
  db: ReturnType<typeof sqliteD1>;
  kv: ReturnType<typeof memoryKv>;
  created: { id?: string; params: CrawlParams }[];
  settle: () => Promise<void>;
  /** Run every Workflow instance the API started, as Cloudflare would. */
  runWorkflows: () => Promise<void>;
};

function world(env: Record<string, unknown> = {}): World {
  resetSchemaMemo();
  const db = sqliteD1();
  const kv = memoryKv();
  const ai = fakeAi();
  const vectors = fakeVectors();
  const created: { id?: string; params: CrawlParams }[] = [];
  const pending: Promise<unknown>[] = [];
  const bindings = {
    HELPPUFF_SECRET: SECRET,
    HELPPUFF_KV: kv,
    HELPPUFF_DB: db,
    AI: ai,
    VECTORS: vectors,
    CRAWL_WORKFLOW: { create: async (o: { id?: string; params: CrawlParams }) => void created.push(o) },
    ADMIN_API_KEY: API_KEY,
    ...env,
  };
  const api = harness(config(), bindings, null, (p) => pending.push(p));
  const browser = harness(config(), bindings, ORIGIN, (p) => pending.push(p));
  return {
    api,
    browser,
    db,
    kv,
    created,
    settle: async () => void (await Promise.all(pending.splice(0))),
    runWorkflows: async () => {
      while (created.length) {
        const next = created.shift()!;
        await runCrawlPart(inlineSteps(), { db, ai, vectors, fetch: globalThis.fetch, startNext: async (params) => void created.push({ params }) }, next.params);
      }
    },
  };
}

const auth = { Authorization: `Bearer ${API_KEY}` };
const get = (h: Harness, path: string) => h.fetch(path, { headers: auth });
const send = (h: Harness, method: string, path: string, body: unknown) =>
  h.fetch(path, { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubGlobal('fetch', fakeSite(PAGES));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('admin API key', () => {
  it('lets the CLI in with the key and nobody in without it', async () => {
    const w = world();
    expect((await w.api.fetch('/admin/api/knowledge/status')).status).toBe(401);
    expect((await w.api.fetch('/admin/api/knowledge/status', { headers: { Authorization: `Bearer ${'x'.repeat(40)}` } })).status).toBe(401);
    expect((await get(w.api, '/admin/api/knowledge/status')).status).toBe(200);
  });

  it('is off when the key is unset or too short', async () => {
    const w = world({ ADMIN_API_KEY: 'short' });
    expect((await w.api.fetch('/admin/api/knowledge/status', { headers: { Authorization: 'Bearer short' } })).status).toBe(401);
  });
});

describe('knowledge', () => {
  it('discovers pages, crawls the selected ones in the background, and reports progress', async () => {
    const w = world();
    const found = (await (await send(w.api, 'POST', '/admin/api/knowledge/discover', {})).json()) as { urls: { url: string; selected: boolean; category: string }[] };
    expect(found.urls.map((u) => [u.url, u.selected])).toEqual([
      ['https://acme.test/', true],
      ['https://acme.test/faq', true],
      ['https://acme.test/privacy', false],
    ]);

    const started = await send(w.api, 'POST', '/admin/api/knowledge/crawl', {});
    expect(started.status).toBe(202);
    const { runId, total } = (await started.json()) as { runId: string; total: number };
    expect(total).toBe(2);
    expect(w.created[0]).toMatchObject({ id: `${runId}-0`, params: { siteId: 'acme', runId, part: 0, options: { embeddingModel: '@cf/baai/bge-m3' } } });

    const before = (await (await get(w.api, '/admin/api/knowledge/status')).json()) as { run: { status: string; done: number } };
    expect(before.run).toMatchObject({ status: 'queued', done: 0 });

    await w.runWorkflows();
    const after = (await (await get(w.api, '/admin/api/knowledge/status')).json()) as {
      run: { status: string; done: number; trigger: string };
      chunks: number;
      pages: Record<string, number>;
      usage: { neurons: number; state: string };
    };
    expect(after.run).toMatchObject({ status: 'done', done: 2, trigger: 'cli' });
    expect(after.pages).toMatchObject({ indexed: 2, discovered: 1 });
    expect(after.chunks).toBeGreaterThan(1);
    expect(after.usage.state).toBe('ok');

    const search = (await (await send(w.api, 'POST', '/admin/api/knowledge/search', { query: 'Do you service Mooroolbark?' })).json()) as { chunks: { url: string }[] };
    expect(search.chunks[0]!.url).toBe('https://acme.test/faq');

    const pages = (await (await get(w.api, '/admin/api/knowledge/pages')).json()) as { pages: { id: string; url: string; chunks: number }[] };
    const faq = pages.pages.find((p) => p.url === 'https://acme.test/faq')!;
    const chunks = (await (await get(w.api, `/admin/api/knowledge/pages/${faq.id}/chunks`)).json()) as { chunks: { content: string }[] };
    expect(chunks.chunks[0]!.content).toContain('Mooroolbark and Montrose');
  });

  it('crawls exactly the pages asked for, and a new crawl supersedes a running one', async () => {
    const w = world();
    const first = (await (await send(w.api, 'POST', '/admin/api/knowledge/crawl', { urls: ['https://acme.test/faq', 'https://elsewhere.test/x'] })).json()) as { runId: string; total: number };
    expect(first.total).toBe(1);
    await send(w.api, 'POST', '/admin/api/knowledge/crawl', { urls: ['https://acme.test/'] });
    const runs = w.db.raw.prepare('SELECT id, status FROM crawl_runs ORDER BY started_at').all() as { id: string; status: string }[];
    expect(runs.find((r) => r.id === first.runId)!.status).toBe('cancelled');
  });

  it('tries failed pages again by hand, without unticking the rest', async () => {
    const w = world();
    const healthy = fakeSite(PAGES);
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/faq')) throw new Error('Too many subrequests.');
      return healthy(input, init);
    }) as typeof fetch);
    await send(w.api, 'POST', '/admin/api/knowledge/discover', {});
    await send(w.api, 'POST', '/admin/api/knowledge/crawl', {});
    await w.runWorkflows();
    const statusOf = (url: string) => w.db.raw.prepare('SELECT status, selected FROM pages WHERE url = ?').get(url) as { status: string; selected: number };
    expect(statusOf('https://acme.test/faq')).toEqual({ status: 'error', selected: 1 });

    vi.stubGlobal('fetch', healthy);
    const retried = await send(w.api, 'POST', '/admin/api/knowledge/crawl/retry', {});
    expect(retried.status).toBe(202);
    const { runId, total } = (await retried.json()) as { runId: string; total: number };
    expect(total).toBe(1);
    // Past the first part: robots.txt and the furniture come from the last run.
    expect(w.created[0]).toMatchObject({ id: `${runId}-1`, params: { runId, part: 1 } });
    expect((await send(w.api, 'POST', '/admin/api/knowledge/crawl/retry', {})).status).toBe(409);
    await w.runWorkflows();

    expect(statusOf('https://acme.test/faq')).toEqual({ status: 'indexed', selected: 1 });
    expect(statusOf('https://acme.test/')).toEqual({ status: 'indexed', selected: 1 });
    const search = (await (await send(w.api, 'POST', '/admin/api/knowledge/search', { query: 'Do you service Mooroolbark?' })).json()) as { chunks: { url: string }[] };
    expect(search.chunks.map((c) => c.url)).toContain('https://acme.test/faq');
    expect((await send(w.api, 'POST', '/admin/api/knowledge/crawl/retry', {})).status).toBe(400);
  });

  it('refuses addresses from another site', async () => {
    const w = world();
    const response = await send(w.api, 'POST', '/admin/api/knowledge/crawl', { urls: ['https://elsewhere.test/'] });
    expect(response.status).toBe(400);
  });

  it('cancels a run', async () => {
    const w = world();
    const { runId } = (await (await send(w.api, 'POST', '/admin/api/knowledge/crawl', { urls: ['https://acme.test/faq'] })).json()) as { runId: string };
    const response = await send(w.api, 'POST', `/admin/api/knowledge/runs/${runId}/cancel`, {});
    expect(await response.json()).toEqual({ cancelled: true });
    await w.runWorkflows();
    expect(w.db.raw.prepare('SELECT count(*) AS n FROM chunks').get()).toEqual({ n: 0 });
  });

  it('adds hand-written knowledge, searchable at once, and removes it', async () => {
    const w = world();
    const added = (await (await send(w.api, 'POST', '/admin/api/knowledge/manual', { title: 'Warranty', content: 'All Rinnai installs carry a 5 year warranty.' })).json()) as { id: string; chunks: number };
    expect(added.chunks).toBe(1);
    const search = (await (await send(w.api, 'POST', '/admin/api/knowledge/search', { query: 'warranty on Rinnai installs' })).json()) as { chunks: { content: string }[] };
    expect(search.chunks[0]!.content).toContain('5 year warranty');
    await send(w.api, 'DELETE', `/admin/api/knowledge/manual/${added.id}`, {});
    expect(w.db.raw.prepare('SELECT count(*) AS n FROM chunks').get()).toEqual({ n: 0 });
  });

  it('keeps the owner’s corrected facts and re-indexes them', async () => {
    const w = world();
    await send(w.api, 'PUT', '/admin/api/knowledge/facts', { facts: { phone: '1300 000 000', email: '' } });
    const facts = (await (await get(w.api, '/admin/api/knowledge/facts')).json()) as { facts: { key: string; value: string; source: string }[] };
    expect(facts.facts).toEqual([{ key: 'phone', value: '1300 000 000', source: 'owner', sourceUrl: 'owner' }]);
    const passage = w.db.raw.prepare("SELECT content FROM chunks WHERE url = 'helppuff://facts'").get() as { content: string };
    expect(passage.content).toContain('Phone: 1300 000 000');
  });

  it('explains when the deployment has no knowledge base', async () => {
    const w = world({ VECTORS: undefined });
    const response = await get(w.api, '/admin/api/knowledge/status');
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/no knowledge base/);
  });
});

describe('settings', () => {
  it('reads the assistant’s settings as one object and saves a change to KV', async () => {
    const w = world();
    const read = (await (await get(w.api, '/admin/api/settings')).json()) as { settings: Record<string, unknown> };
    expect(read.settings).toMatchObject({ botName: 'Assistant', assistant: { model: '@cf/zai-org/glm-4.7-flash', timezone: null }, crawl: { schedule: 'weekly' } });

    const saved = await send(w.api, 'PUT', '/admin/api/settings', {
      settings: {
        botName: 'Ava',
        starterQuestions: ['Do you service my suburb?', 'How do I book?'],
        accent: '#0f766e',
        welcomeMessage: 'Hi! Ask me about our services.',
        assistant: { timezone: 'Australia/Melbourne' },
        crawl: { schedule: 'daily' },
      },
    });
    expect(saved.status).toBe(200);
    const stored = JSON.parse((await w.kv.get(siteConfigKey('acme')))!) as {
      widget: { brand: { agentName: string; accent: string }; home: { shortcuts: { label: string }[] }; chat: { initialMessages: string[] } };
      connector: { options: { business: { name: string }; timezone: string; instructions: string } };
      knowledge: { schedule: string };
      settings: { by: string; hash: string };
    };
    expect(stored.widget.brand).toMatchObject({ agentName: 'Ava', accent: '#0f766e' });
    expect(stored.widget.home.shortcuts.map((s) => s.label)).toEqual(['Do you service my suburb?', 'How do I book?']);
    expect(stored.widget.chat.initialMessages).toEqual(['Hi! Ask me about our services.']);
    // Options the settings do not cover are kept as they were.
    expect(stored.connector.options).toMatchObject({ business: { name: 'Acme Plumbing' }, timezone: 'Australia/Melbourne', instructions: 'You help Acme.' });
    expect(stored.knowledge.schedule).toBe('daily');
    expect(stored.settings.by).toBe('cli');

    const again = (await (await get(w.api, '/admin/api/settings')).json()) as { settings: { botName: string }; hash: string };
    expect(again.settings.botName).toBe('Ava');
    expect(again.hash).toBe(stored.settings.hash);
  });

  it('shows the model, the reranker and thinking, and changes them only from the CLI', async () => {
    const w = world();
    const view = (await (await get(w.api, '/admin/api/settings')).json()) as { settings: { assistant: { rerank: boolean; reasoning: string } }; ai: Record<string, unknown> };
    expect(view.settings.assistant).toMatchObject({ rerank: true, reasoning: 'medium' });
    expect(view.ai).toEqual({ provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', knowledge: 'helppuff' });
    for (const assistant of [{ rerank: false }, { reasoning: 'high' }, { model: '@cf/openai/gpt-oss-20b' }]) {
      const refused = await send(w.api, 'PUT', '/admin/api/settings', { settings: { assistant } });
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: { message: string } }).error.message).toContain('helppuff model set');
    }
    // The same values (a full settings object sent back) and the time zone are fine.
    expect((await send(w.api, 'PUT', '/admin/api/settings', { settings: { assistant: { rerank: true, timezone: 'Australia/Perth' } } })).status).toBe(200);
  });

  it('maps the reranker and thinking into the connector options (what `config pull` writes)', () => {
    const site = config().sites['acme']!;
    const options = (patch: Record<string, unknown>) => applySettings(site, { assistant: patch } as never).connector.options as Record<string, unknown>;
    expect(options({ rerank: false })['retrieval']).toEqual({ rerankerModel: null });
    expect(options({ rerank: true })['retrieval']).toBeUndefined();
    expect(options({ reasoning: 'high' })['reasoning']).toBe('high');
    // Medium is the default: left out, so a later default applies.
    expect(options({ reasoning: 'medium' })['reasoning']).toBeUndefined();
  });

  it('shows the rules HelpPuff adds to the prompt, read-only, next to it', async () => {
    const w = world();
    const view = (await (await get(w.api, '/admin/api/prompt')).json()) as { text: string; builtIn: string | null };
    expect(view.text).toBe('You help Acme.');
    expect(view.builtIn).toContain('## How to answer from the website');
    expect(view.builtIn).toContain('Never promise discounts');
  });

  it('refuses a thinking level that is not one', async () => {
    const w = world();
    // Off is not a choice: answers without thinking proved unsafe.
    expect((await send(w.api, 'PUT', '/admin/api/settings', { settings: { assistant: { reasoning: 'off' } } })).status).toBe(400);
  });

  it('rejects an invalid change with the field named', async () => {
    const w = world();
    const response = await send(w.api, 'PUT', '/admin/api/settings', { settings: { accent: 'teal' } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/accent/);
  });
});

describe('one-time links', () => {
  it('claims a fresh deployment once, then signs in with a login link', async () => {
    const w = world();
    const minted = (await (await send(w.api, 'POST', '/admin/api/links', { kind: 'setup' })).json()) as { url: string };
    const token = minted.url.split('/').pop()!;
    expect(minted.url).toMatch(/\/admin\/#\/setup\//);

    const browser = harness(config(), { HELPPUFF_SECRET: SECRET, HELPPUFF_KV: w.kv, HELPPUFF_DB: w.db, ADMIN_API_KEY: API_KEY }, ADMIN);
    expect((await browser.fetch(`/admin/api/setup?token=${token}`)).status).toBe(200);
    expect((await browser.fetch('/admin/api/setup?token=nope-nope-nope-nope-nope')).status).toBe(404);

    const weak = await browser.post('/admin/api/setup', { token, email: 'owner@acme.test', password: 'short' });
    expect(weak.status).toBe(400);
    const claimed = await browser.post('/admin/api/setup', { token, email: 'Owner@Acme.test', password: 'a long enough password' });
    expect(claimed.status).toBe(200);
    const cookie = claimed.headers.get('Set-Cookie')!.split(';')[0]!;
    const me = (await (await browser.fetch('/admin/api/me', { headers: { Cookie: cookie } })).json()) as { admin: { email: string; owner: boolean } };
    expect(me.admin).toEqual({ email: 'owner@acme.test', owner: true, role: 'owner', name: null, via: 'session' });

    // Used, and setup is over: the same link and a new setup link both fail.
    expect((await browser.post('/admin/api/setup', { token, email: 'x@acme.test', password: 'a long enough password' })).status).toBe(404);
    expect((await send(w.api, 'POST', '/admin/api/links', { kind: 'setup' })).status).toBe(400);

    const login = (await (await send(w.api, 'POST', '/admin/api/links', { kind: 'login' })).json()) as { url: string; email: string };
    expect(login.email).toBe('owner@acme.test');
    const loginToken = login.url.split('/').pop()!;
    const signedIn = await browser.post('/admin/api/login-link', { token: loginToken });
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get('Set-Cookie')).toMatch(/^hp_admin=/);
    expect((await browser.post('/admin/api/login-link', { token: loginToken })).status).toBe(404);
  });

  it('only mints links for the API key', async () => {
    const w = world();
    expect((await w.browser.post('/admin/api/links', { kind: 'setup' })).status).toBe(401);
  });
});

describe('feedback and form leads', () => {
  function echoWorld() {
    resetSchemaMemo();
    const db = sqliteD1();
    const pending: Promise<unknown>[] = [];
    const h = harness(
      defineConfig({ sites: { demo: { origins: [ORIGIN], connector: { type: 'echo' }, widget: { leadForm: { enabled: false } } } } }),
      { HELPPUFF_SECRET: SECRET, HELPPUFF_KV: memoryKv(), HELPPUFF_DB: db },
      ORIGIN,
      (p) => pending.push(p),
    );
    return { h, db, settle: async () => void (await Promise.all(pending.splice(0))) };
  }

  it('advertises feedback and stores a rating on the reply', async () => {
    const { h, db, settle } = echoWorld();
    const { sessionToken, sessionId } = await startSession(h, { context: { pageUrl: 'https://example.com/' } });
    const sent = await h.post('/v1/sessions/messages', { kind: 'text', text: 'hello', clientId: 'c1' }, { headers: { Authorization: `Bearer ${sessionToken}` } });
    const { messages } = (await sent.json()) as { messages: { id: string; role: string }[] };
    await settle();
    const reply = messages.find((m) => m.role === 'agent')!;

    const rate = (messageId: string, value: number) =>
      h.post('/v1/sessions/feedback', { messageId, value }, { headers: { Authorization: `Bearer ${sessionToken}` } });
    expect((await rate(reply.id, -1)).status).toBe(204);
    expect(db.raw.prepare('SELECT feedback FROM messages WHERE id = ?').get(`${sessionId}:${reply.id}`)).toEqual({ feedback: -1 });
    expect((await rate('m_unknown', 1)).status).toBe(404);

    const config = (await (await h.fetch('/v1/sites/demo/config')).json()) as { capabilities: { feedback?: boolean } };
    expect(config.capabilities.feedback).toBe(true);
  });

  it('turns a submitted inline form with contact details into a lead', async () => {
    const { h, db, settle } = echoWorld();
    const { sessionToken, sessionId } = await startSession(h, { context: { pageUrl: 'https://example.com/' } });
    await h.post(
      '/v1/sessions/messages',
      { kind: 'action', actionId: 'form', value: JSON.stringify({ name: 'Sam', phone: '0400 111 222' }), label: 'Sent the form', clientId: 'c2' },
      { headers: { Authorization: `Bearer ${await withForms(sessionToken, ['form'])}` } },
    );
    await settle();
    expect(db.raw.prepare('SELECT name, phone, source FROM leads WHERE conversation_id = ?').get(sessionId)).toEqual({ name: 'Sam', phone: '0400 111 222', source: 'form' });
  });
});

describe('instructions', () => {
  const stored = async (w: ReturnType<typeof world>) => JSON.parse((await w.kv.get(siteConfigKey('acme')))!) as Record<string, any>;

  it('keeps goal, tone and length as settings, around the owner\'s prompt and never in it', async () => {
    const w = world();
    const read = async () => ((await (await get(w.api, '/admin/api/settings')).json()) as { settings: { behaviour: Record<string, unknown> } }).settings.behaviour;
    expect(await read()).toEqual({ goal: 'callbacks', tone: 'friendly', length: 'short', prices: 'share' });

    const saved = await send(w.api, 'PUT', '/admin/api/settings', { settings: { behaviour: { goal: 'bookings', bookingUrl: 'https://acme.test/book', tone: 'professional' } } });
    expect(saved.status).toBe(200);
    expect((await stored(w)).assistant).toEqual({ goal: 'bookings', bookingUrl: 'https://acme.test/book', tone: 'professional', length: 'short', prices: 'share' });
    // The owner's text is untouched, and no prompt version was made.
    expect((await stored(w)).connector.options.instructions).toBe('You help Acme.');
    expect((await stored(w)).prompt).toBeUndefined();
    expect(await read()).toMatchObject({ goal: 'bookings', tone: 'professional' });
  });

  it('reads the choices a site saved with the retired instructions form', async () => {
    const w = world();
    await w.kv.put(siteConfigKey('acme'), JSON.stringify({ profile: { goal: 'answers', tone: 'casual', length: 'detailed', mustKnow: 'x', neverSay: '' } }));
    const view = (await (await get(w.api, '/admin/api/settings')).json()) as { settings: { behaviour: Record<string, unknown> } };
    expect(view.settings.behaviour).toEqual({ goal: 'answers', tone: 'casual', length: 'detailed', prices: 'share' });
  });

  it('shows everything HelpPuff adds around the prompt, and the lines of the prompt that repeat it', async () => {
    const w = world();
    const published = await send(w.api, 'POST', '/admin/api/prompt', {
      text: 'You are the website assistant for Acme.\nBe warm and friendly.\nWe only work in the eastern suburbs.\nCall us on 03 9876 5432.',
      baseVersion: 0,
    });
    expect(published.status).toBe(200);
    const view = (await (await get(w.api, '/admin/api/prompt')).json()) as { builtIn: string; overlaps: { line: number; why: string }[] };
    expect(view.builtIn).toMatch(/^You are the website assistant for Acme/);
    expect(view.builtIn.indexOf('(your instructions, above)')).toBeLessThan(view.builtIn.indexOf('## Rules that always apply'));
    expect(view.builtIn).toContain('## How to answer from the website');
    expect(view.overlaps.map((o) => o.line)).toEqual([1, 2, 4]);
    expect(view.overlaps[2]!.why).toContain('{{business.phone}}');
  });
});

describe('the rate-limit gate', () => {
  it('lets retrieval overlap the limit check, but never calls the model for a refused message', async () => {
    resetSchemaMemo();
    const db = sqliteD1();
    const base = fakeAi();
    let chats = 0;
    const ai = {
      run: async (model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>) => {
        if ('messages' in inputs) {
          chats++;
          return { choices: [{ message: { content: 'Hello there.' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } };
        }
        return base.run(model, inputs, options);
      },
    };
    const config = defineConfig({
      sites: {
        acme: {
          origins: [ORIGIN],
          connector: { type: 'workers-ai', options: { stream: false } },
          widget: { leadForm: { enabled: false } },
          security: { limits: { messagesPerSession: 1 } },
        },
      },
    });
    const h = harness(config, { HELPPUFF_SECRET: SECRET, HELPPUFF_KV: memoryKv(), HELPPUFF_DB: db, AI: ai, VECTORS: fakeVectors() }, ORIGIN, () => {});
    const start = (await (await h.post('/v1/sites/acme/sessions', { context: { pageUrl: `${ORIGIN}/` } })).json()) as { sessionToken: string };
    const send = (text: string) => h.post('/v1/sessions/messages', { kind: 'text', text, clientId: text }, { headers: { Authorization: `Bearer ${start.sessionToken}` } });

    const first = await send('hello');
    expect(first.status).toBe(200);
    expect(first.headers.get('Server-Timing')).toMatch(/limits;dur=\d+.*connector;dur=\d+.*total;dur=\d+/);
    expect(chats).toBe(1);

    const second = await send('hello again');
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe('quota_exceeded');
    expect(chats).toBe(1);
  });
});

describe('uploaded files', () => {
  const upload = (h: Harness, name: string, body: string) =>
    h.fetch(`/admin/api/knowledge/files?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'text/markdown' }, body });

  it('queues an upload for the Workflow, lists its progress, and removes it with its passages', async () => {
    const w = world();
    expect((await upload(w.api, 'brochure.exe', 'x')).status).toBe(400);
    expect((await upload(w.api, 'empty.md', '')).status).toBe(400);

    const response = await upload(w.api, 'Warranty guide.md', '# Warranty\n\nFive years on parts and labour, ZEBRA-4471.');
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    expect(await w.kv.get(uploadKey('acme', id))).not.toBeNull();
    const job = w.created.shift()! as unknown as { id: string; params: FileParams };
    expect(job).toMatchObject({ id: `file-${id}`, params: { kind: 'file', siteId: 'acme', fileId: id } });

    const kv = w.kv as unknown as { get(key: string): Promise<ArrayBuffer | null>; delete(key: string): Promise<void> };
    const deps = { db: w.db, ai: fakeAi(), vectors: fakeVectors(), uploads: { get: (key: string) => kv.get(key), delete: (key: string) => kv.delete(key) } };
    expect((await runFileJob(inlineSteps(), deps, job.params)).status).toBe('indexed');

    const listed = (await (await get(w.api, '/admin/api/knowledge/files')).json()) as { files: { id: string; name: string; status: string; chunks: number }[] };
    expect(listed.files).toMatchObject([{ id, name: 'Warranty guide.md', status: 'indexed', chunks: 1 }]);

    const removed = (await (await send(w.api, 'DELETE', `/admin/api/knowledge/files/${id}`, {})).json()) as { chunks: number };
    expect(removed.chunks).toBe(1);
    expect(w.db.raw.prepare("SELECT count(*) AS n FROM pages WHERE source = 'file'").get()).toEqual({ n: 0 });
    expect(((await (await get(w.api, '/admin/api/knowledge/files')).json()) as { files: unknown[] }).files).toEqual([]);
  });

  it('starts the job again for a file left queued (a Worker mid-deploy never ran it)', async () => {
    const w = world();
    const { id } = (await (await upload(w.api, 'faq.md', '# FAQ')).json()) as { id: string };
    w.created.length = 0;
    w.db.raw.prepare('UPDATE knowledge_files SET updated_at = 0 WHERE id = ?').run(id);
    await get(w.api, '/admin/api/knowledge/files');
    expect(w.created).toHaveLength(1);
    expect((w.created[0] as unknown as { params: FileParams }).params.fileId).toBe(id);
    // Only once per stall window.
    await get(w.api, '/admin/api/knowledge/files');
    expect(w.created).toHaveLength(1);
  });
});
