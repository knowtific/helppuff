import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi } from '../engine/admin-api.js';
import { PRESETS, loadProject, modelOf, retrievalOf, updateProject, type LoadedProject, type Preset } from '../engine/project.js';
import { secretsOf } from '../engine/assistant.js';
import type { Ctx } from './context.js';

/**
 * `helppuff model` and `helppuff rag`: who writes the answers, and what they
 * come from. Changed here (or in helppuff.json), then `helppuff deploy`;
 * never in the dashboard. `test` asks the deployed Worker.
 *
 *   model                         what answers now
 *   model set <provider> [--model …] [--preset …] [--base-url …] [--key-env …] [--module …] [--secrets A,B]
 *   model test ["question"]
 *   rag                           what answers come from now
 *   rag set <type> [--url …] [--module …] [--vector-store …] [--instance …] [--endpoint …] [--token-env …] [--secrets A,B]
 *   rag test ["question"]
 *   scaffold model|rag [--file …] [--use] [--force]
 */

const PROVIDERS = ['workers-ai', 'openai-compatible', 'openai', 'gemini', 'anthropic', 'custom'] as const;
const RETRIEVALS = ['helppuff', 'none', 'ai-search', 'openai-vector-store', 'http', 'custom'] as const;
/** Old backends that `model set` may replace: they split into `model` + `knowledge.retrieval` anyway. */
const REPLACEABLE = new Set(['assistant', 'workers-ai', 'cloudflare', 'openai', 'gemini', 'anthropic']);

const list = (value: string | undefined) => (value ? value.split(',').map((v) => v.trim()).filter(Boolean) : undefined);
const envName = (value: string | undefined, flag: string) => {
  if (value === undefined) return undefined;
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) throw new CliError('usage', `${flag} is a variable name like DEEPINFRA_API_KEY.`, { exitCode: EXIT.usage });
  return value;
};

/** Saved; a key it needs is not in .env yet: ask the user to store it (never through the chat). */
function askForSecrets(ctx: Ctx, missing: string[], what: string): number {
  return ctx.out.needsInput({
    message: `${what} is saved in helppuff.json, but ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not in .env yet.`,
    questions: missing.map((name) => ({
      id: name,
      ask: `The value of ${name}. The user stores it with \`helppuff secret set ${name}\` (a hidden prompt); never paste it into a chat.`,
      flag: `secret set ${name}`,
      kind: 'secret',
      required: true,
      envVar: name,
      secret: true,
    })),
    next: [...missing.map((name) => `helppuff secret set ${name}`), 'helppuff deploy --json', 'helppuff model test --json'],
  });
}

function describeModel(loaded: LoadedProject) {
  const project = loaded.project;
  const model = modelOf(project) as Record<string, unknown> | null;
  if (!model) return { backend: project.backend.type, note: `The ${project.backend.type} backend runs its own model.` };
  const preset = model['preset'] ? PRESETS[model['preset'] as Preset] : null;
  return {
    provider: model['provider'],
    model: model['model'] ?? (model['provider'] === 'workers-ai' ? '@cf/zai-org/glm-4.7-flash' : null),
    ...(preset ? { preset: model['preset'], baseUrl: preset.baseUrl } : model['baseUrl'] ? { baseUrl: model['baseUrl'] } : {}),
    ...(model['module'] ? { module: model['module'] } : {}),
    secrets: secretsOf(loaded),
  };
}

function describeRetrieval(loaded: LoadedProject) {
  const retrieval = retrievalOf(loaded.project);
  if (!retrieval) return { backend: loaded.project.backend.type, note: `The ${loaded.project.backend.type} backend keeps its own knowledge.` };
  return { ...retrieval, explicit: Boolean(loaded.project.knowledge.retrieval), secrets: secretsOf(loaded) };
}

async function test(ctx: Ctx, loaded: LoadedProject, part: 'model' | 'knowledge', question: string | undefined): Promise<number> {
  type Result = { ok: boolean; error?: string; reply?: string; passages?: { title: string; url: string | null; content: string; score: number }[]; ms: number; model?: string; provider?: string; note?: string };
  const result = await adminApi(loaded).send<Result>('POST', '/admin/api/assistant/test', { part, ...(question ? { question } : {}) });
  ctx.out.result(result, () => {
    if (!result.ok) {
      process.stdout.write(`${c.red('✖')} ${result.error}\n`);
      return;
    }
    if (part === 'model') process.stdout.write(`${c.green('✓')} ${result.provider} · ${result.model} · ${result.ms} ms\n${result.reply}\n`);
    else {
      if (result.note) process.stdout.write(`${c.dim(result.note)}\n`);
      for (const [i, p] of (result.passages ?? []).entries()) process.stdout.write(`[${i + 1}] ${c.bold(p.title)} ${c.dim(`${p.score}${p.url ? ` · ${p.url}` : ''}`)}\n    ${p.content.replace(/\s+/g, ' ').slice(0, 200)}\n`);
      if (!result.passages?.length && !result.note) process.stdout.write(c.dim('No passages matched.\n'));
      process.stdout.write(c.dim(`${result.ms} ms\n`));
    }
  });
  return result.ok ? 0 : EXIT.error;
}

export async function modelCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['model', 'preset', 'base-url', 'key-env', 'module', 'secrets', 'gateway', 'gateway-id', 'account-id', 'yes', 'y'], 'model');
  const [sub = 'show', arg, ...rest] = ctx.positionals;
  const loaded = loadProject(ctx.cwd);

  if (sub === 'show') {
    const described = describeModel(loaded);
    ctx.out.result(described, () => process.stdout.write(`${JSON.stringify(described, null, 2)}\n`));
    return 0;
  }
  if (sub === 'test') return test(ctx, loaded, 'model', [arg, ...rest].filter(Boolean).join(' ') || undefined);
  if (sub !== 'set') throw new CliError('usage', 'Usage: helppuff model [set <provider> …] [test "question"]', { exitCode: EXIT.usage });

  const provider = arg as (typeof PROVIDERS)[number];
  if (!PROVIDERS.includes(provider)) {
    return ctx.out.needsInput({ questions: [{ id: 'provider', ask: 'Which provider writes the answers?', flag: 'model set <provider>', kind: 'choice', required: true, options: PROVIDERS.map((value) => ({ value })) }] });
  }
  const backend = loaded.project.backend.type;
  if (!REPLACEABLE.has(backend) && !ctx.flags['yes'] && !ctx.flags['y']) {
    throw new CliError('backend_whole', `This project uses the ${backend} backend, which runs the whole conversation itself.`, { hint: 'Add --yes to replace it with HelpPuff\'s assistant and this model.', exitCode: EXIT.usage });
  }
  const model = str(ctx.flags, 'model');
  const preset = str(ctx.flags, 'preset') as Preset | undefined;
  if (preset && !(preset in PRESETS)) throw new CliError('usage', `--preset is one of: ${Object.keys(PRESETS).join(', ')}.`, { exitCode: EXIT.usage });
  const keyEnv = envName(str(ctx.flags, 'key-env'), '--key-env');
  const secrets = list(str(ctx.flags, 'secrets'));
  secrets?.forEach((name) => envName(name, '--secrets'));

  let next: Record<string, unknown>;
  switch (provider) {
    case 'workers-ai':
      next = { provider, ...(model ? { model } : {}), ...(str(ctx.flags, 'gateway') ? { gateway: str(ctx.flags, 'gateway') } : {}) };
      break;
    case 'openai-compatible': {
      const baseUrl = str(ctx.flags, 'base-url');
      if (!model || (!preset && !baseUrl)) {
        return ctx.out.needsInput({
          questions: [
            ...(!preset && !baseUrl ? [{ id: 'preset', ask: 'Which provider (a preset), or its base URL (--base-url)?', flag: '--preset', kind: 'choice', required: true, options: Object.keys(PRESETS).map((value) => ({ value })) }] : []),
            ...(!model ? [{ id: 'model', ask: 'The model id the provider expects, e.g. deepseek-ai/DeepSeek-V3.1', flag: '--model', kind: 'text', required: true }] : []),
          ],
        });
      }
      next = {
        provider,
        model,
        ...(preset ? { preset } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(keyEnv ? { apiKey: { env: keyEnv } } : !preset ? {} : {}),
        ...(str(ctx.flags, 'gateway-id') ? { gatewayId: str(ctx.flags, 'gateway-id') } : {}),
        ...(str(ctx.flags, 'account-id') ? { accountId: str(ctx.flags, 'account-id') } : {}),
      };
      break;
    }
    case 'openai':
    case 'gemini':
    case 'anthropic':
      next = { provider, ...(model ? { model } : {}), ...(keyEnv ? { apiKey: { env: keyEnv } } : {}) };
      break;
    case 'custom': {
      const module = str(ctx.flags, 'module');
      if (!module) {
        return ctx.out.needsInput({ questions: [{ id: 'module', ask: 'The TypeScript file whose default export is your model (`helppuff scaffold model` writes a starter).', flag: '--module', kind: 'text', required: true, default: './llm.ts' }] });
      }
      next = { provider, module, ...(model ? { model } : {}), ...(secrets ? { secrets } : {}) };
      break;
    }
  }

  const updated = updateProject(loaded, (raw) => {
    // The assistant's tuning (answer length, history, tools, the budget) stays with the new provider.
    const old = (raw['model'] as Record<string, unknown> | undefined) ?? {};
    const keep = Object.fromEntries(Object.entries(old).filter(([key]) => ['reasoning', 'fallbackModel', 'locale', 'timezone', 'maxAnswerSentences', 'maxOutputTokens', 'historyMessages', 'richMessages', 'tools', 'business', 'budget'].includes(key)));
    const backendRaw = raw['backend'] as { type?: string; retrieval?: unknown } | undefined;
    if (backendRaw) {
      // Keep what the old backend knew about the knowledge base.
      if (backendRaw.type === 'workers-ai' && backendRaw.retrieval && !(raw['knowledge'] as Record<string, unknown> | undefined)?.['retrieval']) {
        raw['knowledge'] = { ...((raw['knowledge'] as object) ?? {}), retrieval: { type: 'helppuff', ...(backendRaw.retrieval as object) } };
      }
      delete raw['backend'];
    }
    raw['model'] = { ...keep, ...next };
    raw['format'] = 2;
  });
  const { missing } = secretsOf(updated);
  if (missing.length) return askForSecrets(ctx, missing, `The ${provider} model`);
  const described = describeModel(updated) as Record<string, unknown>;
  ctx.out.result({ ...described, next: ['helppuff deploy --json', 'helppuff model test --json'] }, () => {
    ctx.out.success(`Answers will be written by ${provider}${described['model'] ? ` (${String(described['model'])})` : ''}.`);
    process.stdout.write(c.dim('Run `helppuff deploy` to make it live, then `helppuff model test`.\n'));
  });
  return 0;
}

export async function ragCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['url', 'module', 'vector-store', 'instance', 'endpoint', 'token-env', 'key-env', 'secrets'], 'rag');
  const [sub = 'show', arg, ...rest] = ctx.positionals;
  const loaded = loadProject(ctx.cwd);
  if (sub === 'show') {
    const described = describeRetrieval(loaded);
    ctx.out.result(described, () => process.stdout.write(`${JSON.stringify(described, null, 2)}\n`));
    return 0;
  }
  if (sub === 'test') return test(ctx, loaded, 'knowledge', [arg, ...rest].filter(Boolean).join(' ') || undefined);
  if (sub !== 'set') throw new CliError('usage', 'Usage: helppuff rag [set <type> …] [test "question"]', { exitCode: EXIT.usage });
  if (!retrievalOf(loaded.project)) {
    throw new CliError('backend_whole', `The ${loaded.project.backend.type} backend keeps its own knowledge.`, { hint: 'Switch to HelpPuff\'s assistant first: `helppuff model set <provider>`.', exitCode: EXIT.usage });
  }
  const type = arg as (typeof RETRIEVALS)[number];
  if (!RETRIEVALS.includes(type)) {
    return ctx.out.needsInput({ questions: [{ id: 'type', ask: 'What should answers come from?', flag: 'rag set <type>', kind: 'choice', required: true, options: RETRIEVALS.map((value) => ({ value })) }] });
  }
  const need = (flag: string, ask: string) => ctx.out.needsInput({ questions: [{ id: flag, ask, flag: `--${flag}`, kind: 'text', required: true }] });
  const secrets = list(str(ctx.flags, 'secrets'));
  let next: Record<string, unknown>;
  switch (type) {
    case 'helppuff':
    case 'none':
      next = { type };
      break;
    case 'ai-search':
      next = { type, ...(str(ctx.flags, 'instance') ? { instance: str(ctx.flags, 'instance') } : {}), ...(str(ctx.flags, 'endpoint') ? { endpoint: str(ctx.flags, 'endpoint') } : {}) };
      break;
    case 'openai-vector-store': {
      const id = str(ctx.flags, 'vector-store');
      if (!id) return need('vector-store', 'The OpenAI vector store id (vs_…), filled in OpenAI.');
      const key = envName(str(ctx.flags, 'key-env'), '--key-env');
      next = { type, vectorStoreId: id, ...(key ? { apiKey: { env: key } } : {}) };
      break;
    }
    case 'http': {
      const url = str(ctx.flags, 'url');
      if (!url) return need('url', 'Your search endpoint: it receives { query, question, siteId, limit } and answers { passages: [{ title, content, url? }] }.');
      const token = envName(str(ctx.flags, 'token-env'), '--token-env');
      next = { type, url, ...(token ? { token: { env: token } } : {}) };
      break;
    }
    case 'custom': {
      const module = str(ctx.flags, 'module');
      if (!module) return need('module', 'The TypeScript file whose default export is your retriever (`helppuff scaffold rag` writes a starter).');
      next = { type, module, ...(secrets ? { secrets } : {}) };
      break;
    }
  }
  const updated = updateProject(loaded, (raw) => {
    raw['knowledge'] = { ...((raw['knowledge'] as object) ?? {}), retrieval: next };
    raw['format'] = 2;
  });
  const { missing } = secretsOf(updated);
  if (missing.length) return askForSecrets(ctx, missing, `The ${type} knowledge base`);
  ctx.out.result({ ...describeRetrieval(updated), next: ['helppuff deploy --json', 'helppuff rag test --json'] }, () => {
    ctx.out.success(type === 'none' ? 'No knowledge base: answers come from the prompt and the business details.' : `Answers will come from ${type}.`);
    process.stdout.write(c.dim('Run `helppuff deploy` to make it live, then `helppuff rag test`.\n'));
  });
  return 0;
}

// ------------------------------------------------------------ scaffold

const MODEL_STARTER = `import type { LanguageModel } from '@knowtific/helppuff/sdk';

/**
 * Your own model for HelpPuff's assistant. It gets the conversation in the
 * OpenAI chat-completions shape (system prompt, turns, tools) and returns
 * the reply: text, and any tool calls. HelpPuff does the rest: the prompt,
 * the tools, citations, guardrails and history.
 *
 * Runs in your Cloudflare Worker: use \`fetch\`, read secrets from \`ctx.env\`
 * (list them under \`model.secrets\` in helppuff.json; store each with
 * \`helppuff secret set NAME\`). Test with \`helppuff model test\` after a deploy.
 */
export default {
  id: 'my-model',
  capabilities: { tools: true },
  async chat(request, ctx) {
    const response = await ctx.fetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${String(ctx.env['MY_MODEL_KEY'])}\` },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        ...(request.tools?.length ? { tools: request.tools } : {}),
      }),
      signal: request.signal,
    });
    if (!response.ok) throw new Error(\`model \${response.status}\`);
    const body = (await response.json()) as {
      choices: { message: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const message = body.choices[0]!.message;
    // Streaming is optional: call request.onText?.(piece) as text arrives to show it live.
    return {
      content: message.content ?? '',
      toolCalls: (message.tool_calls ?? []).map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })),
      usage: body.usage ? { input: body.usage.prompt_tokens, output: body.usage.completion_tokens } : null,
    };
  },
} satisfies LanguageModel;
`;

const RAG_STARTER = `import type { Retriever } from '@knowtific/helppuff/sdk';

/**
 * Your own knowledge base for HelpPuff's assistant: given the visitor's
 * question, return the passages that answer it, best first. HelpPuff numbers
 * them, gives them to the model as quoted context, and links the ones it
 * cites (when they have a \`url\`). What you search, and how, is up to you.
 *
 * Runs in your Cloudflare Worker: use \`fetch\`, read secrets from \`ctx.env\`
 * (list them under \`knowledge.retrieval.secrets\` in helppuff.json; store each
 * with \`helppuff secret set NAME\`). Test with \`helppuff rag test\` after a deploy.
 */
export default {
  id: 'my-knowledge',
  async search(request, ctx) {
    const response = await ctx.fetch('https://search.example.com/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${String(ctx.env['MY_SEARCH_KEY'])}\` },
      body: JSON.stringify({ query: request.query, limit: request.limit }),
    });
    if (!response.ok) throw new Error(\`search \${response.status}\`);
    const { results } = (await response.json()) as { results: { title: string; text: string; url?: string; score?: number }[] };
    return results.map((r) => ({ title: r.title, content: r.text, url: r.url, score: r.score }));
  },
} satisfies Retriever;
`;

export async function scaffoldCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['file', 'use', 'force'], 'scaffold');
  const [what] = ctx.positionals;
  if (what !== 'model' && what !== 'rag') throw new CliError('usage', 'Usage: helppuff scaffold model|rag [--file ./llm.ts] [--use] [--force]', { exitCode: EXIT.usage });
  const loaded = loadProject(ctx.cwd);
  const file = str(ctx.flags, 'file') ?? (what === 'model' ? './llm.ts' : './rag.ts');
  if (!/\.(ts|js|mjs)$/.test(file)) throw new CliError('usage', '--file is a .ts, .js or .mjs file.', { exitCode: EXIT.usage });
  const path = resolve(loaded.dir, file);
  if (existsSync(path) && !ctx.flags['force']) throw new CliError('file_exists', `${file} already exists.`, { hint: 'Pick another --file, or add --force to overwrite it.', exitCode: EXIT.usage });
  writeFileSync(path, what === 'model' ? MODEL_STARTER : RAG_STARTER);
  const secret = what === 'model' ? 'MY_MODEL_KEY' : 'MY_SEARCH_KEY';
  if (ctx.flags['use']) {
    updateProject(loaded, (raw) => {
      if (what === 'model') {
        raw['model'] = { provider: 'custom', module: file, secrets: [secret] };
        delete raw['backend'];
      } else {
        raw['knowledge'] = { ...((raw['knowledge'] as object) ?? {}), retrieval: { type: 'custom', module: file, secrets: [secret] } };
      }
      raw['format'] = 2;
    });
  }
  const next = [
    `Edit ${file}: the API you call, and the secret it reads (${secret})`,
    ...(ctx.flags['use'] ? [] : [what === 'model' ? `helppuff model set custom --module ${file} --secrets ${secret}` : `helppuff rag set custom --module ${file} --secrets ${secret}`]),
    `helppuff secret set ${secret}`,
    'helppuff deploy --json',
    `helppuff ${what === 'model' ? 'model' : 'rag'} test --json`,
  ];
  ctx.out.result({ file, used: Boolean(ctx.flags['use']), next }, () => {
    ctx.out.success(`Wrote ${file}.`);
    process.stdout.write(c.dim(`Types: npm i -D @knowtific/helppuff (optional; it deploys without).\nNext:\n${next.map((n) => `  ${n}`).join('\n')}\n`));
  });
  return 0;
}
