import { EMAIL_NOTIFICATIONS, emailAllowed, isEmailNotification, type EmailNotification, type WebhookEventType } from '@helppuff/protocol';
import { openHeaders, sendOutbound, storedHeaders, type OutboundSpec, type Sent } from '../core/outbound.js';
import { ensureSchema, type D1Like } from '../db/d1.js';

/**
 * Email notifications: the site's email service (D1 `email_service`, one
 * request the owner wrote for their provider) and each person's choice of
 * emails (`admin_prefs.prefs.emails`). Every event the webhooks get passes
 * here too (`emitTo`); the ones someone chose become one email per person,
 * written by HelpPuff and sent through the owner's request with
 * `{{email.to}}`, `{{email.subject}}`, `{{email.text}}` and `{{email.html}}`.
 *
 * Off the visitor's path like webhooks, and never throws. Logs carry the
 * email's kind and the status only, never an address or what it says.
 */

export const EMAIL_HEADER_PURPOSE = 'email-header';

export type EmailServiceRow = {
  site_id: string;
  method: string;
  url: string;
  /** JSON headers, secret values sealed (`EMAIL_HEADER_PURPOSE`). */
  headers: string;
  body: string;
  enabled: number;
  /** Where the owner saved it from: the dashboard's address, for links. */
  dashboard_url: string | null;
  last_status: string | null;
  last_error: string | null;
  last_at: number | null;
  updated_by: string | null;
  updated_at: number;
};

export type Email = { subject: string; text: string; html: string };

type Deps = { db: D1Like; fetch: typeof fetch; now?: () => number; log?: (event: string, data?: object) => void; secret?: string | undefined; owner?: string | undefined };

const TIMEOUT_MS = 10_000;
const MEMO_MS = 30_000;
const memo = new Map<string, { at: number; row: EmailServiceRow | null }>();

export function forgetEmailService(siteId: string): void {
  memo.delete(siteId);
}

export async function emailService(db: D1Like, siteId: string, now: number): Promise<EmailServiceRow | null> {
  const cached = memo.get(siteId);
  if (cached && now - cached.at < MEMO_MS) return cached.row;
  await ensureSchema(db);
  const row = (await db.prepare('SELECT * FROM email_service WHERE site_id = ?').bind(siteId).first<EmailServiceRow>()) ?? null;
  memo.set(siteId, { at: now, row });
  return row;
}

/** Which email an event is, if it is one: a finished conversation rated hot is a "hot lead". */
export function emailKind(type: WebhookEventType, data: Record<string, unknown>): EmailNotification | null {
  if (type === 'conversation.completed') return (data['labels'] as { leadQuality?: unknown } | undefined)?.leadQuality === 'hot' ? 'lead.hot' : null;
  // 'lead.hot' is not an event: only a finished conversation (above) is one.
  return isEmailNotification(type) ? type : null;
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const line = (label: string, value: unknown) => (str(value) ? `${label}: ${str(value)}` : '');
const who = (contact: Record<string, unknown>) => str(contact['name']) || str(contact['email']) || str(contact['phone']);
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function when(appointment: Record<string, unknown>): string {
  const start = Number(appointment['start']);
  if (!Number.isFinite(start)) return '';
  const timeZone = str(appointment['timezone']) || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone, timeZoneName: 'short' }).format(start);
  } catch {
    return new Date(start).toISOString();
  }
}

/**
 * The email for an event: a subject and short lines of plain text. The HTML
 * copy is the same text, escaped, so nothing a visitor typed becomes markup;
 * the only link is the dashboard's own.
 */
export function writeEmail(kind: EmailNotification | 'test', data: Record<string, unknown>, dashboard: string | null, names: Record<string, string> = {}): Email {
  const conversation = str(data['conversationId']);
  const toConversation = conversation ? `#/conversations/${encodeURIComponent(conversation)}` : '';
  let subject: string;
  let lines: string[];
  let path = toConversation;
  switch (kind) {
    case 'lead.captured':
      subject = `New contact: ${who(data) || 'a visitor'}`;
      lines = [line('Name', data['name']), line('Email', data['email']), line('Phone', data['phone']), line('Message', data['message'])];
      // Added by hand or over the API: no conversation, so the contacts.
      path = toConversation || '#/leads';
      break;
    case 'lead.hot': {
      const lead = obj(data['lead']);
      subject = `Hot lead: ${who(lead) || 'a visitor'}`;
      lines = [line('Name', lead['name']), line('Email', lead['email']), line('Phone', lead['phone']), '', str(data['summary']), line('Next step', data['followUp'])];
      break;
    }
    case 'callback.requested':
      subject = `Callback requested: ${who(data) || 'a visitor'}`;
      lines = [line('Name', data['name']), line('Phone', data['phone']), line('Email', data['email']), line('About', data['message'])];
      path = '#/callbacks';
      break;
    case 'handover.requested':
      subject = 'A visitor wants to talk to a person';
      lines = ['Someone asked for the team in live chat.', line('Why', data['reason']), line('Page', obj(data['page'])['url'] ?? data['page'])];
      break;
    case 'handover.missed':
      subject = 'Nobody took a live chat in time';
      lines = ['A visitor waited for a person and was offered the callback form instead.'];
      break;
    case 'conversation.assigned': {
      const by = names[str(data['by'])] ?? '';
      subject = by ? `${by} gave you a conversation` : 'A conversation was given to you';
      lines = ['It is yours to answer now.'];
      break;
    }
    case 'job.created': {
      const job = obj(data['job']);
      const number = str(job['number']);
      subject = `New job${number ? ` #${number}` : ''}: ${str(job['title']) || 'untitled'}`;
      lines = [line('Contact', who(obj(job['contact']))), line('Stage', job['stage']), line('Value', job['value'] ? `${str(job['value'])} ${str(job['currency'])}`.trim() : ''), line('From', job['source'])];
      path = str(job['id']) ? `#/jobs/${encodeURIComponent(str(job['id']))}` : '#/jobs';
      break;
    }
    case 'appointment.created':
    case 'appointment.cancelled': {
      const appointment = obj(data['appointment']);
      const cancelled = kind === 'appointment.cancelled';
      subject = `${cancelled ? 'Booking cancelled' : 'New booking'}: ${str(appointment['title']) || 'an appointment'}, ${when(appointment)}`;
      lines = [
        line('When', when(appointment)),
        line('Who', who(obj(appointment['attendee']))),
        line('Phone', obj(appointment['attendee'])['phone']),
        line('Where', appointment['location']),
        line('Notes', appointment['notes']),
        cancelled ? line('Why', data['reason']) : '',
      ];
      path = '#/calendar';
      break;
    }
    case 'knowledge.gap':
      subject = `A question to answer: ${str(data['question']).slice(0, 120)}`;
      lines = [
        `A visitor asked: ${str(data['question'])}`,
        'The assistant could not answer it, and your knowledge base does not cover it. Answer it once and the assistant knows it from then on.',
      ];
      path = '#/knowledge';
      break;
    case 'budget.exhausted':
      subject = 'Today’s AI budget is used up';
      lines = [EMAIL_NOTIFICATIONS['budget.exhausted'].description, line('Back at', data['resetsAt'])];
      path = '#/settings/advanced';
      break;
    case 'test':
      subject = 'A test from HelpPuff';
      lines = ['Your email service works: this is how HelpPuff’s notifications will arrive.', 'Choose which emails you get in Settings → Notifications.'];
      path = '#/settings/notifications';
      break;
  }
  const text = lines.filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== '')).join('\n').trim();
  const link = dashboard ? `${dashboard.replace(/\/+$/, '')}/admin/${path}` : null;
  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.55;color:#16163a">` +
    `<p style="margin:0 0 12px">${escapeHtml(text).replace(/\n/g, '<br>')}</p>` +
    (link ? `<p style="margin:0"><a href="${escapeHtml(link)}" style="color:#3b0d24">Open in the dashboard</a></p>` : '') +
    `</div>`;
  return { subject: subject.slice(0, 200), text: link ? `${text}\n\nOpen in the dashboard: ${link}` : text, html };
}

/**
 * The people who chose this email, and may: one address each. Only current
 * accounts, and the owner (ADMIN_EMAIL, who may have no row in `admins`).
 */
export async function recipients(db: D1Like, kind: EmailNotification, data: Record<string, unknown>, owner?: string): Promise<{ to: string[]; names: Record<string, string> }> {
  const rows = (
    await db
      .prepare('SELECT p.email, a.name, a.role, p.prefs FROM admin_prefs p LEFT JOIN admins a ON a.email = p.email WHERE a.email IS NOT NULL OR p.email = ?')
      .bind(owner ?? '')
      .all<{ email: string; name: string | null; role: string | null; prefs: string | null }>()
  ).results;
  const names = Object.fromEntries(rows.filter((r) => r.name).map((r) => [r.email, r.name!]));
  const to = rows.filter((row) => {
    let chosen: unknown;
    try {
      chosen = row.prefs ? (JSON.parse(row.prefs) as { emails?: unknown }).emails : [];
    } catch {
      chosen = [];
    }
    if (!Array.isArray(chosen) || !chosen.includes(kind)) return false;
    if (!emailAllowed(kind, row.role === 'member' ? 'member' : 'admin')) return false;
    // A chat given to me: only to that person, and not when they took it themselves.
    if (kind === 'conversation.assigned') return data['assignedTo'] === row.email && data['by'] !== row.email;
    return true;
  });
  return { to: to.map((r) => r.email), names };
}

/** The service's request, its secret values opened; null when one cannot be (HELPPUFF_SECRET changed). */
export async function serviceSpec(row: EmailServiceRow, secret: string | undefined): Promise<OutboundSpec | null> {
  const headers = await openHeaders(storedHeaders(row.headers), secret, EMAIL_HEADER_PURPOSE);
  if (!headers) return null;
  const method = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).find((m) => m === row.method) ?? 'POST';
  return { method, url: row.url, headers, body: row.body };
}

/** Send one email through the service: once, and again a moment later if trying again could help. */
export async function sendEmail(fetcher: typeof fetch, spec: OutboundSpec, siteId: string, to: string, email: Email): Promise<Sent> {
  const scope = { email: { to, ...email }, site: { id: siteId } };
  const first = await sendOutbound(spec, scope, fetcher, { timeoutMs: TIMEOUT_MS, userAgent: 'HelpPuff-Email/1' });
  if (first.ok || !first.retryable) return first;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return sendOutbound(spec, scope, fetcher, { timeoutMs: TIMEOUT_MS, userAgent: 'HelpPuff-Email/1' });
}

export async function recordOutcome(db: D1Like, siteId: string, results: Sent[], at: number): Promise<void> {
  const failed = results.find((r) => !r.ok);
  await db
    .prepare('UPDATE email_service SET last_status = ?, last_error = ?, last_at = ? WHERE site_id = ?')
    .bind(failed ? 'failed' : 'ok', failed?.error ?? null, at, siteId)
    .run()
    .catch(() => null);
  forgetEmailService(siteId);
}

/** The emails an event means, to everyone who chose them. Never throws. */
export async function notifyByEmail(deps: Deps, siteId: string, type: WebhookEventType, data: Record<string, unknown>): Promise<void> {
  try {
    const kind = emailKind(type, data);
    if (!kind) return;
    const now = deps.now ?? Date.now;
    const row = await emailService(deps.db, siteId, now());
    if (!row?.enabled) return;
    const { to, names } = await recipients(deps.db, kind, data, deps.owner);
    if (!to.length) return;
    const spec = await serviceSpec(row, deps.secret);
    if (!spec) {
      await recordOutcome(deps.db, siteId, [{ ok: false, status: null, error: 'A secret header could not be read (HELPPUFF_SECRET changed): enter its value again.', retryable: false }], now());
      return;
    }
    const email = writeEmail(kind, data, row.dashboard_url, names);
    const results = await Promise.all(to.map((address) => sendEmail(deps.fetch, spec, siteId, address, email)));
    await recordOutcome(deps.db, siteId, results, now());
    const failed = results.filter((r) => !r.ok);
    if (failed.length) deps.log?.('email.failed', { kind, status: failed[0]!.status, failed: failed.length });
  } catch {
    deps.log?.('email.notify_failed', { type });
  }
}
