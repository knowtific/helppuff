import { Hono } from 'hono';
import { z } from 'zod';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { isIpOrRange } from '../core/ip.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { createKey, forgetKey, keyScopes, keyView, type ApiKeyRow } from '../api/keys.js';
import { ALL_SCOPES, hasScope, isScope, SCOPE_PRESETS, SCOPES, type Scope } from '../api/scopes.js';
import { hashPassword } from './auth.js';
import { assertSameOrigin, currentAdmin, db, jsonBody, siteParam } from './guard.js';
import { mintLink, TTL } from './setup.js';

/**
 * Who and what may use this deployment: dashboard accounts (the team), API
 * keys, and the audit log of what they changed.
 */

export const accessRoutes = new Hono<HonoEnv>();

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INVITE_TTL = 7 * 24 * 3600_000;

function invalid(error: z.ZodError): HelpPuffError {
  const issue = error.issues[0];
  return new HelpPuffError('bad_request', { message: `Check ${issue?.path.join('.') || 'the body'}: ${issue?.message ?? 'invalid'}.`, detail: 'api_body_invalid' });
}

// --------------------------------------------------------------------- team

/** Add a dashboard account. With no password, the answer has a one-time sign-in link (7 days) to send them. */
accessRoutes.post('/admins', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 320) throw new HelpPuffError('bad_request', { message: 'Enter a valid email address.', detail: 'team_bad_email' });
  const password = typeof body['password'] === 'string' ? body['password'] : null;
  if (password !== null && (password.length < 10 || password.length > 1024)) {
    throw new HelpPuffError('bad_request', { message: 'Use a password of at least 10 characters.', detail: 'team_weak_password' });
  }
  const owner = String(c.get('helppuff').env['ADMIN_EMAIL'] ?? '').toLowerCase();
  const d = db(c);
  if (email === owner || (await d.prepare('SELECT 1 AS x FROM admins WHERE email = ?').bind(email).first())) {
    throw new HelpPuffError('conflict', { message: `${email} can already sign in.`, detail: 'team_exists' });
  }
  const name = typeof body['name'] === 'string' ? body['name'].trim().slice(0, 100) || null : null;
  // Without a password, a hash nothing matches: they sign in with the link, then set one with `helppuff users reset`.
  const hash = password ? await hashPassword(password) : `none$${crypto.randomUUID()}`;
  const now = c.get('helppuff').platform.now();
  await d.prepare('INSERT INTO admins (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)').bind(email, hash, name, now).run();
  const link = password ? null : await mintLink(c, 'login', email, INVITE_TTL);
  return c.json({ email, name, createdAt: now, signInLink: link?.url ?? null, signInLinkExpiresAt: link?.expiresAt ?? null }, 201);
});

/** Remove a dashboard account: signed out at their next request. The owner (in Worker config) cannot be removed here. */
accessRoutes.delete('/admins/:email', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  if (email === String(c.get('helppuff').env['ADMIN_EMAIL'] ?? '').toLowerCase()) {
    throw new HelpPuffError('bad_request', { message: 'The owner is set in the Worker’s config; change it with the CLI.', detail: 'team_owner' });
  }
  const result = (await db(c).prepare('DELETE FROM admins WHERE email = ?').bind(email).run()) as { meta?: { changes?: number } } | undefined;
  if (result?.meta?.changes === 0) throw new HelpPuffError('not_found', { message: `No account for ${email}.`, detail: 'team_unknown' });
  return c.json({ email, deleted: true });
});

/** A one-time sign-in link for an account (15 minutes): the way back in after a lost password. */
accessRoutes.post('/admins/:email/sign-in-link', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  const owner = String(c.get('helppuff').env['ADMIN_EMAIL'] ?? '').toLowerCase();
  const known = email === owner || Boolean(await db(c).prepare('SELECT 1 AS x FROM admins WHERE email = ?').bind(email).first());
  if (!known) throw new HelpPuffError('not_found', { message: `No account for ${email}.`, detail: 'team_unknown' });
  const link = await mintLink(c, 'login', email, TTL.login);
  return c.json({ email, url: link.url, expiresAt: link.expiresAt }, 201);
});

// ----------------------------------------------------------------- API keys

export const createKeySchema = z
  .object({
    name: z.string().trim().min(1).max(100).describe('What the key is for, e.g. "Website backend".'),
    site: z.string().min(1).max(64).optional().describe('The site the key works on (one per key). Defaults to the only site.'),
    scopes: z
      .array(z.string())
      .min(1)
      .max(ALL_SCOPES.length)
      .optional()
      .describe(`What it may do: any of ${ALL_SCOPES.join(', ')}. Or use \`preset\`.`),
    preset: z.enum(['chat', 'crm', 'read', 'full']).optional().describe('A ready-made set of scopes: chat, crm, read or full.'),
    expiresInDays: z.number().int().min(1).max(3650).nullable().optional().describe('Days until the key stops working; null or absent: never.'),
    allowIps: z.array(z.string().trim().max(64)).max(50).optional().describe('Only these IP addresses or CIDR ranges may use it.'),
    ratePerMinute: z.number().int().min(1).max(6000).optional().describe('Requests a minute (default `security.limits.apiRequestsPerKeyPerMinute`).'),
  })
  .strict();

accessRoutes.get('/keys', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const rows = await db(c).prepare('SELECT * FROM api_keys WHERE site_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC').bind(siteId).all<ApiKeyRow>();
  return c.json({
    keys: rows.results.map(keyView),
    scopes: Object.entries(SCOPES).map(([scope, description]) => ({ scope, description })),
    presets: Object.entries(SCOPE_PRESETS).map(([id, preset]) => ({ id, ...preset })),
  });
});

/** Make a key. The full key is in this answer only: store it in your secrets manager. */
accessRoutes.post('/keys', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const parsed = createKeySchema.safeParse(await jsonBody(c));
  if (!parsed.success) throw invalid(parsed.error);
  const body = parsed.data;
  const ctx = c.get('helppuff');
  const siteId = siteParam(c, body.site);
  const scopes = body.scopes ?? (body.preset ? SCOPE_PRESETS[body.preset].scopes : null);
  if (!scopes?.length) throw new HelpPuffError('bad_request', { message: 'Give scopes or a preset.', detail: 'key_no_scopes' });
  const unknown = scopes.filter((s) => !isScope(s));
  if (unknown.length) throw new HelpPuffError('bad_request', { message: `Unknown scope: ${unknown.join(', ')}.`, detail: 'key_bad_scope' });
  // A key can only hand out what it has itself.
  const caller = c.get('apiKey');
  if (caller) {
    const beyond = (scopes as Scope[]).filter((s) => !hasScope(keyScopes(caller), s));
    if (beyond.length) throw new HelpPuffError('forbidden', { message: `This key cannot give scopes it does not have: ${beyond.join(', ')}.`, detail: 'key_escalation' });
  }
  const badIp = (body.allowIps ?? []).find((ip) => !isIpOrRange(ip));
  if (badIp) throw new HelpPuffError('bad_request', { message: `Not an IP address or CIDR range: ${badIp}.`, detail: 'key_bad_ip' });
  const site = await resolveSite(ctx, siteId);
  const d = db(c);
  const active = await d.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE site_id = ? AND revoked_at IS NULL').bind(siteId).first<{ n: number }>();
  if ((active?.n ?? 0) >= site.security.limits.apiKeysPerSite) {
    throw new HelpPuffError('bad_request', { message: `This site has ${site.security.limits.apiKeysPerSite} keys already: revoke one first.`, detail: 'key_limit' });
  }
  const now = ctx.platform.now();
  const made = await createKey(
    d,
    requireSecret(ctx),
    {
      name: body.name,
      siteId,
      scopes: [...new Set(scopes)] as Scope[],
      allowIps: body.allowIps ?? [],
      ratePerMinute: body.ratePerMinute ?? site.security.limits.apiRequestsPerKeyPerMinute,
      expiresAt: body.expiresInDays ? now + body.expiresInDays * 86_400_000 : null,
      createdBy: admin.via === 'api-key' ? 'cli' : admin.email,
    },
    now,
  );
  return c.json({ key: made.key, ...made.view }, 201);
});

/** Revoke a key: refused everywhere within 30 seconds. */
accessRoutes.delete('/keys/:id', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const id = c.req.param('id').replace(/^hp_live_/, '');
  const d = db(c);
  const row = await d.prepare('SELECT * FROM api_keys WHERE id = ? AND site_id = ?').bind(id, siteId).first<ApiKeyRow>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such key.', detail: 'key_unknown' });
  const now = c.get('helppuff').platform.now();
  if (!row.revoked_at) await d.prepare('UPDATE api_keys SET revoked_at = ?, revoked_by = ? WHERE id = ?').bind(now, admin.via === 'api-key' ? 'cli' : admin.email, id).run();
  forgetKey(id);
  return c.json({ ...keyView({ ...row, revoked_at: row.revoked_at ?? now }), revoked: true });
});

// -------------------------------------------------------------------- audit

/** Changes made through the API and the dashboard, newest first. Kept 90 days. */
accessRoutes.get('/audit', async (c) => {
  await currentAdmin(c);
  const key = c.get('apiKey');
  const before = Number(c.req.query('before') ?? 0) || null;
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200);
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (key) {
    where.push('site_id = ?');
    params.push(key.site_id);
  }
  if (before) {
    where.push('at < ?');
    params.push(before);
  }
  const rows = await db(c)
    .prepare(`SELECT id, at, actor, action, target, site_id AS site, status FROM audit_log WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT ?`)
    .bind(...params, limit + 1)
    .all<{ at: number }>();
  const items = rows.results.slice(0, limit);
  return c.json({ items, next: rows.results.length > limit ? (items.at(-1)?.at ?? null) : null });
});
