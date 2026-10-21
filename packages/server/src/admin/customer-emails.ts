import { Hono, type Context } from 'hono';
import { EMAIL_PRESETS, presetOf, sendsReplyTo } from '@helppuff/protocol';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { storedHeaders } from '../core/outbound.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { ensureSchema } from '../db/d1.js';
import { liveAvailable } from '../live/service.js';
import { customerContext, customerCopy, inboundVerifiedAt, logCustomerEmail, replyAddress, setEmailsOff, writeCustomerEmail, type CustomerDeps } from '../notifications/customer.js';
import { emailBindingOf, emailService, forgetEmailService, sendThrough, serviceFor, type EmailServiceRow } from '../notifications/email.js';
import { parseJsonTemplate } from '../tools/template.js';
import { assertAdmin, assertSameOrigin, assertSiteAccess, currentAdmin, db, jsonBody, siteParam } from './guard.js';
import { saveSettings } from './settings.js';

/**
 * Settings → Customer emails (wiki Customer-Emails): what each switch still
 * needs (`/customer-emails/status`), the emails sent (`/log`), a preview, the
 * request's reply-to field added for the owner, and the CLI's reply address
 * and its test. Admins only, except emailing a copy from a conversation,
 * which anyone on the team may do. The switches themselves are settings
 * (`customerEmails`, `PUT /settings`).
 */

export const customerEmailRoutes = new Hono<HonoEnv>();

const bad = (message: string, detail: string) => new HelpPuffError('bad_request', { message, detail });

const customerDeps = (c: Context<HonoEnv>): CustomerDeps => {
  const ctx = c.get('helppuff');
  return { db: db(c), fetch: globalThis.fetch.bind(globalThis), secret: ctx.secret || undefined, emailBinding: emailBindingOf(ctx.env), now: () => ctx.platform.now(), log: (event, data) => ctx.platform.log(event, data) };
};

function serviceView(row: EmailServiceRow | null) {
  if (!row) return null;
  const cloudflare = row.kind === 'cloudflare';
  const preset = cloudflare ? undefined : presetOf(row.url);
  let host: string | null = null;
  try {
    host = cloudflare ? null : new URL(row.url).host;
  } catch {
    // No name.
  }
  const replyTo = cloudflare || sendsReplyTo({ url: row.url, body: row.body, headers: storedHeaders(row.headers).filter((h) => !h.secret) });
  return {
    kind: cloudflare ? ('cloudflare' as const) : ('request' as const),
    name: cloudflare ? 'Cloudflare Email Service' : (preset?.name ?? host),
    from: row.from_address ?? null,
    enabled: Boolean(row.enabled),
    sendsReplyTo: replyTo,
    // The dashboard can add it itself to a request made from a preset.
    canAddReplyTo: !replyTo && Boolean(preset),
    lastStatus: row.last_status,
    lastError: row.last_error,
  };
}

/** Every switch, what it still needs, and the reply address. */
customerEmailRoutes.get('/customer-emails/status', async (c) => {
  assertAdmin(await currentAdmin(c));
  const ctx = c.get('helppuff');
  const siteId = siteParam(c, c.req.query('site'));
  const site = await resolveSite(ctx, siteId);
  await ensureSchema(db(c));
  const row = await emailService(db(c), siteId, ctx.platform.now());
  const service = serviceView(row);
  const inbound = site.customerEmails.inbound;
  const verifiedAt = inbound.domain ? await inboundVerifiedAt(db(c), siteId, inbound.domain) : null;
  const live = liveAvailable(ctx.env, site, siteId);
  const sends = Boolean(service?.enabled) && ctx.secret.length >= 32;
  return c.json({
    site: siteId,
    origin: site.origins[0] ?? null,
    settings: site.customerEmails,
    delaySeconds: site.security.limits.customerReplyDelaySeconds,
    service,
    live,
    inbound: { domain: inbound.domain ?? null, ruleId: inbound.ruleId ?? null, verifiedAt, address: inbound.domain ? `reply@${inbound.domain}` : null },
    ready: {
      copy: sends,
      replies: sends && live,
      inbound: sends && live && Boolean(inbound.domain && verifiedAt) && Boolean(service?.sendsReplyTo),
    },
  });
});

/** The last emails sent to (and received from) customers. */
customerEmailRoutes.get('/customer-emails/log', async (c) => {
  assertAdmin(await currentAdmin(c));
  const siteId = siteParam(c, c.req.query('site'));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20));
  await ensureSchema(db(c));
  const rows = await db(c)
    .prepare('SELECT id, conversation_id AS conversationId, kind, to_email AS "to", status, error, sent_at AS at FROM customer_emails WHERE site_id = ? ORDER BY sent_at DESC LIMIT ?')
    .bind(siteId, limit)
    .all<Record<string, unknown>>();
  return c.json({ emails: rows.results });
});

/** What a customer would get, written from the site's names with a sample conversation. */
customerEmailRoutes.get('/customer-emails/preview', async (c) => {
  assertAdmin(await currentAdmin(c));
  const site = await resolveSite(c.get('helppuff'), siteParam(c, c.req.query('site')));
  const kind = c.req.query('kind') === 'reply' ? 'reply' : 'copy';
  const brand = site.widget.brand.name;
  const canReply = Boolean(site.customerEmails.inbound.enabled && site.customerEmails.inbound.domain);
  const links = { continueUrl: `${site.origins[0]?.replace(/\/+$/, '') ?? 'https://example.com'}/#hp-resume=…`, unsubscribeUrl: 'https://…/v1/email/unsubscribe', canReply };
  const email =
    kind === 'reply'
      ? writeCustomerEmail({ kind: 'reply', brand, agentName: site.live.showAgentName ? 'Sam' : null, asked: 'Can someone come out tomorrow morning?', replies: ['Yes, I can be there at 10am. Does that work?'], ...links })
      : writeCustomerEmail({
          kind: 'copy',
          brand,
          recap: 'You asked whether someone could come tomorrow. We said the team would confirm a time by email.',
          lines: [
            { who: 'you', text: 'Can someone come out tomorrow morning?' },
            { who: 'assistant', text: 'I’ll ask the team to confirm a time. What’s the best email to reach you?' },
          ],
          contact: { email: null, phone: null },
          ...links,
        });
  return c.json(email);
});

/** Email the customer a copy of this conversation now (A, by hand, whether or not A is on). */
customerEmailRoutes.post('/conversations/:id/email-copy', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const id = c.req.param('id');
  const row = await db(c).prepare('SELECT site_id FROM conversations WHERE id = ?').bind(id).first<{ site_id: string }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such conversation.', detail: 'admin_conversation_missing' });
  assertSiteAccess(c, row.site_id, 'conversation');
  const site = await resolveSite(c.get('helppuff'), row.site_id);
  const result = await customerCopy(customerDeps(c), customerContext(site, row.site_id), id, { manual: true });
  if (result.status === 'sent') return c.json(result);
  const why: Record<string, string> = {
    no_secret: 'This deployment has no HELPPUFF_SECRET.',
    no_email_service: 'Connect an email service first: Settings → Notifications.',
    no_email: 'There is no email address for this visitor.',
    unsubscribed: 'This customer unsubscribed from emails.',
    limit: 'Today’s limit of emails to this customer (or from the site) is used up.',
    nothing_to_send: 'Nothing in this conversation to send yet.',
    service: `The email service refused it${result.error ? `: ${result.error}` : ''}.`,
  };
  throw bad(why[result.reason ?? ''] ?? 'It could not be sent.', `customer_copy_${result.reason ?? 'failed'}`);
});

/**
 * "Add it for me": the request's body gets where replies go and the extra
 * headers, in its service's own names (the preset's `customer` fields). Only
 * for a request made from a preset; a field already there is kept.
 */
customerEmailRoutes.post('/customer-emails/reply-to', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  assertAdmin(admin);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site'] ?? c.req.query('site'));
  const d = db(c);
  await ensureSchema(d);
  const row = await d.prepare('SELECT * FROM email_service WHERE site_id = ?').bind(siteId).first<EmailServiceRow>();
  if (!row || row.kind === 'cloudflare') throw bad('There is no request to change.', 'customer_emails_no_request');
  const preset = EMAIL_PRESETS.find((p) => p.request('', '').url === row.url.trim());
  const parsed = parseJsonTemplate(row.body.trim());
  if (!preset || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw bad('Add {{email.replyTo}} to the request yourself, where your service takes a reply-to address (Settings → Notifications).', 'customer_emails_reply_to_manual');
  }
  const merged = { ...preset.customer, ...(parsed as Record<string, unknown>) };
  await d
    .prepare('UPDATE email_service SET body = ?, updated_by = ?, updated_at = ? WHERE site_id = ?')
    .bind(JSON.stringify(merged, null, 2), admin.email, c.get('helppuff').platform.now(), siteId)
    .run();
  forgetEmailService(siteId);
  return c.json({ body: JSON.stringify(merged, null, 2) });
});

/** The CLI's reply address (`helppuff email replies on|off`): the subdomain and the Email Routing rule. */
customerEmailRoutes.put('/customer-emails/inbound', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  assertAdmin(admin);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const domain = body['domain'] === null ? null : typeof body['domain'] === 'string' ? body['domain'].trim().toLowerCase() : undefined;
  if (domain === undefined) throw bad('Say which subdomain receives replies (`domain`), or null to remove it.', 'customer_emails_domain_missing');
  if (domain !== null && !/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw bad('That is not a domain name like chat.acme.com.', 'customer_emails_domain_invalid');
  const ruleId = typeof body['ruleId'] === 'string' && body['ruleId'] ? body['ruleId'].slice(0, 64) : null;
  const patch = typeof body['enabled'] === 'boolean' ? { customerEmails: { inbound: { enabled: body['enabled'] } } } : {};
  const saved = await saveSettings(c, siteId, patch, admin.via === 'api-key' ? 'cli' : admin.email, { domain, ruleId });
  return c.json({ site: siteId, customerEmails: saved.settings.customerEmails, settings: saved.settings, hash: saved.hash });
});

/** Send the test email to the reply address; `status` shows `verifiedAt` once it arrived. */
customerEmailRoutes.post('/customer-emails/test', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const ctx = c.get('helppuff');
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site'] ?? c.req.query('site'));
  const site = await resolveSite(ctx, siteId);
  const domain = site.customerEmails.inbound.domain;
  if (!domain) throw bad('Set the reply address up first: `helppuff email replies on <subdomain>`.', 'customer_emails_inbound_not_set_up');
  const d = db(c);
  await ensureSchema(d);
  const row = await emailService(d, siteId, ctx.platform.now());
  if (!row?.enabled) throw bad('Connect an email service first: Settings → Notifications, or `helppuff email set`.', 'customer_emails_no_service');
  const service = await serviceFor(row, ctx.secret || undefined, emailBindingOf(ctx.env), globalThis.fetch.bind(globalThis));
  if ('problem' in service) throw bad(service.problem, 'customer_emails_service');
  const to = await replyAddress(requireSecret(ctx), siteId, 'test', domain);
  const sent = await sendThrough(service, siteId, to, writeCustomerEmail({ kind: 'test', brand: site.widget.brand.name }));
  await logCustomerEmail(d, { siteId, conversationId: null, kind: 'test', to, status: sent.ok ? 'ok' : 'failed', error: sent.error, messageId: sent.messageId ?? null, at: ctx.platform.now() });
  return c.json({ ...sent, to });
});

/** Stop or allow emails to a contact (`allowed: true` is "Allow again"). */
customerEmailRoutes.post('/leads/:id/emails', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const body = await jsonBody(c);
  if (typeof body['allowed'] !== 'boolean') throw bad('Say `allowed`: true or false.', 'lead_emails_allowed');
  const lead = await db(c).prepare('SELECT id, site_id, email FROM leads WHERE id = ?').bind(c.req.param('id')).first<{ id: string; site_id: string; email: string | null }>();
  if (!lead) throw new HelpPuffError('not_found', { message: 'No such contact.', detail: 'admin_lead_missing' });
  assertSiteAccess(c, lead.site_id, 'lead');
  if (!lead.email) throw bad('This contact has no email address.', 'lead_no_email');
  await setEmailsOff(db(c), lead.site_id, lead.email, !body['allowed'], c.get('helppuff').platform.now());
  return c.json({ id: lead.id, emailOff: !body['allowed'] });
});
