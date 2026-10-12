import { Hono, type Context } from 'hono';
import { EMAIL_NOTIFICATIONS, EMAIL_PRESETS, emailAllowed, type EmailNotification } from '@helppuff/protocol';
import { HelpPuffError } from '../core/errors.js';
import { headersView, sealHeaders, storedHeaders, validMethod, validOutboundUrl, type OutboundSpec } from '../core/outbound.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { ensureSchema } from '../db/d1.js';
import { EMAIL_HEADER_PURPOSE, emailService, forgetEmailService, recordOutcome, sendEmail, serviceSpec, writeEmail, type EmailServiceRow } from '../notifications/email.js';
import { assertAdmin, assertSameOrigin, currentAdmin, db, jsonBody, siteParam } from './guard.js';

/**
 * Email notifications (Settings → Notifications). Admins connect the site's
 * email service: one request for their provider, filled with `{{email.to}}`,
 * `{{email.subject}}`, `{{email.text}}` and `{{email.html}}`. Everyone picks
 * their own emails in `/prefs` (`emails`); `GET /notifications` says what
 * there is to pick and whether email is set up. Sent by `notifications/email.ts`.
 */

export const notificationRoutes = new Hono<HonoEnv>();

const bad = (message: string, detail: string) => new HelpPuffError('bad_request', { message, detail });

const view = (row: EmailServiceRow) => ({
  method: row.method,
  url: row.url,
  headers: headersView(storedHeaders(row.headers)),
  body: row.body,
  enabled: Boolean(row.enabled),
  dashboardUrl: row.dashboard_url,
  lastStatus: row.last_status,
  lastError: row.last_error,
  lastAt: row.last_at,
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
});

const choices = (role: 'owner' | 'admin' | 'member') =>
  (Object.entries(EMAIL_NOTIFICATIONS) as [EmailNotification, (typeof EMAIL_NOTIFICATIONS)[EmailNotification]][])
    .filter(([type]) => emailAllowed(type, role))
    .map(([type, about]) => ({ type, label: about.label, description: about.description }));

/** What there is to choose, and whether the site can send email yet. Anyone on the team. */
notificationRoutes.get('/notifications', async (c) => {
  const admin = await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const row = await emailService(db(c), siteId, c.get('helppuff').platform.now());
  return c.json({
    email: { configured: Boolean(row), enabled: Boolean(row?.enabled), ...(admin.role !== 'member' && row ? { lastStatus: row.last_status, lastError: row.last_error, lastAt: row.last_at } : {}) },
    choices: choices(admin.role),
  });
});

notificationRoutes.get('/notifications/email', async (c) => {
  assertAdmin(await currentAdmin(c));
  const siteId = siteParam(c, c.req.query('site'));
  await ensureSchema(db(c));
  const row = await db(c).prepare('SELECT * FROM email_service WHERE site_id = ?').bind(siteId).first<EmailServiceRow>();
  return c.json({
    service: row ? view(row) : null,
    presets: EMAIL_PRESETS.map((p) => ({ id: p.id, name: p.name, docs: p.docs, key: p.key, request: p.request('you@yourdomain.com', '') })),
  });
});

type Draft = Omit<OutboundSpec, 'headers'> & { headers: string };

/** The request from the dashboard's (or the API's) JSON, over what is stored. It has to address someone. */
async function validService(body: Record<string, unknown>, was: EmailServiceRow | null, secret: () => string): Promise<Draft> {
  const kept = was ? storedHeaders(was.headers) : [];
  const headers = body['headers'] === undefined ? kept : await sealHeaders(body['headers'], kept, secret(), EMAIL_HEADER_PURPOSE, 'email');
  const url = validOutboundUrl(body['url'] === undefined ? was?.url : body['url'], 'email_url');
  const text = body['body'] === undefined ? (was?.body ?? '') : typeof body['body'] === 'string' ? body['body'].slice(0, 20_000) : '';
  const draft = { method: validMethod(body['method'] === undefined ? (was?.method ?? 'POST') : body['method']), url, headers: JSON.stringify(headers), body: text };
  const all = [draft.url, draft.body, ...headers.filter((h) => !h.secret).map((h) => h.value)].join('\n');
  if (!/\{\{\s*email\.to\s*\}\}/.test(all)) throw bad('Put {{email.to}} where the recipient goes, so each email reaches its person.', 'email_to_missing');
  if (!/\{\{\s*email\.(text|html)\s*\}\}/.test(all)) throw bad('Put {{email.text}} (or {{email.html}}) where the message goes.', 'email_text_missing');
  return draft;
}

/** The dashboard's address, from the request that saved the service: the links in emails. */
const dashboardOf = (c: Context<HonoEnv>) => {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return null;
  }
};

notificationRoutes.put('/notifications/email', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  assertAdmin(admin);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site'] ?? c.req.query('site'));
  const d = db(c);
  await ensureSchema(d);
  const was = await d.prepare('SELECT * FROM email_service WHERE site_id = ?').bind(siteId).first<EmailServiceRow>();
  const draft = await validService(body, was ?? null, () => requireSecret(c.get('helppuff')));
  const enabled = typeof body['enabled'] === 'boolean' ? body['enabled'] : was ? Boolean(was.enabled) : true;
  const now = c.get('helppuff').platform.now();
  await d
    .prepare(
      `INSERT INTO email_service (site_id, method, url, headers, body, enabled, dashboard_url, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site_id) DO UPDATE SET method = excluded.method, url = excluded.url, headers = excluded.headers, body = excluded.body,
         enabled = excluded.enabled, dashboard_url = excluded.dashboard_url, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(siteId, draft.method, draft.url, draft.headers, draft.body, enabled ? 1 : 0, dashboardOf(c) ?? was?.dashboard_url ?? null, admin.email, now)
    .run();
  forgetEmailService(siteId);
  const row = (await d.prepare('SELECT * FROM email_service WHERE site_id = ?').bind(siteId).first<EmailServiceRow>())!;
  return c.json(view(row));
});

notificationRoutes.delete('/notifications/email', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const siteId = siteParam(c, c.req.query('site'));
  await ensureSchema(db(c));
  await db(c).prepare('DELETE FROM email_service WHERE site_id = ?').bind(siteId).run();
  forgetEmailService(siteId);
  return c.json({ deleted: true });
});

/**
 * Send a test email now, to you (or `to`), and say what the service answered.
 * With `url`, `headers` or `body` it tests those unsaved changes instead
 * (empty secret headers use the stored values).
 */
notificationRoutes.post('/notifications/email/test', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  assertAdmin(admin);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site'] ?? c.req.query('site'));
  const to = typeof body['to'] === 'string' && body['to'].trim() ? body['to'].trim() : admin.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) throw bad('Say which address to send the test to (`to`).', 'email_test_to');
  const ctx = c.get('helppuff');
  const d = db(c);
  await ensureSchema(d);
  const was = await d.prepare('SELECT * FROM email_service WHERE site_id = ?').bind(siteId).first<EmailServiceRow>();
  const draftGiven = ['url', 'headers', 'body', 'method'].some((k) => body[k] !== undefined);
  if (!was && !draftGiven) throw new HelpPuffError('not_found', { message: 'Set up the email service first.', detail: 'email_service_missing' });
  const row: EmailServiceRow = draftGiven
    ? { ...(was ?? { site_id: siteId, enabled: 1, dashboard_url: null, last_status: null, last_error: null, last_at: null, updated_by: null, updated_at: 0 }), ...(await validService(body, was ?? null, () => requireSecret(ctx))) }
    : was!;
  const spec = await serviceSpec(row, ctx.secret || undefined);
  if (!spec) throw bad('A secret header could not be read (HELPPUFF_SECRET changed): enter its value again.', 'email_secret_unreadable');
  const sent = await sendEmail(globalThis.fetch.bind(globalThis), spec, siteId, to, writeEmail('test', {}, dashboardOf(c)));
  if (!draftGiven) await recordOutcome(d, siteId, [sent], ctx.platform.now());
  return c.json({ ...sent, to });
});
