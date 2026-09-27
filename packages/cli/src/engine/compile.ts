import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectSecretNames, murmurConfigSchema, normalizePrompt, storedSiteConfigSchema, getConnector } from '@murmur/server';
import { CliError } from '../errors.js';
import {
  BACKENDS_WITH_PROMPT,
  aiSearchInstanceFor,
  dashboardEnabled,
  resourceName,
  usesAnthropicKnowledge,
  workerNameFor,
  type LoadedProject,
  type Project,
} from './project.js';

/**
 * murmur.json → everything the Worker needs.
 *
 *  - `serverConfig`  bundled into the Worker: the full site, origins included
 *  - `storedConfig`  pushed to KV as `config:<site>`: everything but origins,
 *                    so content changes go live without a redeploy
 *  - `wrangler`      the Worker's bindings, name and assets
 *  - `secrets`       every environment variable the config references
 *
 * The prompt is inlined into the connector options rather than kept under a
 * separate KV key: one KV write then updates prompt and config together,
 * and the bundled copy is a complete fallback if KV is ever unreadable.
 */

export const AI_SEARCH_BINDING = 'AI_SEARCH';
export const KV_BINDING = 'MURMUR_KV';
export const DB_BINDING = 'MURMUR_DB';
/** Supports the `ai_search` binding (introduced 2026-03-27). */
export const COMPATIBILITY_DATE = '2026-03-27';
export const DEV_PORT = 8787;
export const DEV_ORIGIN = `http://localhost:${DEV_PORT}`;
export const devOrigin = (port = DEV_PORT) => `http://localhost:${port}`;

export type Compiled = {
  site: string;
  workerName: string;
  serverConfig: unknown;
  storedConfig: unknown;
  wrangler: Record<string, unknown>;
  secrets: string[];
  aiSearchInstance: string | null;
  /** Changes only when the Worker itself must be redeployed. */
  workerHash: string;
};

export function readPrompt(loaded: LoadedProject): string | undefined {
  if (!BACKENDS_WITH_PROMPT.includes(loaded.project.backend.type)) return undefined;
  const file = resolve(loaded.dir, loaded.project.prompt);
  if (!existsSync(file)) {
    throw new CliError('missing_prompt', `The prompt file ${loaded.project.prompt} does not exist.`, {
      hint: 'Create it, or point `prompt` in murmur.json at the right file.',
    });
  }
  const text = normalizePrompt(readFileSync(file, 'utf8'));
  if (text.length > 16_000) {
    throw new CliError('prompt_too_long', `${loaded.project.prompt} is ${text.length} characters; the limit is 16000.`, {
      hint: 'Move reference material into the knowledge base (`knowledge.files`) and keep the prompt to instructions.',
    });
  }
  return text || undefined;
}

export function connectorFor(project: Project, prompt: string | undefined): { type: string; options: Record<string, unknown> } {
  const backend = project.backend;
  const instructions = prompt ? { instructions: prompt } : {};
  switch (backend.type) {
    case 'cloudflare':
      return {
        type: 'cloudflare',
        options: {
          ...(backend.endpoint ? { endpoint: backend.endpoint } : { binding: AI_SEARCH_BINDING }),
          ...(backend.model ? { model: backend.model } : {}),
          ...(backend.maxResults ? { maxResults: backend.maxResults } : {}),
          ...instructions,
          stream: true,
        },
      };
    case 'openai':
      return {
        type: 'openai',
        options: {
          apiKey: backend.apiKey,
          model: backend.model,
          ...(backend.promptId ? { promptRef: { id: backend.promptId } } : instructions),
          ...(backend.vectorStoreId ? { vectorStoreIds: [backend.vectorStoreId] } : {}),
          ...(backend.baseUrl ? { baseUrl: backend.baseUrl } : {}),
          stream: true,
        },
      };
    case 'gemini':
      return {
        type: 'gemini',
        options: {
          apiKey: backend.apiKey,
          model: backend.model,
          ...(prompt ? { systemInstruction: prompt } : {}),
          ...(backend.fileSearchStore ? { fileSearchStores: [backend.fileSearchStore] } : {}),
          stream: true,
        },
      };
    case 'anthropic':
      return {
        type: 'anthropic',
        options: {
          apiKey: backend.apiKey,
          model: backend.model,
          ...(backend.effort ? { effort: backend.effort } : {}),
          ...instructions,
          ...(usesAnthropicKnowledge(project)
            ? { knowledge: backend.endpoint ? { endpoint: backend.endpoint } : { binding: AI_SEARCH_BINDING } }
            : {}),
          stream: true,
        },
      };
    case 'http':
      return {
        type: 'http',
        options: {
          url: backend.url,
          mode: backend.mode,
          ...(backend.model ? { model: backend.model } : {}),
          ...(backend.token ? { apiKey: backend.token } : {}),
          ...(backend.mode === 'openai' ? instructions : {}),
          ...(backend.signingSecret ? { signingSecret: backend.signingSecret } : {}),
          stream: backend.stream,
        },
      };
    case 'retell':
      return {
        type: 'retell',
        options: {
          apiKey: backend.apiKey,
          agentId: backend.agentId,
          dynamicVariables: { customer_name: '{{lead.name}}', page_url: '{{context.pageUrl}}' },
        },
      };
    case 'echo':
      return { type: 'echo', options: { stream: true } };
  }
}

export function compile(
  loaded: LoadedProject,
  options: {
    workerUrl?: string | undefined;
    kvNamespaceId?: string;
    d1DatabaseId?: string | undefined;
    dev?: boolean;
    devPort?: number;
    runtimeVersion?: string;
  } = {},
): Compiled {
  const { project } = loaded;
  const prompt = readPrompt(loaded);
  const connector = connectorFor(project, prompt);

  // Validate connector options with the connector's own schema — the same
  // check the Worker does at runtime — so a bad field fails here, not live.
  try {
    getConnector(connector.type).parseOptions(connector.options);
  } catch (thrown) {
    const issues = (thrown as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    throw new CliError(
      'invalid_backend',
      `The ${connector.type} backend options are invalid${issues ? `:\n  ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')}` : ''}`,
    );
  }

  const widget: Record<string, unknown> = { ...(project.widget as Record<string, unknown>) };
  if (project.security.captcha && !widget['captcha']) {
    widget['captcha'] = { provider: 'turnstile', siteKey: project.security.captcha.siteKey };
  }

  const sinks = project.leads.webhook ? [{ type: 'webhook', options: { url: project.leads.webhook } }] : [];
  const origins = [
    ...new Set([
      ...project.origins,
      ...(options.workerUrl ? [new URL(options.workerUrl).origin] : []),
      ...(options.dev ? [devOrigin(options.devPort)] : []),
    ]),
  ];

  // Local testing makes many sessions from one IP; production limits would
  // start refusing them within minutes.
  const security = options.dev
    ? { ...project.security, limits: { ...project.security.limits, messagesPerIpPerMinute: 600, sessionsPerIpPerHour: 1000 } }
    : project.security;
  const stored = { connector, sinks, security, widget };
  const site = { origins, ...stored };
  const serverConfig = { sites: { [project.site]: site } };

  const parsedServer = murmurConfigSchema.safeParse(serverConfig);
  if (!parsedServer.success) {
    throw new CliError(
      'invalid_config',
      `The compiled config is invalid:\n  ${parsedServer.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')}`,
    );
  }
  const parsedStored = storedSiteConfigSchema.safeParse(stored);
  if (!parsedStored.success) {
    throw new CliError('invalid_config', `The KV config is invalid: ${parsedStored.error.message}`);
  }

  const dashboard = dashboardEnabled(project);
  const secrets = [...collectSecretNames(site), ...(dashboard ? ['ADMIN_PASSWORD_HASH'] : [])].sort();
  const aiSearchInstance = aiSearchInstanceFor(project);
  const workerName = workerNameFor(project);

  const wrangler: Record<string, unknown> = {
    name: workerName,
    main: 'worker.mjs',
    compatibility_date: COMPATIBILITY_DATE,
    // The Anthropic SDK imports Node built-ins.
    compatibility_flags: ['nodejs_compat'],
    workers_dev: true,
    kv_namespaces: [{ binding: KV_BINDING, id: options.kvNamespaceId ?? 'murmur-local' }],
    ...(aiSearchInstance
      ? { ai_search: [{ binding: AI_SEARCH_BINDING, instance_name: aiSearchInstance, ...(options.dev ? { remote: true } : {}) }] }
      : {}),
    ...(dashboard
      ? {
          d1_databases: [
            { binding: DB_BINDING, database_name: resourceName(project.site), database_id: options.d1DatabaseId ?? 'murmur-local' },
          ],
          // Workers AI, for conversation summaries.
          ai: { binding: 'AI' },
        }
      : {}),
    assets: { directory: 'assets', not_found_handling: 'none' },
    vars: {
      MURMUR_LOG: options.dev ? '1' : '0',
      ...(dashboard ? { ADMIN_EMAIL: project.dashboard.adminEmail!.toLowerCase() } : {}),
      ...(dashboard && project.dashboard.summaryModel ? { MURMUR_SUMMARY_MODEL: project.dashboard.summaryModel } : {}),
    },
    observability: { enabled: true },
  };

  const workerHash = createHash('sha256')
    .update(JSON.stringify({ wrangler, origins, site: project.site, runtime: options.runtimeVersion ?? 'dev' }))
    .digest('hex')
    .slice(0, 16);

  return {
    site: project.site,
    workerName,
    serverConfig,
    storedConfig: stored,
    wrangler,
    secrets: ['MURMUR_SECRET', ...secrets.filter((name) => name !== 'MURMUR_SECRET')],
    aiSearchInstance,
    workerHash,
  };
}

export function dashboardUrl(workerUrl: string): string {
  return `${workerUrl.replace(/\/$/, '')}/admin/`;
}

export function embedSnippet(workerUrl: string, site: string): string {
  return `<script src="${workerUrl.replace(/\/$/, '')}/loader.js" data-site="${site}" async></script>`;
}
