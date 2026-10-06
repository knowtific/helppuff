import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySettings, helppuffConfigSchema, readSettings, settingsHash } from '@helppuff/server';
import { compile, knowledgeFor } from '../src/engine/compile.js';
import { loadProject, parseProject, saveProject, type ProjectInput } from '../src/engine/project.js';
import { pullSettings } from '../src/commands/manage.js';
import { adminApi } from '../src/engine/admin-api.js';
import { startCrawlFromCli, startLearning } from '../src/engine/deploy.js';
import { uploadFilesToWorker } from '../src/engine/knowledge.js';
import { CliError } from '../src/errors.js';
import { fakeFetch, tempProject } from './helpers.js';

const BASE: ProjectInput = {
  site: 'acme',
  name: 'Acme Plumbing',
  website: 'https://acme.com.au',
  origins: ['https://acme.com.au', 'https://www.acme.com.au'],
  backend: { type: 'workers-ai' },
};

function project(extra: Partial<ProjectInput> = {}) {
  const dir = tempProject({ 'prompt.md': 'You help Acme customers.', '.env': 'ADMIN_API_KEY=hp_test_key_that_is_long_enough_0000000\n' });
  saveProject(dir, { ...BASE, ...extra });
  return loadProject(dir);
}

const siteOf = (loaded: ReturnType<typeof project>) => helppuffConfigSchema.parse(compile(loaded).serverConfig).sites['acme']!;

describe('workers-ai projects', () => {
  it('compile to the RAG bindings: AI, Vectorize, D1, the crawl Workflow, a cron and Browser Rendering', () => {
    const compiled = compile(project(), { workerUrl: 'https://knowtific-helppuff-acme.me.workers.dev', d1DatabaseId: 'db1', kvNamespaceId: 'kv1' });
    expect(compiled.wrangler).toMatchObject({
      ai: { binding: 'AI' },
      vectorize: [{ binding: 'VECTORS', index_name: 'knowtific-helppuff-acme' }],
      d1_databases: [{ binding: 'HELPPUFF_DB', database_id: 'db1' }],
      workflows: [{ name: 'knowtific-helppuff-acme-crawl', binding: 'CRAWL_WORKFLOW', class_name: 'CrawlWorkflow' }],
      triggers: { crons: ['23 3 * * *'] },
      browser: { binding: 'BROWSER' },
    });
    expect(compiled.secrets).toEqual(['HELPPUFF_SECRET', 'ADMIN_API_KEY']);
    const site = siteOf(project());
    expect(site.connector).toMatchObject({ type: 'workers-ai', options: { instructions: 'You help Acme customers.', stream: true } });
    expect(readSettings(site).assistant?.model).toBe('@cf/zai-org/glm-4.7-flash');
    expect(site.knowledge).toMatchObject({ website: 'https://acme.com.au', maxPages: 300, schedule: 'weekly', renderJs: 'auto' });
  });

  it('needs no admin email: the first account comes from the setup link', () => {
    const compiled = compile(project());
    expect(compiled.secrets).not.toContain('ADMIN_PASSWORD_HASH');
    expect((compiled.wrangler['vars'] as Record<string, string>)['ADMIN_EMAIL']).toBeUndefined();
  });

  it('turns crawl settings into the Worker’s, and leaves out the browser when rendering is off', () => {
    const loaded = project({ knowledge: { website: { schedule: 'daily', renderJs: 'never', include: ['**/services/**'] }, files: [] } });
    expect(knowledgeFor(loaded.project)).toEqual({ website: 'https://acme.com.au', include: ['**/services/**'], maxPages: 300, renderJs: 'never', schedule: 'daily' });
    expect(compile(loaded).wrangler['browser']).toBeUndefined();
    expect(knowledgeFor(project({ knowledge: { website: false, files: [] } }).project)).toMatchObject({ schedule: 'off' });
  });

  it('rejects options the connector does not know', () => {
    expect(() => parseProject({ ...BASE, backend: { type: 'workers-ai', temperature: 2 } })).toThrow(/backend/);
    expect(() => compile(project({ backend: { type: 'workers-ai', retrieval: { finalK: 50 } } as never }))).toThrow();
  });
});

describe('config pull', () => {
  it('writes the live settings into helppuff.json so the next deploy compiles to exactly them', async () => {
    const loaded = project();
    const changed = applySettings(siteOf(loaded), {
      botName: 'Ava',
      accent: '#0f766e',
      starterQuestions: ['Do you service Lilydale?'],
      welcomeMessage: 'Hi! Ask me anything.',
      leads: { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'company', label: 'Company', type: 'text', required: false }] },
      assistant: { timezone: 'Australia/Melbourne', locale: 'en-AU', rerank: false },
      crawl: { schedule: 'monthly' },
    });
    const live = readSettings({ ...siteOf(loaded), ...changed });

    const pulled = pullSettings(loaded, live);
    const again = readSettings(siteOf(pulled));
    expect(again).toEqual(live);
    expect(await settingsHash(again)).toBe(await settingsHash(live));

    const raw = JSON.parse(readFileSync(join(loaded.dir, 'helppuff.json'), 'utf8')) as Record<string, any>;
    expect(raw['backend']).toEqual({ type: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', timezone: 'Australia/Melbourne', locale: 'en-AU', retrieval: { rerankerModel: null } });
    expect(again.assistant!.rerank).toBe(false);
    expect(raw['widget']['brand']).toMatchObject({ agentName: 'Ava', accent: '#0f766e' });
    expect(raw['knowledge']['website']).toMatchObject({ schedule: 'monthly' });
  });
});

describe('admin API client', () => {
  it('sends the key and the site, and maps refusals to exit codes', async () => {
    const loaded = project({ cloudflare: { url: 'https://w.example.workers.dev' } });
    const { fetch, calls } = fakeFetch([
      (url, init) => {
        if (url.pathname === '/admin/api/knowledge/status') {
          return new Headers(init.headers).get('Authorization') === 'Bearer hp_test_key_that_is_long_enough_0000000'
            ? Response.json({ chunks: 3 })
            : undefined;
        }
        if (url.pathname === '/admin/api/settings') return Response.json({ error: { code: 'unauthorized', message: 'nope' } }, { status: 401 });
        return undefined;
      },
    ]);
    const api = adminApi(loaded, { fetch });
    expect(await api.get('/admin/api/knowledge/status')).toEqual({ chunks: 3 });
    expect(calls[0]!.url).toBe('https://w.example.workers.dev/admin/api/knowledge/status?site=acme');
    await expect(api.get('/admin/api/settings')).rejects.toSatisfy((e: unknown) => e instanceof CliError && e.exitCode === 3 && e.code === 'admin_unauthorized');
  });

  it('refuses without a key, with exit code 3', () => {
    const loaded = project({ cloudflare: { url: 'https://w.example.workers.dev' } });
    writeFileSync(join(loaded.dir, '.env'), '');
    expect(() => adminApi(loaded, { env: {} })).toThrow(expect.objectContaining({ code: 'no_admin_key', exitCode: 3 }));
  });

  it('starts a crawl of all non-legal pages, or of exactly the given ones', async () => {
    const loaded = project({ cloudflare: { url: 'https://w.example.workers.dev' } });
    const bodies: Record<string, unknown>[] = [];
    const { fetch } = fakeFetch([
      (url, init) => {
        if (url.pathname === '/admin/api/knowledge/discover') {
          return Response.json({ warnings: [], urls: [{ url: 'https://acme.com.au/', category: 'home', suggested: true }, { url: 'https://acme.com.au/privacy', category: 'legal', suggested: false }, { url: 'https://acme.com.au/blog/2019/x', category: 'blog', suggested: false }] });
        }
        if (url.pathname === '/admin/api/knowledge/crawl') {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return Response.json({ runId: 'r1', total: 1 }, { status: 202 });
        }
        return undefined;
      },
    ]);
    const api = adminApi(loaded, { fetch });
    await startCrawlFromCli(api, { mode: 'all' });
    await startCrawlFromCli(api, { mode: 'suggested' });
    await startCrawlFromCli(api, { mode: 'urls', urls: ['https://acme.com.au/faq'] });
    expect(bodies.map((b) => b['urls'])).toEqual([
      ['https://acme.com.au/', 'https://acme.com.au/blog/2019/x'],
      ['https://acme.com.au/'],
      ['https://acme.com.au/faq'],
    ]);
    expect(bodies.every((b) => b['site'] === 'acme')).toBe(true);
  });
});

describe('onboarding without a person (an AI agent)', () => {
  function worker(learnedBefore: boolean) {
    const paths: string[] = [];
    const { fetch } = fakeFetch([
      (url) => {
        paths.push(url.pathname);
        if (url.pathname === '/admin/api/knowledge/status') return Response.json({ run: learnedBefore ? { status: 'done' } : null });
        if (url.pathname === '/admin/api/knowledge/discover') return Response.json({ warnings: [], urls: [{ url: 'https://acme.com.au/', category: 'home', suggested: true }] });
        if (url.pathname === '/admin/api/knowledge/crawl') return Response.json({ runId: 'r1', total: 1 }, { status: 202 });
        if (url.pathname === '/admin/api/knowledge/facts/detect') return Response.json({ found: 3, facts: [] });
        return undefined;
      },
    ]);
    return { api: adminApi(project({ cloudflare: { url: 'https://w.example.workers.dev' } }), { fetch }), paths };
  }

  it('learns the suggested pages and reads the business details when nothing was learned yet', async () => {
    const { api, paths } = worker(false);
    const loaded = project();
    expect(await startLearning(api, loaded.project, { unattended: true }, [])).toEqual({ runId: 'r1', total: 1 });
    expect(paths).toEqual(['/admin/api/knowledge/status', '/admin/api/knowledge/discover', '/admin/api/knowledge/crawl', '/admin/api/knowledge/facts/detect']);
  });

  it('leaves a site already learned alone, and leaves onboarding to a person when one is there', async () => {
    const learned = worker(true);
    expect(await startLearning(learned.api, project().project, { unattended: true }, [])).toBeNull();
    expect(learned.paths).toEqual(['/admin/api/knowledge/status']);

    const person = worker(false);
    expect(await startLearning(person.api, project().project, { unattended: false }, [])).toBeNull();
    expect(person.paths).toEqual([]);
  });
});

describe('helppuff eval scoring', () => {
  it('passes a grounded answer, fails a wrong source, and checks refusals', async () => {
    const { score } = await import('../src/commands/eval.js');
    expect(score({ question: 'phone?', source: '/contact', contains: ['9876'] }, 'Call us on 03 9876 5432.', ['https://acme.com.au/contact']).pass).toBe(true);
    expect(score({ question: 'phone?', source: '/contact' }, 'Call us.', ['https://acme.com.au/about']).reasons).toEqual(['expected a source containing "/contact"']);
    expect(score({ question: 'car?', refuse: true }, 'I’m not sure about that — want me to put you in touch with the team?', []).pass).toBe(true);
    expect(score({ question: 'car?', refuse: true }, 'Yes, we fix cars for $50.', []).pass).toBe(false);
  });
});

describe('retrieval: helppuff on another backend', () => {
  it('deploys the knowledge base next to OpenAI, and drops the vector store', () => {
    const loaded = project({ backend: { type: 'openai', vectorStoreId: 'vs_1', retrieval: 'helppuff' } });
    const compiled = compile(loaded);
    expect(compiled.wrangler).toMatchObject({ vectorize: [{ binding: 'VECTORS' }], workflows: [{ class_name: 'CrawlWorkflow' }], ai: { binding: 'AI' } });
    const site = siteOf(loaded);
    expect(site.connector.options).toMatchObject({ retrieval: 'helppuff' });
    expect((site.connector.options as Record<string, unknown>)['vectorStoreIds']).toBeUndefined();
    expect(site.knowledge).toMatchObject({ website: 'https://acme.com.au' });
  });

  it('keeps Claude off AI Search when it uses HelpPuff’s knowledge', () => {
    const compiled = compile(project({ backend: { type: 'anthropic', retrieval: 'helppuff' } }));
    expect(compiled.wrangler['ai_search']).toBeUndefined();
    expect(compiled.wrangler['vectorize']).toBeDefined();
  });
});

describe('knowledge.files on deploy', () => {
  it('sends documents to be read on the Worker, text as entries, and only what changed', async () => {
    const loaded = project({ knowledge: { website: false, files: ['docs'] } } as Partial<ProjectInput>);
    mkdirSync(join(loaded.dir, 'docs'));
    writeFileSync(join(loaded.dir, 'docs', 'prices.pdf'), '%PDF-1.4 prices');
    writeFileSync(join(loaded.dir, 'docs', 'faq.md'), '# FAQ\n\nYes, weekends too.');
    const calls: string[] = [];
    const api = {
      send: async <T,>(method: string, path: string) => {
        calls.push(`${method} ${path}`);
        return {} as T;
      },
      upload: async <T,>(path: string, query: Record<string, string>, _bytes: Uint8Array, type: string) => {
        calls.push(`UPLOAD ${path} ${query['name']} ${type}`);
        return { id: `id-${calls.length}` } as T;
      },
    };

    expect(await uploadFilesToWorker(loaded, api)).toMatchObject({ uploaded: 2, unchanged: 0, removed: 0 });
    expect(calls).toEqual(['POST /admin/api/knowledge/manual', 'UPLOAD /admin/api/knowledge/files prices.pdf application/pdf']);

    calls.length = 0;
    expect(await uploadFilesToWorker(loaded, api)).toMatchObject({ uploaded: 0, unchanged: 2, removed: 0 });
    expect(calls).toEqual([]);

    // A changed PDF replaces the old upload; a file taken away is removed.
    writeFileSync(join(loaded.dir, 'docs', 'prices.pdf'), '%PDF-1.4 new prices');
    rmSync(join(loaded.dir, 'docs', 'faq.md'));
    calls.length = 0;
    expect(await uploadFilesToWorker(loaded, api)).toMatchObject({ uploaded: 1, unchanged: 0, removed: 1 });
    expect(calls).toEqual([
      'DELETE /admin/api/knowledge/files/id-2',
      'UPLOAD /admin/api/knowledge/files prices.pdf application/pdf',
      'DELETE /admin/api/knowledge/manual/file-docs-faq-md',
    ]);
  });
});

describe('upgrading', () => {
  it('stamps this release into the Worker it deploys', async () => {
    const { VERSION } = await import('../src/engine/version.js');
    expect(VERSION).toBe((JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version);
    expect(compile(project()).wrangler['vars']).toMatchObject({ HELPPUFF_VERSION: VERSION });
  });

  it('reads an older helppuff.json as the current format, and refuses one from a newer CLI', async () => {
    const { upgradeProjectFile } = await import('../src/engine/project.js');
    const steps = [
      { to: 2, describe: 'leads.webhook moved to webhooks', apply: (raw: Record<string, unknown>) => void (raw['moved'] = true) },
      { to: 3, describe: 'something else', apply: (raw: Record<string, unknown>) => void (raw['third'] = true) },
    ];
    const old = { site: 'acme' };
    const upgraded = upgradeProjectFile(old, steps, 3);
    expect(upgraded).toEqual({ raw: { site: 'acme', moved: true, third: true, format: 3 }, from: 1, changes: ['leads.webhook moved to webhooks', 'something else'] });
    expect(old).toEqual({ site: 'acme' });
    expect(upgradeProjectFile({ format: 2 }, steps, 3).changes).toEqual(['something else']);
    expect(upgradeProjectFile({ format: 3 }, steps, 3).changes).toEqual([]);
    expect(() => upgradeProjectFile({ format: 4 }, steps, 3)).toThrow(CliError);
  });
});
