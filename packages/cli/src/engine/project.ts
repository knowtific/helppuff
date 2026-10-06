import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { widgetConfigSchema } from '@helppuff/protocol';
import { assistantConfigSchema, securitySchema } from '@helppuff/server';
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
  .omit({ instructions: true, bindings: true, stream: true })
  .partial()
  .extend({ type: z.literal('workers-ai').describe('Workers AI with HelpPuff\'s own knowledge base. The default; runs on the Workers Free plan.') })
  .strict();

export const backendSchema = z.discriminatedUnion('type', [
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
]).describe('What answers visitors. `type` picks it; the other fields depend on the type.');
export type Backend = z.infer<typeof backendSchema>;
export type BackendType = Backend['type'];

export const BACKENDS_WITH_PROMPT: readonly BackendType[] = ['workers-ai', 'cloudflare', 'openai', 'gemini', 'anthropic', 'http'];
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
  })
  .strict();

/**
 * The helppuff.json format. When a release moves or renames a field, it bumps
 * this and adds a step to PROJECT_UPGRADES: a file in the old format is then
 * read as the new one everywhere, and `helppuff upgrade` writes it back.
 */
export const PROJECT_FORMAT = 1;

export type ProjectUpgrade = { to: number; describe: string; apply: (raw: Record<string, unknown>) => void };

/** One step per format bump, in order. Each must be safe to run on any file of the previous format. */
export const PROJECT_UPGRADES: readonly ProjectUpgrade[] = [];

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
    backend: backendSchema,
    prompt: z.string().min(1).default(PROMPT_FILE).describe('Path to the system prompt, relative to helppuff.json.'),
    knowledge: knowledgeSchema.default({}).describe('What the assistant learns from: the website, and your own files.'),
    widget: widgetConfigSchema.default({}).describe('Brand, launcher, home screen, lead form, flows — see `helppuff schema`.'),
    assistant: assistantConfigSchema
      .default({})
      .describe('How the assistant behaves: goal, tone, answer length. HelpPuff writes these around prompt.md on every answer, so prompt.md holds only what is specific to the business.'),
    security: securitySchema.default({}).describe('Rate limits, daily cap, Turnstile. The defaults are safe for a public site.'),
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

export type Project = z.infer<typeof projectSchema>;
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
  const parsed = projectSchema.safeParse(raw);
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

export const usesWorkersAi = (project: Project) => project.backend.type === 'workers-ai';

/**
 * HelpPuff's own knowledge base is deployed (Vectorize, the crawl Workflow,
 * the setup link): always for workers-ai, and for openai / gemini /
 * anthropic with `retrieval: "helppuff"` — retrieval stays on Cloudflare and
 * only generation moves to the provider.
 */
export const usesHelpPuffKnowledge = (project: Project) =>
  usesWorkersAi(project) || ('retrieval' in project.backend && project.backend.retrieval === 'helppuff');

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
