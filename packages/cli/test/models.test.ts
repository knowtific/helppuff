import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { helppuffConfigSchema } from '@helppuff/server';
import { main } from '../src/cli.js';
import { compile } from '../src/engine/compile.js';
import { customImports } from '../src/engine/build.js';
import { loadProject, parseProject, splitBackend, upgradeProjectFile } from '../src/engine/project.js';
import { tempProject } from './helpers.js';

/**
 * The model and the knowledge base, chosen separately: the format-2 split of
 * old backends, what each choice compiles to, a site's own modules, and the
 * `model` / `rag` / `scaffold` commands an agent drives.
 */

const BASE = { site: 'acme', name: 'Acme', website: 'https://acme.com.au', origins: ['https://acme.com.au'] };

function project(extra: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const dir = tempProject({ 'prompt.md': 'You help Acme.', '.env': 'ADMIN_API_KEY=k\n', 'helppuff.json': JSON.stringify({ ...BASE, ...extra }), ...files });
  return { dir, loaded: () => loadProject(dir) };
}
const siteOf = (dir: string) => helppuffConfigSchema.parse(compile(loadProject(dir)).serverConfig).sites['acme']!;
const options = (dir: string) => siteOf(dir).connector.options as Record<string, any>;

describe('the format-2 split of old backends', () => {
  const split = (backend: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const raw: Record<string, unknown> = { ...BASE, backend, ...extra };
    splitBackend(raw);
    return { backend: raw['backend'], model: raw['model'], retrieval: (raw['knowledge'] as Record<string, unknown> | undefined)?.['retrieval'] };
  };

  it('splits the backends that combined a model and a knowledge base', () => {
    expect(split({ type: 'workers-ai', model: '@cf/x', retrieval: { finalK: 6 } })).toEqual({ backend: undefined, model: { provider: 'workers-ai', model: '@cf/x' }, retrieval: { type: 'helppuff', finalK: 6 } });
    expect(split({ type: 'cloudflare', instance: 'kb', model: '@cf/y' })).toEqual({ backend: undefined, model: { provider: 'workers-ai', model: '@cf/y' }, retrieval: { type: 'ai-search', instance: 'kb' } });
    expect(split({ type: 'anthropic', model: 'claude-x', retrieval: 'helppuff' })).toEqual({ backend: undefined, model: { provider: 'anthropic', model: 'claude-x' }, retrieval: { type: 'helppuff' } });
    expect(split({ type: 'anthropic', knowledge: false })).toMatchObject({ retrieval: { type: 'none' } });
    expect(split({ type: 'openai', retrieval: 'helppuff' })).toMatchObject({ model: { provider: 'openai' }, retrieval: { type: 'helppuff' } });
    expect(split({ type: 'http', mode: 'openai', url: 'https://llm.example.com/v1', model: 'm', token: { env: 'T' } })).toEqual({
      backend: undefined,
      model: { provider: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', model: 'm', apiKey: { env: 'T' } },
      retrieval: { type: 'none' },
    });
  });

  it('keeps whole backends, and those that would lose something', () => {
    for (const backend of [
      { type: 'retell', agentId: 'a' },
      { type: 'echo' },
      { type: 'http', mode: 'helppuff', url: 'https://x.example.com' },
      { type: 'http', mode: 'openai', url: 'https://x.example.com', signingSecret: { env: 'S' } },
      { type: 'openai', promptId: 'pmpt_1' },
      { type: 'openai', vectorStoreId: 'vs_1' },
      { type: 'gemini', fileSearchStore: 'fileSearchStores/x' },
    ]) {
      expect(split(backend).backend, JSON.stringify(backend)).toEqual(backend);
    }
  });

  it('is applied when an old helppuff.json is read, and written back by upgrade', () => {
    const { raw, from, changes } = upgradeProjectFile({ ...BASE, backend: { type: 'workers-ai' } });
    expect(from).toBe(1);
    expect(changes).toHaveLength(1);
    expect(raw).toMatchObject({ format: 2, model: { provider: 'workers-ai' } });
    expect(raw['backend']).toBeUndefined();
    expect(parseProject(raw).backend).toEqual({ type: 'assistant' });
  });

  it('refuses a model next to a backend that runs its own', () => {
    expect(() => parseProject({ ...BASE, format: 2, backend: { type: 'retell', agentId: 'a' }, model: { provider: 'workers-ai' } })).toThrow(/model.*retell backend runs its own/);
    expect(() => parseProject({ ...BASE, format: 2, model: { provider: 'openai-compatible', model: 'm' } })).toThrow(/baseUrl: needed without a `preset`/);
  });
});

describe('what a model and knowledge base compile to', () => {
  it('a preset: its base URL and its key’s variable, uploaded as a secret', () => {
    const { dir } = project({ format: 2, model: { provider: 'openai-compatible', preset: 'deepinfra', model: 'deepseek-ai/DeepSeek-V3.1', locale: 'en-AU' } });
    expect(options(dir)).toMatchObject({
      model: 'deepseek-ai/DeepSeek-V3.1',
      locale: 'en-AU',
      provider: { type: 'openai-compatible', baseUrl: 'https://api.deepinfra.com/v1/openai', apiKey: { env: 'DEEPINFRA_API_KEY' }, label: 'deepinfra' },
      knowledge: { type: 'helppuff' },
    });
    expect(compile(loadProject(dir)).secrets).toContain('DEEPINFRA_API_KEY');
  });

  it('Cloudflare AI Gateway: the account and gateway in the URL, its token as cf-aig-authorization', () => {
    const { dir } = project({
      format: 2,
      model: { provider: 'openai-compatible', preset: 'cloudflare-ai-gateway', model: 'openai/gpt-5-mini', accountId: 'a'.repeat(32), gatewayId: 'acme', apiKey: { env: 'OPENAI_API_KEY' }, gatewayToken: { env: 'CF_AIG_TOKEN' } },
    });
    expect(options(dir)['provider']).toMatchObject({
      baseUrl: `https://gateway.ai.cloudflare.com/v1/${'a'.repeat(32)}/acme/compat`,
      apiKey: { env: 'OPENAI_API_KEY' },
      headers: { 'cf-aig-authorization': { env: 'CF_AIG_TOKEN' } },
    });
  });

  it('Claude through its Messages API, Gemini through its OpenAI-compatible one', () => {
    expect(options(project({ format: 2, model: { provider: 'anthropic' } }).dir)['provider']).toEqual({ type: 'anthropic', apiKey: { env: 'ANTHROPIC_API_KEY' } });
    expect(options(project({ format: 2, model: { provider: 'gemini' } }).dir)['provider']).toMatchObject({ type: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' });
  });

  it('knowledge none deploys no Vectorize; Workers AI still gets its AI binding without a dashboard', () => {
    const { dir } = project({ format: 2, knowledge: { website: false, retrieval: { type: 'none' } }, dashboard: { enabled: false } });
    const compiled = compile(loadProject(dir));
    expect(compiled.wrangler['vectorize']).toBeUndefined();
    expect(compiled.wrangler['ai']).toEqual({ binding: 'AI' });
    expect(options(dir)['knowledge']).toEqual({ type: 'none' });
  });

  it('a site’s own model and knowledge: imported by the Worker entry, their secrets uploaded, edits redeploy', () => {
    const { dir } = project(
      { format: 2, model: { provider: 'custom', module: './ai/llm.ts', secrets: ['MY_KEY'] }, knowledge: { retrieval: { type: 'custom', module: './ai/rag.ts', secrets: ['SEARCH_KEY'] } } },
      { 'ai/llm.ts': 'export default { id: "x", chat: async () => ({ content: "", toolCalls: [], usage: null }) };', 'ai/rag.ts': 'export default { id: "r", search: async () => [] };' },
    );
    const loaded = loadProject(dir);
    expect(options(dir)).toMatchObject({ provider: { type: 'custom', id: 'site-model' }, knowledge: { type: 'custom', id: 'site-retriever' } });
    const compiled = compile(loaded);
    expect(compiled.secrets).toEqual(expect.arrayContaining(['MY_KEY', 'SEARCH_KEY']));
    const entry = customImports(dir, join(dir, '.helppuff', 'deploy'), loaded.project).join('\n');
    expect(entry).toContain('import siteModel from "../../ai/llm.ts";');
    expect(entry).toContain('export default createWorker(config, { models: { "site-model": siteModel }, retrievers: { "site-retriever": siteRetriever } });');
    // Editing the file changes the Worker's hash, so deploy uploads it.
    writeFileSync(join(dir, 'ai', 'rag.ts'), 'export default { id: "r2", search: async () => [] };');
    expect(compile(loadProject(dir)).workerHash).not.toBe(compiled.workerHash);
  });

  it('says plainly when a module file is missing', () => {
    const { dir } = project({ format: 2, model: { provider: 'custom', module: './nope.ts' } });
    expect(() => customImports(dir, join(dir, '.helppuff', 'deploy'), loadProject(dir).project)).toThrow(/nope\.ts does not exist/);
  });
});

describe('helppuff model / rag / scaffold', () => {
  afterEach(() => vi.restoreAllMocks());

  async function run(dir: string, args: string[]) {
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const code = await main([...args, '--json', '--cwd', dir]);
    vi.mocked(process.stdout.write).mockRestore();
    return { code, json: JSON.parse(out) as Record<string, any> };
  }
  const file = (dir: string) => JSON.parse(readFileSync(join(dir, 'helppuff.json'), 'utf8')) as Record<string, any>;

  it('sets a preset model, asks for its key the safe way, then is ready', async () => {
    const { dir } = project({ format: 2, model: { provider: 'workers-ai', timezone: 'Australia/Sydney' } });
    const asked = await run(dir, ['model', 'set', 'openai-compatible', '--preset', 'deepinfra', '--model', 'deepseek-ai/DeepSeek-V3.1']);
    expect(asked.code).toBe(10);
    expect(asked.json).toMatchObject({ status: 'needs_input', questions: [{ envVar: 'DEEPINFRA_API_KEY', secret: true }] });
    expect(asked.json['next']).toContain('helppuff secret set DEEPINFRA_API_KEY');
    // Saved already, keeping the assistant's tuning.
    expect(file(dir)['model']).toEqual({ provider: 'openai-compatible', preset: 'deepinfra', model: 'deepseek-ai/DeepSeek-V3.1', timezone: 'Australia/Sydney' });

    writeFileSync(join(dir, '.env'), 'ADMIN_API_KEY=k\nDEEPINFRA_API_KEY=di\n');
    const ready = await run(dir, ['model', 'set', 'openai-compatible', '--preset', 'deepinfra', '--model', 'deepseek-ai/DeepSeek-V3.1']);
    expect(ready.code).toBe(0);
    expect(ready.json).toMatchObject({ provider: 'openai-compatible', preset: 'deepinfra', next: ['helppuff deploy --json', 'helppuff model test --json'] });
  });

  it('replaces an old backend that splits anyway, but asks before replacing one that runs everything', async () => {
    const old = project({ backend: { type: 'workers-ai', retrieval: { finalK: 6 } } });
    expect((await run(old.dir, ['model', 'set', 'anthropic'])).code).toBe(10);
    expect(file(old.dir)).toMatchObject({ format: 2, model: { provider: 'anthropic' }, knowledge: { retrieval: { type: 'helppuff', finalK: 6 } } });
    expect(file(old.dir)['backend']).toBeUndefined();

    const retell = project({ backend: { type: 'retell', agentId: 'a' } });
    const refused = await run(retell.dir, ['model', 'set', 'workers-ai']);
    expect(refused.code).not.toBe(0);
    expect(refused.json['error']).toMatchObject({ code: 'backend_whole' });
  });

  it('sets the knowledge base: none, an HTTP search (with what it still needs), a custom file', async () => {
    const { dir } = project({ format: 2 });
    expect((await run(dir, ['rag', 'set', 'none'])).code).toBe(0);
    expect(file(dir)['knowledge']['retrieval']).toEqual({ type: 'none' });
    const asked = await run(dir, ['rag', 'set', 'http']);
    expect(asked.json).toMatchObject({ status: 'needs_input', questions: [{ flag: '--url' }] });
    expect((await run(dir, ['rag', 'set', 'http', '--url', 'https://search.acme.com/q'])).code).toBe(0);
    expect(file(dir)['knowledge']['retrieval']).toEqual({ type: 'http', url: 'https://search.acme.com/q' });
    expect((await run(dir, ['rag'])).json).toMatchObject({ type: 'http', explicit: true });
  });

  it('scaffolds a typed starter that deploys without installing anything, and can use it at once', async () => {
    const { dir } = project({ format: 2 });
    const made = await run(dir, ['scaffold', 'rag', '--use']);
    expect(made.json).toMatchObject({ file: './rag.ts', used: true });
    const source = readFileSync(join(dir, 'rag.ts'), 'utf8');
    expect(source).toMatch(/^import type \{ Retriever \} from '@knowtific\/helppuff\/sdk';/);
    expect(source).toContain('} satisfies Retriever;');
    expect(file(dir)['knowledge']['retrieval']).toEqual({ type: 'custom', module: './rag.ts', secrets: ['MY_SEARCH_KEY'] });
    expect((await run(dir, ['scaffold', 'rag'])).json['error']).toMatchObject({ code: 'file_exists' });
  });
});
