import { createHash, randomBytes } from 'node:crypto';
import { DASHBOARD_SCHEMA, promptField, promptHash, siteConfigKey, type PromptMeta, type StoredSiteConfig } from '@murmur/server';
import { CliError } from '../errors.js';
import { previewPage, runtimeVersion, writeWorker } from './build.js';
import { compile, dashboardUrl, embedSnippet } from './compile.js';
import { cloudflareSession, type CloudflareSession } from './credentials.js';
import { loadEnv, writeEnvVar } from './env.js';
import {
  ensureAiSearchInstance,
  indexingStatus,
  knowledgeMissing,
  syncKnowledge,
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
import { dashboardEnabled, resourceName, updateProject, workerNameFor, type LoadedProject } from './project.js';
import { readState, writeState } from './state.js';
import { wranglerDeploy } from './wrangler.js';

/**
 * `murmur deploy`, end to end. Safe to run again at any time: every step
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

export type DeployOptions = {
  knowledge?: 'auto' | 'force' | 'skip';
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
  healthy: boolean;
  warnings: string[];
};

const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/** A workers.dev subdomain, created from the account name if the account has none. */
async function ensureSubdomain(cf: CloudflareSession, progress?: Progress, readOnly = false): Promise<string> {
  const existing = await cf.api.subdomain(cf.accountId);
  if (existing) return existing;
  if (readOnly) return '<your-subdomain>';
  const base = (cf.accountName ?? 'murmur').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'murmur';
  for (const candidate of [base, `${base}-${randomBytes(2).toString('hex')}`, `knowtific-${randomBytes(3).toString('hex')}`]) {
    try {
      progress?.(`Registering the workers.dev subdomain "${candidate}"…`);
      return await cf.api.createSubdomain(cf.accountId, candidate);
    } catch {
      // Taken; try the next.
    }
  }
  throw new CliError('no_subdomain', 'Could not register a workers.dev subdomain for this account.', {
    hint: 'Open Workers & Pages in the Cloudflare dashboard once to pick one, then run `murmur deploy` again.',
  });
}

/** MURMUR_SECRET signs session tokens. Generated once and kept in .env so redeploys do not log visitors out. */
function ensureMurmurSecret(dir: string, env: Record<string, string>): string {
  const existing = env['MURMUR_SECRET'];
  if (existing && existing.length >= 32) return existing;
  const secret = randomBytes(32).toString('base64');
  writeEnvVar(dir, 'MURMUR_SECRET', secret);
  env['MURMUR_SECRET'] = secret;
  return secret;
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

  // Secrets are checked up front: a Worker deployed without them answers
  // every visitor with an error.
  if (!options.dryRun) ensureMurmurSecret(loaded.dir, env);
  const required = compile(loaded, { workerUrl: url }).secrets;
  const missing = required.filter((name) => !env[name] && !(options.dryRun && name === 'MURMUR_SECRET'));
  if (missing.length) {
    throw new CliError('missing_secret', `Missing secret(s): ${missing.join(', ')}.`, {
      hint: missing
        .map((name) =>
          name === 'ADMIN_PASSWORD_HASH' ? `murmur users reset ${loaded.project.dashboard.adminEmail ?? '<email>'}` : `murmur secret set ${name}`,
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
      warnings: ['dry run: nothing was changed'],
    };
  }

  progress?.('Preparing storage…');
  const kvNamespaceId = await cf.api.ensureKvNamespace(cf.accountId, resourceName(loaded.project.site));
  let d1DatabaseId: string | undefined;
  if (dashboardEnabled(loaded.project)) {
    progress?.('Preparing the dashboard database…');
    d1DatabaseId = await cf.api.ensureD1Database(cf.accountId, resourceName(loaded.project.site));
    for (const statement of DASHBOARD_SCHEMA) await cf.api.d1Query(cf.accountId, d1DatabaseId, statement);
  } else if (loaded.project.dashboard.enabled) {
    warnings.push('The dashboard is on but has no admin: set it with `murmur config set dashboard.adminEmail you@example.com`.');
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
      warnings.push(`Knowledge was not synced: ${(thrown as Error).message}. Run \`murmur knowledge sync\` to retry.`);
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
  const workerHash = fingerprint(`${compiled.workerHash}:${previewPage(loaded.project)}`);

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
  const stored = { ...(compiled.storedConfig as StoredSiteConfig), ...(promptMeta ? { prompt: promptMeta } : {}) };
  try {
    await cf.api.kvPut(cf.accountId, kvNamespaceId, siteConfigKey(compiled.site), JSON.stringify(stored));
  } catch (thrown) {
    // Not live, so not a version.
    await rollback();
    throw thrown;
  }
  if (promptMeta) {
    state.prompt = { version: promptMeta.version, hash: promptMeta.hash };
    writeState(loaded.dir, state);
  }

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
    };
  });

  const indexing = await indexingStatus(cf.api, cf.accountId, loaded.project).catch(() => null);
  const healthy = await healthCheck(url, compiled.site, loaded.project.origins[0] ?? url, doFetch, progress);
  if (!healthy) {
    warnings.push(
      workerExists
        ? 'The Worker did not answer the health check. Run `murmur doctor`.'
        : 'The Worker is deployed but not answering yet — a new workers.dev address can take a few minutes to go live.',
    );
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

export { hasDeployed } from './state.js';
