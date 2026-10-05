import type { KvStore } from '@murmur/connector-types';
import { storedSiteConfigSchema, type ConnectorConfig, type MurmurConfig, type PromptMeta, type StoredSiteConfig } from '../config/schema.js';
import { siteConfigKey } from '../config/site.js';
import { MurmurError } from '../core/errors.js';
import { getConnector } from '../core/registry.js';
import type { D1Like } from '../db/d1.js';

/**
 * Prompt versions.
 *
 * The live prompt is the text inside the connector options of the site's KV
 * config (`config:<site>`) — exactly where `murmur deploy` has always put it,
 * so the chat path reads it the way it always has. Alongside it, a small
 * `prompt` block records which version that text is. Every version, with
 * who published it and from where, is kept in D1.
 *
 * Two writers publish: the CLI (`murmur deploy`, from prompt.md) and the
 * dashboard. Each names the version it started from, and a publish that did
 * not start from the current one is refused — so neither can silently
 * overwrite the other's change. The CLI shares this file's hash and SQL so
 * both sides agree on what "the same prompt" means.
 */

export const PROMPT_LIMIT = 16_000;

/** Line endings and surrounding whitespace never make a new version. */
export function normalizePrompt(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

export async function promptHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizePrompt(text)));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type PromptVersionRow = {
  version: number;
  hash: string;
  source: PromptMeta['source'];
  author: string | null;
  note: string | null;
  restoredFrom: number | null;
  createdAt: number;
  chars: number;
};

const COLUMNS = `version, hash, source, author, note, restored_from AS restoredFrom, created_at AS createdAt, LENGTH(text) AS chars`;

/** Shared with the CLI, which runs them through the D1 HTTP API. */
export const PROMPT_SQL = {
  head: `SELECT ${COLUMNS} FROM prompt_versions WHERE site_id = ? ORDER BY version DESC LIMIT 1`,
  list: `SELECT ${COLUMNS} FROM prompt_versions WHERE site_id = ? ORDER BY version DESC LIMIT ?`,
  get: `SELECT ${COLUMNS}, text FROM prompt_versions WHERE site_id = ? AND version = ?`,
  insert: `INSERT INTO prompt_versions (site_id, version, text, hash, source, author, note, restored_from, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  remove: `DELETE FROM prompt_versions WHERE site_id = ? AND version = ?`,
} as const;

/**
 * Where a connector config keeps its prompt, and what is in it now.
 *
 * `editable` is false when Murmur does not own the prompt (Retell, an OpenAI
 * stored prompt, the owner's own API), and when the option points at another
 * source (`{ kv }`, `{ url }`, `{ env }`) that is edited elsewhere.
 */
export function promptField(connector: ConnectorConfig): {
  option: string | null;
  text: string;
  editable: boolean;
  reason: string | null;
} {
  let option: string | null;
  try {
    const erased = getConnector(connector.type);
    option = erased.promptOption(erased.parseOptions(connector.options ?? {}));
  } catch {
    option = null;
  }
  if (!option) {
    return { option: null, text: '', editable: false, reason: `The ${connector.type} backend keeps its own prompt; edit it there.` };
  }
  const value = ((connector.options ?? {}) as Record<string, unknown>)[option];
  if (value === undefined || typeof value === 'string') return { option, text: value ?? '', editable: true, reason: null };
  return { option, text: '', editable: false, reason: 'This prompt is loaded from another source (KV, a URL or a secret); edit it there.' };
}

/**
 * `kv` must be the raw binding, not the platform's forgiving wrapper: here a
 * read that fails must not look like "nothing stored" (the publish would
 * then drop the site's other sections), and a write that fails must not
 * look like a success.
 */
export type PromptCtx = { config: MurmurConfig; kv: KvStore; now: () => number };

export type PromptState = {
  site: string;
  connector: string;
  editable: boolean;
  reason: string | null;
  option: string | null;
  text: string;
  hash: string;
  /** 0 until the first version is recorded. */
  version: number;
  meta: PromptMeta | null;
  stored: StoredSiteConfig | null;
  connectorConfig: ConnectorConfig;
};

/** The live prompt, read fresh (no edge cache) — a publish decision must not act on a minute-old copy. */
export async function readPromptState(ctx: PromptCtx, db: D1Like | null, site: string): Promise<PromptState> {
  const bundled = ctx.config.sites[site];
  if (!bundled) throw new MurmurError('not_found', { message: 'No such site.', detail: 'admin_unknown_site' });

  const raw = await ctx.kv.get(siteConfigKey(site));
  let stored: StoredSiteConfig | null = null;
  if (raw !== null) {
    try {
      const parsed = storedSiteConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) stored = parsed.data;
    } catch {
      // Unparsable: the Worker is running on the bundled config, and so do we.
    }
  }
  const connectorConfig = stored?.connector ?? bundled.connector;
  const field = promptField(connectorConfig);
  const head = db ? await db.prepare(PROMPT_SQL.head).bind(site).first<PromptVersionRow>() : null;
  const meta = stored?.prompt ?? null;

  return {
    site,
    connector: connectorConfig.type,
    ...field,
    hash: await promptHash(field.text),
    version: Math.max(head?.version ?? 0, meta?.version ?? 0),
    meta,
    stored,
    connectorConfig,
  };
}

export type PublishInput = {
  text: string;
  /** The version the editor started from. Anything else is a conflict. */
  baseVersion: number;
  source: PromptMeta['source'];
  by: string | null;
  note?: string | null | undefined;
  restoredFrom?: number | null | undefined;
};

export type PublishResult =
  | { status: 'published'; version: number; hash: string }
  | { status: 'unchanged'; version: number; hash: string }
  | { status: 'conflict'; version: number; hash: string; meta: PromptMeta | null };

/** Record a new version in D1, then make it live in KV. */
export async function publishPrompt(ctx: PromptCtx, db: D1Like, site: string, input: PublishInput): Promise<PublishResult> {
  const state = await readPromptState(ctx, db, site);
  if (!state.editable || !state.option) {
    throw new MurmurError('bad_request', { message: state.reason ?? 'This prompt cannot be edited here.', detail: 'prompt_not_editable' });
  }
  const text = normalizePrompt(input.text);
  if (!text) throw new MurmurError('bad_request', { message: 'The prompt is empty.', detail: 'prompt_empty' });
  if (text.length > PROMPT_LIMIT) {
    throw new MurmurError('bad_request', {
      message: `The prompt is ${text.length} characters; the limit is ${PROMPT_LIMIT}. Move reference material into the knowledge base.`,
      detail: 'prompt_too_long',
    });
  }
  if (input.baseVersion !== state.version) return { status: 'conflict', version: state.version, hash: state.hash, meta: state.meta };

  const hash = await promptHash(text);
  if (hash === state.hash) return { status: 'unchanged', version: state.version, hash };

  const now = ctx.now();
  const statements = [];
  let base = state.version;
  // A deployment from before versioning: keep what was live as version 1,
  // so the first edit can be undone like any other.
  if (base === 0 && state.text) {
    base = 1;
    statements.push(
      db.prepare(PROMPT_SQL.insert).bind(site, 1, state.text, state.hash, 'cli', null, 'The prompt before versioning', null, now),
    );
  }
  const version = base + 1;
  statements.push(
    db
      .prepare(PROMPT_SQL.insert)
      .bind(site, version, text, hash, input.source, input.by, input.note?.trim().slice(0, 200) || null, input.restoredFrom ?? null, now),
  );
  try {
    await db.batch(statements);
  } catch {
    // The primary key refused it: someone published this number first.
    const latest = await readPromptState(ctx, db, site);
    return { status: 'conflict', version: latest.version, hash: latest.hash, meta: latest.meta };
  }

  const meta: PromptMeta = { version, hash, at: now, by: input.by, source: input.source };
  const options = { ...((state.connectorConfig.options ?? {}) as Record<string, unknown>), [state.option]: text };
  const next = storedSiteConfigSchema.parse({
    ...(state.stored ?? {}),
    connector: { type: state.connectorConfig.type, options },
    prompt: meta,
  });
  try {
    await ctx.kv.put(siteConfigKey(site), JSON.stringify(next));
  } catch (thrown) {
    // Not live, so not a version: history must only hold what visitors saw.
    await db.prepare(PROMPT_SQL.remove).bind(site, version).run().catch(() => undefined);
    throw thrown;
  }
  return { status: 'published', version, hash };
}
