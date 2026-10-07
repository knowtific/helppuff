import type { D1Like } from '../db/d1.js';
import { b64url } from '../admin/auth.js';
import type { Scope } from './scopes.js';

/**
 * API keys for `/api/v1`: `hp_live_<id>_<secret>`.
 *
 *  - `hp_live_` makes a leaked key recognisable (and scannable);
 *  - `<id>` (12 characters) is public: it finds the row and names the key in lists;
 *  - `<secret>` is 32 random bytes.
 *
 * Only `HMAC-SHA-256(pepper, secret)` is stored, the pepper derived from
 * HELPPUFF_SECRET (never in D1), so a copy of the database opens nothing.
 * Hashing, not encryption: a key is only ever verified, never read back. A
 * fast hash is right for a 256-bit random secret (nothing to guess), unlike a
 * password. The full key is shown once, when it is made.
 */

export const KEY_PREFIX = 'hp_live_';
const ID_LENGTH = 12;
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export type ApiKeyRow = {
  id: string;
  name: string;
  secret_hash: string;
  site_id: string;
  scopes: string;
  allow_ips: string | null;
  rate_per_minute: number;
  created_by: string | null;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
  revoked_by: string | null;
};

/** A key as the API shows it: never the secret or its hash. */
export type ApiKeyView = {
  id: string;
  name: string;
  prefix: string;
  site: string;
  scopes: string[];
  allowIps: string[];
  ratePerMinute: number;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

const encoder = new TextEncoder();

function list(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function keyView(row: ApiKeyRow): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    prefix: `${KEY_PREFIX}${row.id}`,
    site: row.site_id,
    scopes: list(row.scopes),
    allowIps: list(row.allow_ips),
    ratePerMinute: row.rate_per_minute,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export const keyScopes = (row: ApiKeyRow): string[] => list(row.scopes);
export const keyAllowIps = (row: ApiKeyRow): string[] => list(row.allow_ips);

/** The id and secret of a presented key, or null when it is not one of ours. */
export function parseKey(value: string): { id: string; secret: string } | null {
  if (!value.startsWith(KEY_PREFIX)) return null;
  const rest = value.slice(KEY_PREFIX.length);
  const id = rest.slice(0, ID_LENGTH);
  if (rest[ID_LENGTH] !== '_' || !/^[a-z2-9]+$/.test(id)) return null;
  const secret = rest.slice(ID_LENGTH + 1);
  return secret.length >= 40 && secret.length <= 64 ? { id, secret } : null;
}

async function hashSecret(serverSecret: string, secret: string): Promise<string> {
  const pepper = await crypto.subtle.importKey('raw', encoder.encode(`${serverSecret}:api-key`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', pepper, encoder.encode(secret))));
}

function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export type NewKey = {
  name: string;
  siteId: string;
  scopes: Scope[];
  allowIps: string[];
  ratePerMinute: number;
  expiresAt: number | null;
  createdBy: string;
};

/** Make a key. The returned `key` is the only time the full value exists. */
export async function createKey(db: D1Like, serverSecret: string, input: NewKey, now: number): Promise<{ key: string; view: ApiKeyView }> {
  const id = newId();
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const row: ApiKeyRow = {
    id,
    name: input.name,
    secret_hash: await hashSecret(serverSecret, secret),
    site_id: input.siteId,
    scopes: JSON.stringify(input.scopes),
    allow_ips: input.allowIps.length ? JSON.stringify(input.allowIps) : null,
    rate_per_minute: input.ratePerMinute,
    created_by: input.createdBy,
    created_at: now,
    expires_at: input.expiresAt,
    last_used_at: null,
    revoked_at: null,
    revoked_by: null,
  };
  await db
    .prepare(
      `INSERT INTO api_keys (id, name, secret_hash, site_id, scopes, allow_ips, rate_per_minute, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.name, row.secret_hash, row.site_id, row.scopes, row.allow_ips, row.rate_per_minute, row.created_by, row.created_at, row.expires_at)
    .run();
  forgetKey(id);
  return { key: `${KEY_PREFIX}${id}_${secret}`, view: keyView(row) };
}

/** Looked-up rows, briefly: a revoke takes effect within this long on every isolate. */
export const KEY_CACHE_MS = 30_000;
const cache = new Map<string, { at: number; row: ApiKeyRow | null }>();
export function forgetKey(id: string): void {
  cache.delete(id);
}

/** The key's row when the presented value is a live key; null otherwise (unknown, wrong secret, revoked or expired). */
export async function verifyKey(db: D1Like, serverSecret: string, presented: string, now: number): Promise<ApiKeyRow | null> {
  const parsed = parseKey(presented);
  if (!parsed) return null;
  let entry = cache.get(parsed.id);
  if (!entry || now - entry.at > KEY_CACHE_MS) {
    const row = await db.prepare('SELECT * FROM api_keys WHERE id = ?').bind(parsed.id).first<ApiKeyRow>();
    entry = { at: now, row: row ?? null };
    if (cache.size > 1000) cache.clear();
    cache.set(parsed.id, entry);
  }
  const row = entry.row;
  // Hash even for an unknown id, so timing does not tell which ids exist.
  const hash = await hashSecret(serverSecret, parsed.secret);
  if (!row || !sameText(hash, row.secret_hash)) return null;
  if (row.revoked_at || (row.expires_at !== null && row.expires_at <= now)) return null;
  return row;
}

const lastUsedWritten = new Map<string, number>();
/** `last_used_at`, written at most once an hour per key per isolate: never a write per request. */
export function noteKeyUsed(db: D1Like, row: ApiKeyRow, now: number, defer: (work: Promise<unknown>) => void): void {
  const last = lastUsedWritten.get(row.id) ?? row.last_used_at ?? 0;
  if (now - last < 3_600_000) return;
  lastUsedWritten.set(row.id, now);
  defer(db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(now, row.id).run());
}
