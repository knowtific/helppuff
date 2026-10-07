import { Hono, type Context } from 'hono';
import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { b64url, hashPassword, issueSession, sessionCookie } from './auth.js';
import { assertSameOrigin, currentAdmin, db, isSecure, jsonBody, passwordHashOf, viaApiKey } from './guard.js';
import { signInPolicy, throttleIp } from './signin.js';

/**
 * One-time links: the setup link `helppuff deploy` prints, and the login
 * link `helppuff dashboard` mints when a password is lost.
 *
 *  - Only the SHA-256 of a token is stored (`admin_tokens`); the token itself
 *    exists once, in the link.
 *  - Single use, short-lived: setup 24 hours, login 15 minutes.
 *  - A setup link only works while the deployment has no admin at all, so an
 *    unclaimed instance cannot be claimed twice, and an invalid or used link
 *    looks exactly like a missing page (404).
 */

export const setupRoutes = new Hono<HonoEnv>();

const TTL = { setup: 24 * 3600_000, login: 15 * 60_000 } as const;
type Kind = keyof typeof TTL;

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

const notFound = () => new HelpPuffError('not_found', { message: 'This link has expired or was already used.', detail: 'admin_token_invalid' });

async function hasAdmin(c: Context<HonoEnv>): Promise<boolean> {
  if (String(c.get('helppuff').env['ADMIN_EMAIL'] ?? '')) return true;
  return Boolean(await db(c).prepare('SELECT 1 AS x FROM admins LIMIT 1').first());
}

type TokenRow = { token_hash: string; kind: Kind; email: string | null; expires_at: number; used_at: number | null };

async function liveToken(c: Context<HonoEnv>, token: unknown, kind: Kind): Promise<TokenRow> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw notFound();
  const row = await db(c).prepare('SELECT * FROM admin_tokens WHERE token_hash = ?').bind(await sha256(token)).first<TokenRow>();
  if (!row || row.kind !== kind || row.used_at || row.expires_at <= c.get('helppuff').platform.now()) throw notFound();
  if (kind === 'setup' && (await hasAdmin(c))) throw notFound();
  return row;
}

/** Spend a token. The `used_at IS NULL` guard makes two racing claims resolve to one winner. */
async function spend(c: Context<HonoEnv>, row: TokenRow): Promise<void> {
  const result = (await db(c)
    .prepare('UPDATE admin_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
    .bind(c.get('helppuff').platform.now(), row.token_hash)
    .run()) as { meta?: { changes?: number } } | undefined;
  if (result?.meta?.changes === 0) throw notFound();
}

/** Link checks share the sign-in limit per IP (`security.signIn.attemptsPerIp`). */
async function throttle(c: Context<HonoEnv>): Promise<void> {
  await throttleIp(c, await signInPolicy(c), 'admin-link');
}

/** Mint a link. API key only: this is what `helppuff deploy` and `helppuff dashboard` call. */
setupRoutes.post('/admin/api/links', async (c) => {
  if (!(await viaApiKey(c))) throw new HelpPuffError('unauthorized', { message: 'Use the admin API key.', detail: 'admin_links_api_key_only' });
  const body = await jsonBody(c);
  const kind: Kind = body['kind'] === 'login' ? 'login' : 'setup';
  const ctx = c.get('helppuff');
  const now = ctx.platform.now();
  let email: string | null = null;
  if (kind === 'setup' && (await hasAdmin(c))) {
    throw new HelpPuffError('bad_request', { message: 'Setup is already complete; mint a login link instead.', detail: 'admin_setup_done' });
  }
  if (kind === 'login') {
    const owner = String(ctx.env['ADMIN_EMAIL'] ?? '').toLowerCase();
    const asked = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
    const first = await db(c).prepare('SELECT email FROM admins ORDER BY created_at LIMIT 1').first<{ email: string }>();
    email = asked || owner || first?.email || null;
    if (!email) throw new HelpPuffError('bad_request', { message: 'Nobody has an account yet; mint a setup link.', detail: 'admin_no_accounts' });
    const known = email === owner || Boolean(await db(c).prepare('SELECT 1 AS x FROM admins WHERE email = ?').bind(email).first());
    if (!known) throw new HelpPuffError('not_found', { message: `No account for ${email}.`, detail: 'admin_unknown_email' });
  }
  const token = newToken();
  await db(c)
    .prepare('INSERT INTO admin_tokens (token_hash, kind, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), kind, email, now, now + TTL[kind])
    .run();
  const origin = new URL(c.req.url).origin;
  // In the fragment: never sent to a server, so never in a log or a Referer.
  const url = kind === 'setup' ? `${origin}/admin/#/setup/${token}` : `${origin}/admin/#/signin/${token}`;
  return c.json({ kind, url, email, expiresAt: now + TTL[kind] }, 201);
});

/** Whether a link is good, before the page asks for anything. */
setupRoutes.get('/admin/api/setup', async (c) => {
  await throttle(c);
  const kind: Kind = c.req.query('kind') === 'login' ? 'login' : 'setup';
  const row = await liveToken(c, c.req.query('token'), kind);
  return c.json({ kind, email: row.email, expiresAt: row.expires_at });
});

/** Claim a fresh deployment: create the first account and sign in. */
setupRoutes.post('/admin/api/setup', async (c) => {
  assertSameOrigin(c);
  await throttle(c);
  const body = await jsonBody(c);
  const row = await liveToken(c, body['token'], 'setup');
  const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
  const password = typeof body['password'] === 'string' ? body['password'] : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HelpPuffError('bad_request', { message: 'Enter a valid email address.', detail: 'setup_bad_email' });
  if (password.length < 10) throw new HelpPuffError('bad_request', { message: 'Use a password of at least 10 characters.', detail: 'setup_weak_password' });
  await spend(c, row);
  const ctx = c.get('helppuff');
  const now = ctx.platform.now();
  const name = typeof body['name'] === 'string' ? body['name'].trim().slice(0, 100) || null : null;
  const hash = await hashPassword(password);
  await db(c)
    .prepare('INSERT INTO admins (email, password_hash, name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)')
    .bind(email, hash, name, now, now)
    .run();
  c.header('Set-Cookie', sessionCookie(await issueSession(requireSecret(ctx), email, now, hash), isSecure(c)));
  return c.json({ email });
});

/** Sign in with a one-time login link. */
setupRoutes.post('/admin/api/login-link', async (c) => {
  assertSameOrigin(c);
  await throttle(c);
  const body = await jsonBody(c);
  const row = await liveToken(c, body['token'], 'login');
  if (!row.email) throw notFound();
  const hash = await passwordHashOf(c, row.email);
  if (hash === null) throw notFound();
  await spend(c, row);
  const ctx = c.get('helppuff');
  c.header('Set-Cookie', sessionCookie(await issueSession(requireSecret(ctx), row.email, ctx.platform.now(), hash), isSecure(c)));
  return c.json({ email: row.email });
});

/** Rotate nothing here, but let a signed-in owner see when setup was done. */
setupRoutes.get('/admin/api/setup/state', async (c) => {
  await currentAdmin(c);
  return c.json({ claimed: await hasAdmin(c), apiKey: String(c.get('helppuff').env['ADMIN_API_KEY'] ?? '').length >= 32 });
});
