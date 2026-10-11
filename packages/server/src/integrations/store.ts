import { HelpPuffError } from '../core/errors.js';
import { open, seal } from '../core/secretbox.js';
import type { D1Like } from '../db/d1.js';

/**
 * Integrations (Settings → Integrations): the site's connections to other
 * services, one per kind, reused by any feature (bookings today). The key is
 * sealed with HELPPUFF_SECRET (`core/secretbox.ts`) and never shown again;
 * saving one is live at once, no deploy.
 */

export const INTEGRATION_KINDS = ['composio', 'calcom', 'calendly'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
export const isIntegrationKind = (value: unknown): value is IntegrationKind => typeof value === 'string' && (INTEGRATION_KINDS as readonly string[]).includes(value);

export const INTEGRATION_INFO: Record<IntegrationKind, { name: string; key: string; help: string }> = {
  composio: { name: 'Composio', key: 'API key', help: 'Connects Google Calendar and Outlook (and later CRMs) without your own OAuth app. composio.dev → Settings → API keys.' },
  calcom: { name: 'Cal.com', key: 'API key (cal_live_…)', help: 'Cal.com → Settings → Developer → API keys. Self-hosted: also your API v2 base URL.' },
  calendly: { name: 'Calendly', key: 'Personal access token', help: 'Calendly → Integrations → API and webhooks → Personal access tokens.' },
};

const PURPOSE = 'integration-key';

/** A row of the `integrations` table (shared with live chat's Telegram). `config` holds the base URL. */
export type IntegrationRow = {
  site_id: string;
  kind: IntegrationKind;
  config: string;
  secret: string | null;
  status: string | null;
  last_error: string | null;
  updated_at: number;
  meta: string | null;
  last_at: number | null;
};

const baseUrlOf = (row: Pick<IntegrationRow, 'config'>): string | null => {
  try {
    const value = (JSON.parse(row.config) as { baseUrl?: unknown }).baseUrl;
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
};

export type Integration = { row: IntegrationRow; key: string; baseUrl: string | null; meta: Record<string, unknown> };

export async function integrationRow(db: D1Like, siteId: string, kind: IntegrationKind): Promise<IntegrationRow | null> {
  return db.prepare('SELECT * FROM integrations WHERE site_id = ? AND kind = ?').bind(siteId, kind).first<IntegrationRow>();
}

export async function listIntegrations(db: D1Like, siteId: string): Promise<IntegrationRow[]> {
  return (await db.prepare(`SELECT * FROM integrations WHERE site_id = ? AND kind IN (${INTEGRATION_KINDS.map(() => '?').join(', ')}) ORDER BY kind`).bind(siteId, ...INTEGRATION_KINDS).all<IntegrationRow>()).results;
}

export const metaOf = (row: Pick<IntegrationRow, 'meta'>): Record<string, unknown> => {
  try {
    const parsed = row.meta ? (JSON.parse(row.meta) as unknown) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** The integration with its key opened, or null when there is none (or it was sealed under another secret). */
export async function openIntegration(db: D1Like, secret: string, siteId: string, kind: IntegrationKind): Promise<Integration | null> {
  const row = await integrationRow(db, siteId, kind);
  if (!row?.secret) return null;
  const key = await open(secret, PURPOSE, row.secret);
  if (!key) return null;
  return { row, key, baseUrl: baseUrlOf(row), meta: metaOf(row) };
}

/** What the dashboard and the API see: never the key. */
export function integrationView(row: IntegrationRow) {
  const meta = metaOf(row);
  return {
    kind: row.kind,
    name: INTEGRATION_INFO[row.kind]?.name ?? row.kind,
    connected: Boolean(row.secret),
    baseUrl: baseUrlOf(row),
    status: row.status ?? 'unknown',
    lastError: row.last_error,
    lastAt: row.last_at,
    account: typeof meta['account'] === 'string' ? meta['account'] : null,
    plan: typeof meta['plan'] === 'string' ? meta['plan'] : null,
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
  };
}
export type IntegrationView = ReturnType<typeof integrationView>;

/** An https base URL for a self-hosted service, without a trailing slash. */
export function validBaseUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HelpPuffError('bad_request', { message: 'baseUrl is an https address.', detail: 'integration_base_url' });
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HelpPuffError('bad_request', { message: 'baseUrl is an https address, like https://cal.example.com/api/v2.', detail: 'integration_base_url' });
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new HelpPuffError('bad_request', { message: 'baseUrl must be https, without a user name or password.', detail: 'integration_base_url' });
  return url.toString().replace(/\/+$/, '');
}

/** Save (or replace) an integration's key. An empty key keeps the stored one (changing only the base URL). */
export async function saveIntegration(
  db: D1Like,
  secret: string,
  input: { siteId: string; kind: IntegrationKind; key?: string | null; baseUrl?: string | null; by: string },
  now: number,
): Promise<IntegrationRow> {
  const current = await integrationRow(db, input.siteId, input.kind);
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!key && !current?.secret) throw new HelpPuffError('bad_request', { message: `Give the ${INTEGRATION_INFO[input.kind].key}.`, detail: 'integration_key_missing' });
  if (key.length > 4000 || /\s/.test(key)) throw new HelpPuffError('bad_request', { message: 'That key does not look right: no spaces, at most 4000 characters.', detail: 'integration_key_invalid' });
  const sealed = key ? await seal(secret, PURPOSE, key) : current!.secret;
  const baseUrl = input.baseUrl === undefined ? (current ? baseUrlOf(current) : null) : input.baseUrl;
  // A new key starts afresh: what was learned about the old account (its plan, its user) goes.
  await db
    .prepare(
      `INSERT INTO integrations (site_id, kind, config, secret, status, last_error, updated_at, meta) VALUES (?, ?, ?, ?, 'unknown', NULL, ?, NULL)
       ON CONFLICT (site_id, kind) DO UPDATE SET config = excluded.config, secret = excluded.secret, updated_at = excluded.updated_at,
         meta = CASE WHEN ? THEN NULL ELSE integrations.meta END, status = CASE WHEN ? THEN 'unknown' ELSE integrations.status END`,
    )
    .bind(input.siteId, input.kind, JSON.stringify({ ...(baseUrl ? { baseUrl } : {}), by: input.by }), sealed, now, key ? 1 : 0, key ? 1 : 0)
    .run();
  return (await integrationRow(db, input.siteId, input.kind))!;
}

/** Record how the last call went, and what was learned (the account, the plan). */
export async function markIntegration(db: D1Like, row: IntegrationRow, result: { ok: boolean; error?: string | null; meta?: Record<string, unknown> }, now: number): Promise<void> {
  const meta = result.meta ? JSON.stringify({ ...metaOf(row), ...result.meta }) : row.meta;
  await db
    .prepare('UPDATE integrations SET status = ?, last_error = ?, last_at = ?, meta = ? WHERE site_id = ? AND kind = ?')
    .bind(result.ok ? 'ok' : 'error', result.ok ? null : (result.error ?? 'failed').slice(0, 300), now, meta, row.site_id, row.kind)
    .run();
}

export async function deleteIntegration(db: D1Like, siteId: string, kind: IntegrationKind): Promise<boolean> {
  const row = await integrationRow(db, siteId, kind);
  if (!row) return false;
  await db.prepare('DELETE FROM integrations WHERE site_id = ? AND kind = ?').bind(siteId, kind).run();
  return true;
}
