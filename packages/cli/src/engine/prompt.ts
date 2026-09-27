import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  PROMPT_SQL,
  normalizePrompt,
  promptField,
  promptHash,
  siteConfigKey,
  storedSiteConfigSchema,
  type PromptMeta,
  type PromptVersionRow,
  type StoredSiteConfig,
} from '@murmur/server';
import { CliError } from '../errors.js';
import { gitEmail } from './admins.js';
import { cloudflareSession, type CloudflareSession } from './credentials.js';
import { dashboardEnabled, type LoadedProject } from './project.js';
import { readState, writeState, type State } from './state.js';

/**
 * prompt.md and the live prompt, kept from drifting apart.
 *
 * The owner can change the prompt in the dashboard, and so can anyone else
 * who deploys, so prompt.md is not automatically the latest. Every publish
 * gets a version number (`prompt` in the site's KV config; the full history
 * in D1 when the dashboard is on), and `.murmur/state.json` remembers which
 * version this folder's prompt.md was last published as or pulled from.
 * Comparing the three tells a local edit from a remote one:
 *
 *   in_sync       prompt.md is the live text
 *   ahead         only prompt.md changed — deploy publishes it as a new version
 *   behind        only the live prompt changed — pull before deploying
 *   diverged      both changed (or this folder never synced) — pull keeps
 *                 prompt.md as prompt.mine.md so the two can be merged
 *   untracked     deployed before versioning — the next deploy starts history
 *   not_deployed  nothing live yet
 *
 * Deploy refuses `behind` and `diverged` rather than overwrite a change it
 * has not seen. The server shares the hash and SQL (`@murmur/server`), so
 * both sides agree on what "the same prompt" means.
 */

export type PromptSync = 'not_deployed' | 'untracked' | 'in_sync' | 'ahead' | 'behind' | 'diverged';

export type LivePrompt = {
  /** 0 when deployed before versioning. */
  version: number;
  hash: string;
  text: string;
  meta: PromptMeta | null;
  editable: boolean;
};

/** Where the CLI reaches a deployment: the account, and the ids deploy recorded. */
export type Remote = { cf: CloudflareSession; kvNamespaceId: string; d1DatabaseId: string | null };

export function promptSync(local: string, base: State['prompt'], live: Pick<LivePrompt, 'version' | 'hash'> | null): PromptSync {
  if (!live) return 'not_deployed';
  if (live.version === 0) return 'untracked';
  if (local === live.hash) return 'in_sync';
  if (base && base.version === live.version && base.hash === live.hash) return 'ahead';
  if (base && local === base.hash) return 'behind';
  return 'diverged';
}

/**
 * Read prompt_versions. A deployment made before versioning has no such
 * table until its next deploy (or first dashboard visit) creates it — which
 * is simply "no versions yet", not an error.
 */
async function versionRows<T>(remote: Remote, sql: string, params: unknown[]): Promise<T[]> {
  if (!remote.d1DatabaseId) return [];
  try {
    return await remote.cf.api.d1Query<T>(remote.cf.accountId, remote.d1DatabaseId, sql, params);
  } catch (thrown) {
    if (/no such table: prompt_versions/.test((thrown as Error).message)) return [];
    throw thrown;
  }
}

const metaOf = (row: PromptVersionRow): PromptMeta => ({
  version: row.version,
  hash: row.hash,
  at: row.createdAt,
  by: row.author,
  source: row.source,
});

/** The live prompt and the stored config it sits in, or nulls when nothing usable is deployed. */
export async function readLivePrompt(remote: Remote, site: string): Promise<{ live: LivePrompt | null; stored: StoredSiteConfig | null }> {
  const raw = await remote.cf.api.kvGet(remote.cf.accountId, remote.kvNamespaceId, siteConfigKey(site));
  if (raw === null) return { live: null, stored: null };
  let stored: StoredSiteConfig | null = null;
  try {
    const parsed = storedSiteConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) stored = parsed.data;
  } catch {
    // The Worker ignores an unparsable config, and so does this: a deploy replaces it.
  }
  if (!stored?.connector) return { live: null, stored };

  const field = promptField(stored.connector);
  const [head] = await versionRows<PromptVersionRow>(remote, PROMPT_SQL.head, [site]);
  const meta = stored.prompt ?? (head ? metaOf(head) : null);
  return {
    live: {
      version: Math.max(head?.version ?? 0, stored.prompt?.version ?? 0),
      hash: await promptHash(field.text),
      text: field.text,
      meta,
      editable: field.editable,
    },
    stored,
  };
}

/** The deployment this project points at. Throws if it has not been deployed. */
export async function remoteFor(loaded: LoadedProject, env: Record<string, string>): Promise<Remote> {
  const kvNamespaceId = loaded.project.cloudflare.kvNamespaceId;
  if (!kvNamespaceId) throw new CliError('not_deployed', 'This assistant has not been deployed yet.', { hint: 'murmur deploy' });
  const cf = await cloudflareSession(env, { accountId: loaded.project.cloudflare.accountId });
  const d1DatabaseId = dashboardEnabled(loaded.project) ? (loaded.project.cloudflare.d1DatabaseId ?? null) : null;
  return { cf, kvNamespaceId, d1DatabaseId };
}

export function promptFile(loaded: LoadedProject): string {
  return resolve(loaded.dir, loaded.project.prompt);
}

export function readLocalPrompt(loaded: LoadedProject): string {
  const file = promptFile(loaded);
  return existsSync(file) ? normalizePrompt(readFileSync(file, 'utf8')) : '';
}

/** Who a CLI publish is attributed to in the dashboard's history. */
export function publisher(loaded: LoadedProject): string | null {
  return gitEmail(loaded.dir) ?? loaded.project.dashboard.adminEmail?.toLowerCase() ?? null;
}

function describeLive(live: LivePrompt): string {
  const meta = live.meta;
  if (!meta) return `version ${live.version}`;
  const where = meta.source === 'dashboard' ? 'in the dashboard' : meta.source === 'restore' ? 'restored in the dashboard' : 'from the CLI';
  const when = new Date(meta.at).toISOString().slice(0, 16).replace('T', ' ');
  return `version ${live.version} (published ${where}${meta.by ? ` by ${meta.by}` : ''}, ${when} UTC)`;
}

/** The refusal deploy gives when prompt.md is not based on the live prompt. */
export function driftError(sync: 'behind' | 'diverged', live: LivePrompt, base: State['prompt'], file: string): CliError {
  const name = basename(file);
  if (sync === 'behind') {
    return new CliError('prompt_behind', `The live prompt is now ${describeLive(live)}; ${name} is still version ${base?.version ?? '?'}.`, {
      hint: `Run \`murmur prompt pull\` to bring ${name} up to date, then deploy again.`,
      details: { live: live.version, local: base?.version ?? null },
    });
  }
  return new CliError(
    'prompt_diverged',
    base
      ? `The live prompt changed to ${describeLive(live)}, and ${name} has edits of its own since version ${base.version}.`
      : `${name} differs from the live prompt, ${describeLive(live)}, and this folder has not synced with it before.`,
    {
      hint: `Run \`murmur prompt pull\`: it keeps your ${name} as ${mineName(name)} and brings in version ${live.version}. Merge what you need into ${name}, then deploy again.`,
      details: { live: live.version, local: base?.version ?? null },
    },
  );
}

const mineName = (name: string) => name.replace(/(\.md)?$/i, '.mine.md');

/**
 * Record a publish in D1 (when the dashboard is on) and return the meta to
 * store beside it in KV. `rollback` removes the rows again if KV then fails.
 */
export async function recordPublish(
  remote: Remote,
  site: string,
  input: { text: string; hash: string; live: LivePrompt | null; by: string | null; now?: number },
): Promise<{ meta: PromptMeta; rollback: () => Promise<void> }> {
  const now = input.now ?? Date.now();
  const inserted: number[] = [];
  let base = input.live?.version ?? 0;
  const insert = async (version: number, text: string, hash: string, by: string | null, note: string | null) => {
    if (!remote.d1DatabaseId) return;
    try {
      await remote.cf.api.d1Query(remote.cf.accountId, remote.d1DatabaseId, PROMPT_SQL.insert, [site, version, text, hash, 'cli', by, note, null, now]);
    } catch (thrown) {
      if (/UNIQUE|constraint/i.test((thrown as Error).message)) {
        throw new CliError('prompt_behind', `Someone published prompt version ${version} a moment ago.`, {
          hint: 'Run `murmur prompt pull`, then deploy again.',
        });
      }
      throw thrown;
    }
    inserted.push(version);
  };

  // Deployed before versioning: what was live becomes version 1, so it can be restored.
  if (base === 0 && input.live?.text && input.live.hash !== input.hash) {
    await insert(1, input.live.text, input.live.hash, null, 'The prompt before versioning');
    base = 1;
  }
  const version = base + 1;
  await insert(version, input.text, input.hash, input.by, null);

  return {
    meta: { version, hash: input.hash, at: now, by: input.by, source: 'cli' },
    rollback: async () => {
      for (const v of inserted) {
        await remote.cf.api.d1Query(remote.cf.accountId, remote.d1DatabaseId!, PROMPT_SQL.remove, [site, v]).catch(() => undefined);
      }
    },
  };
}

export type PullResult = {
  file: string;
  /** The version whose text is now in prompt.md. */
  pulled: number;
  /** The live version prompt.md is now based on. */
  live: number;
  changed: boolean;
  /** Where unpublished local edits were kept, if there were any. */
  backup: string | null;
};

/** Bring the live prompt — or an older version, to restore it — into prompt.md. */
export async function pullPrompt(loaded: LoadedProject, remote: Remote, options: { version?: number } = {}): Promise<PullResult> {
  const site = loaded.project.site;
  const { live } = await readLivePrompt(remote, site);
  if (!live) throw new CliError('not_deployed', 'There is no live prompt to pull yet.', { hint: 'murmur deploy' });
  if (!live.editable) throw new CliError('prompt_not_versioned', 'This backend keeps its prompt outside Murmur, so there is nothing to pull.');

  let text = live.text;
  let pulled = live.version;
  if (options.version !== undefined && options.version !== live.version) {
    if (!remote.d1DatabaseId) {
      throw new CliError('no_history', 'Older versions are kept in the dashboard database, which this project does not have.', {
        hint: 'Turn the dashboard on (murmur config set dashboard.adminEmail you@example.com) and deploy.',
      });
    }
    const [row] = await versionRows<PromptVersionRow & { text: string }>(remote, PROMPT_SQL.get, [site, options.version]);
    if (!row) throw new CliError('no_such_version', `There is no prompt version ${options.version}.`, { hint: 'murmur prompt history' });
    text = row.text;
    pulled = row.version;
  }

  const file = promptFile(loaded);
  const local = readLocalPrompt(loaded);
  const localHash = await promptHash(local);
  const state = readState(loaded.dir);
  let backup: string | null = null;
  // Edits that were never published would be lost: keep them beside it.
  if (local && local !== normalizePrompt(text) && localHash !== live.hash && localHash !== state.prompt?.hash) {
    backup = join(dirname(file), mineName(basename(file)));
    writeFileSync(backup, `${local}\n`);
  }
  writeFileSync(file, `${normalizePrompt(text)}\n`);
  // Based on the live version even when the text is older: deploying it then
  // publishes a new version with the old text — a restore, recorded as one.
  state.prompt = { version: live.version, hash: live.hash };
  writeState(loaded.dir, state);
  return { file, pulled, live: live.version, changed: local !== normalizePrompt(text), backup };
}

export async function promptHistory(remote: Remote, site: string, limit = 50): Promise<PromptVersionRow[]> {
  if (!remote.d1DatabaseId) {
    throw new CliError('no_history', 'Prompt history is kept in the dashboard database, which this project does not have.', {
      hint: 'Turn the dashboard on (murmur config set dashboard.adminEmail you@example.com) and deploy.',
    });
  }
  return versionRows<PromptVersionRow>(remote, PROMPT_SQL.list, [site, limit]);
}

export async function promptVersionText(remote: Remote, site: string, version: number): Promise<string> {
  const [row] = await versionRows<{ text: string }>(remote, PROMPT_SQL.get, [site, version]);
  if (!row) throw new CliError('no_such_version', `There is no prompt version ${version}.`, { hint: 'murmur prompt history' });
  return row.text;
}
