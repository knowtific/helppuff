import type { Context } from 'hono';
import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { dbFrom, type D1Like } from '../db/d1.js';
import { cookieValue, readSession, SESSION_COOKIE } from './auth.js';

/**
 * Who may use the dashboard API, and the checks every handler shares.
 *
 * Two ways in:
 *  - a dashboard session cookie (people, in the browser);
 *  - `Authorization: Bearer <ADMIN_API_KEY>` (the CLI and agents). The key
 *    is a Worker secret, also kept in the project's `.env`; it acts as the
 *    owner.
 */

export type Admin = { email: string; owner: boolean; via: 'session' | 'api-key' };

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
  if (await viaApiKey(c)) return { email: 'api-key', owner: true, via: 'api-key' };
  const ctx = c.get('helppuff');
  const session = await readSession(requireSecret(ctx), cookieValue(c.req.header('Cookie'), SESSION_COOKIE), ctx.platform.now());
  if (!session) throw new HelpPuffError('unauthorized', { message: 'Please sign in.', detail: 'admin_no_session' });
  const owner = String(ctx.env['ADMIN_EMAIL'] ?? '').toLowerCase();
  if (owner && session.email === owner) return { email: session.email, owner: true, via: 'session' };
  // Removed accounts lose access at their next request, not in seven days.
  const row = await db(c).prepare('SELECT email FROM admins WHERE email = ?').bind(session.email).first();
  if (!row) throw new HelpPuffError('unauthorized', { message: 'Please sign in.', detail: 'admin_revoked' });
  // Without an owner in Worker config, the first account (made at setup) is the owner.
  const first = owner ? null : await db(c).prepare('SELECT email FROM admins ORDER BY created_at LIMIT 1').first<{ email: string }>();
  return { email: session.email, owner: first?.email === session.email, via: 'session' };
}

/** The site asked for, or the only one — a CLI deployment has exactly one. */
export function siteParam(c: Context<HonoEnv>, value: unknown): string {
  const sites = Object.keys(c.get('helppuff').config.sites);
  const site = typeof value === 'string' && value ? value : sites[0];
  if (!site || !sites.includes(site)) throw new HelpPuffError('not_found', { message: 'No such site.', detail: 'admin_unknown_site' });
  return site;
}

export async function jsonBody(c: Context<HonoEnv>): Promise<Record<string, unknown>> {
  const body = (await c.req.json().catch(() => null)) as unknown;
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
