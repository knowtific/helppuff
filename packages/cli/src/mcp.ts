import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { isCliError } from './errors.js';
import { VERSION } from './help.js';
import { chat } from './engine/chat.js';
import { compile, devOrigin, embedSnippet } from './engine/compile.js';
import { cloudflareSession } from './engine/credentials.js';
import { deploy, startCrawlFromCli, type CrawlRequest } from './engine/deploy.js';
import { adminApi } from './engine/admin-api.js';
import { waitForCrawl } from './commands/knowledge.js';
import { doctor } from './engine/doctor.js';
import { loadEnv, writeEnvVar } from './engine/env.js';
import { runInit } from './engine/init.js';
import { syncKnowledge } from './engine/knowledge.js';
import { aiSearchInstanceFor, loadProject, updateProject } from './engine/project.js';
import type { Answers } from './engine/questions.js';
import { projectJsonSchema } from './engine/schema.js';
import { promptHistory, promptSync, pullPrompt, readLivePrompt, readLocalPrompt, remoteFor } from './engine/prompt.js';
import { readState } from './engine/state.js';
import { promptHash } from '@helppuff/server';

/**
 * `helppuff mcp` — the same engine as the CLI, as MCP tools over stdio.
 *
 * Hand-rolled JSON-RPC rather than an SDK: the protocol surface a tool
 * server needs (initialize, tools/list, tools/call, ping) is small and
 * stable, and this keeps the package free of a dependency that changes
 * shape between versions. stdout carries only protocol frames; all
 * progress goes to stderr.
 */

type Json = Record<string, unknown>;
type Tool = { name: string; description: string; inputSchema: Json; run: (args: Json) => Promise<unknown> };

const cwdProp = { cwd: { type: 'string', description: 'Project folder (defaults to where the server was started).' } };
const progress = (message: string) => process.stderr.write(`${message}\n`);

function cwdOf(args: Json, base: string): string {
  return typeof args['cwd'] === 'string' ? resolve(base, args['cwd']) : base;
}

function crawlOf(value: string): CrawlRequest {
  if (value === 'all' || value === 'suggested') return { mode: value };
  return { mode: 'match', include: value.split(',').map((g) => g.trim()).filter(Boolean) };
}

export function tools(base: string): Tool[] {
  return [
    {
      name: 'helppuff_setup',
      description:
        'Create a chat assistant project (helppuff.json, prompt.md, .env). Pass what you know; if anything required is missing the result has status "needs_input" with the questions to ask the user — ask them, then call again with the answers added. Never invent URLs, keys or account ids.',
      inputSchema: {
        type: 'object',
        properties: {
          ...cwdProp,
          url: { type: 'string', description: 'Website, e.g. acme.com, or "none"' },
          name: { type: 'string' },
          defaults: { type: 'boolean', description: 'Take the free default stack (workers-ai: Workers AI + its own knowledge base)' },
          backend: { type: 'string', enum: ['workers-ai', 'cloudflare', 'openai', 'gemini', 'anthropic', 'http', 'retell'] },
          model: { type: 'string' },
          apiKey: { type: 'string', description: 'Provider API key (openai/gemini/anthropic/retell)' },
          aiSearch: { type: 'string', description: '"new", an existing AI Search instance name, or "endpoint"' },
          aiSearchEndpoint: { type: 'string' },
          httpUrl: { type: 'string' },
          httpMode: { type: 'string', enum: ['helppuff', 'openai'] },
          httpToken: { type: 'string' },
          retellAgent: { type: 'string' },
          docs: { type: 'array', items: { type: 'string' } },
          cfToken: { type: 'string', description: 'Cloudflare API token' },
          cfAccount: { type: 'string' },
          adminEmail: { type: 'string', description: 'Dashboard owner email (defaults to git user.email)' },
          adminPassword: { type: 'string', description: 'Omit to generate one; it is returned once in the result' },
          dashboard: { type: 'boolean', description: 'false turns off the CRM dashboard' },
          agentName: { type: 'string', description: 'What visitors see the assistant called' },
          goal: { type: 'string', enum: ['leads', 'answer', 'book', 'sell'], description: 'What it steers visitors towards' },
          notes: { type: 'string', description: "The owner's must-know / never-say instructions, woven into the prompt" },
          leadForm: { type: 'string', description: 'Pre-chat form: "none" (default), or fields from name,email,phone, e.g. "name,email,phone"' },
          acceptDefaults: { type: 'boolean', description: 'Take the recommended answer where one exists' },
          force: { type: 'boolean' },
        },
      },
      run: async (args) => {
        const answers: Answers = {};
        const map: [keyof Answers, string][] = [
          ['website', 'url'], ['name', 'name'], ['backend', 'backend'], ['model', 'model'], ['apiKey', 'apiKey'],
          ['aiSearch', 'aiSearch'], ['httpUrl', 'httpUrl'], ['httpMode', 'httpMode'], ['httpToken', 'httpToken'],
          ['retellAgent', 'retellAgent'], ['cfToken', 'cfToken'], ['cfAccount', 'cfAccount'],
          ['adminEmail', 'adminEmail'], ['adminPassword', 'adminPassword'],
          ['agentName', 'agentName'], ['goal', 'goal'], ['notes', 'notes'], ['leadForm', 'leadForm'],
        ];
        for (const [key, arg] of map) if (typeof args[arg] === 'string') (answers as Json)[key] = args[arg];
        if (typeof args['aiSearchEndpoint'] === 'string') {
          answers.aiSearch = 'endpoint';
          answers.endpoint = args['aiSearchEndpoint'];
        }
        if (Array.isArray(args['docs'])) answers.docs = args['docs'].map(String);
        if (args['dashboard'] === false) answers.dashboard = false;
        if (typeof args['defaults'] === 'boolean') answers.defaults = args['defaults'];
        const result = await runInit({
          cwd: cwdOf(args, base),
          answers,
          yes: args['acceptDefaults'] === true,
          force: args['force'] === true,
          progress,
        });
        if (result.status === 'created') {
          return {
            ...result,
            project: undefined,
            next: 'Call helppuff_deploy (with crawl: "suggested" for workers-ai), then helppuff_ask with a realistic question. Give the user setupUrl from the deploy. If adminPassword is present, show it to the user once.',
          };
        }
        return result;
      },
    },
    {
      name: 'helppuff_deploy',
      description: 'Deploy or update the assistant on Cloudflare. Returns the preview URL and embed snippet. Content-only changes are live in seconds.',
      inputSchema: {
        type: 'object',
        properties: {
          ...cwdProp,
          knowledge: { type: 'string', enum: ['auto', 'force', 'skip'], description: 'force = re-sync the knowledge base' },
          force: { type: 'boolean', description: 'Re-upload the Worker even if unchanged' },
          dryRun: { type: 'boolean' },
          crawl: {
            type: 'string',
            description: 'workers-ai: also start a crawl — "suggested", "all", or globs like "**/services/**,**/faq/**". It runs in the background.',
          },
          overwriteSettings: { type: 'boolean', description: 'Publish over settings changed in the dashboard. Prefer helppuff_config with action pull.' },
        },
      },
      run: async (args) => {
        const crawl = typeof args['crawl'] === 'string' && args['crawl'] !== 'none' ? crawlOf(args['crawl']) : undefined;
        return deploy(loadProject(cwdOf(args, base)), {
          knowledge: (args['knowledge'] as 'auto') ?? 'auto',
          forceWorker: args['force'] === true,
          dryRun: args['dryRun'] === true,
          overwriteSettings: args['overwriteSettings'] === true,
          ...(crawl ? { crawl } : {}),
          progress,
        });
      },
    },
    {
      name: 'helppuff_crawl',
      description:
        'workers-ai: crawl pages into the knowledge base, in the background on Cloudflare. which: "selected" (default; the first time, the suggested pages), "suggested", "all", globs, or urls. Then poll helppuff_knowledge_status (or pass wait:true).',
      inputSchema: {
        type: 'object',
        properties: {
          ...cwdProp,
          which: { type: 'string' },
          urls: { type: 'array', items: { type: 'string' } },
          wait: { type: 'boolean', description: 'Wait until the crawl finishes (can take minutes).' },
        },
      },
      run: async (args) => {
        const loaded = loadProject(cwdOf(args, base));
        const api = adminApi(loaded);
        const urls = Array.isArray(args['urls']) ? args['urls'].map(String) : null;
        const which = typeof args['which'] === 'string' ? args['which'] : 'selected';
        const started = urls
          ? await startCrawlFromCli(api, { mode: 'urls', urls }, progress)
          : which === 'selected'
            ? await api.send<{ runId: string; total: number }>('POST', '/admin/api/knowledge/crawl', {})
            : await startCrawlFromCli(api, crawlOf(which), progress);
        if (args['wait'] !== true) return { ...started, status: 'started', next: 'helppuff_knowledge_status' };
        return { ...started, final: await waitForCrawl(api, started.runId, () => {}) };
      },
    },
    {
      name: 'helppuff_knowledge_status',
      description: 'workers-ai: crawl progress, page statuses, passage count, and today’s usage against the free daily budget.',
      inputSchema: { type: 'object', properties: cwdProp },
      run: async (args) => adminApi(loadProject(cwdOf(args, base))).get('/admin/api/knowledge/status'),
    },
    {
      name: 'helppuff_knowledge_add',
      description: 'workers-ai: add hand-written knowledge (a Q&A, a policy, a price list) — indexed and live at once.',
      inputSchema: { type: 'object', required: ['title', 'text'], properties: { ...cwdProp, title: { type: 'string' }, text: { type: 'string' }, id: { type: 'string' } } },
      run: async (args) =>
        adminApi(loadProject(cwdOf(args, base))).send('POST', '/admin/api/knowledge/manual', {
          title: String(args['title']),
          content: String(args['text']),
          ...(typeof args['id'] === 'string' ? { id: args['id'] } : {}),
        }),
    },
    {
      name: 'helppuff_ask',
      description:
        'Ask the deployed assistant a visitor question and see the passages retrieval found (with scores). Use it to check answers are grounded; when sources is empty the assistant should say it is not sure.',
      inputSchema: { type: 'object', required: ['question'], properties: { ...cwdProp, question: { type: 'string' }, session: { type: 'string' } } },
      run: async (args) => {
        const loaded = loadProject(cwdOf(args, base));
        const url = loaded.project.cloudflare.url;
        if (!url) return { ok: false, error: 'Not deployed yet. Call helppuff_deploy first.' };
        const question = String(args['question']);
        const [turn, search] = await Promise.all([
          chat({ url, site: loaded.project.site, origin: new URL(url).origin, message: question, session: typeof args['session'] === 'string' ? args['session'] : undefined, secret: loadEnv(loaded.dir)['HELPPUFF_SECRET'] }),
          loaded.project.backend.type === 'workers-ai'
            ? adminApi(loaded).send<{ chunks: { url: string; headingPath: string; score: number }[] }>('POST', '/admin/api/knowledge/search', { query: question }).catch(() => null)
            : Promise.resolve(null),
        ]);
        return { reply: turn.reply, session: turn.session, sources: search?.chunks.map((c) => ({ url: c.url, section: c.headingPath, score: c.score })) ?? null };
      },
    },
    {
      name: 'helppuff_chat',
      description: 'Send a visitor message to the deployed assistant (or local dev with local:true) and get its reply. Pass the returned session to continue the conversation.',
      inputSchema: {
        type: 'object',
        required: ['message'],
        properties: { ...cwdProp, message: { type: 'string' }, session: { type: 'string' }, local: { type: 'boolean' } },
      },
      run: async (args) => {
        const loaded = loadProject(cwdOf(args, base));
        const local = args['local'] === true;
        const portFile = resolve(loaded.dir, '.helppuff', 'dev', 'port');
        const port = existsSync(portFile) ? Number(readFileSync(portFile, 'utf8').trim()) : 8787;
        const url = local ? `http://localhost:${port}` : loaded.project.cloudflare.url;
        if (!url) return { ok: false, error: 'Not deployed yet. Call helppuff_deploy first.' };
        const turn = await chat({
          url,
          site: loaded.project.site,
          origin: local ? devOrigin(port) : new URL(url).origin,
          message: String(args['message']),
          session: typeof args['session'] === 'string' ? args['session'] : undefined,
          secret: loadEnv(loaded.dir)['HELPPUFF_SECRET'],
        });
        return { reply: turn.reply, messages: turn.messages, session: turn.session };
      },
    },
    {
      name: 'helppuff_status',
      description: 'The project summary: site, backend, deployed URL, preview and embed snippet.',
      inputSchema: { type: 'object', properties: cwdProp },
      run: async (args) => {
        const { project } = loadProject(cwdOf(args, base));
        const url = project.cloudflare.url;
        return {
          site: project.site,
          name: project.name,
          backend: project.backend,
          url,
          embed: url ? embedSnippet(url, project.site) : null,
          dashboard: url && project.dashboard.enabled ? `${url}/admin/` : null,
        };
      },
    },
    {
      name: 'helppuff_doctor',
      description: 'Run every health check (config, secrets, Cloudflare token, provider key, knowledge, Worker, live endpoint) with a fix for each failure.',
      inputSchema: { type: 'object', properties: cwdProp },
      run: async (args) => doctor(cwdOf(args, base)),
    },
    {
      name: 'helppuff_knowledge_sync',
      description: 'Re-crawl the website and re-upload knowledge files to the backend. Deploy afterwards if the result says so.',
      inputSchema: { type: 'object', properties: cwdProp },
      run: async (args) => {
        const loaded = loadProject(cwdOf(args, base));
        const env = loadEnv(loaded.dir);
        const cf = aiSearchInstanceFor(loaded.project) ? await cloudflareSession(env) : undefined;
        const result = await syncKnowledge(loaded, { env, progress, ...(cf ? { cf } : {}) });
        if (result.backendUpdate) updateProject(loaded, (raw) => Object.assign(raw['backend'] as object, result.backendUpdate));
        return result;
      },
    },
    {
      name: 'helppuff_config',
      description:
        'Read helppuff.json, or change one field by dotted path (e.g. widget.brand.accent, backend.model, knowledge.files). Changes are validated; call helppuff_deploy to publish.',
      inputSchema: {
        type: 'object',
        properties: { ...cwdProp, path: { type: 'string' }, value: { description: 'Omit to read. Any JSON value to set.' } },
      },
      run: async (args) => {
        const loaded = loadProject(cwdOf(args, base));
        const keys = typeof args['path'] === 'string' ? args['path'].split('.').filter(Boolean) : [];
        if (!('value' in args)) {
          return { value: keys.reduce<unknown>((acc, k) => (acc as Json | undefined)?.[k], loaded.project) };
        }
        const updated = updateProject(loaded, (raw) => {
          let node = raw as Json;
          for (const key of keys.slice(0, -1)) node = (node[key] ??= {}) as Json;
          node[keys.at(-1)!] = args['value'];
        });
        compile(updated);
        return { saved: true, next: 'helppuff_deploy' };
      },
    },
    {
      name: 'helppuff_prompt',
      description:
        "The assistant's system prompt (prompt.md), which is versioned. action: read (default) · write (replace prompt.md with text; helppuff_deploy publishes it as a new version) · status (prompt.md vs the live version: in_sync, ahead, behind, diverged) · pull (bring the live prompt, or `version`, into prompt.md — do this when deploy fails with prompt_behind or prompt_diverged; unpublished edits are kept in prompt.mine.md to merge) · history (every version: who, where, when).",
      inputSchema: {
        type: 'object',
        properties: {
          ...cwdProp,
          action: { type: 'string', enum: ['read', 'write', 'status', 'pull', 'history'] },
          text: { type: 'string', description: 'write: the new prompt' },
          version: { type: 'number', description: 'pull: an older version to restore into prompt.md' },
        },
      },
      run: async (args) => {
        const loaded = loadProject(cwdOf(args, base));
        const file = resolve(loaded.dir, loaded.project.prompt);
        const action = typeof args['action'] === 'string' ? args['action'] : typeof args['text'] === 'string' ? 'write' : 'read';
        if (action === 'write') {
          if (typeof args['text'] !== 'string') return { ok: false, error: 'write needs text.' };
          writeFileSync(file, `${args['text'].trim()}\n`);
          compile(loaded);
          return { saved: file, next: 'helppuff_deploy' };
        }
        if (action === 'read') return { text: existsSync(file) ? readFileSync(file, 'utf8') : '' };
        const remote = await remoteFor(loaded, loadEnv(loaded.dir));
        if (action === 'pull') {
          return pullPrompt(loaded, remote, typeof args['version'] === 'number' ? { version: args['version'] } : {});
        }
        if (action === 'history') return { versions: await promptHistory(remote, loaded.project.site) };
        const { live } = await readLivePrompt(remote, loaded.project.site);
        const baseVersion = readState(loaded.dir).prompt;
        return {
          status: live && !live.editable ? 'not_versioned' : promptSync(await promptHash(readLocalPrompt(loaded)), baseVersion, live),
          live: live ? { version: live.version, meta: live.meta } : null,
          basedOn: baseVersion?.version ?? null,
        };
      },
    },
    {
      name: 'helppuff_secret',
      description: 'Store a secret (e.g. OPENAI_API_KEY) in .env; it is uploaded to the Worker on the next deploy. Prefer asking the user to run `helppuff secret set NAME` themselves.',
      inputSchema: { type: 'object', required: ['name', 'value'], properties: { ...cwdProp, name: { type: 'string' }, value: { type: 'string' } } },
      run: async (args) => {
        const loaded = loadProject(cwdOf(args, base));
        const name = String(args['name']);
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return { ok: false, error: 'Secret names are UPPER_SNAKE_CASE.' };
        writeEnvVar(loaded.dir, name, String(args['value']));
        return { stored: name, next: 'helppuff_deploy' };
      },
    },
    {
      name: 'helppuff_schema',
      description: 'The JSON Schema of helppuff.json: every field with its description.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => projectJsonSchema(),
    },
  ];
}

const INSTRUCTIONS = `HelpPuff deploys an AI chat widget for a website to the user's Cloudflare account.
Typical flow: helppuff_setup (repeat while it returns needs_input, asking the user those questions) →
helppuff_deploy → helppuff_chat with a realistic visitor question → give the user the preview URL and embed snippet.
Change behaviour with helppuff_prompt, look and backend with helppuff_config, then helppuff_deploy. If deploy reports prompt_behind or prompt_diverged, the owner edited the prompt in the dashboard: helppuff_prompt action pull, merge, deploy again.`;

export async function serveMcp(base: string): Promise<number> {
  const registry = tools(base);
  const send = (frame: Json) => process.stdout.write(`${JSON.stringify(frame)}\n`);
  const rl = createInterface({ input: process.stdin });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let request: Json;
    try {
      request = JSON.parse(line) as Json;
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    const id = request['id'];
    const method = String(request['method'] ?? '');
    const params = (request['params'] ?? {}) as Json;
    if (id === undefined) continue; // A notification; none need answering.

    try {
      switch (method) {
        case 'initialize':
          send({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: typeof params['protocolVersion'] === 'string' ? params['protocolVersion'] : '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'helppuff', version: VERSION },
              instructions: INSTRUCTIONS,
            },
          });
          break;
        case 'ping':
          send({ jsonrpc: '2.0', id, result: {} });
          break;
        case 'tools/list':
          send({
            jsonrpc: '2.0',
            id,
            result: { tools: registry.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
          });
          break;
        case 'tools/call': {
          const tool = registry.find((t) => t.name === params['name']);
          if (!tool) {
            send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${String(params['name'])}` } });
            break;
          }
          try {
            const result = await tool.run((params['arguments'] ?? {}) as Json);
            send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
          } catch (thrown) {
            const error = isCliError(thrown) ? thrown.toJSON() : { code: 'unexpected', message: (thrown as Error).message };
            send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error }, null, 2) }] } });
          }
          break;
        }
        default:
          send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    } catch (thrown) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: (thrown as Error).message } });
    }
  }
  return 0;
}
