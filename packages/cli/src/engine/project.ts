import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { widgetConfigSchema } from '@helppuff/protocol';
import { assistantConfigSchema, liveConfigSchema, securitySchema } from '@helppuff/server';
import { workersAiOptionsSchema } from '@helppuff/connector-workers-ai';
import { CliError } from '../errors.js';

/**
 * `helppuff.json` — the one file a person or an agent edits.
 *
 * It describes *what* the assistant is (site, backend, prompt, knowledge,
 * widget) and never *how* it is deployed: the Worker config, the bundled
 * server config and the KV payloads are all compiled from it. Secrets are
 * never in it — only the names of environment variables that hold them,
 * whose values live in `.env` locally and as Worker secrets once deployed.
 *
 * Kept deliberately flatter than the server's own config: a backend is a
 * `type` plus a handful of fields, not a connector with nested options.
 */

export const PROJECT_FILE = 'helppuff.json';
export const PROMPT_FILE = 'prompt.md';
export const GENERATED_DIR = '.helppuff';

const envRef = z
  .object({ env: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'an UPPER_SNAKE_CASE variable name').describe('The variable name, e.g. `OPENAI_API_KEY`.') })
  .strict()
  .describe('A secret, by the name of the environment variable that holds it: kept in .env and set as a Worker secret, never written here.');
const secretRef = (fallback: string) => envRef.default({ env: fallback });

export const SITE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * Every resource helppuff creates on a Cloudflare account is named
 * `knowtific-helppuff-<site>`: the Worker, the KV namespace, the D1 database
 * and the AI Search instance. One prefix makes them easy to find, and to
 * tell apart from anything else on the account.
 */
export const RESOURCE_PREFIX = 'knowtific-helppuff';
export const resourceName = (site: string) => `${RESOURCE_PREFIX}-${site}`.slice(0, 63);

/** Where an AI Search instance comes from: one we manage, one that exists, or a public URL. */
const aiSearchFields = {
  instance: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional().describe('Instance name on your account. Created by `helppuff deploy` if it does not exist.'),
  endpoint: z.string().url().optional().describe('Use an existing public endpoint instead of a binding, e.g. https://search.example.com'),
};

/**
 * HelpPuff's own knowledge base: the Worker crawls the site into Vectorize +
 * D1 and answers with Workers AI. Everything is optional; leaving a field
 * out takes the connector's default (see `helppuff schema`). The prompt comes
 * from prompt.md, and the bindings are wired by `helppuff deploy`.
 */
const workersAiBackend = workersAiOptionsSchema
  .omit({ instructions: true, bindings: true, stream: true, provider: true, knowledge: true })
  .partial()
  .extend({ type: z.literal('workers-ai').describe('Workers AI with HelpPuff\'s own knowledge base. The default; runs on the Workers Free plan.') })
  .strict();

// ------------------------------------------------------------------ model

/**
 * OpenAI-compatible providers: the base URL and the key's variable name, so
 * `{ "provider": "openai-compatible", "preset": "deepinfra", "model": … }`
 * is enough. Verified against each provider's docs on 2026-10-08.
 */
export const PRESETS = {
  deepinfra: { baseUrl: 'https://api.deepinfra.com/v1/openai', key: 'DEEPINFRA_API_KEY', label: 'DeepInfra' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', label: 'OpenRouter' },
  deepseek: { baseUrl: 'https://api.deepseek.com', key: 'DEEPSEEK_API_KEY', label: 'DeepSeek' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', label: 'Groq' },
  together: { baseUrl: 'https://api.together.xyz/v1', key: 'TOGETHER_API_KEY', label: 'Together AI' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', key: 'MISTRAL_API_KEY', label: 'Mistral' },
  fireworks: { baseUrl: 'https://api.fireworks.ai/inference/v1', key: 'FIREWORKS_API_KEY', label: 'Fireworks' },
  'vercel-ai-gateway': { baseUrl: 'https://ai-gateway.vercel.sh/v1', key: 'AI_GATEWAY_API_KEY', label: 'Vercel AI Gateway' },
  'cloudflare-ai-gateway': { baseUrl: 'https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/compat', key: 'CF_AIG_TOKEN', label: 'Cloudflare AI Gateway' },
} as const;
export type Preset = keyof typeof PRESETS;

/** How the assistant behaves, whoever runs the model: answer length, history, tools, the budget. */
const tuning = workersAiOptionsSchema
  .pick({ reasoning: true, fallbackModel: true, locale: true, timezone: true, maxAnswerSentences: true, maxOutputTokens: true, historyMessages: true, richMessages: true, tools: true, business: true })
  .partial().shape;
const budgetSchema = z
  .object({
    dailyNeurons: z.number().int().min(0).max(10_000_000).optional().describe('Workers AI only: neurons per UTC day before answers stop (default 9,000; the free allocation is 10,000). Raise it on Workers Paid.'),
    maxInputTokens: z.number().int().min(1000).max(100_000).optional().describe('The most tokens sent to the model per answer: prompt, passages and history, trimmed to fit.'),
  })
  .strict()
  .optional()
  .describe('Spend guards. Other providers bill you directly; cap them with `security.limits.messagesPerSitePerDay`.');

export const modelSchema = z
  .discriminatedUnion('provider', [
    z
      .object({
        provider: z.literal('workers-ai').describe('Workers AI, on your Cloudflare account. The default: no key, on the Free plan.'),
        model: z.string().min(1).max(200).optional().describe('A Workers AI model id. Default: GLM-4.7 Flash.'),
        gateway: z.string().min(1).max(64).optional().describe('An AI Gateway id: caching, logs and rate limits in front of every Workers AI call.'),
        budget: budgetSchema,
        ...tuning,
      })
      .strict(),
    z
      .object({
        provider: z.literal('openai-compatible').describe('Any OpenAI-compatible `/chat/completions` API with tools.'),
        preset: z.enum(Object.keys(PRESETS) as [Preset, ...Preset[]]).optional().describe('Fills `baseUrl` and the key\'s variable name: deepinfra, openrouter, deepseek, groq, together, mistral, fireworks, vercel-ai-gateway, cloudflare-ai-gateway.'),
        baseUrl: z.string().url().optional().describe('The API base, before `/chat/completions`. Needed without a preset.'),
        model: z.string().min(1).max(200).describe('The model id the provider expects, e.g. `deepseek-ai/DeepSeek-V3.1`.'),
        apiKey: envRef.optional().describe('The key, by environment variable name. Default: the preset\'s (e.g. `DEEPINFRA_API_KEY`).'),
        headers: z.record(z.string(), z.union([z.string().max(2000), envRef])).optional().describe('Extra headers; a value may be a secret (`{ env }`).'),
        nativeTools: z.boolean().optional().describe('The model calls tools natively (default true). Off: tool calls it writes in its text are still read.'),
        accountId: z.string().regex(/^[0-9a-f]{32}$/).optional().describe('cloudflare-ai-gateway: the account (default: the one deployed to).'),
        gatewayId: z.string().min(1).max(64).optional().describe('cloudflare-ai-gateway: the gateway (default: `default`).'),
        gatewayToken: envRef.optional().describe('cloudflare-ai-gateway: an authenticated gateway\'s token, sent as `cf-aig-authorization`.'),
        budget: budgetSchema,
        ...tuning,
      })
      .strict(),
    z
      .object({
        provider: z.literal('openai').describe('OpenAI.'),
        model: z.string().min(1).default('gpt-5-mini').describe('The OpenAI model.'),
        apiKey: secretRef('OPENAI_API_KEY').describe('Your OpenAI API key, by environment variable name.'),
        budget: budgetSchema,
        ...tuning,
      })
      .strict(),
    z
      .object({
        provider: z.literal('gemini').describe('Google Gemini (its OpenAI-compatible API).'),
        model: z.string().min(1).default('gemini-3-flash').describe('The Gemini model.'),
        apiKey: secretRef('GEMINI_API_KEY').describe('Your Gemini API key, by environment variable name.'),
        budget: budgetSchema,
        ...tuning,
      })
      .strict(),
    z
      .object({
        provider: z.literal('anthropic').describe('Anthropic Claude (the Messages API).'),
        model: z.string().min(1).default('claude-opus-5').describe('The Claude model.'),
        apiKey: secretRef('ANTHROPIC_API_KEY').describe('Your Anthropic API key, by environment variable name.'),
        budget: budgetSchema,
        ...tuning,
      })
      .strict(),
    z
      .object({
        provider: z.literal('custom').describe('Your own model: a TypeScript file whose default export is `defineModel({ id, chat })`. See the wiki\'s Custom model page.'),
        module: z.string().min(1).regex(/\.(ts|js|mjs)$/, 'a .ts, .js or .mjs file').describe('The file, relative to helppuff.json, e.g. `./llm.ts`. Bundled into the Worker at deploy.'),
        model: z.string().min(1).max(200).optional().describe('Passed to your `chat` as `request.model`.'),
        secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(20).optional().describe('The environment variables your file reads (`env.NAME`): uploaded as Worker secrets at deploy.'),
        budget: budgetSchema,
        ...tuning,
      })
      .strict(),
  ])
  .describe('Who writes the answers. Leave it out for Workers AI. Changed only here (or with `helppuff model set`), then `helppuff deploy`.');
export type ModelConfig = z.infer<typeof modelSchema>;

/** The knowledge base's tuning, for HelpPuff's own (the old `backend.retrieval`). */
const helppuffRetrieval = workersAiOptionsSchema.shape.retrieval._def.innerType.partial().shape;

export const retrievalSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('helppuff').describe('HelpPuff\'s own knowledge base: your site and files, learned by the Worker (Vectorize + D1).'), ...helppuffRetrieval }).strict(),
    z.object({ type: z.literal('none').describe('No knowledge base: the prompt and the business details only.') }).strict(),
    z
      .object({
        type: z.literal('ai-search').describe('Cloudflare AI Search, searched for passages; your model writes the answer.'),
        ...aiSearchFields,
        maxResults: z.number().int().min(1).max(50).optional().describe('Passages per question.'),
      })
      .strict(),
    z
      .object({
        type: z.literal('openai-vector-store').describe('An OpenAI vector store you fill in OpenAI, searched for passages.'),
        vectorStoreId: z.string().min(1).describe('The vector store id, e.g. `vs_…`.'),
        apiKey: secretRef('OPENAI_API_KEY').describe('An OpenAI API key that can read it.'),
      })
      .strict(),
    z
      .object({
        type: z.literal('http').describe('Your own search over HTTP: `POST url { query, question, siteId, limit }` → `{ passages: [{ title, content, url? }] }`.'),
        url: z.string().url().describe('Your endpoint.'),
        token: envRef.optional().describe('Sent as `Authorization: Bearer …`.'),
      })
      .strict(),
    z
      .object({
        type: z.literal('custom').describe('Your own knowledge base: a TypeScript file whose default export is `defineRetriever({ id, search })`. See the wiki\'s Custom knowledge base page.'),
        module: z.string().min(1).regex(/\.(ts|js|mjs)$/, 'a .ts, .js or .mjs file').describe('The file, relative to helppuff.json, e.g. `./rag.ts`.'),
        secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(20).optional().describe('The environment variables your file reads: uploaded as Worker secrets at deploy.'),
      })
      .strict(),
  ])
  .describe('What answers come from. Left out: HelpPuff\'s own knowledge base. `none` for none. Changed only here (or with `helppuff rag set`), then `helppuff deploy`.');
export type RetrievalConfig = z.infer<typeof retrievalSchema>;

export const backendSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('assistant').describe('HelpPuff\'s own assistant, set up by `model` and `knowledge.retrieval`. Implied when `backend` is left out; never written by hand.'),
    })
    .strict(),
  workersAiBackend,
  z
    .object({
      type: z.literal('cloudflare').describe('Cloudflare AI Search: retrieval and generation managed by Cloudflare.'),
      ...aiSearchFields,
      model: z.string().min(1).optional().describe('Workers AI model id, or an AI Gateway alias. Empty uses the instance\'s own model.'),
      maxResults: z.number().int().min(1).max(50).optional().describe('Passages AI Search retrieves per question.'),
    })
    .strict(),
  z
    .object({
      type: z.literal('openai').describe('OpenAI (Responses API), or any compatible endpoint with `baseUrl`.'),
      model: z.string().min(1).default('gpt-5-mini').describe('The OpenAI model.'),
      apiKey: secretRef('OPENAI_API_KEY').describe('Your OpenAI API key, by environment variable name.'),
      vectorStoreId: z.string().min(1).optional().describe('Filled in by `helppuff knowledge sync`.'),
      retrieval: z.literal('helppuff').optional().describe('`helppuff`: answer from HelpPuff\'s own knowledge base (crawled by the Worker) instead of a vector store.'),
      promptId: z.string().min(1).optional().describe('A stored prompt in the OpenAI dashboard; overrides prompt.md.'),
      baseUrl: z.string().url().optional().describe('Another OpenAI-compatible Responses endpoint, e.g. Azure OpenAI.'),
    })
    .strict(),
  z
    .object({
      type: z.literal('gemini').describe('Google Gemini, with File Search.'),
      model: z.string().min(1).default('gemini-3-flash').describe('The Gemini model.'),
      apiKey: secretRef('GEMINI_API_KEY').describe('Your Gemini API key, by environment variable name.'),
      fileSearchStore: z.string().min(1).optional().describe('Filled in by `helppuff knowledge sync`.'),
      retrieval: z.literal('helppuff').optional().describe('`helppuff`: answer from HelpPuff\'s own knowledge base instead of File Search.'),
    })
    .strict(),
  z
    .object({
      type: z.literal('anthropic').describe('Anthropic Claude, grounded in AI Search or HelpPuff\'s own knowledge base.'),
      model: z.string().min(1).default('claude-opus-5').describe('The Claude model.'),
      apiKey: secretRef('ANTHROPIC_API_KEY').describe('Your Anthropic API key, by environment variable name.'),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional().describe('How hard Claude thinks before answering. Lower is faster and cheaper.'),
      knowledge: z.boolean().optional().describe('Ground answers in a Cloudflare AI Search instance. On by default when there is knowledge.'),
      retrieval: z.literal('helppuff').optional().describe('`helppuff`: ground answers in HelpPuff\'s own knowledge base instead of AI Search.'),
      ...aiSearchFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('http').describe('Your own API.'),
      url: z.string().url().describe('Your API\'s base URL.'),
      mode: z.enum(['helppuff', 'openai']).default('helppuff').describe('`helppuff`: your API speaks the HelpPuff backend protocol. `openai`: any /chat/completions endpoint.'),
      model: z.string().min(1).optional().describe('`openai` mode: the model name your endpoint expects.'),
      token: envRef.optional().describe('Sent as `Authorization: Bearer …`.'),
      signingSecret: envRef.optional().describe('Signs every request with HMAC-SHA256 so your API can verify it.'),
      stream: z.boolean().default(true).describe('Stream replies as they are written.'),
    })
    .strict(),
  z
    .object({
      type: z.literal('retell').describe('A Retell chat agent.'),
      agentId: z.string().min(1).describe('The Retell chat agent id.'),
      apiKey: secretRef('RETELL_API_KEY').describe('Your Retell API key, by environment variable name.'),
      retrieval: z.literal('helppuff').optional().describe('`helppuff`: crawl the site into HelpPuff\'s knowledge base; the agent searches it via a custom function (see `helppuff status`).'),
    })
    .strict(),
  z.object({ type: z.literal('echo').describe('Echoes what it is sent, with a demo of every widget feature. For development; needs no key.') }).strict(),
]).describe('Only for a backend that runs the whole conversation itself: `retell`, `http` (your own API), `echo`, or `openai` / `gemini` with their own file stores. Otherwise leave it out and use `model` and `knowledge.retrieval`.');
export type Backend = z.infer<typeof backendSchema>;
export type BackendType = Backend['type'];

export const BACKENDS_WITH_PROMPT: readonly BackendType[] = ['assistant', 'workers-ai', 'cloudflare', 'openai', 'gemini', 'anthropic', 'http'];
/** What `init` asks about: the old backend names, written as `model` + `knowledge.retrieval` by `splitBackend`. */
export const DEFAULT_BACKEND: BackendType = 'workers-ai';

export const knowledgeSchema = z
  .object({
    /** Crawl the website and index its pages. */
    website: z
      .union([
        z.boolean(),
        z
          .object({
            maxPages: z.number().int().min(1).max(1000).optional().describe('Default: 300 for workers-ai (crawled by the Worker), 50 for the others (crawled here).'),
            include: z.array(z.string().min(1)).optional().describe('Only crawl URLs matching one of these: a substring, or a glob like `**/services/**`.'),
            exclude: z.array(z.string().min(1)).optional().describe('Never crawl URLs matching one of these. Defaults leave out privacy, terms, tags, carts and accounts.'),
            renderJs: z.enum(['auto', 'always', 'never']).optional().describe('workers-ai: render pages drawn by JavaScript with Browser Rendering (`auto` = only when needed).'),
            schedule: z.enum(['off', 'daily', 'weekly', 'monthly']).optional().describe('workers-ai: re-crawl the selected pages on this schedule.'),
          })
          .strict(),
      ])
      .default(true)
      .describe('Learn from the website: `true` (the defaults), `false`, or which pages and how often.'),
    files: z.array(z.string().min(1)).default([]).describe('Files and folders to index, relative to helppuff.json. PDF, Markdown, text, HTML, DOCX.'),
    retrieval: retrievalSchema.optional(),
  })
  .strict();

/**
 * The helppuff.json format. When a release moves or renames a field, it bumps
 * this and adds a step to PROJECT_UPGRADES: a file in the old format is then
 * read as the new one everywhere, and `helppuff upgrade` writes it back.
 */
export const PROJECT_FORMAT = 2;

export type ProjectUpgrade = { to: number; describe: string; apply: (raw: Record<string, unknown>) => void };

/** One step per format bump, in order. Each must be safe to run on any file of the previous format. */
export const PROJECT_UPGRADES: readonly ProjectUpgrade[] = [
  {
    to: 2,
    describe: 'The model and the knowledge base are chosen separately: `backend` becomes `model` + `knowledge.retrieval` (except Retell, your own API, echo, and OpenAI or Gemini with their own file stores).',
    apply: (raw) => splitBackend(raw),
  },
];

/**
 * An old-style `backend` as `model` + `knowledge.retrieval`, in place. Kept
 * as a whole backend when it runs the conversation itself or cannot be split
 * without losing something: Retell, your own API in `helppuff` mode (or
 * signed), echo, OpenAI with a stored prompt, a vector store HelpPuff fills
 * or another base URL, Gemini with File Search.
 */
export function splitBackend(raw: Record<string, unknown>): void {
  const b = raw['backend'] as Record<string, unknown> | undefined;
  if (!b || typeof b !== 'object') return;
  const knowledge = (raw['knowledge'] && typeof raw['knowledge'] === 'object' ? raw['knowledge'] : (raw['knowledge'] = {})) as Record<string, unknown>;
  const files = Array.isArray(knowledge['files']) ? knowledge['files'] : [];
  const learns = (knowledge['website'] !== false && Boolean(raw['website'])) || files.length > 0;
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  const done = (model: Record<string, unknown>, retrieval: Record<string, unknown> | null) => {
    delete raw['backend'];
    raw['model'] = model;
    if (retrieval) knowledge['retrieval'] = retrieval;
  };
  switch (b['type']) {
    case 'workers-ai': {
      const { type: _type, retrieval, ...rest } = b;
      return done({ provider: 'workers-ai', ...rest }, retrieval ? { type: 'helppuff', ...(retrieval as object) } : null);
    }
    case 'cloudflare':
      return done({ provider: 'workers-ai', ...pick(['model']) }, { type: 'ai-search', ...pick(['instance', 'endpoint', 'maxResults']) });
    case 'anthropic': {
      const own = b['retrieval'] === 'helppuff';
      const search = !own && (b['knowledge'] !== undefined ? b['knowledge'] === true : Boolean(b['endpoint'] || b['instance'] || learns));
      return done({ provider: 'anthropic', ...pick(['model', 'apiKey']) }, own ? { type: 'helppuff' } : search ? { type: 'ai-search', ...pick(['instance', 'endpoint']) } : { type: 'none' });
    }
    case 'openai': {
      if (b['promptId'] || b['baseUrl']) return;
      if (b['retrieval'] === 'helppuff') return done({ provider: 'openai', ...pick(['model', 'apiKey']) }, { type: 'helppuff' });
      if (!learns) return done({ provider: 'openai', ...pick(['model', 'apiKey']) }, { type: 'none' });
      return;
    }
    case 'gemini': {
      if (b['retrieval'] === 'helppuff') return done({ provider: 'gemini', ...pick(['model', 'apiKey']) }, { type: 'helppuff' });
      if (!learns && !b['fileSearchStore']) return done({ provider: 'gemini', ...pick(['model', 'apiKey']) }, { type: 'none' });
      return;
    }
    case 'http': {
      if (b['mode'] !== 'openai' || b['signingSecret']) return;
      return done({ provider: 'openai-compatible', baseUrl: b['url'], model: b['model'] ?? 'default', ...(b['token'] ? { apiKey: b['token'] } : {}) }, { type: 'none' });
    }
    default:
      return;
  }
}

/** A raw helppuff.json in the current format, and what changed to get there. Pure: the input is not modified. */
export function upgradeProjectFile(
  input: Record<string, unknown>,
  upgrades: readonly ProjectUpgrade[] = PROJECT_UPGRADES,
  current = PROJECT_FORMAT,
): { raw: Record<string, unknown>; from: number; changes: string[] } {
  const from = typeof input['format'] === 'number' ? input['format'] : 1;
  if (from > current) {
    throw new CliError('project_too_new', `${PROJECT_FILE} is format ${from}, written by a newer helppuff than this one (format ${current}).`, {
      hint: 'Run the newer CLI: npx @knowtific/helppuff@latest',
    });
  }
  const raw = structuredClone(input);
  const changes: string[] = [];
  for (const step of upgrades) {
    if (step.to <= from || step.to > current) continue;
    step.apply(raw);
    changes.push(step.describe);
  }
  if (changes.length) raw['format'] = current;
  return { raw, from, changes };
}

export const projectSchema = z
  .object({
    $schema: z.string().optional().describe('The JSON Schema for editors and agents. Written by helppuff.'),
    format: z.number().int().min(1).optional().describe('The helppuff.json format version. Absent means 1; `helppuff upgrade` updates it when a release changes the format.'),
    site: z.string().regex(SITE_ID, 'lowercase letters, digits and dashes, starting with a letter or digit').describe('Site id: lowercase letters, digits and dashes. Appears in the embed snippet.'),
    name: z.string().min(1).max(60).describe('The business name, as visitors see it.'),
    website: z.string().url().optional().describe('The website the assistant is for, and learns from.'),
    origins: z.array(z.string().url()).min(1).describe('Every origin the widget may be embedded on. The preview page is added automatically.'),
    backend: backendSchema.optional(),
    model: modelSchema.optional(),
    prompt: z.string().min(1).default(PROMPT_FILE).describe('Path to the system prompt, relative to helppuff.json.'),
    knowledge: knowledgeSchema.default({}).describe('What the assistant learns from: the website, and your own files.'),
    widget: widgetConfigSchema.default({}).describe('Brand, launcher, home screen, lead form, flows — see `helppuff schema`.'),
    assistant: assistantConfigSchema
      .default({})
      .describe('How the assistant behaves: goal, tone, answer length. HelpPuff writes these around prompt.md on every answer, so prompt.md holds only what is specific to the business.'),
    security: securitySchema.default({}).describe('Rate limits, daily cap, Turnstile. The defaults are safe for a public site.'),
    live: liveConfigSchema
      .default({})
      .describe('Live chat: visitors can talk to a person on your team, who answers from the dashboard or Telegram. Off by default. `helppuff live on` turns it on.'),
    leads: z
      .object({
        webhook: z
          .union([z.string().url(), envRef])
          .optional()
          .describe('POST each lead to this URL (or to the URL in this environment variable). For every event, add webhooks in the dashboard instead.'),
      })
      .strict()
      .default({})
      .describe('Where leads go besides the dashboard.'),
    dashboard: z
      .object({
        enabled: z.boolean().default(true).describe('Serve the dashboard at <worker>/admin.'),
        adminEmail: z.string().email().optional().describe('The owner\'s email, for backends without a setup link. workers-ai: set on the setup page instead.'),
        summaryModel: z.string().min(1).optional().describe('Workers AI model used for conversation summaries.'),
      })
      .strict()
      .default({})
      .describe('The dashboard at <worker>/admin: conversations, leads, knowledge, analytics and settings, stored in D1 on your account.'),
    cloudflare: z
      .object({
        accountId: z.string().regex(/^[0-9a-f]{32}$/).optional().describe('The Cloudflare account deployed to.'),
        workerName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional().describe('The Worker\'s name. Default: knowtific-helppuff-<site>.'),
        url: z.string().url().optional().describe('Where the Worker answers.'),
        kvNamespaceId: z.string().optional().describe('The KV namespace (live config, new-conversation counters).'),
        d1DatabaseId: z.string().optional().describe('The D1 database (conversations, leads, knowledge).'),
        vectorizeIndex: z.string().optional().describe('The Vectorize index (knowledge vectors).'),
      })
      .strict()
      .default({})
      .describe('Written by `helppuff deploy`. Safe to commit; holds no secrets.'),
  })
  .strict();

/** A parsed project: `backend` is always there (`assistant` when it was left out). */
export type Project = Omit<z.infer<typeof projectSchema>, 'backend'> & { backend: z.infer<typeof backendSchema> };
export type ProjectInput = z.input<typeof projectSchema>;

export type LoadedProject = { dir: string; file: string; project: Project; raw: Record<string, unknown> };

/** Walk up from `start` to the nearest helppuff.json. */
export function findProjectDir(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, PROJECT_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadProject(cwd: string): LoadedProject {
  const loaded = findProject(cwd);
  if (!loaded) {
    throw new CliError('no_project', `No ${PROJECT_FILE} found in ${cwd} or any parent folder.`, {
      hint: 'Run `helppuff init` to create one.',
    });
  }
  return loaded;
}

/** The nearest project from `cwd`, or null before `helppuff init`. */
export function findProject(cwd: string): LoadedProject | null {
  const dir = findProjectDir(cwd);
  if (!dir) return null;
  const file = join(dir, PROJECT_FILE);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (thrown) {
    throw new CliError('invalid_project', `${PROJECT_FILE} is not valid JSON: ${(thrown as Error).message}`);
  }
  // An older format is read as the current one; `helppuff upgrade` saves it.
  raw = upgradeProjectFile(raw).raw;
  return { dir, file, project: parseProject(raw), raw };
}

export function parseProject(raw: unknown): Project {
  const parsed = projectSchema
    .superRefine((p, ctx) => {
      if (p.backend && p.backend.type !== 'assistant' && p.model) ctx.addIssue({ code: 'custom', path: ['model'], message: `\`model\` is for HelpPuff's assistant; the ${p.backend.type} backend runs its own. Remove one of them.` });
      if (p.backend && p.knowledge.retrieval && !['assistant', 'workers-ai'].includes(p.backend.type)) ctx.addIssue({ code: 'custom', path: ['knowledge', 'retrieval'], message: `the ${p.backend.type} backend keeps its own knowledge; \`knowledge.retrieval\` is for HelpPuff's assistant.` });
      if (p.model?.provider === 'openai-compatible' && !p.model.preset && !p.model.baseUrl) ctx.addIssue({ code: 'custom', path: ['model', 'baseUrl'], message: 'needed without a `preset`' });
    })
    .transform((p) => ({ ...p, backend: p.backend ?? ({ type: 'assistant' } as const) }))
    .safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new CliError('invalid_project', `${PROJECT_FILE} has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`, {
      hint: 'Fix the fields above, or run `helppuff schema` to see every allowed field.',
      details: { problems },
    });
  }
  return parsed.data;
}

/**
 * Write the project back. Keys the user wrote are kept in their order and
 * fields left at their default are not expanded into the file, so a diff of
 * helppuff.json only ever shows what actually changed.
 */
export function saveProject(dir: string, next: ProjectInput): void {
  parseProject(next);
  const file = join(dir, PROJECT_FILE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}

/** Read-modify-write on the raw file, so defaults are not written back. */
export function updateProject(loaded: LoadedProject, change: (raw: Record<string, unknown>) => void): LoadedProject {
  const raw = structuredClone(loaded.raw);
  change(raw);
  saveProject(loaded.dir, raw as ProjectInput);
  return { ...loaded, raw, project: parseProject(raw) };
}

/** The Worker's name: stable per site, valid as a DNS label. */
export function workerNameFor(project: Project): string {
  return project.cloudflare.workerName ?? resourceName(project.site);
}

/** The AI Search instance a project uses, when it uses one through a binding. */
export function aiSearchInstanceFor(project: Project): string | null {
  const backend = project.backend;
  const retrieval = retrievalOf(project);
  if (retrieval?.type === 'ai-search') return retrieval.endpoint ? null : (retrieval.instance ?? resourceName(project.site));
  if (backend.type === 'cloudflare') return backend.endpoint ? null : (backend.instance ?? resourceName(project.site));
  if (backend.type === 'anthropic' && usesAnthropicKnowledge(project)) {
    return backend.endpoint ? null : (backend.instance ?? resourceName(project.site));
  }
  return null;
}

export function usesAnthropicKnowledge(project: Project): boolean {
  const backend = project.backend;
  if (backend.type !== 'anthropic' || backend.retrieval === 'helppuff') return false;
  if (backend.knowledge !== undefined) return backend.knowledge;
  return Boolean(backend.endpoint || backend.instance || hasKnowledge(project));
}

export function hasKnowledge(project: Project): boolean {
  return (project.knowledge.website !== false && Boolean(project.website)) || project.knowledge.files.length > 0;
}

/** HelpPuff's assistant answers (the default), rather than a whole backend. */
export const isAssistant = (project: Project) => project.backend.type === 'assistant';

/** The assistant's model: what helppuff.json says, or Workers AI. Null for a whole backend. */
export function modelOf(project: Project): ModelConfig | null {
  if (!isAssistant(project)) return null;
  return project.model ?? { provider: 'workers-ai' };
}

/** The assistant's knowledge: what helppuff.json says, else HelpPuff's own. Null for a whole backend. */
export function retrievalOf(project: Project): RetrievalConfig | null {
  if (!isAssistant(project)) return null;
  // HelpPuff's own by default: even with no website or files, the dashboard can add knowledge to it.
  return project.knowledge.retrieval ?? { type: 'helppuff' };
}

/** Workers AI runs the answers: the assistant with Workers AI, or the old `workers-ai` backend. */
export const usesWorkersAi = (project: Project) => project.backend.type === 'workers-ai' || modelOf(project)?.provider === 'workers-ai';

/**
 * HelpPuff's own knowledge base is deployed (Vectorize, the crawl Workflow,
 * the setup link): always for workers-ai, and for openai / gemini /
 * anthropic with `retrieval: "helppuff"` — retrieval stays on Cloudflare and
 * only generation moves to the provider.
 */
export const usesHelpPuffKnowledge = (project: Project) =>
  project.backend.type === 'workers-ai' || retrievalOf(project)?.type === 'helppuff' || ('retrieval' in project.backend && project.backend.retrieval === 'helppuff');

/**
 * Whether this project deploys the dashboard. With workers-ai the first
 * account is created from the setup link, so no admin email is needed up
 * front; the other backends still name the owner in helppuff.json.
 */
export function dashboardEnabled(project: Project): boolean {
  return project.dashboard.enabled && (Boolean(project.dashboard.adminEmail) || usesHelpPuffKnowledge(project));
}

/** D1 holds the dashboard and, for workers-ai, the knowledge base. */
export function needsDatabase(project: Project): boolean {
  return dashboardEnabled(project) || usesHelpPuffKnowledge(project);
}

/** The Vectorize index a workers-ai project uses. */
export function vectorizeIndexFor(project: Project): string | null {
  return usesHelpPuffKnowledge(project) ? (project.cloudflare.vectorizeIndex ?? resourceName(project.site)) : null;
}
