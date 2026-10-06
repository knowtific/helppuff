import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type * as AdminsModule from '../src/engine/admins.js';
import { secretCommand } from '../src/commands/manage.js';
import { nextSteps, onboardingFrom, projectOnboarding, unattendedFrom } from '../src/commands/setup.js';
import type { DeployResult } from '../src/engine/deploy.js';
import { readState } from '../src/engine/state.js';
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

  it("never offers an instance helppuff created for another site", () => {
    const facts = {
      env: {},
      site: { url: 'https://acme.com.au/' } as never,
      instances: [
        { id: 'knowtific-helppuff-othersite', type: 'web-crawler', source: 'other.com' },
        { id: 'knowtific-helppuff-acme', type: 'web-crawler', source: 'acme.com.au' },
        { id: 'handmade', type: 'r2' },
      ],
    };
    const q = pendingQuestions({ website: 'acme.com.au', backend: 'cloudflare' }, facts).find((x) => x.id === 'aiSearch');
    const values = q?.options?.map((o) => o.value);
    expect(values).toEqual(['knowtific-helppuff-acme', 'new', 'handmade', 'endpoint']);
  });
});

describe('runInit for an agent', () => {
  it('makes the automatic or dashboard onboarding choice explicit', () => {
    expect(onboardingFrom({ flags: { onboarding: 'defaults' } } as never, false, undefined)).toBe('defaults');
    expect(onboardingFrom({ flags: { onboarding: 'dashboard' } } as never, false, undefined)).toBe('dashboard');
    expect(onboardingFrom({ flags: {} } as never, false, undefined)).toBe('defaults');
    expect(onboardingFrom({ flags: {} } as never, true, undefined)).toBe('dashboard');
    expect(() => onboardingFrom({ flags: { onboarding: 'dashboard' } } as never, false, { mode: 'suggested' })).toThrow(/cannot be combined/);
    expect(() => onboardingFrom({ flags: { onboarding: 'unknown' } } as never, false, undefined)).toThrow(/must be "defaults" or "dashboard"/);
  });

  it('remembers an explicit onboarding choice, so a later bare deploy does not crawl', () => {
    const dir = tempProject();
    const ctx = (flags: Record<string, unknown>) => ({ flags }) as never;
    expect(projectOnboarding(ctx({}), dir, false, undefined)).toBe('defaults');
    expect(readState(dir).onboarding).toBeUndefined();

    expect(projectOnboarding(ctx({ onboarding: 'dashboard' }), dir, false, undefined)).toBe('dashboard');
    expect(readState(dir).onboarding).toBe('dashboard');
    // `helppuff deploy --json` from an agent, with no flag: still the user's setup page.
    expect(projectOnboarding(ctx({}), dir, false, undefined)).toBe('dashboard');
    expect(unattendedFrom(ctx({}), 'dashboard')).toBe(false);
    // Pages asked for explicitly win over the saved choice, without an error.
    expect(projectOnboarding(ctx({ crawl: 'all' }), dir, false, { mode: 'all' })).toBe('defaults');
    expect(readState(dir).onboarding).toBe('dashboard');
    // A dry run changes nothing.
    expect(projectOnboarding(ctx({ onboarding: 'defaults', 'dry-run': true }), dir, false, undefined)).toBe('defaults');
    expect(readState(dir).onboarding).toBe('dashboard');

    expect(projectOnboarding(ctx({ onboarding: 'defaults' }), dir, true, undefined)).toBe('defaults');
    expect(projectOnboarding(ctx({}), dir, true, undefined)).toBe('defaults');
  });

  it('learns nothing with --crawl none, even with the default onboarding', () => {
    expect(unattendedFrom({ flags: {} } as never, 'defaults')).toBe(true);
    expect(unattendedFrom({ flags: { crawl: 'none' } } as never, 'defaults')).toBe(false);
    expect(unattendedFrom({ flags: { crawl: 'none' } } as never, 'dashboard')).toBe(false);
  });

  it('hands dashboard onboarding to the user even without a setup link', () => {
    const deployed = {
      url: 'https://w.example.workers.dev',
      dashboard: 'https://w.example.workers.dev/admin/',
      preview: 'https://w.example.workers.dev/',
      setupUrl: null,
      crawl: null,
    } as DeployResult;
    const steps = nextSteps(deployed, 'dashboard').join('\n');
    expect(steps).toContain('https://w.example.workers.dev/admin/');
    expect(steps).toContain('helppuff dashboard --json');
    expect(steps).toContain('nothing is learned until they do');
    expect(steps).not.toMatch(/^helppuff ask/m);

    const withLink = nextSteps({ ...deployed, setupUrl: 'https://w.example.workers.dev/admin/setup#t' }, 'dashboard').join('\n');
    expect(withLink).toContain('setup link https://w.example.workers.dev/admin/setup#t');
    expect(nextSteps(deployed, 'defaults')[0]).toMatch(/^helppuff ask/);
  });

  it('stores Cloudflare access safely before the project is initialized', async () => {
    const dir = tempProject();
    const result = vi.fn();
    const warn = vi.fn();

    await secretCommand({
      cwd: dir,
      positionals: ['set', 'CLOUDFLARE_API_TOKEN'],
      flags: { value: 'cf-secret' },
      interactive: false,
      out: { result, warn } as never,
    });

    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('CLOUDFLARE_API_TOKEN=cf-secret');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.env');
    // No project yet: say exactly which folder init must run in to find it.
    expect(result).toHaveBeenCalledWith(
      { name: 'CLOUDFLARE_API_TOKEN', stored: join(dir, '.env'), uploadedToWorker: false },
      expect.any(Function),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`run \`helppuff init\` in ${dir}`));
    expect(JSON.stringify([result.mock.calls, warn.mock.calls])).not.toContain('cf-secret');
  });

  it('stores a secret in the project folder from anywhere inside it', async () => {
    const dir = tempProject();
    await runInit({ cwd: dir, answers: { website: 'acme.com.au', cfToken: 't' }, yes: true, fetch: world().fetch });
    const sub = join(dir, 'src');
    mkdirSync(sub);
    const result = vi.fn();
    const warn = vi.fn();

    await secretCommand({ cwd: sub, positionals: ['set', 'OPENAI_API_KEY'], flags: { value: 'sk-x' }, interactive: false, out: { result, warn } as never });

    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('OPENAI_API_KEY=sk-x');
    expect(existsSync(join(sub, '.env'))).toBe(false);
    expect(result).toHaveBeenCalledWith({ name: 'OPENAI_API_KEY', stored: '.env', uploadedToWorker: false }, expect.any(Function));
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns needs_input, with what it already knows, and writes nothing', async () => {
    const dir = tempProject();
    const { fetch } = world();
    const result = await runInit({ cwd: dir, answers: { website: 'acme.com.au' }, fetch });
    expect(result.status).toBe('needs_input');
    if (result.status !== 'needs_input') return;
    expect(result.questions.map((q) => q.id)).toEqual(['cfToken']);
    expect(result.known).toEqual({ website: 'acme.com.au' });
    expect(existsSync(join(dir, 'helppuff.json'))).toBe(false);
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
    const project = JSON.parse(readFileSync(join(dir, 'helppuff.json'), 'utf8'));
    expect(project).toMatchObject({
      site: 'acme',
      name: 'Acme Plumbing',
      backend: { type: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
      widget: { brand: { accent: '#0EA5E9' }, chat: { fallbackContact: { email: 'hello@acme.com.au' } } },
    });
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('CLOUDFLARE_API_TOKEN=cf-token');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.env');
    expect(readFileSync(join(dir, 'prompt.md'), 'utf8')).toContain('Acme Plumbing');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(dir, '.claude'))).toBe(false);
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
    expect(JSON.parse(readFileSync(join(dir, 'helppuff.json'), 'utf8')).backend.instance).toBe('acme-web');
  });

  it('stores a provider key in .env, not in helppuff.json', async () => {
    const dir = tempProject();
    await runInit({
      cwd: dir,
      answers: { website: 'acme.com.au', backend: 'openai', apiKey: 'sk-live', cfToken: 't' },
      fetch: world().fetch,
    });
    expect(readFileSync(join(dir, 'helppuff.json'), 'utf8')).not.toContain('sk-live');
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
    // How it behaves is a setting; prompt.md holds only what is specific to the business.
    if (result.status === 'created') expect(result.project.assistant).toMatchObject({ goal: 'callbacks' });
    const prompt = readFileSync(join(dir, 'prompt.md'), 'utf8');
    expect(prompt).toMatch(/^About Acme Plumbing: /);
    expect(prompt).not.toContain('You are');
  });

  it('still takes the old flags from an agent', async () => {
    const dir = tempProject();
    const result = await runInit({ cwd: dir, answers: { website: 'acme.com.au', cfToken: 't', goal: 'book', notes: 'We never work on Sundays.' }, yes: true, fetch: world().fetch });
    if (result.status === 'created') expect(result.project.assistant).toMatchObject({ goal: 'bookings' });
    expect(readFileSync(join(dir, 'prompt.md'), 'utf8')).toContain('We never work on Sundays.');
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
    // The form and the greeting are settings: HelpPuff tells the model about them, prompt.md does not repeat them.
    expect(readFileSync(join(dir, 'prompt.md'), 'utf8')).not.toContain('{{lead.');
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
    const dir = tempProject({ 'helppuff.json': '{}' });
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
