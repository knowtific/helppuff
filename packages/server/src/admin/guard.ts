import type { Context } from 'hono';
import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { dbFrom, type D1Like } from '../db/d1.js';
import { cookieValue, passwordFingerprint, readSession, SESSION_COOKIE } from './auth.js';

/**
 * Who may use the dashboard API, and the checks every handler shares.
 *
 * Two ways in:
 *  - a dashboard session cookie (people, in the browser);
 *  - `Authorization: Bearer <ADMIN_API_KEY>` (the CLI and agents). The key
 *    is a Worker secret, also kept in the project's `.env`; it acts as the
 *    owner.
 */

/**
 * What a dashboard account may do. The owner and admins: everything.
 * Members: the inbox only — conversations, jobs, contacts, callbacks, live chat and
 * their own notification settings (`memberMay`).
 */
export type Role = 'owner' | 'admin' | 'member';
export const ROLES = ['admin', 'member'] as const;

/** `api-key`: the deployment's ADMIN_API_KEY (the CLI, full access). `key`: a scoped key from `/api/v1/keys`. */
export type Admin = { email: string; owner: boolean; role: Role; name: string | null; via: 'session' | 'api-key' | 'key' };

/**
 * The routes a member may use, by method and path below the API base. Fail
 * closed: anything not listed (settings, knowledge, prompt, webhooks, keys,
 * the team, analytics) is refused, whatever is added later.
 */
const MEMBER_ROUTES: [method: string | '*', path: RegExp][] = [
  ['GET', /^\/me$/],
  ['POST', /^\/logout$/],
  ['GET', /^\/admins$/],
  ['GET', /^\/conversations$/],
  ['*', /^\/conversations\/[^/]+(\/(reply|notes|close|assign|handback|takeover|summary))?$/],
  ['GET', /^\/leads(\.csv)?$/],
  ['POST', /^\/leads$/],
  ['*', /^\/leads\/[^/]+(\/notes)?$/],
  ['*', /^\/notes\/[^/]+$/],
  ['*', /^\/callbacks(\/[^/]+)?$/],
  ['GET', /^\/labels$/],
  ['*', /^\/prefs$/],
  ['GET', /^\/live\/(status|socket)$/],
  ['GET', /^\/jobs(\/pipeline)?$/],
  ['POST', /^\/jobs$/],
  ['*', /^\/jobs\/(?!pipeline|setup)[^/]+(\/(move|updates|notes))?$/],
];

export function memberMay(method: string, path: string): boolean {
  const relative = path.replace(/^\/(admin\/api|api\/v1)/, '') || '/';
  // Deleting is for admins: a member can close a conversation, not erase it.
  if (method === 'DELETE' && !/^\/notes\//.test(relative)) return false;
  return MEMBER_ROUTES.some(([m, re]) => (m === '*' || m === method) && re.test(relative));
}

/** Refuse a member: for handlers that need an admin whatever the route table says. */
export function assertAdmin(admin: Admin): void {
  if (admin.role === 'member') throw new HelpPuffError('forbidden', { message: 'Only an admin can do this.', detail: 'admin_role_member' });
}

/** The public API (`/api/v1`): API keys only, never a dashboard cookie. */
export const isPublicApi = (c: Context<HonoEnv>) => c.req.path.startsWith('/api/');

export function db(c: Context<HonoEnv>): D1Like {
  const found = dbFrom(c.get('helppuff').env);
  if (!found) {
    throw new HelpPuffError('not_found', {
      message: 'The dashboard is not enabled for this deployment. Run `helppuff deploy` with dashboard enabled.',
      detail: 'admin_no_db',
    });
  }
  return found;
}

export function isSecure(c: Context<HonoEnv>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

/** Mutations must come from the dashboard's own origin (or from no browser at all). */
export function assertSameOrigin(c: Context<HonoEnv>): void {
  const origin = c.req.header('Origin');
  if (origin && origin !== new URL(c.req.url).origin) {
    throw new HelpPuffError('forbidden_origin', { message: 'Cross-origin request refused.', detail: 'admin_cross_origin' });
  }
}

const encoder = new TextEncoder();

/** Constant-time string comparison, through a hash so lengths do not leak either. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))]);
  const ax = new Uint8Array(x);
  const by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i]! ^ by[i]!;
  return diff === 0 && a.length === b.length;
}

export async function viaApiKey(c: Context<HonoEnv>): Promise<boolean> {
  const header = c.req.header('Authorization') ?? '';
  const key = String(c.get('helppuff').env['ADMIN_API_KEY'] ?? '');
  if (!header.startsWith('Bearer ') || key.length < 32) return false;
  return safeEqual(header.slice(7).trim(), key);
}

export async function currentAdmin(c: Context<HonoEnv>): Promise<Admin> {
  const key = c.get('apiKey');
  if (key) {
    c.set('actor', `key:${key.id}`);
    // A key's scopes are its role (api/auth.ts).
    return { email: `key:${key.id}`, owner: false, role: 'admin', name: key.name, via: 'key' };
  }
  if (await viaApiKey(c)) {
    c.set('actor', 'admin-key');
    return { email: 'api-key', owner: true, role: 'owner', name: null, via: 'api-key' };
  }
  if (isPublicApi(c)) throw new HelpPuffError('unauthorized', { message: 'Send an API key: Authorization: Bearer hp_live_…', detail: 'api_no_key' });
  const ctx = c.get('helppuff');
  const secret = requireSecret(ctx);
  const session = await readSession(secret, cookieValue(c.req.header('Cookie'), SESSION_COOKIE), ctx.platform.now());
  if (!session) throw new HelpPuffError('unauthorized', { message: 'Please sign in.', detail: 'admin_no_session' });
  const owner = String(ctx.env['ADMIN_EMAIL'] ?? '').toLowerCase();
  const isOwner = Boolean(owner) && session.email === owner;
  const d = db(c);
  // Removed accounts, changed passwords and signed-out sessions lose access at their next request, not in seven days.
  const [row, signedOut] = await Promise.all([
    d.prepare('SELECT email, password_hash, name, role FROM admins WHERE email = ?').bind(session.email).first<{ email: string; password_hash: string; name: string | null; role: string | null }>(),
    d.prepare('SELECT 1 AS x FROM admin_signed_out WHERE id = ?').bind(session.id).first(),
  ]);
  if (!isOwner && !row) throw new HelpPuffError('unauthorized', { message: 'Please sign in.', detail: 'admin_revoked' });
  const hash = isOwner ? String(ctx.env['ADMIN_PASSWORD_HASH'] ?? '') : row!.password_hash;
  if (signedOut || session.fingerprint !== (await passwordFingerprint(secret, hash))) {
    throw new HelpPuffError('unauthorized', { message: 'Please sign in.', detail: signedOut ? 'admin_signed_out' : 'admin_password_changed' });
  }
  c.set('actor', session.email);
  const name = row?.name ?? null;
  if (isOwner) return { email: session.email, owner: true, role: 'owner', name, via: 'session' };
  // Without an owner in Worker config, the first account (made at setup) is the owner.
  const first = owner ? null : await d.prepare('SELECT email FROM admins ORDER BY created_at LIMIT 1').first<{ email: string }>();
  if (first?.email === session.email) return { email: session.email, owner: true, role: 'owner', name, via: 'session' };
  const role: Role = row?.role === 'member' ? 'member' : 'admin';
  if (role === 'member' && !memberMay(c.req.method, c.req.path)) {
    throw new HelpPuffError('forbidden', { message: 'Only an admin can do this. Ask the owner if you need it.', detail: 'admin_role_member' });
  }
  return { email: session.email, owner: false, role, name, via: 'session' };
}

/** The password hash a session for `email` is tied to: the owner's Worker secret, or the account's row. Null for no such account. */
export async function passwordHashOf(c: Context<HonoEnv>, email: string): Promise<string | null> {
  const owner = String(c.get('helppuff').env['ADMIN_EMAIL'] ?? '').toLowerCase();
  if (owner && email === owner) return String(c.get('helppuff').env['ADMIN_PASSWORD_HASH'] ?? '');
  const row = await db(c).prepare('SELECT password_hash FROM admins WHERE email = ?').bind(email).first<{ password_hash: string }>();
  return row?.password_hash ?? null;
}

/**
 * The site asked for, or the only one — a CLI deployment has exactly one.
 * An API key belongs to one site: that site, whatever was asked.
 */
export function siteParam(c: Context<HonoEnv>, value: unknown): string {
  const sites = Object.keys(c.get('helppuff').config.sites);
  const key = c.get('apiKey');
  if (key) {
    if (typeof value === 'string' && value && value !== key.site_id) throw new HelpPuffError('forbidden', { message: `This key is for site "${key.site_id}".`, detail: 'api_key_site' });
    if (!sites.includes(key.site_id)) throw new HelpPuffError('not_found', { message: 'No such site.', detail: 'admin_unknown_site' });
    return key.site_id;
  }
  const site = typeof value === 'string' && value ? value : sites[0];
  if (!site || !sites.includes(site)) throw new HelpPuffError('not_found', { message: 'No such site.', detail: 'admin_unknown_site' });
  return site;
}

export async function jsonBody(c: Context<HonoEnv>): Promise<Record<string, unknown>> {
  const body = (await c.req.json().catch(() => null)) as unknown;
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** A record of another site is, to a key, a record that does not exist. */
export function assertSiteAccess(c: Context<HonoEnv>, siteId: unknown, what = 'record'): void {
  const key = c.get('apiKey');
  if (key && siteId !== key.site_id) throw new HelpPuffError('not_found', { message: `No such ${what}.`, detail: 'api_key_other_site' });
}
