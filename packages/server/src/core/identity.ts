import type { KvStore } from '@helppuff/connector-types';
import type { VerifiedUser } from '@helppuff/protocol';

/**
 * Signed-in visitors. The site's own server signs a short JWT (HS256) with
 * the site's identity secret, and its page passes it to the widget
 * (`HelpPuff.identify({ token })`). The Worker checks it when a chat starts;
 * its claims become the verified `user`: `{{user.id}}` in tools and the
 * prompt, the lead's email and name, and the conversation's record.
 *
 * Anything the visitor types (the pre-chat form, `identify({ email })`) is a
 * claim; only a signed token is proof. A bad or expired token is ignored, so
 * the chat still works, without a verified user.
 *
 * The secret is derived from the Worker's own (`HELPPUFF_SECRET`), the site
 * and a version, so there is nothing new to store or deploy. Rotating bumps
 * the version (KV `identity:<site>`): tokens signed with the old secret stop
 * working at once.
 */

const encoder = new TextEncoder();

/** Claims kept on the user: the reserved ones are the token's own. */
const RESERVED = new Set(['sub', 'exp', 'iat', 'nbf', 'iss', 'aud', 'jti']);
/** The longest a token may live, from its `iat` (or now): a token is a session, not a credential. */
export const MAX_TOKEN_AGE_S = 7 * 86_400;
const MAX_CLAIMS = 20;

async function hmac(key: string, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

function base64url(bytes: Uint8Array): string {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): string | null {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Constant-time comparison of two strings of the same alphabet. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const versionKey = (siteId: string) => `identity:${siteId}`;

/** The site's identity secret version (1 until rotated). */
export async function identityVersion(kv: KvStore, siteId: string): Promise<number> {
  const raw = Number(await kv.get(versionKey(siteId)));
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
}

/** A new secret: the old one stops working. Returns the new version. */
export async function rotateIdentity(kv: KvStore, siteId: string): Promise<number> {
  const next = (await identityVersion(kv, siteId)) + 1;
  await kv.put(versionKey(siteId), String(next));
  return next;
}

/** The site's identity secret: 64 hex characters, derived, never stored. */
export async function identitySecret(workerSecret: string, siteId: string, version: number): Promise<string> {
  return hex(await hmac(workerSecret, `helppuff-identity:${siteId}:${version}`));
}

/** Sign claims as the site's server would (tests, and the dashboard's example). */
export async function signIdentity(claims: Record<string, unknown>, secret: string): Promise<string> {
  const head = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(encoder.encode(JSON.stringify(claims)));
  return `${head}.${body}.${base64url(await hmac(secret, `${head}.${body}`))}`;
}

export type IdentityProblem = 'malformed' | 'algorithm' | 'signature' | 'expired' | 'too_long' | 'no_subject';

/**
 * Check a signed identity. HS256 only; `sub` (the site's user id) and `exp`
 * are required, and a token may live at most a week. String and number
 * claims are kept (up to 20, 500 characters each) as the user's fields.
 */
export async function verifyIdentity(token: string, secret: string, nowMs: number): Promise<{ user: VerifiedUser } | { problem: IdentityProblem }> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[\w-]+$/.test(p))) return { problem: 'malformed' };
  const [head, body, signature] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(fromBase64url(head) ?? '') as Record<string, unknown>;
    claims = JSON.parse(fromBase64url(body) ?? '') as Record<string, unknown>;
  } catch {
    return { problem: 'malformed' };
  }
  if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') return { problem: 'malformed' };
  // Only HMAC with SHA-256: never "none", never an algorithm the token chooses.
  if (header['alg'] !== 'HS256') return { problem: 'algorithm' };
  if (!same(base64url(await hmac(secret, `${head}.${body}`)), signature)) return { problem: 'signature' };

  const now = Math.floor(nowMs / 1000);
  const exp = Number(claims['exp']);
  if (!Number.isFinite(exp) || exp <= now) return { problem: 'expired' };
  const issued = Number.isFinite(Number(claims['iat'])) ? Number(claims['iat']) : now;
  if (exp - Math.min(issued, now) > MAX_TOKEN_AGE_S) return { problem: 'too_long' };
  if (Number.isFinite(Number(claims['nbf'])) && Number(claims['nbf']) > now + 60) return { problem: 'expired' };

  const sub = typeof claims['sub'] === 'string' || typeof claims['sub'] === 'number' ? String(claims['sub']).trim() : '';
  if (!sub || sub.length > 200) return { problem: 'no_subject' };
  const user: VerifiedUser = { id: sub };
  for (const [key, value] of Object.entries(claims)) {
    if (RESERVED.has(key) || key === 'id' || !/^[A-Za-z][\w-]{0,63}$/.test(key)) continue;
    if (Object.keys(user).length > MAX_CLAIMS) break;
    if (typeof value === 'string' && value.trim()) user[key] = value.trim().slice(0, 500);
    else if (typeof value === 'number' && Number.isFinite(value)) user[key] = String(value);
  }
  return { user };
}

/** A user object from a trusted caller (the API's `user`): string fields, an `id`. Null when there is no id. */
export function cleanUser(value: unknown): VerifiedUser | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw['id'] === 'string' || typeof raw['id'] === 'number' ? String(raw['id']).trim() : '';
  if (!id || id.length > 200) return null;
  const user: VerifiedUser = { id };
  for (const [key, v] of Object.entries(raw)) {
    if (key === 'id' || !/^[A-Za-z][\w-]{0,63}$/.test(key)) continue;
    if (Object.keys(user).length > MAX_CLAIMS) break;
    if (typeof v === 'string' && v.trim()) user[key] = v.trim().slice(0, 500);
    else if (typeof v === 'number' && Number.isFinite(v)) user[key] = String(v);
  }
  return user;
}
