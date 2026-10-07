import type { Context, Next } from 'hono';
import { viaApiKey } from '../admin/guard.js';
import { HelpPuffError } from '../core/errors.js';
import { ipMatches } from '../core/ip.js';
import { hitMemory, rateLimited } from '../core/ratelimit.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { dbFrom } from '../db/d1.js';
import { keyAllowIps, keyScopes, noteKeyUsed, verifyKey } from './keys.js';
import { findEndpoint, type Endpoint } from './registry.js';
import { hasScope } from './scopes.js';

/**
 * The public API's door (`/api/v1/*`), before any handler runs:
 *
 *  1. the route must be in the registry, or it does not exist here (fail
 *     closed: a new dashboard route is not public until it is listed);
 *  2. a key in the URL is refused (URLs end up in logs);
 *  3. bodies are bounded before they are read;
 *  4. `Authorization: Bearer <key>`: the deployment's ADMIN_API_KEY (the CLI,
 *     full access) or an API key, which must be live, from an allowed
 *     address, carry the route's scope, and be under its per-minute rate.
 *
 * Handlers then see the key through `currentAdmin` / `siteParam` (one site
 * per key). Dashboard cookies are never accepted here.
 */

export const API_BASE = '/api/v1';
export const ADMIN_BASE = '/admin/api';
const MAX_BODY = 1_000_000;
const MAX_UPLOAD = 10 * 1024 * 1024 + 1024;
const KEY_IN_URL = ['key', 'api_key', 'apikey', 'apiKey', 'token', 'access_token'];

/** The path below the base the request came through: `/leads/abc`. */
export function relativePath(c: Context<HonoEnv>): string {
  const path = c.req.path;
  for (const base of [API_BASE, ADMIN_BASE]) if (path.startsWith(base)) return path.slice(base.length) || '/';
  return path;
}

export async function publicApiGate(c: Context<HonoEnv>, next: Next): Promise<void> {
  const ctx = c.get('helppuff');
  const path = relativePath(c);
  // The description of the API is public, like any API reference.
  if (c.req.method === 'GET' && path === '/openapi.json') return next();

  const endpoint = findEndpoint(c.req.method, path);
  if (!endpoint || endpoint.scope === null) throw new HelpPuffError('not_found', { message: 'No such endpoint. See /api/v1/openapi.json.', detail: 'api_no_route' });

  const query = new URL(c.req.url).searchParams;
  if (KEY_IN_URL.some((name) => query.has(name))) {
    throw new HelpPuffError('bad_request', { message: 'Send the key in the Authorization header, never in the URL.', detail: 'api_key_in_url' });
  }
  const length = Number(c.req.header('Content-Length') ?? 0);
  if (length > (path === '/knowledge/files' ? MAX_UPLOAD : MAX_BODY)) {
    throw new HelpPuffError('bad_request', { message: 'The request body is too large.', detail: 'api_payload_too_large' });
  }

  if (await viaApiKey(c)) return next();

  const header = c.req.header('Authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented) throw new HelpPuffError('unauthorized', { message: 'Send an API key: Authorization: Bearer hp_live_…', detail: 'api_no_key' });
  const db = dbFrom(ctx.env);
  if (!db) throw new HelpPuffError('not_found', { message: 'The API needs the dashboard database. Run `helppuff deploy` with the dashboard on.', detail: 'api_no_db' });
  const now = ctx.platform.now();
  const key = await verifyKey(db, requireSecret(ctx), presented, now);
  if (!key) throw new HelpPuffError('unauthorized', { message: 'This API key is not valid (unknown, revoked or expired).', detail: 'api_bad_key' });

  const allow = keyAllowIps(key);
  if (allow.length && !ipMatches(ctx.platform.ip, allow)) {
    throw new HelpPuffError('forbidden', { message: 'This key cannot be used from this address.', detail: 'api_key_ip' });
  }
  // Every request counts, refused ones too: probing for scopes is rate limited like anything else.
  const verdict = hitMemory('apikey', key.id, key.rate_per_minute, 60, now);
  c.header('X-RateLimit-Limit', String(key.rate_per_minute));
  c.header('X-RateLimit-Remaining', String(Math.max(0, key.rate_per_minute - verdict.count)));
  if (!verdict.allowed) throw rateLimited(verdict, 'api_key_rate');
  if (!allowed(endpoint, keyScopes(key))) {
    throw new HelpPuffError('forbidden', { message: `This key does not have the ${endpoint.scope} scope.`, detail: 'api_key_scope' });
  }

  c.set('apiKey', key);
  noteKeyUsed(db, key, now, ctx.platform.waitUntil);
  await next();
}

const allowed = (endpoint: Endpoint, scopes: string[]) => endpoint.scope === 'any' || (endpoint.scope !== null && hasScope(scopes, endpoint.scope));

const AUDIT_KEEP_MS = 90 * 86_400_000;

/**
 * Every successful change, through the API or the dashboard, into
 * `audit_log`: who (an email, `key:<id>` or `admin-key`), what (the route),
 * which record, when. After the response; never the request body.
 */
export function audit(c: Context<HonoEnv>): void {
  const method = c.req.method;
  const actor = c.get('actor');
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || !actor || c.res.status >= 400) return;
  const ctx = c.get('helppuff');
  const db = dbFrom(ctx.env);
  if (!db) return;
  const path = relativePath(c);
  const endpoint = findEndpoint(method, path);
  const route = endpoint?.path ?? path;
  // The record: the first `:param` of the route, from the request's path.
  const parts = path.split('/');
  const target = route.split('/').findIndex((part) => part.startsWith(':'));
  const now = ctx.platform.now();
  ctx.platform.waitUntil(
    (async () => {
      await db
        .prepare('INSERT INTO audit_log (id, at, actor, action, target, site_id, status, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(`au_${crypto.randomUUID()}`, now, actor, `${method} ${route}`, target >= 0 ? decodeURIComponent(parts[target] ?? '') : null, c.get('apiKey')?.site_id ?? c.req.query('site') ?? null, c.res.status, await ctx.ipKey())
        .run();
      // Now and then, forget what is older than the retention.
      if (Math.random() < 0.02) await db.prepare('DELETE FROM audit_log WHERE at < ?').bind(now - AUDIT_KEEP_MS).run();
    })().catch(() => ctx.platform.log('audit.failed')),
  );
}
