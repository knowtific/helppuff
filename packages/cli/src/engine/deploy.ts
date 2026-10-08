import { createHash, randomBytes } from 'node:crypto';
import { PACKAGE_NAME, VERSION } from './version.js';
import {
  migrate,
  newer,
  helppuffConfigSchema,
  promptField,
  promptHash,
  readSettings,
  settingsHash,
  siteConfigKey,
  type PromptMeta,
  type StoredSiteConfig,
} from '@helppuff/server';
import { DEFAULT_RETRIEVAL, EMBEDDING_DIMENSIONS } from '@helppuff/rag';
import { EXIT } from '../errors.js';
import { adminApi, type AdminApi } from './admin-api.js';
import { CliError } from '../errors.js';
import { chatPage, previewPage, runtimeVersion, writeWorker } from './build.js';
import { compile, dashboardUrl, embedSnippet } from './compile.js';
import { cloudflareSession, type CloudflareSession } from './credentials.js';
import { loadEnv, writeEnvVar } from './env.js';
import {
  ensureAiSearchInstance,
  indexingStatus,
  knowledgeMissing,
  syncKnowledge,
  uploadFilesToWorker,
  type FilesSynced,
  type IndexingStatus,
  type Progress,
  type SyncResult,
} from './knowledge.js';
import {
  driftError,
  promptFile,
  promptSync,
  publisher,
  readLivePrompt,
  readLocalPrompt,
  recordPublish,
  type LivePrompt,
  type Remote,
} from './prompt.js';
import {
  dashboardEnabled,
  needsDatabase,
  resourceName,
  updateProject,
  usesHelpPuffKnowledge,
  vectorizeIndexFor,
  workerNameFor,
  type LoadedProject,
  type Project,
} from './project.js';
import { readState, writeState } from './state.js';
import { wranglerDeploy } from './wrangler.js';

/**
 * `helppuff deploy`, end to end. Safe to run again at any time: every step
 * finds what exists before creating anything.
 *
 *   1. Cloudflare session, workers.dev subdomain → the Worker's URL
 *   2. KV namespace; AI Search instance (a binding must exist before deploy)
 *   3. Knowledge, on the first deploy or when asked
 *   4. The Worker itself — skipped when only content changed
 *   5. Secrets the config references, when missing or changed
 *   6. The site config into KV — this is what makes content changes live
 *   7. A health check through the real protocol endpoint
 */

/** Which pages to crawl after a workers-ai deploy. Omitted: none (the setup page or `helppuff crawl` picks them). */
export type CrawlRequest =
  | { mode: 'suggested' | 'all' }
  | { mode: 'match'; include: string[] }
  | { mode: 'urls'; urls: string[] };

export type DeployOptions = {
  knowledge?: 'auto' | 'force' | 'skip';
  crawl?: CrawlRequest;
  /**
   * No person is at the setup page to do onboarding (an AI agent, CI): when
   * the site has never been learned, start learning the suggested pages
   * (helppuff.json's `knowledge.website.include`/`exclude` shape the
   * suggestion) and read the business details now, so the assistant is ready
   * without anyone opening the dashboard.
   */
  unattended?: boolean;
  /** Deploy although the Worker runs a newer release (a deliberate rollback). */
  allowDowngrade?: boolean;
  /** Publish over settings changed in the dashboard since this folder last pulled them. */
  overwriteSettings?: boolean;
  forceWorker?: boolean;
  dryRun?: boolean;
  cf?: { token?: string | undefined; accountId?: string | undefined };
  fetch?: typeof fetch;
  progress?: Progress;
};

export type DeployResult = {
  url: string;
  /** The CRM dashboard, when enabled. */
  dashboard: string | null;
  preview: string;
  embed: string;
  site: string;
  account: { id: string; name: string | null };
  workerDeployed: boolean;
  secretsUploaded: string[];
  knowledge: SyncResult | null;
  /** The prompt version now live, and whether this deploy published it. Null when the backend keeps its own prompt. */
  prompt: { version: number; published: boolean } | null;
  /** AI Search indexing progress. Deploy never waits for it; answers improve as it completes. */
  indexing: IndexingStatus | null;
  /** workers-ai: the one-time link that creates the first dashboard account (24 hours). Null once set up. */
  setupUrl: string | null;
  /** workers-ai: the crawl this deploy started, if any. It runs in the background. */
  crawl: { runId: string; total: number } | null;
  /** workers-ai: local files uploaded as knowledge entries. */
  files: FilesSynced | null;
  /**
   * Jobs, set up after the deploy: `waiting` (chosen from the website when the crawl
   * ends), `done` (chosen now), `kept` (already set up, or the owner's own). Null: no dashboard.
   */
  jobs: { status: 'waiting' | 'done' | 'kept'; template: string; chosenBy: string; reason: string | null } | null;
  healthy: boolean;
  warnings: string[];
};

const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/** A workers.dev subdomain, created from the account name if the account has none. */
async function ensureSubdomain(cf: CloudflareSession, progress?: Progress, readOnly = false): Promise<string> {
  const existing = await cf.api.subdomain(cf.accountId);
  if (existing) return existing;
  if (readOnly) return '<your-subdomain>';
  const base = (cf.accountName ?? 'helppuff').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'helppuff';
  for (const candidate of [base, `${base}-${randomBytes(2).toString('hex')}`, `knowtific-${randomBytes(3).toString('hex')}`]) {
    try {
      progress?.(`Registering the workers.dev subdomain "${candidate}"…`);
      return await cf.api.createSubdomain(cf.accountId, candidate);
    } catch {
      // Taken; try the next.
    }
  }
  throw new CliError('no_subdomain', 'Could not register a workers.dev subdomain for this account.', {
    hint: 'Open Workers & Pages in the Cloudflare dashboard once to pick one, then run `helppuff deploy` again.',
  });
}

/**
 * A generated secret, kept in .env so redeploys reuse it:
 *  - HELPPUFF_SECRET signs session tokens (rotating it logs visitors out);
 *  - ADMIN_API_KEY is how this CLI (and agents) call the Worker's admin API.
 */
function ensureGeneratedSecret(dir: string, env: Record<string, string>, name: 'HELPPUFF_SECRET' | 'ADMIN_API_KEY'): string {
  const existing = env[name] ?? (name === 'ADMIN_API_KEY' ? env['HELPPUFF_ADMIN_API_KEY'] : undefined);
  if (existing && existing.length >= 32) return existing;
  const secret = name === 'ADMIN_API_KEY' ? `hp_${randomBytes(32).toString('base64url')}` : randomBytes(32).toString('base64');
  writeEnvVar(dir, name, secret);
  env[name] = secret;
  return secret;
}

export function embeddingModelFor(project: Project): string {
  const backend = project.backend;
  return backend.type === 'workers-ai' ? (backend.retrieval?.embeddingModel ?? DEFAULT_RETRIEVAL.embeddingModel) : DEFAULT_RETRIEVAL.embeddingModel;
}

export async function deploy(initial: LoadedProject, options: DeployOptions = {}): Promise<DeployResult> {
  const progress = options.progress;
  const doFetch = options.fetch ?? fetch;
  let loaded = initial;
  const warnings: string[] = [];
  const env = loadEnv(loaded.dir);

  // Fail on a bad config before touching Cloudflare.
  const checked = compile(loaded);

  progress?.('Connecting to Cloudflare…');
  const cf = await cloudflareSession(env, { token: options.cf?.token, accountId: options.cf?.accountId }, doFetch);
  const workerName = workerNameFor(loaded.project);
  const subdomain = await ensureSubdomain(cf, progress, options.dryRun);
  const url = `https://${workerName}.${subdomain}.workers.dev`;

  // Never go backwards by accident (an old npx cache, a stale global install):
  // a rollback is a choice, made with --allow-downgrade.
  const live = await liveVersion(url, doFetch);
  if (live.version && newer(live.version, VERSION) && !options.allowDowngrade) {
    throw new CliError('downgrade', `The Worker runs helppuff ${live.version}; this is ${VERSION}, which is older.`, {
      hint: `Upgrade instead: npx ${PACKAGE_NAME}@latest upgrade — or, to roll back on purpose, add --allow-downgrade.`,
      details: { live: live.version, cli: VERSION },
    });
  }

  // Secrets are checked up front: a Worker deployed without them answers
  // every visitor with an error.
  if (!options.dryRun) {
    ensureGeneratedSecret(loaded.dir, env, 'HELPPUFF_SECRET');
    if (needsDatabase(loaded.project)) ensureGeneratedSecret(loaded.dir, env, 'ADMIN_API_KEY');
  }
  const required = compile(loaded, { workerUrl: url }).secrets;
  const missing = required.filter((name) => !env[name] && !(options.dryRun && (name === 'HELPPUFF_SECRET' || name === 'ADMIN_API_KEY')));
  if (missing.length) {
    throw new CliError('missing_secret', `Missing secret(s): ${missing.join(', ')}.`, {
      hint: missing
        .map((name) =>
          name === 'ADMIN_PASSWORD_HASH' ? `helppuff users reset ${loaded.project.dashboard.adminEmail ?? '<email>'}` : `helppuff secret set ${name}`,
        )
        .join('\n'),
      details: { missing },
    });
  }

  if (options.dryRun) {
    const compiled = compile(loaded, { workerUrl: url });
    return {
      url,
      dashboard: dashboardEnabled(loaded.project) ? dashboardUrl(url) : null,
      preview: url,
      embed: embedSnippet(url, compiled.site),
      site: compiled.site,
      account: { id: cf.accountId, name: cf.accountName },
      workerDeployed: false,
      secretsUploaded: [],
      knowledge: null,
      indexing: null,
      healthy: false,
      prompt: null,
      setupUrl: null,
      crawl: null,
      files: null,
      jobs: null,
      warnings: ['dry run: nothing was changed'],
    };
  }

  progress?.('Preparing storage…');
  const kvNamespaceId = await cf.api.ensureKvNamespace(cf.accountId, resourceName(loaded.project.site));
  let d1DatabaseId: string | undefined;
  if (needsDatabase(loaded.project)) {
    progress?.('Preparing the database…');
    d1DatabaseId = await cf.api.ensureD1Database(cf.accountId, resourceName(loaded.project.site));
    const databaseId = d1DatabaseId;
    await migrate((sql, params) => cf.api.d1Query(cf.accountId, databaseId, sql, params));
  } else if (loaded.project.dashboard.enabled) {
    warnings.push('The dashboard is on but has no admin: set it with `helppuff config set dashboard.adminEmail you@example.com`.');
  }
  const vectorizeIndex = vectorizeIndexFor(loaded.project);
  if (vectorizeIndex) {
    const model = embeddingModelFor(loaded.project);
    const dimensions = EMBEDDING_DIMENSIONS[model];
    if (!dimensions) {
      throw new CliError('unknown_embedding_model', `helppuff does not know the vector size of ${model}.`, {
        hint: `Use one of: ${Object.keys(EMBEDDING_DIMENSIONS).join(', ')}`,
        exitCode: EXIT.usage,
      });
    }
    progress?.('Preparing the vector index…');
    await cf.api.ensureVectorizeIndex(cf.accountId, vectorizeIndex, dimensions);
  }
  await ensureAiSearchInstance(cf.api, cf.accountId, loaded.project, progress, doFetch);

  // The prompt may have moved on since this folder last saw it — edited in
  // the dashboard, or deployed from elsewhere. Refuse before changing
  // anything rather than publish over a version nobody here has read.
  const state = readState(loaded.dir);
  const promptRemote: Remote = { cf, kvNamespaceId, d1DatabaseId: d1DatabaseId ?? null };
  let promptMeta: PromptMeta | null = null;
  let promptToPublish: { text: string; hash: string; live: LivePrompt | null } | null = null;
  const connector = (checked.storedConfig as StoredSiteConfig).connector;
  if (connector && promptField(connector).editable) {
    progress?.('Checking the live prompt…');
    const text = readLocalPrompt(loaded);
    const hash = await promptHash(text);
    const { live } = await readLivePrompt(promptRemote, loaded.project.site);
    const sync = promptSync(hash, state.prompt, live);
    if (sync === 'behind' || sync === 'diverged') throw driftError(sync, live!, state.prompt, promptFile(loaded));
    if (sync === 'in_sync') {
      promptMeta = live!.meta;
      state.prompt = { version: live!.version, hash };
    } else {
      promptToPublish = { text, hash, live };
    }
  }

  // Settings edited in the dashboard live only in KV until pulled; publishing
  // helppuff.json over them would silently undo the owner's changes.
  const { stored: liveStored } = await readLivePrompt(promptRemote, loaded.project.site).catch(() => ({ stored: null }));
  const liveSettings = liveStored?.settings;
  // A deploy's own write (from any copy of helppuff.json) may be replaced; anything else must be pulled first.
  if (liveSettings && liveSettings.by !== 'deploy' && liveSettings.hash !== state.settings?.hash && !options.overwriteSettings) {
    throw new CliError('settings_changed', `Settings were changed in the dashboard${liveSettings.by ? ` by ${liveSettings.by}` : ''} since this folder last saw them.`, {
      hint: 'Run `helppuff config pull` to bring them into helppuff.json, then deploy. Or deploy with --overwrite-settings to discard them.',
      details: { changedAt: liveSettings.at, by: liveSettings.by },
    });
  }

  let knowledge: SyncResult | null = null;
  const mode = options.knowledge ?? 'auto';
  const wantsKnowledge = mode === 'force' || (mode === 'auto' && (await knowledgeMissing(loaded.project, cf)));
  const syncNow = async () => {
    try {
      knowledge = await syncKnowledge(loaded, { cf, env, fetch: doFetch, ...(progress ? { progress } : {}) });
      if (knowledge.backendUpdate) {
        loaded = updateProject(loaded, (raw) => Object.assign(raw['backend'] as object, knowledge!.backendUpdate));
      }
      if (knowledge.skipped.length) warnings.push(`Skipped: ${knowledge.skipped.join(', ')}`);
    } catch (thrown) {
      if (mode === 'force') throw thrown;
      warnings.push(`Knowledge was not synced: ${(thrown as Error).message}. Run \`helppuff knowledge sync\` to retry.`);
    }
  };
  // OpenAI and Gemini stores are named in the config, so they come first.
  // AI Search is bound by name, so its uploads can follow the go-live.
  const storeInConfig = loaded.project.backend.type === 'openai' || loaded.project.backend.type === 'gemini';
  if (wantsKnowledge && storeInConfig) await syncNow();

  const version = runtimeVersion();
  const compiled = compile(loaded, { workerUrl: url, kvNamespaceId, d1DatabaseId, runtimeVersion: version });
  const workerExists = await cf.api.workerExists(cf.accountId, workerName);
  let workerDeployed = false;
  // The preview page is generated here, not shipped in the runtime, so it is part of the Worker too.
  const workerHash = fingerprint(`${compiled.workerHash}:${previewPage(loaded.project)}:${chatPage(loaded.project)}`);

  if (options.forceWorker || !workerExists || state.workerHash !== workerHash) {
    progress?.(workerExists ? 'Updating the Worker…' : 'Deploying the Worker (first time takes a minute)…');
    const dir = writeWorker(loaded.dir, compiled, loaded.project);
    const auth = { accountId: cf.accountId, ...(cf.source === 'api-token' ? { token: cf.token } : {}) };
    const reported = await wranglerDeploy(dir, auth, (line) => {
      if (/Uploaded|Deployed|Published|https:\/\//.test(line)) progress?.(`  ${line.trim()}`);
    });
    if (reported && reported !== url) warnings.push(`Wrangler reported ${reported}; expected ${url}.`);
    workerDeployed = true;
    state.workerHash = workerHash;
  }

  // Secrets: upload those the Worker lacks, or whose local value changed.
  const onWorker = new Set(await cf.api.secretNames(cf.accountId, workerName).catch(() => [] as string[]));
  const known = state.secrets ?? {};
  const uploaded: string[] = [];
  for (const name of compiled.secrets) {
    const value = env[name]!;
    const print = fingerprint(value);
    if (onWorker.has(name) && known[name] === print) continue;
    progress?.(`Setting secret ${name}…`);
    await cf.api.putSecret(cf.accountId, workerName, name, value);
    known[name] = print;
    uploaded.push(name);
  }
  state.secrets = known;
  writeState(loaded.dir, state);

  progress?.('Publishing config…');
  let rollback = async () => {};
  if (promptToPublish) {
    const recorded = await recordPublish(promptRemote, compiled.site, { ...promptToPublish, by: publisher(loaded) });
    promptMeta = recorded.meta;
    rollback = recorded.rollback;
  }
  const settingsNow = await settingsHash(readSettings(helppuffConfigSchema.parse(compiled.serverConfig).sites[compiled.site]!));
  const stored = {
    ...(compiled.storedConfig as StoredSiteConfig),
    ...(promptMeta ? { prompt: promptMeta } : {}),
    settings: { at: Date.now(), by: 'deploy', hash: settingsNow },
  };
  try {
    await cf.api.kvPut(cf.accountId, kvNamespaceId, siteConfigKey(compiled.site), JSON.stringify(stored));
  } catch (thrown) {
    // Not live, so not a version.
    await rollback();
    throw thrown;
  }
  if (promptMeta) state.prompt = { version: promptMeta.version, hash: promptMeta.hash };
  state.settings = { hash: settingsNow };
  writeState(loaded.dir, state);

  // Live from here on: AI Search uploads (and any wait for a first crawl) happen now.
  if (wantsKnowledge && !storeInConfig) await syncNow();

  loaded = updateProject(loaded, (raw) => {
    raw['cloudflare'] = {
      ...((raw['cloudflare'] as object) ?? {}),
      accountId: cf.accountId,
      workerName,
      url,
      kvNamespaceId,
      ...(d1DatabaseId ? { d1DatabaseId } : {}),
      ...(vectorizeIndex ? { vectorizeIndex } : {}),
    };
  });

  const indexing = await indexingStatus(cf.api, cf.accountId, loaded.project).catch(() => null);
  const healthy = await healthCheck(url, compiled.site, loaded.project.origins[0] ?? url, doFetch, progress);
  if (!healthy) {
    warnings.push(
      workerExists
        ? 'The Worker did not answer the health check. Run `helppuff doctor`.'
        : 'The Worker is deployed but not answering yet — a new workers.dev address can take a few minutes to go live.',
    );
  }

  // workers-ai, once live: the setup link, local files, and the first crawl.
  let setupUrl: string | null = null;
  let crawl: DeployResult['crawl'] = null;
  let files: DeployResult['files'] = null;
  if (healthy && usesHelpPuffKnowledge(loaded.project)) {
    const api = adminApi(loaded, { url, fetch: doFetch, env });
    await waitForAdminKey(api, progress);
    setupUrl = await mintSetupLink(api, warnings);
    if (loaded.project.knowledge.files.length) {
      progress?.('Adding your files to the knowledge base…');
      files = await uploadFilesToWorker(loaded, api, progress).catch((thrown: unknown) => {
        warnings.push(`Files were not added: ${(thrown as Error).message}. Run \`helppuff knowledge add\`.`);
        return null;
      });
      if (files?.skipped.length) warnings.push(`Not added: ${files.skipped.join(', ')}`);
    }
    crawl = await startLearning(api, loaded.project, options, warnings, progress);
    // Vectors from one embedding model mean nothing to another: when the model
    // changed (or this folder never recorded it), re-learn the pages already
    // chosen. Unchanged pages are re-embedded because the model is in their hash.
    const model = embeddingModelFor(loaded.project);
    if (state.embeddingModel !== model) {
      if (!crawl) {
        const learned = await api.get<{ run: unknown }>('/admin/api/knowledge/status').catch(() => null);
        if (learned?.run) {
          progress?.('Re-learning your site for the new embedding model…');
          crawl = await api.send<{ runId: string; total: number }>('POST', '/admin/api/knowledge/crawl', {}).catch(() => null);
          if (!crawl) warnings.push('The embedding model changed; run `helppuff crawl` to re-learn your site.');
        }
      }
      state.embeddingModel = model;
      writeState(loaded.dir, state);
    }
  }

  // Jobs: the pipeline at once (the assistant can make jobs from the first
  // visitor), and the AI's choice of template from the website, now or when
  // the crawl ends. Once: never over a pipeline already set up.
  let jobs: DeployResult['jobs'] = null;
  if (healthy && dashboardEnabled(loaded.project)) {
    const api = adminApi(loaded, { url, fetch: doFetch, env });
    if (!usesHelpPuffKnowledge(loaded.project)) await waitForAdminKey(api, progress);
    type Setup = { status: 'waiting' | 'done' | 'kept'; pipeline: { template: string; chosenBy: string; reason: string | null } };
    jobs = await api
      .send<Setup>('POST', '/admin/api/jobs/setup', { force: false })
      .then((r) => ({ status: r.status, template: r.pipeline.template, chosenBy: r.pipeline.chosenBy, reason: r.pipeline.reason }))
      .catch((thrown: unknown) => {
        warnings.push(`Jobs were not set up: ${(thrown as Error).message}. Run \`helppuff jobs setup\`.`);
        return null;
      });
  }

  return {
    url,
    dashboard: dashboardEnabled(loaded.project) ? dashboardUrl(url) : null,
    preview: `${url}/`,
    embed: embedSnippet(url, compiled.site),
    site: compiled.site,
    account: { id: cf.accountId, name: cf.accountName },
    workerDeployed,
    secretsUploaded: uploaded,
    knowledge,
    indexing,
    healthy,
    setupUrl,
    crawl,
    files,
    jobs,
    warnings,
    prompt: promptMeta ? { version: promptMeta.version, published: Boolean(promptToPublish) } : null,
  };
}

/** GET the site's config through the real route, as a browser on the site would. */
export async function healthCheck(
  url: string,
  site: string,
  origin: string,
  doFetch: typeof fetch = fetch,
  progress?: Progress,
  attempts = 8,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await doFetch(`${url}/v1/sites/${site}/config`, { headers: { Origin: origin } });
      if (response.ok) return true;
    } catch {
      // Not reachable yet.
    }
    if (attempt === 0) progress?.('Waiting for the Worker to answer…');
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return false;
}


/** A new secret takes a few seconds to reach every location; wait until the admin API accepts the key. */
async function waitForAdminKey(api: AdminApi, progress?: Progress, attempts = 10): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await api.get('/admin/api/setup/state');
      return;
    } catch (thrown) {
      if (!(thrown instanceof CliError) || thrown.code !== 'admin_unauthorized') return;
      if (attempt === 0) progress?.('Waiting for the admin key to reach the Worker…');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/** The one-time setup link, while nobody has claimed the dashboard. */
export async function mintSetupLink(api: AdminApi, warnings: string[]): Promise<string | null> {
  try {
    const link = await api.send<{ url: string }>('POST', '/admin/api/links', { kind: 'setup' });
    return link.url;
  } catch (thrown) {
    if (thrown instanceof CliError && /already complete/i.test(thrown.message)) return null;
    warnings.push(`No setup link: ${(thrown as Error).message}. Run \`helppuff dashboard\` for a sign-in link.`);
    return null;
  }
}

type Discovered = { urls: { url: string; suggested: boolean; selected?: boolean; category: string }[]; warnings: string[] };

/** Start a crawl through the admin API, choosing pages as the request says. */
/**
 * After a deploy: the crawl asked for (--crawl), or — with no person to do
 * onboarding (`unattended`) and nothing learned yet — the suggested pages,
 * plus the business details read now. Failures become warnings: the
 * assistant is live either way.
 */
/** What the deployed Worker reports at /healthz: its release and the D1 migration it expects. Nulls when unknown. */
export async function liveVersion(url: string, doFetch: typeof fetch = fetch): Promise<{ version: string | null; schema: number | null }> {
  try {
    const response = await doFetch(`${url}/healthz`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { version: null, schema: null };
    const body = (await response.json()) as { version?: unknown; schema?: unknown };
    return { version: typeof body.version === 'string' ? body.version : null, schema: typeof body.schema === 'number' ? body.schema : null };
  } catch {
    return { version: null, schema: null };
  }
}

export async function startLearning(
  api: AdminApi,
  project: Project,
  options: Pick<DeployOptions, 'crawl' | 'unattended'>,
  warnings: string[],
  progress?: Progress,
): Promise<{ runId: string; total: number } | null> {
  let request = options.crawl;
  if (!request && options.unattended && project.website && project.knowledge.website !== false) {
    const learned = await api.get<{ run: unknown }>('/admin/api/knowledge/status').catch(() => null);
    if (learned && !learned.run) request = { mode: 'suggested' };
  }
  if (!request) return null;
  const crawl = await startCrawlFromCli(api, request, progress).catch((thrown: unknown) => {
    warnings.push(`The crawl did not start: ${(thrown as Error).message}. Run \`helppuff crawl\`.`);
    return null;
  });
  // What onboarding would have shown a person: the business details, read now rather than when the crawl ends.
  if (crawl && options.unattended) {
    progress?.('Reading your business details…');
    await api.send('POST', '/admin/api/knowledge/facts/detect', {}).catch(() => null);
  }
  return crawl;
}

export async function startCrawlFromCli(api: AdminApi, request: CrawlRequest, progress?: Progress): Promise<{ runId: string; total: number }> {
  if (request.mode === 'urls') return api.send('POST', '/admin/api/knowledge/crawl', { urls: request.urls });
  progress?.('Finding the pages of your site…');
  const found = await api.send<Discovered>('POST', '/admin/api/knowledge/discover', {});
  const urls =
    request.mode === 'all'
      ? found.urls.filter((u) => u.category !== 'legal').map((u) => u.url)
      : request.mode === 'suggested'
        ? found.urls.filter((u) => u.suggested).map((u) => u.url)
        : found.urls.map((u) => u.url);
  progress?.(`Crawling ${request.mode === 'match' ? 'the matching' : urls.length} page(s) in the background…`);
  return api.send('POST', '/admin/api/knowledge/crawl', {
    urls,
    ...(request.mode === 'match' ? { include: request.include } : {}),
  });
}
