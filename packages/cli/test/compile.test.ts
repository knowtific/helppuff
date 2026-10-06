import { describe, expect, it } from 'vitest';
import { helppuffConfigSchema } from '@helppuff/server';
import { compile } from '../src/engine/compile.js';
import { parseProject, type ProjectInput } from '../src/engine/project.js';
import { parseEnv } from '../src/engine/env.js';
import { parseArgs } from '../src/args.js';
import { tempProject } from './helpers.js';

function loaded(backend: Record<string, unknown>, extra: Partial<ProjectInput> = {}) {
  const raw = {
    site: 'acme',
    name: 'Acme',
    website: 'https://acme.com',
    origins: ['https://acme.com'],
    backend,
    ...extra,
  };
  const dir = tempProject({ 'prompt.md': 'You help Acme customers.' });
  return { dir, file: `${dir}/helppuff.json`, raw, project: parseProject(raw) };
}

describe('compile', () => {
  it('produces a config the server accepts, for every backend', () => {
    const backends = [
      { type: 'cloudflare' },
      { type: 'cloudflare', endpoint: 'https://search.acme.com' },
      { type: 'openai', vectorStoreId: 'vs_1' },
      { type: 'gemini', fileSearchStore: 'fileSearchStores/x' },
      { type: 'anthropic' },
      { type: 'http', url: 'https://api.acme.com', token: { env: 'BACKEND_TOKEN' } },
      { type: 'http', url: 'https://llm.acme.com/v1', mode: 'openai', model: 'llama3' },
      { type: 'retell', agentId: 'agent_1' },
      { type: 'echo' },
    ];
    for (const backend of backends) {
      const compiled = compile(loaded(backend), { workerUrl: 'https://knowtific-helppuff-acme.me.workers.dev' });
      expect(helppuffConfigSchema.safeParse(compiled.serverConfig).success, backend.type).toBe(true);
    }
  });

  it('inlines the prompt, adds the preview origin, and never embeds a secret value', () => {
    const compiled = compile(loaded({ type: 'openai' }), { workerUrl: 'https://knowtific-helppuff-acme.me.workers.dev' });
    const site = (compiled.serverConfig as { sites: Record<string, { origins: string[]; connector: { options: Record<string, unknown> } }> }).sites['acme']!;
    expect(site.connector.options['instructions']).toBe('You help Acme customers.');
    expect(site.connector.options['apiKey']).toEqual({ env: 'OPENAI_API_KEY' });
    expect(site.origins).toEqual(['https://acme.com', 'https://knowtific-helppuff-acme.me.workers.dev']);
    expect(compiled.secrets).toEqual(['HELPPUFF_SECRET', 'OPENAI_API_KEY']);
  });

  it('counts messages per visitor with a Rate Limiting binding set to the live limit, one namespace per site', () => {
    const compiled = compile(loaded({ type: 'echo' }));
    const [limiter] = compiled.wrangler['ratelimits'] as { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
    expect(limiter).toMatchObject({ name: 'HELPPUFF_IP_LIMITER', simple: { limit: 10, period: 60 } });
    expect(Number(limiter!.namespace_id)).toBeGreaterThan(0);
    expect((compiled.wrangler['vars'] as Record<string, string>)['HELPPUFF_IP_LIMIT']).toBe('10');
    const other = compile({ ...loaded({ type: 'echo' }), project: parseProject({ ...loaded({ type: 'echo' }).raw, site: 'beta' }) });
    expect((other.wrangler['ratelimits'] as { namespace_id: string }[])[0]!.namespace_id).not.toBe(limiter!.namespace_id);
  });

  it('binds an AI Search instance only when one is used', () => {
    expect(compile(loaded({ type: 'cloudflare' })).wrangler['ai_search']).toEqual([
      { binding: 'AI_SEARCH', instance_name: 'knowtific-helppuff-acme' },
    ]);
    expect(compile(loaded({ type: 'cloudflare', instance: 'existing' })).aiSearchInstance).toBe('existing');
    expect(compile(loaded({ type: 'cloudflare', endpoint: 'https://s.acme.com' })).wrangler['ai_search']).toBeUndefined();
    expect(compile(loaded({ type: 'openai' })).wrangler['ai_search']).toBeUndefined();
    // Anthropic with a website to learn from gets an instance for its knowledge.
    expect(compile(loaded({ type: 'anthropic' })).aiSearchInstance).toBe('knowtific-helppuff-acme');
  });

  it('changes the worker hash only for worker-shaping changes', () => {
    const a = compile(loaded({ type: 'cloudflare', model: 'x' }));
    const b = compile(loaded({ type: 'cloudflare', model: 'y' }));
    const c = compile(loaded({ type: 'cloudflare', model: 'x' }, { origins: ['https://acme.com', 'https://shop.acme.com'] }));
    expect(a.workerHash).toBe(b.workerHash);
    expect(a.workerHash).not.toBe(c.workerHash);
  });

  it('adds D1, Workers AI and the owner for the dashboard, and needs the password hash', () => {
    const compiled = compile(loaded({ type: 'openai' }, { dashboard: { adminEmail: 'Owner@Acme.com' } }), { d1DatabaseId: 'db-1' });
    expect(compiled.wrangler['d1_databases']).toEqual([{ binding: 'HELPPUFF_DB', database_name: 'knowtific-helppuff-acme', database_id: 'db-1' }]);
    expect(compiled.wrangler['ai']).toEqual({ binding: 'AI' });
    expect((compiled.wrangler['vars'] as Record<string, string>)['ADMIN_EMAIL']).toBe('owner@acme.com');
    expect(compiled.secrets).toContain('ADMIN_PASSWORD_HASH');
    // No owner, no dashboard bindings.
    expect(compile(loaded({ type: 'openai' })).wrangler['d1_databases']).toBeUndefined();
  });

  it('matches the Worker\'s password format exactly', async () => {
    const { hashPassword } = await import('../src/engine/admins.js');
    const { verifyPassword } = await import('@helppuff/server');
    expect(await verifyPassword(hashPassword('correct-horse', 20_000), 'correct-horse')).toBe(true);
    expect(await verifyPassword(hashPassword('correct-horse', 20_000), 'wrong-horse')).toBe(false);
  });

  it('mirrors a Turnstile key into the widget', () => {
    const compiled = compile(
      loaded({ type: 'echo' }, { security: { captcha: { provider: 'turnstile', siteKey: '0x4AAA', secret: { env: 'TURNSTILE_SECRET' } } } }),
    );
    const widget = (compiled.storedConfig as { widget: { captcha?: unknown } }).widget;
    expect(widget.captcha).toEqual({ provider: 'turnstile', siteKey: '0x4AAA' });
    expect(compiled.secrets).toContain('TURNSTILE_SECRET');
  });

  it('rejects a project with a missing prompt file', () => {
    const project = loaded({ type: 'openai' });
    project.project = parseProject({ ...project.raw, prompt: 'missing.md' });
    expect(() => compile(project)).toThrow(/does not exist/);
  });
});

describe('project validation', () => {
  it('names the offending field', () => {
    expect(() => parseProject({ site: 'Bad Id', name: 'x', origins: ['https://a.com'], backend: { type: 'echo' } })).toThrow(/site:/);
    expect(() => parseProject({ site: 'a', name: 'x', origins: ['https://a.com'], backend: { type: 'nope' } })).toThrow(/backend/);
  });
});

describe('env and args', () => {
  it('parses .env lines, quotes and comments', () => {
    expect(parseEnv('A=1\nexport B="two words"\n# c\nC=x # trailing\nbad line')).toEqual({ A: '1', B: 'two words', C: 'x' });
  });

  it('parses flags the way the help describes', () => {
    const parsed = parseArgs(['init', '--url', 'acme.com', '--docs', 'a,b', '--docs=c', '--no-agent-files', '-y', '--json']);
    expect(parsed.command).toBe('init');
    expect(parsed.flags).toMatchObject({ url: 'acme.com', docs: ['a', 'b', 'c'], 'agent-files': false, y: true, json: true });
    expect(() => parseArgs(['init', '--url'])).toThrow(/needs a value/);
  });
});
