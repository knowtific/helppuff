import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type * as AdminsModule from '../src/engine/admins.js';
import { runInit } from '../src/engine/init.js';
import { pendingQuestions, matchingInstance } from '../src/engine/questions.js';
import { ACME_HOME, cf, fakeFetch, html, tempProject } from './helpers.js';

// Never pick up the developer's own `wrangler login` in tests.
vi.mock('../src/engine/wrangler-auth.js', () => ({ wranglerOAuthToken: async () => null, wranglerLogin: async () => false }));
// Nor their git identity: the dashboard owner defaults to it.
vi.mock('../src/engine/admins.js', async (original) => ({
  ...(await original<typeof AdminsModule>()),
  gitEmail: () => 'owner@acme.com.au',
}));

const ACCOUNT = 'a'.repeat(32);

function world(instances: unknown[] = []) {
  return fakeFetch([
    (url) => (url.hostname === 'acme.com.au' && url.pathname === '/' ? html(ACME_HOME) : undefined),
    (url) => (url.pathname === '/client/v4/accounts' ? cf([{ id: ACCOUNT, name: 'Acme' }]) : undefined),
    (url) => (url.pathname.endsWith('/ai-search/namespaces/default/instances') ? cf(instances) : undefined),
    (url) => (url.hostname === 'api.openai.com' && url.pathname === '/v1/models' ? Response.json({ data: [] }) : undefined),
  ]);
}

describe('the questions', () => {
  it('asks only for the website and Cloudflare access when nothing is known', () => {
    const ids = pendingQuestions({}, { env: {} }).filter((q) => q.required).map((q) => q.id);
    expect(ids).toEqual(['website', 'cfToken']);
  });

  it('takes the free default without asking, and offers backends only with --no-defaults', () => {
    const first = pendingQuestions({ website: 'x.com' }, { env: {}, cloudflareLogin: true }).filter((q) => q.required || q.wizard).map((q) => q.id);
    expect(first).toEqual([]);
    const advanced = pendingQuestions({ website: 'x.com', defaults: false }, { env: {}, cloudflareLogin: true });
    expect(advanced.find((q) => q.id === 'backend')).toMatchObject({ default: 'workers-ai', wizard: true });
  });

  it('leaves the dashboard account to the setup link on workers-ai', () => {
    const ids = pendingQuestions({ website: 'x.com', backend: 'workers-ai' }, { env: {}, cloudflareLogin: true }).map((q) => q.id);
    expect(ids).not.toContain('adminEmail');
    expect(ids).not.toContain('adminPassword');
  });

  it('defaults the dashboard owner to the git email, and drops it with --no-dashboard', () => {
    const q = pendingQuestions({ backend: 'cloudflare' }, { env: {}, gitEmail: 'me@acme.com' }).find((x) => x.id === 'adminEmail');
    expect(q).toMatchObject({ required: false, default: 'me@acme.com' });
    expect(pendingQuestions({ dashboard: false }, { env: {} }).map((x) => x.id)).not.toContain('adminEmail');
  });

  it('does not ask for a key that is already in the environment', () => {
    const ids = pendingQuestions({ website: 'x.com', backend: 'openai' }, { env: { OPENAI_API_KEY: 'sk', CLOUDFLARE_API_TOKEN: 't' } }).map(
      (q) => q.id,
    );
    expect(ids).not.toContain('apiKey');
    expect(ids).not.toContain('cfToken');
  });

  it('asks for a URL and suggests the OpenAI mode for /v1 endpoints on the http backend', () => {
    const qs = pendingQuestions({ website: 'x.com', backend: 'http', httpUrl: 'https://llm.acme.com/v1' }, { env: {}, cloudflareLogin: true });
    expect(qs.find((q) => q.id === 'httpMode')?.default).toBe('openai');
  });

  it('prefers an existing AI Search instance that already crawls this site', () => {
    const facts = {
      env: {},
      site: { url: 'https://www.acme.com.au/' } as never,
      instances: [
        { id: 'other', type: 'r2' },
        { id: 'acme-site', type: 'web-crawler', source: 'acme.com.au' },
      ],
    };
    expect(matchingInstance(facts)).toBe('acme-site');
    const q = pendingQuestions({ website: 'acme.com.au', backend: 'cloudflare' }, facts).find((x) => x.id === 'aiSearch');
    expect(q?.default).toBe('acme-site');
    // The match is first, so the default is also the top choice.
    expect(q?.options?.[0]?.value).toBe('acme-site');
  });

  it("never offers an instance murmur created for another site", () => {
    const facts = {
      env: {},
      site: { url: 'https://acme.com.au/' } as never,
      instances: [
        { id: 'knowtific-murmur-othersite', type: 'web-crawler', source: 'other.com' },
        { id: 'knowtific-murmur-acme', type: 'web-crawler', source: 'acme.com.au' },
        { id: 'handmade', type: 'r2' },
      ],
    };
    const q = pendingQuestions({ website: 'acme.com.au', backend: 'cloudflare' }, facts).find((x) => x.id === 'aiSearch');
    const values = q?.options?.map((o) => o.value);
    expect(values).toEqual(['knowtific-murmur-acme', 'new', 'handmade', 'endpoint']);
  });
});

describe('runInit for an agent', () => {
  it('returns needs_input, with what it already knows, and writes nothing', async () => {
    const dir = tempProject();
    const { fetch } = world();
    const result = await runInit({ cwd: dir, answers: { website: 'acme.com.au' }, fetch });
    expect(result.status).toBe('needs_input');
    if (result.status !== 'needs_input') return;
    expect(result.questions.map((q) => q.id)).toEqual(['cfToken']);
    expect(result.known).toEqual({ website: 'acme.com.au' });
    expect(existsSync(join(dir, 'murmur.json'))).toBe(false);
  });

  it('never echoes a secret back', async () => {
    const dir = tempProject();
    const result = await runInit({ cwd: dir, answers: { website: 'acme.com.au', apiKey: 'sk-secret' }, fetch: world().fetch });
    expect(JSON.stringify(result)).not.toContain('sk-secret');
  });

  it('creates a Cloudflare project from a URL, a backend and a token', async () => {
    const dir = tempProject();
    const result = await runInit({
      cwd: dir,
      answers: { website: 'acme.com.au', backend: 'cloudflare', cfToken: 'cf-token' },
      fetch: world().fetch,
    });
    expect(result.status).toBe('created');
    const project = JSON.parse(readFileSync(join(dir, 'murmur.json'), 'utf8'));
    expect(project).toMatchObject({
      site: 'acme',
      name: 'Acme Plumbing',
      backend: { type: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
      widget: { brand: { accent: '#0EA5E9' }, chat: { fallbackContact: { email: 'hello@acme.com.au' } } },
    });
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('CLOUDFLARE_API_TOKEN=cf-token');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.env');
    expect(readFileSync(join(dir, 'prompt.md'), 'utf8')).toContain('Acme Plumbing');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/website-chatbot/SKILL.md'))).toBe(true);
    if (result.status === 'created') expect(result.assumed['model']).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('sets up the dashboard owner with a generated password, stored only as a hash', async () => {
    const dir = tempProject();
    const result = await runInit({ cwd: dir, answers: { website: 'acme.com.au', backend: 'cloudflare', cfToken: 't' }, fetch: world().fetch });
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(result.project.dashboard).toMatchObject({ enabled: true, adminEmail: 'owner@acme.com.au' });
    expect(result.adminPassword).toMatch(/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/);
    const env = readFileSync(join(dir, '.env'), 'utf8');
    expect(env).toMatch(/ADMIN_PASSWORD_HASH=pbkdf2\$100000\$/);
    expect(env).not.toContain(result.adminPassword!);
  });

  it('uses a given password and does not echo it', async () => {
    const dir = tempProject();
    const result = await runInit({
      cwd: dir,
      answers: { website: 'acme.com.au', backend: 'cloudflare', cfToken: 't', adminPassword: 'a-long-password' },
      fetch: world().fetch,
    });
    if (result.status !== 'created') throw new Error('not created');
    expect(result.adminPassword).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('a-long-password');
  });

  it('skips the dashboard entirely when asked', async () => {
    const dir = tempProject();
    const result = await runInit({ cwd: dir, answers: { website: 'acme.com.au', backend: 'cloudflare', cfToken: 't', dashboard: false }, fetch: world().fetch });
    if (result.status !== 'created') throw new Error('not created');
    expect(result.project.dashboard.enabled).toBe(false);
    expect(readFileSync(join(dir, '.env'), 'utf8')).not.toContain('ADMIN_PASSWORD_HASH');
  });

  it('reuses an instance that already crawls the site', async () => {
    const dir = tempProject();
    await runInit({
      cwd: dir,
      answers: { website: 'acme.com.au', backend: 'cloudflare', cfToken: 't' },
      fetch: world([{ id: 'acme-web', type: 'web-crawler', source: 'acme.com.au' }]).fetch,
    });
    expect(JSON.parse(readFileSync(join(dir, 'murmur.json'), 'utf8')).backend.instance).toBe('acme-web');
  });

  it('stores a provider key in .env, not in murmur.json', async () => {
    const dir = tempProject();
    await runInit({
      cwd: dir,
      answers: { website: 'acme.com.au', backend: 'openai', apiKey: 'sk-live', cfToken: 't' },
      fetch: world().fetch,
    });
    expect(readFileSync(join(dir, 'murmur.json'), 'utf8')).not.toContain('sk-live');
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('OPENAI_API_KEY=sk-live');
  });

  it('refuses a provider key the provider rejects', async () => {
    const dir = tempProject();
    const { fetch } = fakeFetch([
      (url) => (url.hostname === 'api.openai.com' ? new Response('bad key', { status: 401 }) : undefined),
      (url) => (url.pathname === '/client/v4/accounts' ? cf([{ id: ACCOUNT, name: 'Acme' }]) : undefined),
      () => html(ACME_HOME),
    ]);
    await expect(
      runInit({ cwd: dir, answers: { website: 'acme.com.au', backend: 'openai', apiKey: 'nope', cfToken: 't' }, fetch }),
    ).rejects.toMatchObject({ code: 'invalid_api_key' });
  });

  it('asks a person for the website and nothing else', async () => {
    const dir = tempProject();
    const asked: string[] = [];
    const result = await runInit({
      cwd: dir,
      answers: { cfToken: 't' },
      fetch: world().fetch,
      ask: async (q) => {
        asked.push(q.id);
        return q.id === 'website' ? 'acme.com.au' : q.default;
      },
    });
    expect(asked).toEqual(['website']);
    expect(result.status).toBe('created');
    if (result.status === 'created') expect(result.project.backend).toEqual({ type: 'workers-ai' });
    // The prompt comes from the same generator as the dashboard's instructions form.
    expect(readFileSync(join(dir, 'prompt.md'), 'utf8')).toContain('arrange a callback from the team');
  });

  it('still takes the old flags from an agent', async () => {
    const dir = tempProject();
    await runInit({ cwd: dir, answers: { website: 'acme.com.au', cfToken: 't', goal: 'book', notes: 'We never work on Sundays.' }, yes: true, fetch: world().fetch });
    const prompt = readFileSync(join(dir, 'prompt.md'), 'utf8');
    expect(prompt).toContain('help visitors book');
    expect(prompt).toContain('We never work on Sundays.');
  });

  it('asks for details up front when told to, and greets by name', async () => {
    const dir = tempProject();
    const result = await runInit({
      cwd: dir,
      answers: { website: 'acme.com.au', backend: 'cloudflare', cfToken: 't', leadForm: 'name,email,phone', agentName: 'Kai' },
      fetch: world().fetch,
    });
    if (result.status !== 'created') throw new Error('not created');
    const widget = result.project.widget;
    expect(widget.leadForm.enabled).toBe(true);
    expect(widget.leadForm.fields.map((f) => [f.name, f.type, f.required])).toEqual([
      ['name', 'text', true],
      ['email', 'email', true],
      ['phone', 'tel', false],
    ]);
    expect(widget.chat.initialMessages).toEqual(["Hi {{name}}! I'm Kai from Acme Plumbing. How can I help you today?"]);
    const prompt = readFileSync(join(dir, 'prompt.md'), 'utf8');
    expect(prompt).toContain('name {{lead.name}}, email {{lead.email}}, phone {{lead.phone}}');
    expect(prompt).toContain('do not greet again');
  });

  it('asks for name, email, an optional phone and the question by default', async () => {
    const dir = tempProject();
    const result = await runInit({ cwd: dir, answers: { website: 'acme.com.au', backend: 'cloudflare', cfToken: 't' }, fetch: world().fetch });
    if (result.status !== 'created') throw new Error('not created');
    const form = result.project.widget.leadForm;
    expect(form.enabled).toBe(true);
    expect(form.fields.map((f) => [f.name, f.type, Boolean(f.required)])).toEqual([
      ['name', 'text', true],
      ['email', 'email', true],
      ['phone', 'tel', false],
      ['message', 'textarea', true],
    ]);
    expect(result.project.widget.chat.initialMessages).toEqual(['Hi {{name}}! How can we help you today?']);
  });

  it('lets visitors chat straight away with --lead-form none', async () => {
    const dir = tempProject();
    const result = await runInit({ cwd: dir, answers: { website: 'acme.com.au', cfToken: 't', leadForm: 'none' }, fetch: world().fetch });
    if (result.status === 'created') expect(result.project.widget.leadForm.enabled).toBe(false);
  });

  it('refuses to overwrite an existing project without --force', async () => {
    const dir = tempProject({ 'murmur.json': '{}' });
    await expect(runInit({ cwd: dir, answers: {}, fetch: world().fetch })).rejects.toMatchObject({ code: 'project_exists' });
  });

  it('with yes, takes the free default stack', async () => {
    const dir = tempProject();
    const result = await runInit({ cwd: dir, answers: { website: 'acme.com.au', cfToken: 't' }, yes: true, fetch: world().fetch });
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(result.project.backend).toEqual({ type: 'workers-ai' });
    expect(result.project.dashboard.adminEmail).toBeUndefined();
    expect(result.adminPassword).toBeUndefined();
  });
});
