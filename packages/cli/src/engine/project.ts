import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { widgetConfigSchema } from '@murmur/protocol';
import { securitySchema } from '@murmur/server';
import { CliError } from '../errors.js';

/**
 * `murmur.json` — the one file a person or an agent edits.
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

export const PROJECT_FILE = 'murmur.json';
export const PROMPT_FILE = 'prompt.md';
export const GENERATED_DIR = '.murmur';

const envRef = z.object({ env: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'an UPPER_SNAKE_CASE variable name') }).strict();
const secretRef = (fallback: string) => envRef.default({ env: fallback });

export const SITE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * Every resource murmur creates on a Cloudflare account is named
 * `knowtific-murmur-<site>`: the Worker, the KV namespace, the D1 database
 * and the AI Search instance. One prefix makes them easy to find, and to
 * tell apart from anything else on the account.
 */
export const RESOURCE_PREFIX = 'knowtific-murmur';
export const resourceName = (site: string) => `${RESOURCE_PREFIX}-${site}`.slice(0, 63);

/** Where an AI Search instance comes from: one we manage, one that exists, or a public URL. */
const aiSearchFields = {
  /** Instance name on your account. Created by `murmur deploy` if it does not exist. */
  instance: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(),
  /** Use an existing public endpoint instead of a binding, e.g. https://search.example.com */
  endpoint: z.string().url().optional(),
};

export const backendSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('cloudflare'),
      ...aiSearchFields,
      /** Workers AI model id, or an AI Gateway alias. Empty uses the instance's own model. */
      model: z.string().min(1).optional(),
      maxResults: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('openai'),
      model: z.string().min(1).default('gpt-5-mini'),
      apiKey: secretRef('OPENAI_API_KEY'),
      /** Filled in by `murmur knowledge sync`. */
      vectorStoreId: z.string().min(1).optional(),
      /** A stored prompt in the OpenAI dashboard; overrides prompt.md. */
      promptId: z.string().min(1).optional(),
      baseUrl: z.string().url().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('gemini'),
      model: z.string().min(1).default('gemini-3-flash'),
      apiKey: secretRef('GEMINI_API_KEY'),
      /** Filled in by `murmur knowledge sync`. */
      fileSearchStore: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('anthropic'),
      model: z.string().min(1).default('claude-opus-5'),
      apiKey: secretRef('ANTHROPIC_API_KEY'),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
      /** Ground answers in a Cloudflare AI Search instance. On by default when there is knowledge. */
      knowledge: z.boolean().optional(),
      ...aiSearchFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('http'),
      url: z.string().url(),
      /** `murmur`: your API speaks the Murmur backend protocol. `openai`: any /chat/completions endpoint. */
      mode: z.enum(['murmur', 'openai']).default('murmur'),
      model: z.string().min(1).optional(),
      /** Sent as `Authorization: Bearer …`. */
      token: envRef.optional(),
      /** Signs every request with HMAC-SHA256 so your API can verify it. */
      signingSecret: envRef.optional(),
      stream: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      type: z.literal('retell'),
      agentId: z.string().min(1),
      apiKey: secretRef('RETELL_API_KEY'),
    })
    .strict(),
  z.object({ type: z.literal('echo') }).strict(),
]);
export type Backend = z.infer<typeof backendSchema>;
export type BackendType = Backend['type'];

export const BACKENDS_WITH_KNOWLEDGE: readonly BackendType[] = ['cloudflare', 'openai', 'gemini', 'anthropic'];
export const BACKENDS_WITH_PROMPT: readonly BackendType[] = ['cloudflare', 'openai', 'gemini', 'anthropic', 'http'];

export const knowledgeSchema = z
  .object({
    /** Crawl the website and index its pages. */
    website: z
      .union([
        z.boolean(),
        z
          .object({
            maxPages: z.number().int().min(1).max(500).default(50),
            /** Only crawl URLs containing one of these. */
            include: z.array(z.string().min(1)).optional(),
            exclude: z.array(z.string().min(1)).optional(),
          })
          .strict(),
      ])
      .default(true),
    /** Files and folders to index, relative to murmur.json. PDF, Markdown, text, HTML, DOCX. */
    files: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const projectSchema = z
  .object({
    $schema: z.string().optional(),
    /** Site id: lowercase letters, digits and dashes. Appears in the embed snippet. */
    site: z.string().regex(SITE_ID, 'lowercase letters, digits and dashes, starting with a letter or digit'),
    name: z.string().min(1).max(60),
    website: z.string().url().optional(),
    /** Every origin the widget may be embedded on. The preview page is added automatically. */
    origins: z.array(z.string().url()).min(1),
    backend: backendSchema,
    /** Path to the system prompt, relative to murmur.json. */
    prompt: z.string().min(1).default(PROMPT_FILE),
    knowledge: knowledgeSchema.default({}),
    /** Brand, launcher, home screen, lead form, flows — see `murmur schema`. */
    widget: widgetConfigSchema.default({}),
    /** Rate limits, daily cap, Turnstile. The defaults are safe for a public site. */
    security: securitySchema.default({}),
    leads: z
      .object({ webhook: z.union([z.string().url(), envRef]).optional() })
      .strict()
      .default({}),
    /**
     * The CRM dashboard at <worker>/admin: conversations, leads, analytics
     * and AI summaries, stored in a D1 database on your account. The owner
     * signs in with this email and the password whose hash is the
     * ADMIN_PASSWORD_HASH secret (`murmur users reset <email>` to change it).
     */
    dashboard: z
      .object({
        enabled: z.boolean().default(true),
        adminEmail: z.string().email().optional(),
        /** Workers AI model used for conversation summaries. */
        summaryModel: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
    /** Written by `murmur deploy`. Safe to commit; holds no secrets. */
    cloudflare: z
      .object({
        accountId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
        workerName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional(),
        url: z.string().url().optional(),
        kvNamespaceId: z.string().optional(),
        d1DatabaseId: z.string().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
export type ProjectInput = z.input<typeof projectSchema>;

export type LoadedProject = { dir: string; file: string; project: Project; raw: Record<string, unknown> };

/** Walk up from `start` to the nearest murmur.json. */
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
  const dir = findProjectDir(cwd);
  if (!dir) {
    throw new CliError('no_project', `No ${PROJECT_FILE} found in ${cwd} or any parent folder.`, {
      hint: 'Run `murmur init` to create one.',
    });
  }
  const file = join(dir, PROJECT_FILE);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (thrown) {
    throw new CliError('invalid_project', `${PROJECT_FILE} is not valid JSON: ${(thrown as Error).message}`);
  }
  return { dir, file, project: parseProject(raw), raw };
}

export function parseProject(raw: unknown): Project {
  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new CliError('invalid_project', `${PROJECT_FILE} has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`, {
      hint: 'Fix the fields above, or run `murmur schema` to see every allowed field.',
      details: { problems },
    });
  }
  return parsed.data;
}

/**
 * Write the project back. Keys the user wrote are kept in their order and
 * fields left at their default are not expanded into the file, so a diff of
 * murmur.json only ever shows what actually changed.
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
  if (backend.type !== 'anthropic') return false;
  if (backend.knowledge !== undefined) return backend.knowledge;
  return Boolean(backend.endpoint || backend.instance || hasKnowledge(project));
}

export function hasKnowledge(project: Project): boolean {
  return (project.knowledge.website !== false && Boolean(project.website)) || project.knowledge.files.length > 0;
}

/** Whether this project deploys the dashboard (and so needs D1 and an admin). */
export function dashboardEnabled(project: Project): boolean {
  return project.dashboard.enabled && Boolean(project.dashboard.adminEmail);
}
