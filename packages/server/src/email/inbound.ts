import PostalMime from 'postal-mime';
import { cleanText } from '@helppuff/protocol';
import type { SiteConfig } from '../config/schema.js';
import type { D1Like } from '../db/d1.js';
import { emitTo, outboundOf, workflowRetry } from '../webhooks/deliver.js';
import { handoverCard, hubSettings, postToTelegram, publish, type LiveDeps } from '../live/service.js';
import { aiSettingsFor } from '../knowledge/env.js';
import { logCustomerEmail, readReplyAddress, refIn, setEmailsOff, subjectRef } from '../notifications/customer.js';
import { createConversationJob } from '../conversations/complete.js';
import { reasonOf } from '../core/log.js';

/**
 * Answers by email (Customer emails, C): the Worker's `email()` handler.
 * Cloudflare Email Routing hands it mail sent to `reply@<subdomain>` (one
 * literal rule, set up by `helppuff email replies on`); with sub-addressing
 * the address is `reply+<conversationId>.<sig>@<subdomain>`.
 *
 * Every message is acted on: saved, dropped (automatic mail, never
 * answered: no loops) or rejected with a reason. A saved one is the
 * customer's message in their conversation, which becomes a live chat
 * waiting for the team; the assistant never answers it. Testable with a fake
 * message: no `cloudflare:*` import here.
 */

/** As much of Cloudflare's `ForwardableEmailMessage` as is used. */
export type InboundMessage = {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
};

export type InboundDeps = {
  /** Every site this Worker serves, with its live config. */
  sites: () => Promise<Record<string, SiteConfig>>;
  db: D1Like;
  env: Record<string, unknown>;
  secret: string;
  now: () => number;
  log: (event: string, data?: object) => void;
  waitUntil: (promise: Promise<unknown>) => void;
  fetch?: typeof fetch;
  /** The owner (ADMIN_EMAIL), who may have no row in `admins`. */
  owner?: string | undefined;
};

export type InboundOutcome = 'saved' | 'test' | 'unsubscribed' | 'dropped' | 'rejected';

const MAX_RAW_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_MESSAGE = 4000;

/** Mail no person wrote: answered by nobody, and never replied to. */
export function isAutomatic(headers: Headers, from: string): boolean {
  const auto = headers.get('auto-submitted')?.trim().toLowerCase();
  if (auto && auto !== 'no') return true;
  if (/^(bulk|auto_reply|junk|list)$/i.test(headers.get('precedence')?.trim() ?? '')) return true;
  if (headers.has('x-autoreply') || headers.has('x-autorespond') || headers.get('x-auto-response-suppress')?.toLowerCase().includes('all')) return true;
  const sender = from.trim().toLowerCase();
  return !sender || sender === '<>' || /^(mailer-daemon|postmaster)@/.test(sender);
}

/** A failed DMARC check, as the receiving server recorded it. */
export const failsDmarc = (headers: Headers) => /\bdmarc=fail\b/i.test(headers.get('authentication-results') ?? '');

/** HTML as plain text: the quoted part (Gmail's, Outlook's) cut first. */
export function htmlToText(html: string): string {
  const cut = html.search(/<div[^>]+class="?[^">]*gmail_quote|<blockquote|<div id="?(divRplyFwdMsg|appendonsend)|<hr[^>]*id="?stopSpelling/i);
  return (cut > 0 ? html.slice(0, cut) : html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Only what they wrote now: cut at the first quote header ("On … wrote:",
 * Outlook's "-----Original Message-----" or "From: … Sent: …"), without
 * `>` lines or a `-- ` signature.
 */
export function newPart(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1] ?? '';
    if (/^\s*-{2,}\s*(original message|forwarded message)\s*-{2,}\s*$/i.test(line)) break;
    if (/^\s*_{10,}\s*$/.test(line) && /^\s*from:/i.test(next)) break;
    if (/^\s*from:\s.+/i.test(line) && /^\s*(sent|date):\s/i.test(next)) break;
    if (/^\s*on\s.+wrote:\s*$/i.test(line)) break;
    if (/^\s*on\s.+/i.test(line) && /^.*wrote:\s*$/i.test(next) && !/^\s*on\s/i.test(next)) break;
    if (/^\s*>/.test(line)) continue;
    if (line === '-- ' || line === '--') break;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const addressOf = (value: string | undefined | null) => (/<([^>]+)>/.exec(value ?? '')?.[1] ?? value ?? '').trim().toLowerCase();
const messageIds = (value: string | null | undefined) => [...(value ?? '').matchAll(/<([^>]+)>/g)].map((m) => m[1]!.trim()).slice(-20);

async function readRaw(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  return new Response(stream).arrayBuffer();
}

/** The site whose answers by email arrive at this address's domain. */
async function siteFor(deps: InboundDeps, address: string): Promise<{ siteId: string; site: SiteConfig } | null> {
  const domain = address.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  for (const [siteId, site] of Object.entries(await deps.sites())) {
    if (site.customerEmails.inbound.domain === domain) return { siteId, site };
  }
  return null;
}

/** The conversation an answer is for: its address, then the email it answers, then the tag in its subject. */
async function conversationFor(deps: InboundDeps, siteId: string, to: string, headers: Headers, subject: string): Promise<string | null> {
  const byAddress = await readReplyAddress(deps.secret, siteId, to);
  if (byAddress) return byAddress.conversationId;
  const ids = [...messageIds(headers.get('in-reply-to')), ...messageIds(headers.get('references'))];
  for (const id of ids) {
    const row = await deps.db.prepare('SELECT conversation_id FROM customer_emails WHERE message_id = ? AND site_id = ? LIMIT 1').bind(id, siteId).first<{ conversation_id: string | null }>();
    if (row?.conversation_id) return row.conversation_id;
  }
  const ref = refIn(subject);
  if (ref) {
    const row = await deps.db.prepare('SELECT conversation_id FROM customer_emails WHERE site_id = ? AND ref = ? ORDER BY sent_at DESC LIMIT 1').bind(siteId, ref).first<{ conversation_id: string | null }>();
    // The tag is only a fallback: it must still be this conversation's.
    if (row?.conversation_id && (await subjectRef(deps.secret, row.conversation_id)) === ref) return row.conversation_id;
  }
  return null;
}

export async function handleInboundEmail(message: InboundMessage, deps: InboundDeps): Promise<InboundOutcome> {
  const reject = (reason: string, why: string): InboundOutcome => {
    message.setReject(reason);
    deps.log('email.inbound_rejected', { why });
    return 'rejected';
  };
  try {
    const to = message.to.trim().toLowerCase();
    const found = await siteFor(deps, to);
    if (!found) return reject('Unknown address', 'unknown_domain');
    const { siteId, site } = found;
    if (deps.secret.length < 32) return reject('Not set up', 'no_secret');
    if (message.rawSize > MAX_RAW_BYTES) return reject('Message too large', 'too_large');

    // The CLI's test: arrival is all that is checked.
    const test = await readReplyAddress(deps.secret, siteId, to);
    if (test?.conversationId === 'test') {
      await logCustomerEmail(deps.db, { siteId, conversationId: null, kind: 'inbound-test', to: test.domain, status: 'ok', at: deps.now() });
      deps.log('email.inbound_test', { siteId });
      return 'test';
    }
    if (!site.customerEmails.inbound.enabled) return reject('Replies by email are off', 'off');
    if (isAutomatic(message.headers, message.from)) {
      deps.log('email.inbound_dropped', { why: 'automatic' });
      return 'dropped';
    }
    if (failsDmarc(message.headers)) return reject('DMARC check failed', 'dmarc');

    const raw = await readRaw(message.raw);
    const parsed = await PostalMime.parse(raw);
    const subject = parsed.subject ?? message.headers.get('subject') ?? '';
    const conversationId = await conversationFor(deps, siteId, to, message.headers, subject);
    if (!conversationId) return reject('Unknown conversation', 'unknown_conversation');
    const conversation = await deps.db
      .prepare('SELECT c.id, c.status, c.assigned_to, l.email FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = ? AND c.site_id = ?')
      .bind(conversationId, siteId)
      .first<{ id: string; status: string | null; assigned_to: string | null; email: string | null }>();
    if (!conversation) return reject('Unknown conversation', 'unknown_conversation');

    const body = parsed.text?.trim() ? parsed.text : parsed.html ? htmlToText(parsed.html) : '';
    if (new TextEncoder().encode(body).length > MAX_TEXT_BYTES) return reject('Message too long', 'too_long');
    let text = cleanText(newPart(body), 'input').trim();
    const sender = addressOf(message.from);
    const headerFrom = addressOf(parsed.from?.address ?? message.headers.get('from'));
    const contact = conversation.email?.trim().toLowerCase() ?? '';
    const theirs = Boolean(contact) && (sender === contact || headerFrom === contact);

    // The List-Unsubscribe mailto: "unsubscribe" as the subject, nothing else said.
    if (/^\s*unsubscribe\s*$/i.test(subject) && text.length < 40) {
      if (contact) await setEmailsOff(deps.db, siteId, contact, true, deps.now());
      deps.log('email.unsubscribed', { siteId, via: 'mailto' });
      return 'unsubscribed';
    }

    const attachments = parsed.attachments?.filter((a) => a.disposition !== 'inline').length ?? 0;
    if (!text && !attachments) {
      deps.log('email.inbound_dropped', { why: 'empty' });
      return 'dropped';
    }
    if (attachments) text = `${text}${text ? '\n\n' : ''}(${attachments} attachment${attachments === 1 ? '' : 's'} not shown: ask them to send ${attachments === 1 ? 'it' : 'them'} in the chat)`;
    text = text.slice(0, MAX_MESSAGE);

    const now = deps.now();
    const day = now - (now % 86_400_000);
    const limits = site.security.limits;
    const [mine, all] = await Promise.all([
      deps.db.prepare("SELECT COUNT(*) AS n FROM customer_emails WHERE conversation_id = ? AND kind = 'inbound' AND sent_at >= ?").bind(conversationId, day).first<{ n: number }>(),
      deps.db.prepare("SELECT COUNT(*) AS n FROM customer_emails WHERE site_id = ? AND kind = 'inbound' AND sent_at >= ?").bind(siteId, day).first<{ n: number }>(),
    ]);
    if ((mine?.n ?? 0) >= limits.inboundEmailsPerConversationPerDay || (all?.n ?? 0) >= limits.inboundEmailsPerSitePerDay) {
      deps.log('limit.inbound_emails', { siteId });
      return reject('Too many emails today: please use the chat on our website', 'limit');
    }

    // Whoever has it keeps it, if they are still on the team; else everyone available is alerted.
    const keeper = conversation.assigned_to
      ? await deps.db
          .prepare('SELECT email, name FROM admins WHERE email = ?')
          .bind(conversation.assigned_to)
          .first<{ email: string; name: string | null }>()
          .then((row) => row ?? (conversation.assigned_to === deps.owner ? { email: conversation.assigned_to, name: null } : null))
      : null;
    const assignedTo = keeper?.email ?? null;
    const id = `e${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const payload = { via: 'email', ...(theirs ? {} : { from: headerFrom || sender }) };
    await deps.db.batch([
      deps.db
        .prepare('INSERT OR IGNORE INTO messages (id, conversation_id, role, type, text, payload, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(`${conversationId}:${id}`, conversationId, 'user', 'text', text, JSON.stringify(payload), now),
      deps.db
        .prepare(
          `UPDATE conversations SET status = 'live', waiting_since = ?, closed_at = NULL, completed_at = NULL, handover_at = COALESCE(handover_at, ?),
             assigned_to = ?, assigned_name = CASE WHEN ? IS NULL THEN NULL ELSE assigned_name END, last_at = ?, message_count = message_count + 1 WHERE id = ?`,
        )
        .bind(now, now, assignedTo, assignedTo, now, conversationId),
    ]);
    await logCustomerEmail(deps.db, { siteId, conversationId, kind: 'inbound', to: theirs ? contact : headerFrom || sender, status: theirs ? 'ok' : 'other_sender', at: now });

    deps.waitUntil(announce(deps, site, siteId, conversationId, { id, text, assignedTo, from: theirs ? null : headerFrom || sender, now }));
    return 'saved';
  } catch (thrown) {
    deps.log('email.inbound_failed', { reason: reasonOf(thrown) });
    message.setReject('Could not be delivered, please use the chat on our website');
    return 'rejected';
  }
}

/** The same path a live visitor message takes: the team's dashboards, Telegram, the webhooks and emails; and the conversation's end job again. */
async function announce(deps: InboundDeps, site: SiteConfig, siteId: string, conversationId: string, input: { id: string; text: string; assignedTo: string | null; from: string | null; now: number }): Promise<void> {
  const fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const live: LiveDeps = { db: deps.db, env: deps.env, secret: deps.secret, now: deps.now, fetch: fetcher, waitUntil: deps.waitUntil, log: deps.log };
  try {
    const card = await handoverCard(deps.db, conversationId);
    await publish(live, siteId, {
      type: 'email',
      siteId,
      conversationId,
      message: { id: input.id, ts: input.now, role: 'user', type: 'text', text: input.text },
      conversation: card,
      assignedTo: input.assignedTo,
      who: (card['leadName'] as string | null | undefined) ?? (card['leadEmail'] as string | null | undefined) ?? null,
      settings: hubSettings(site.live),
    });
    await postToTelegram(live, siteId, conversationId, `📧 ${input.text}`).catch((thrown) => deps.log('telegram.relay_failed', { reason: reasonOf(thrown) }));
    await emitTo({ db: deps.db, fetch: fetcher, now: deps.now, log: deps.log, retry: workflowRetry(deps.env), ...outboundOf(deps.env) }, siteId, 'message.received', {
      conversationId,
      kind: 'text',
      text: input.text,
      channel: 'email',
      from: input.from ?? (card['leadName'] as string | null | undefined) ?? (card['leadEmail'] as string | null | undefined) ?? null,
      assignedTo: input.assignedTo,
    });
    // It ends again when it goes quiet: summary, copy, `conversation.completed`.
    const configured = deps.env['HELPPUFF_SUMMARY_MODEL'];
    const model = deps.env['AI'] ? (typeof configured === 'string' && configured ? configured : aiSettingsFor(site).chatModel) : null;
    await createConversationJob(deps.env, site, siteId, conversationId, `conv-${conversationId}-${input.now.toString(36)}`, model).catch(() => {});
  } catch (thrown) {
    deps.log('email.inbound_announce_failed', { reason: reasonOf(thrown) });
  }
}
