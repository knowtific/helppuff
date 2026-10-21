import { stripChatTokens, type CustomerEmailKind } from '@helppuff/protocol';
import type { StepLike } from '@helppuff/rag';
import type { SiteConfig } from '../config/schema.js';
import { base32Mac, openLink, signLink, timingSafeEqual } from '../core/token.js';
import type { D1Like } from '../db/d1.js';
import { emailBindingOf, emailService, serviceFor, sendThrough, type Email, type EmailBinding, type SentEmail } from './email.js';
import { visitorConnected } from '../live/service.js';

/**
 * Emails to customers (Settings → Customer emails, wiki Customer-Emails):
 *
 *  - **copy** (A): when a chat ends, a recap written for the customer and the
 *    whole conversation (`customerCopy`, from the conversation job);
 *  - **reply** (B): the team's replies to a customer who left, a while after
 *    they were written (`runCustomerReplyJob`, a Workflow kind);
 *  - **answers by email** (C): each email's Reply-To is a signed address of
 *    the conversation (`replyAddress`); `email/inbound.ts` receives them.
 *
 * Every one goes through the site's email service, to the conversation's
 * contact, never to an address that unsubscribed, within the daily limits,
 * with a link to continue the chat (`#hp-resume=`) and one to unsubscribe.
 * Every one is in the `customer_emails` log. What a customer gets is only
 * what they saw: the transcript's visible messages and a recap addressed to
 * them, never the team's summary, labels, notes, attributes or tool data.
 */

export const RESUME_PURPOSE = 'resume';
export const UNSUBSCRIBE_PURPOSE = 'unsubscribe';
export const RESUME_DAYS = 30;
export const RESUME_PARAM = 'hp-resume';

/** What the emails need from the site's config, taken when a job starts (a Workflow has no config of its own). */
export type CustomerContext = {
  siteId: string;
  brand: string;
  showAgentName: boolean;
  origins: string[];
  /** Answers by email are on: Reply-To is the conversation's address at this domain. */
  replyDomain: string | null;
  perContactPerDay: number;
  perSitePerDay: number;
};

export function customerContext(site: SiteConfig, siteId: string): CustomerContext {
  const inbound = site.customerEmails.inbound;
  return {
    siteId,
    brand: site.widget.brand.name,
    showAgentName: site.live.showAgentName,
    origins: site.origins.filter((o) => /^https?:\/\//.test(o)),
    replyDomain: inbound.enabled && inbound.domain ? inbound.domain : null,
    perContactPerDay: site.security.limits.customerEmailsPerContactPerDay,
    perSitePerDay: site.security.limits.customerEmailsPerSitePerDay,
  };
}

export type CustomerDeps = {
  db: D1Like;
  fetch: typeof fetch;
  /** HELPPUFF_SECRET: signs the links and the reply address. Without it, nothing is sent. */
  secret: string | undefined;
  emailBinding?: EmailBinding | undefined;
  now: () => number;
  log?: ((event: string, data?: object) => void) | undefined;
};

// ------------------------------------------------------------ addresses

const SIG_LENGTH = 10;
const REF_LENGTH = 7;

const replySig = (secret: string, siteId: string, conversationId: string) => base32Mac(secret, `reply:${siteId}:${conversationId}`, SIG_LENGTH);

/** `reply+<conversationId>.<sig>@<domain>`: answers to it land in that conversation. `test` is the CLI's test. */
export async function replyAddress(secret: string, siteId: string, conversationId: string, domain: string): Promise<string> {
  return `reply+${conversationId}.${await replySig(secret, siteId, conversationId)}@${domain}`;
}

/** The conversation a reply address names, when its signature is this site's; null otherwise. */
export async function readReplyAddress(secret: string, siteId: string, address: string): Promise<{ conversationId: string; domain: string } | null> {
  const match = /^reply\+([a-z0-9-]{1,64})\.([a-z2-7]{10})@([a-z0-9.-]+)$/i.exec(address.trim());
  if (!match) return null;
  const conversationId = match[1]!.toLowerCase();
  const expected = await replySig(secret, siteId, conversationId);
  return timingSafeEqual(expected, match[2]!.toLowerCase()) ? { conversationId, domain: match[3]!.toLowerCase() } : null;
}

/** The short tag in a subject (`[#k3f9a2q]`), the last way an answer finds its conversation. */
export const subjectRef = (secret: string, conversationId: string) => base32Mac(secret, `ref:${conversationId}`, REF_LENGTH);
export const refIn = (subject: string): string | null => /\[#([a-z2-7]{7})\]/i.exec(subject)?.[1]?.toLowerCase() ?? null;

// ---------------------------------------------------------------- links

/** The page to come back to: where the conversation started, when it is on an allowed origin; else the site's first origin. */
export function resumePage(pageUrl: string | null, origins: string[]): string | null {
  try {
    if (pageUrl) {
      const url = new URL(pageUrl);
      if (origins.some((o) => o.replace(/\/+$/, '') === url.origin)) {
        url.hash = '';
        return url.toString();
      }
    }
  } catch {
    // The first origin, below.
  }
  return origins[0] ? `${origins[0].replace(/\/+$/, '')}/` : null;
}

export async function resumeLink(secret: string, siteId: string, conversationId: string, page: string, now: number): Promise<string> {
  const token = await signLink(secret, RESUME_PURPOSE, { s: siteId, c: conversationId, exp: now + RESUME_DAYS * 86_400_000 });
  return `${page}#${RESUME_PARAM}=${token}`;
}

/** The conversation a resume token opens, for this site; null when it is not one, or expired. */
export async function readResume(secret: string, siteId: string, token: string, now: number): Promise<string | null> {
  const payload = await openLink(secret, RESUME_PURPOSE, token, now);
  return payload && payload['s'] === siteId && typeof payload['c'] === 'string' ? payload['c'] : null;
}

export async function unsubscribeLink(secret: string, base: string, siteId: string, email: string): Promise<string> {
  const token = await signLink(secret, UNSUBSCRIBE_PURPOSE, { s: siteId, e: email.toLowerCase() });
  return `${base.replace(/\/+$/, '')}/v1/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

export async function readUnsubscribe(secret: string, token: string): Promise<{ siteId: string; email: string } | null> {
  const payload = await openLink(secret, UNSUBSCRIBE_PURPOSE, token);
  return payload && typeof payload['s'] === 'string' && typeof payload['e'] === 'string' ? { siteId: payload['s'], email: payload['e'] } : null;
}

/** Stop or allow emails to a contact (by address: a person is one email). */
export async function setEmailsOff(db: D1Like, siteId: string, email: string, off: boolean, now: number): Promise<number> {
  const result = (await db
    .prepare('UPDATE leads SET email_off = ? WHERE site_id = ? AND lower(email) = ?')
    .bind(off ? now : null, siteId, email.toLowerCase())
    .run()) as { meta?: { changes?: number }; changes?: number } | undefined;
  return result?.meta?.changes ?? result?.changes ?? 0;
}

// ------------------------------------------------------------ the emails

export type Line = { who: 'you' | 'assistant' | 'team'; name?: string | null; text: string };

export type CopyInput = { kind: 'copy'; brand: string; recap: string | null; lines: Line[]; contact: { email?: string | null; phone?: string | null } };
export type ReplyInput = { kind: 'reply'; brand: string; agentName: string | null; asked: string | null; replies: string[] };
export type TestInput = { kind: 'test'; brand: string };
export type CustomerEmailInput = (CopyInput | ReplyInput | TestInput) & {
  continueUrl?: string | null;
  unsubscribeUrl?: string | null;
  /** Answers by email are on: say so. */
  canReply?: boolean;
  /** The subject's tag, when answers by email are on. */
  ref?: string | null;
};

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0]?.slice(0, 40) || null;

/**
 * A customer email: a subject, plain text, and the same as HTML, everything
 * escaped (nothing anyone typed becomes markup); the only links are ours.
 */
export function writeCustomerEmail(input: CustomerEmailInput): Email {
  const brand = input.brand.trim() || 'us';
  let subject: string;
  const blocks: { label?: string; text: string }[] = [];
  switch (input.kind) {
    case 'copy':
      subject = `Your conversation with ${brand}`;
      if (input.recap) blocks.push({ text: input.recap });
      for (const line of input.lines) blocks.push({ label: line.who === 'you' ? 'You' : line.who === 'team' ? (firstName(line.name) ?? brand) : brand, text: line.text });
      break;
    case 'reply': {
      const who = input.agentName ? `${input.agentName} from ${brand}` : brand;
      subject = `${who} replied`;
      if (input.asked) blocks.push({ label: 'You asked', text: clip(input.asked, 600) });
      for (const reply of input.replies) blocks.push({ label: input.agentName ?? brand, text: reply });
      break;
    }
    case 'test':
      subject = `A test from ${brand}`;
      blocks.push({ text: 'Answers by email work once this arrives. Nothing to do.' });
      break;
  }
  if (input.ref) subject = `${subject} [#${input.ref}]`;
  const contact = input.kind === 'copy' ? [input.contact.email, input.contact.phone].filter((v): v is string => Boolean(v)) : [];
  const continueLine = input.continueUrl ? (input.canReply ? 'Continue the chat, or just reply to this email.' : 'Continue the chat:') : input.canReply ? 'Just reply to this email to answer.' : '';

  const text = [
    ...blocks.map((b) => (b.label ? `${b.label}: ${b.text}` : b.text)),
    '',
    continueLine,
    input.continueUrl ?? '',
    contact.length ? `\n${brand}: ${contact.join(' · ')}` : '',
    input.unsubscribeUrl ? `\nNo more emails like this: ${input.unsubscribeUrl}` : '',
  ]
    .filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n')
    .trim();

  const p = (inner: string, style = '') => `<p style="margin:0 0 12px${style}">${inner}</p>`;
  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#16163a;max-width:560px">` +
    blocks.map((b) => p(`${b.label ? `<strong>${escapeHtml(b.label)}:</strong> ` : ''}${escapeHtml(b.text).replace(/\n/g, '<br>')}`)).join('') +
    (input.continueUrl
      ? p(`<a href="${escapeHtml(input.continueUrl)}" style="display:inline-block;background:#3b0d24;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Continue the chat</a>${input.canReply ? ' &nbsp;or just reply to this email' : ''}`)
      : input.canReply
        ? p('Just reply to this email to answer.')
        : '') +
    (contact.length ? p(`${escapeHtml(brand)}: ${contact.map(escapeHtml).join(' · ')}`, ';color:#55556d;font-size:13px') : '') +
    (input.unsubscribeUrl ? p(`<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#55556d">No more emails like this</a>`, ';font-size:12px') : '') +
    `</div>`;
  return { subject: clip(subject, 200), text, html };
}

/** The conversation as the customer saw it: their messages and the answers, nothing internal. */
export async function visibleLines(db: D1Like, conversationId: string, limit = 200): Promise<Line[]> {
  const rows = (
    await db
      .prepare(
        "SELECT role, type, text, author, payload FROM messages WHERE conversation_id = ? AND role IN ('user', 'agent') AND text IS NOT NULL AND type NOT IN ('form', 'notice', 'booking') ORDER BY ts, id",
      )
      .bind(conversationId)
      .all<{ role: string; type: string; text: string; author: string | null; payload: string | null }>()
  ).results;
  return rows.slice(-limit).flatMap((row): Line[] => {
    const text = stripChatTokens(row.text).trim();
    if (!text) return [];
    if (row.role === 'user') return [{ who: 'you', text: clip(text, 4000) }];
    let name: string | null = null;
    try {
      name = (JSON.parse(row.payload ?? '{}') as { meta?: { agentName?: string } }).meta?.agentName ?? null;
    } catch {
      // No name.
    }
    return [row.author ? { who: 'team', name, text: clip(text, 4000) } : { who: 'assistant', text: clip(text, 4000) }];
  });
}

// ------------------------------------------------------------- sending

export type CustomerSend = { status: 'sent' | 'skipped' | 'failed'; reason?: string; to?: string; error?: string | null };

const dayStart = (now: number) => now - (now % 86_400_000);

type Contact = { page_url: string | null; email: string | null; email_off: number | null; site_id: string };

async function contactOf(db: D1Like, siteId: string, conversationId: string): Promise<Contact | null> {
  return db
    .prepare('SELECT c.site_id, c.page_url, l.email, l.email_off FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = ? AND c.site_id = ?')
    .bind(conversationId, siteId)
    .first<Contact>();
}

/** The business's own contact details (Knowledge → business details), for the copy's footer and Reply-To. */
async function businessContact(db: D1Like, siteId: string): Promise<{ email: string | null; phone: string | null }> {
  const facts = (
    await db
      .prepare("SELECT key, value FROM site_facts WHERE site_id = ? AND key IN ('phone', 'email')")
      .bind(siteId)
      .all<{ key: string; value: string }>()
      .catch(() => ({ results: [] as { key: string; value: string }[] }))
  ).results;
  const email = facts.find((f) => f.key === 'email')?.value.trim() ?? '';
  const phone = facts.find((f) => f.key === 'phone')?.value.trim().slice(0, 40) ?? '';
  return { email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null, phone: phone || null };
}

export async function logCustomerEmail(
  db: D1Like,
  row: { siteId: string; conversationId: string | null; kind: CustomerEmailKind | 'inbound' | 'inbound-test'; to: string | null; status: string; error?: string | null; messageId?: string | null; ref?: string | null; at: number },
): Promise<void> {
  await db
    .prepare('INSERT INTO customer_emails (id, site_id, conversation_id, kind, to_email, status, error, message_id, ref, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(`ce_${crypto.randomUUID().replace(/-/g, '')}`, row.siteId, row.conversationId, row.kind, row.to, row.status, row.error ?? null, row.messageId ? row.messageId.replace(/^<|>$/g, '') : null, row.ref ?? null, row.at)
    .run();
}

/**
 * Send one email to a conversation's customer, if it may go: the service is
 * on, the contact has an address and did not unsubscribe, today's limits
 * are not used up. Writes it (`write` gets the links), sends, logs. Never throws.
 */
export async function sendToCustomer(
  deps: CustomerDeps,
  ctx: CustomerContext,
  input: { kind: 'copy' | 'reply'; conversationId: string; write: (parts: { continueUrl: string | null; unsubscribeUrl: string | null; canReply: boolean; ref: string | null; business: { email: string | null; phone: string | null } }) => Promise<Email | null> | Email | null },
): Promise<CustomerSend> {
  const { db, now } = deps;
  const secret = deps.secret && deps.secret.length >= 32 ? deps.secret : null;
  try {
    if (!secret) return { status: 'skipped', reason: 'no_secret' };
    const row = await emailService(db, ctx.siteId, now());
    if (!row?.enabled) return { status: 'skipped', reason: 'no_email_service' };
    const contact = await contactOf(db, ctx.siteId, input.conversationId);
    if (!contact) return { status: 'skipped', reason: 'not_found' };
    const to = contact.email?.trim().toLowerCase();
    if (!to) return { status: 'skipped', reason: 'no_email' };
    if (contact.email_off) return { status: 'skipped', reason: 'unsubscribed', to };
    const since = dayStart(now());
    const [mine, site] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS n FROM customer_emails WHERE site_id = ? AND to_email = ? AND kind IN ('copy', 'reply') AND status = 'ok' AND sent_at >= ?").bind(ctx.siteId, to, since).first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM customer_emails WHERE site_id = ? AND kind IN ('copy', 'reply') AND status = 'ok' AND sent_at >= ?").bind(ctx.siteId, since).first<{ n: number }>(),
    ]);
    if ((mine?.n ?? 0) >= ctx.perContactPerDay || (site?.n ?? 0) >= ctx.perSitePerDay) {
      deps.log?.('limit.customer_emails', { siteId: ctx.siteId, kind: input.kind });
      return { status: 'skipped', reason: 'limit', to };
    }
    const service = await serviceFor(row, secret, deps.emailBinding, deps.fetch);
    if ('problem' in service) {
      await logCustomerEmail(db, { siteId: ctx.siteId, conversationId: input.conversationId, kind: input.kind, to, status: 'failed', error: service.problem, at: now() });
      return { status: 'failed', reason: 'service', error: service.problem, to };
    }

    const page = resumePage(contact.page_url, ctx.origins);
    const replyTo = ctx.replyDomain ? await replyAddress(secret, ctx.siteId, input.conversationId, ctx.replyDomain) : null;
    const unsubscribeUrl = row.dashboard_url ? await unsubscribeLink(secret, row.dashboard_url, ctx.siteId, to) : null;
    const ref = ctx.replyDomain ? await subjectRef(secret, input.conversationId) : null;
    const business = await businessContact(db, ctx.siteId);
    const email = await input.write({
      continueUrl: page ? await resumeLink(secret, ctx.siteId, input.conversationId, page, now()) : null,
      unsubscribeUrl,
      canReply: Boolean(replyTo),
      ref,
      business,
    });
    if (!email) return { status: 'skipped', reason: 'nothing_to_send', to };

    // Threads with the last email of this conversation, when the service told us its id.
    const last = await db
      .prepare('SELECT message_id FROM customer_emails WHERE conversation_id = ? AND message_id IS NOT NULL ORDER BY sent_at DESC LIMIT 1')
      .bind(input.conversationId)
      .first<{ message_id: string }>();
    const unsubscribe = [unsubscribeUrl ? `<${unsubscribeUrl}>` : '', replyTo ? `<mailto:${replyTo}?subject=unsubscribe>` : ''].filter(Boolean).join(', ');
    const headers: Record<string, string> = {
      'Auto-Submitted': 'auto-generated',
      ...(unsubscribe ? { 'List-Unsubscribe': unsubscribe } : {}),
      ...(unsubscribeUrl ? { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
      ...(last ? { 'In-Reply-To': `<${last.message_id}>`, References: `<${last.message_id}>` } : {}),
    };
    const sent: SentEmail = await sendThrough(service, ctx.siteId, to, { ...email, replyTo: replyTo ?? business.email ?? undefined, headers });
    await logCustomerEmail(db, { siteId: ctx.siteId, conversationId: input.conversationId, kind: input.kind, to, status: sent.ok ? 'ok' : 'failed', error: sent.error, messageId: sent.messageId ?? null, ref, at: now() });
    if (!sent.ok) deps.log?.('customer_email.failed', { kind: input.kind, status: sent.status, reason: sent.error });
    return sent.ok ? { status: 'sent', to } : { status: 'failed', reason: 'service', error: sent.error, to };
  } catch (thrown) {
    deps.log?.('customer_email.failed', { kind: input.kind, reason: String((thrown as Error)?.message ?? thrown).slice(0, 200) });
    return { status: 'failed', reason: 'error' };
  }
}

// --------------------------------------------------------------- A: copy

/**
 * The copy of a conversation (A). From the conversation job when the switch
 * is on, or by hand from the dashboard (`manual`: whatever the switch says,
 * and again if one went). Automatic copies need two visitor messages,
 * something new since the last copy, and none in the last day.
 */
export async function customerCopy(deps: CustomerDeps, ctx: CustomerContext, conversationId: string, options: { manual?: boolean } = {}): Promise<CustomerSend> {
  const { db } = deps;
  if (!options.manual) {
    const [visitor, last] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS n, MAX(ts) AS at FROM messages WHERE conversation_id = ? AND role = 'user'").bind(conversationId).first<{ n: number; at: number | null }>(),
      db.prepare("SELECT MAX(sent_at) AS at FROM customer_emails WHERE conversation_id = ? AND kind = 'copy' AND status = 'ok'").bind(conversationId).first<{ at: number | null }>(),
    ]);
    if ((visitor?.n ?? 0) < 2) return { status: 'skipped', reason: 'too_short' };
    if (last?.at && (last.at > deps.now() - 86_400_000 || last.at >= (visitor?.at ?? 0))) return { status: 'skipped', reason: 'already_sent' };
  }
  return sendToCustomer(deps, ctx, {
    kind: 'copy',
    conversationId,
    write: async (parts) => {
      const [lines, row] = await Promise.all([visibleLines(db, conversationId), db.prepare('SELECT summary FROM conversations WHERE id = ?').bind(conversationId).first<{ summary: string | null }>()]);
      if (!lines.length) return null;
      let recap: string | null = null;
      try {
        const value = (JSON.parse(row?.summary ?? '{}') as { recap?: unknown }).recap;
        recap = typeof value === 'string' && value.trim() ? value.trim().slice(0, 800) : null;
      } catch {
        // The transcript alone.
      }
      return writeCustomerEmail({ kind: 'copy', brand: ctx.brand, recap, lines, contact: parts.business, ...parts });
    },
  });
}

// ------------------------------------------------------- B: team replies

export type CustomerReplyParams = {
  kind: 'customer-reply';
  siteId: string;
  conversationId: string;
  delayMs: number;
  context: CustomerContext;
};

/** The Workflow instance for a reply: replies until the next email share one, so a burst is one email. */
export const customerReplyInstance = (conversationId: string, emailedAt: number | null, messageTs: number, delayMs: number) =>
  `cr-${conversationId}-${(delayMs > 0 ? (emailedAt ?? 0) : messageTs).toString(36)}`.slice(0, 100);

/**
 * B's job: wait (`customerReplyDelaySeconds`), then, unless the customer is
 * on the conversation now (they saw it), email every reply from the team
 * since the last email. Whatever happens, the replies up to now are dealt
 * with (`emailed_at`), so the next reply starts a new job.
 */
export async function runCustomerReplyJob(step: StepLike, deps: CustomerDeps & { connected: (siteId: string, conversationId: string) => Promise<boolean> }, params: CustomerReplyParams): Promise<CustomerSend> {
  if (params.delayMs > 0) await step.sleep('wait', params.delayMs);
  return step.do('send', async () => {
    const { db } = deps;
    const done = (result: CustomerSend) =>
      db
        .prepare('UPDATE conversations SET emailed_at = ? WHERE id = ?')
        .bind(deps.now(), params.conversationId)
        .run()
        .then(() => result);
    if (await deps.connected(params.siteId, params.conversationId).catch(() => false)) return done({ status: 'skipped', reason: 'on_the_site' });
    const row = await db.prepare('SELECT emailed_at FROM conversations WHERE id = ? AND site_id = ?').bind(params.conversationId, params.siteId).first<{ emailed_at: number | null }>();
    if (!row) return { status: 'skipped', reason: 'not_found' };
    const lastVisitor = await db.prepare("SELECT MAX(ts) AS at FROM messages WHERE conversation_id = ? AND role = 'user'").bind(params.conversationId).first<{ at: number | null }>();
    const after = Math.max(row.emailed_at ?? 0, lastVisitor?.at ?? 0);
    const replies = (
      await db
        .prepare("SELECT text, payload FROM messages WHERE conversation_id = ? AND role = 'agent' AND author IS NOT NULL AND text IS NOT NULL AND ts > ? ORDER BY ts, id LIMIT 20")
        .bind(params.conversationId, after)
        .all<{ text: string; payload: string | null }>()
    ).results.filter((r) => {
      try {
        return !(JSON.parse(r.payload ?? '{}') as { noEmail?: unknown }).noEmail;
      } catch {
        return true;
      }
    });
    if (!replies.length) return done({ status: 'skipped', reason: 'nothing_new' });
    let agentName: string | null = null;
    try {
      agentName = params.context.showAgentName ? ((JSON.parse(replies.at(-1)!.payload ?? '{}') as { meta?: { agentName?: string } }).meta?.agentName ?? null) : null;
    } catch {
      // The brand alone.
    }
    const asked = await db
      .prepare("SELECT text FROM messages WHERE conversation_id = ? AND role = 'user' AND text IS NOT NULL ORDER BY ts DESC, id DESC LIMIT 1")
      .bind(params.conversationId)
      .first<{ text: string }>();
    const result = await sendToCustomer(deps, params.context, {
      kind: 'reply',
      conversationId: params.conversationId,
      write: (parts) => writeCustomerEmail({ kind: 'reply', brand: params.context.brand, agentName, asked: asked ? stripChatTokens(asked.text) : null, replies: replies.map((r) => stripChatTokens(r.text)), ...parts }),
    });
    return done(result);
  });
}

/** When a test email last arrived at this domain's reply address (`helppuff email replies test`; recorded by `email/inbound.ts`). */
export async function inboundVerifiedAt(db: D1Like, siteId: string, domain: string): Promise<number | null> {
  const row = await db
    .prepare("SELECT MAX(sent_at) AS at FROM customer_emails WHERE site_id = ? AND kind = 'inbound-test' AND status = 'ok' AND to_email = ?")
    .bind(siteId, domain)
    .first<{ at: number | null }>()
    .catch(() => null);
  return row?.at ?? null;
}

type WorkflowCreate = { create(options: { id?: string; params: unknown }): Promise<unknown> };

/**
 * A person on the team replied: start B's job when the customer should get it
 * by email. B on, or answers by email on and the customer's last message came
 * by email (they write by email, so they are answered by email). Never throws.
 */
export async function startCustomerReply(
  deps: { db: D1Like; env: Record<string, unknown>; log: (event: string, data?: object) => void; secret: string; fetch: typeof fetch; now: () => number },
  site: SiteConfig,
  siteId: string,
  conversationId: string,
  messageTs: number,
): Promise<void> {
  try {
    const emails = site.customerEmails;
    if (!emails.replies.enabled && !(emails.inbound.enabled && emails.inbound.domain)) return;
    const workflow = deps.env['CRAWL_WORKFLOW'] as Partial<WorkflowCreate> | undefined;
    const delayMs = site.security.limits.customerReplyDelaySeconds * 1000;
    // Without the Workflow (an older deployment, local development) only "at once" can be kept.
    if ((!workflow || typeof workflow.create !== 'function') && delayMs > 0) return;
    const row = await deps.db
      .prepare(
        `SELECT c.emailed_at, l.email, l.email_off,
           (SELECT payload FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.ts DESC LIMIT 1) AS last_visitor
         FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = ? AND c.site_id = ?`,
      )
      .bind(conversationId, siteId)
      .first<{ emailed_at: number | null; email: string | null; email_off: number | null; last_visitor: string | null }>();
    if (!row?.email || row.email_off) return;
    if (!emails.replies.enabled) {
      let byEmail = false;
      try {
        byEmail = (JSON.parse(row.last_visitor ?? '{}') as { via?: unknown }).via === 'email';
      } catch {
        // Not by email.
      }
      if (!byEmail) return;
    }
    const params: CustomerReplyParams = { kind: 'customer-reply', siteId, conversationId, delayMs, context: customerContext(site, siteId) };
    if (!workflow || typeof workflow.create !== 'function') {
      const inline: StepLike = { do: (_name, run) => run() as never, sleep: async () => {} };
      await runCustomerReplyJob(inline, { db: deps.db, fetch: deps.fetch, secret: deps.secret, emailBinding: emailBindingOf(deps.env), now: deps.now, log: deps.log, connected: (site, id) => visitorConnected(deps.env, site, id) }, params);
      return;
    }
    await workflow.create({ id: customerReplyInstance(conversationId, row.emailed_at, messageTs, delayMs), params }).catch(() => {
      // Already waiting for this burst of replies: that job sends this one too.
    });
  } catch (thrown) {
    deps.log('customer_email.reply_not_started', { reason: String((thrown as Error)?.message ?? thrown).slice(0, 200) });
  }
}
