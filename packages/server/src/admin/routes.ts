import { Hono, type Context } from 'hono';
import { cleanText } from '@helppuff/protocol';
import { chatRoutes, deleteConversations } from './chat.js';
import { accessRoutes } from './access.js';
import { keyScopes } from '../api/keys.js';
import { HelpPuffError } from '../core/errors.js';
import { getConnector } from '../core/registry.js';
import { guidanceFor } from '../core/guidance.js';
import { promptOverlaps } from './overlaps.js';
import type { SiteConfig } from '../config/schema.js';
import { resolveSecrets } from '../config/load.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { cookieValue, issueSession, readSession, SESSION_COOKIE, sessionCookie, verifyPassword } from './auth.js';
import { assertAccountOpen, assertSignInCaptcha, recordFailure, signInPolicy, signInRoutes, throttleIp } from './signin.js';
import { assertSameOrigin, assertSiteAccess, currentAdmin, db, isPublicApi, isSecure, jsonBody, siteParam } from './guard.js';
import { API_BASE, audit, publicApiGate } from '../api/auth.js';
import { openApiDocument } from '../api/openapi.js';
import { knowledgeRoutes } from './knowledge.js';
import { resolveSite } from '../config/site.js';
import { knowledgeEnv, ownsKnowledge } from '../knowledge/env.js';
import { settingsRoutes } from './settings.js';
import { setupRoutes } from './setup.js';
import { webhookRoutes } from './webhooks.js';
import { toolRoutes } from './tools.js';
import { agentRoutes } from './agent.js';
import { callbackRoutes, callbackView } from './callbacks.js';
import { attributesJson, closeCutoff, CONVERSATION_STATUSES, conversationExtras, inboxRoutes, labelsSql, mergeAttributes, parseJsonObject, parseLabels, statusFilter, statusSql, type ConversationStatus } from './inbox.js';
import { liveRoutes } from './live.js';
import { jobRoutes, maybeSetup } from './jobs.js';
import { homeRoutes, maybeSuggestHome } from './home.js';
import { assistantRoutes } from './assistant.js';
import { liveAvailable } from '../live/service.js';
import { versionRoutes } from './version.js';
import { dbFrom, ensureSchema, type D1Like } from '../db/d1.js';
import { emit } from '../webhooks/deliver.js';
import { summarizeConversation, type AiRunner } from '../conversations/summary.js';
import { summaryModel } from '../conversations/complete.js';
export { extractJson } from '../conversations/summary.js';
import { PROMPT_LIMIT, PROMPT_SQL, promptCtx, promptField, publishPrompt, readPromptState, type PromptVersionRow, type PublishResult } from './prompts.js';

/**
 * The dashboard API, under `/admin/api`. Everything but sign-in needs a
 * session; everything that changes data also needs a same-origin request.
 * Admin accounts themselves are managed from the CLI, not from here, which
 * keeps the web-facing surface to reading and triaging.
 */

export const adminRoutes = new Hono<HonoEnv>();

const DAY = 86_400_000;
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'] as const;

adminRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  if (dbFrom(c.get('helppuff').env)) await ensureSchema(dbFrom(c.get('helppuff').env)!);
  // The public API: registered routes only, API keys only (api/auth.ts).
  if (isPublicApi(c)) await publicApiGate(c, next);
  else await next();
  audit(c);
});

/** The API's description (OpenAPI 3.1), from the same registry that guards it. Public, like any API reference. */
adminRoutes.get('/openapi.json', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(openApiDocument(`${new URL(c.req.url).origin}${API_BASE}`));
});

adminRoutes.post('/login', async (c) => {
  assertSameOrigin(c);
  const ctx = c.get('helppuff');
  const secret = requireSecret(ctx);
  const policy = await signInPolicy(c);
  // Every attempt counts against the IP; the owner's CLI (proven by HELPPUFF_SECRET) checks a new password took effect and is exempt.
  await throttleIp(c, policy, 'login');

  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; password?: unknown; captchaToken?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 1024) : '';
  const refuse = () => new HelpPuffError('unauthorized', { message: 'That email and password do not match.', detail: 'admin_bad_login' });
  if (!email || !password) throw refuse();
  await assertSignInCaptcha(c, policy, body.captchaToken);
  // Failures count against the email from any IP: spreading guesses over many addresses does not help.
  await assertAccountOpen(c, policy, email);

  let ok: boolean;
  let hash: string;
  const owner = String(ctx.env['ADMIN_EMAIL'] ?? '').toLowerCase();
  const ownerHash = String(ctx.env['ADMIN_PASSWORD_HASH'] ?? '');
  if (owner && email === owner && ownerHash) {
    hash = ownerHash;
    ok = await verifyPassword(ownerHash, password);
  } else {
    const row = await db(c).prepare('SELECT password_hash FROM admins WHERE email = ?').bind(email).first<{ password_hash: string }>();
    hash = row?.password_hash ?? '';
    // Hash anyway on a miss, so timing does not reveal which emails exist.
    ok = await verifyPassword(row?.password_hash ?? 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password);
    if (ok) await db(c).prepare('UPDATE admins SET last_login_at = ? WHERE email = ?').bind(ctx.platform.now(), email).run();
  }
  if (!ok) {
    await recordFailure(c, policy, email);
    throw refuse();
  }

  c.header('Set-Cookie', sessionCookie(await issueSession(secret, email, ctx.platform.now(), hash), isSecure(c)));
  return c.json({ email });
});

/** Ends this session everywhere: its id is recorded until it would have expired, so a copied cookie stops working too. */
adminRoutes.post('/logout', async (c) => {
  assertSameOrigin(c);
  const ctx = c.get('helppuff');
  const now = ctx.platform.now();
  const session = ctx.secret.length >= 32 ? await readSession(ctx.secret, cookieValue(c.req.header('Cookie'), SESSION_COOKIE), now) : null;
  const d = dbFrom(ctx.env);
  if (session && d) {
    await d.batch([
      d.prepare('INSERT OR IGNORE INTO admin_signed_out (id, expires_at) VALUES (?, ?)').bind(session.id, session.exp),
      d.prepare('DELETE FROM admin_signed_out WHERE expires_at < ?').bind(now),
    ]);
  }
  c.header('Set-Cookie', sessionCookie('', isSecure(c), 0));
  return c.json({ ok: true });
});

adminRoutes.get('/me', async (c) => {
  const admin = await currentAdmin(c);
  const config = c.get('helppuff').config;
  const origin = new URL(c.req.url).origin;
  const ctx = c.get('helppuff');
  const key = c.get('apiKey');
  const sites = await Promise.all(
    // A key sees its own site only.
    Object.keys(config.sites).filter((id) => !key || id === key.site_id).map(async (id) => {
      // The live config: the dashboard may have renamed or recoloured it since the deploy.
      const site = await resolveSite(ctx, id);
      return {
        id,
        name: site.widget.brand.name,
        accent: site.widget.brand.accent,
        avatar: site.widget.brand.avatar ?? null,
        embed: `<script src="${origin}/loader.js" data-site="${id}" async></script>`,
        connector: site.connector.type,
        /** HelpPuff's own knowledge base (workers-ai) is on: the Knowledge page and onboarding apply. */
        knowledge: ownsKnowledge(site) && Boolean(knowledgeEnv(ctx.env)),
        website: site.knowledge.website ?? site.origins.find((o) => /^https:/.test(o) && !/workers\.dev/.test(o)) ?? null,
        /** The dashboard's "Before you go live" checklist. */
        production: {
          turnstile: Boolean(site.security.captcha),
          // What a Turnstile widget for this site needs: the public hosts the chat is on, and the dashboard's.
          hostnames: turnstileHostnames(site.origins, origin),
          dailyCap: site.security.limits.messagesPerSitePerDay,
        },
        /** Live chat is on and can run here (the Live inbox, notifications). */
        live: liveAvailable(ctx.env, site, id),
        /** HelpPuff writes this backend's prompt: the Instructions and Prompt & tools pages apply. */
        prompt: promptField(site.connector).option !== null,
      };
    }),
  );
  // Jobs set themselves up from the website once it is learned (in the background).
  if (!key && dbFrom(ctx.env)) {
    for (const site of sites) {
      ctx.platform.waitUntil(maybeSetup(ctx, site.id).catch(() => ctx.platform.log('jobs.setup_failed')));
      ctx.platform.waitUntil(maybeSuggestHome(ctx, site.id).catch(() => ctx.platform.log('home.suggest_failed')));
    }
  }
  return c.json({
    admin,
    ...(key ? { key: { id: key.id, name: key.name, scopes: keyScopes(key), site: key.site_id, expiresAt: key.expires_at } } : {}),
    sites,
    summaries: Boolean(ctx.env['AI']),
  });
});

/** Public hostnames (no localhost or bare IPs), the dashboard's last; at most 10, Turnstile's limit. */
export function turnstileHostnames(origins: readonly string[], dashboard: string): string[] {
  const hosts = new Set<string>();
  for (const value of [...origins, dashboard]) {
    try {
      const host = new URL(value).hostname;
      if (host !== 'localhost' && !/^[\d.]+$|:/.test(host) && host.includes('.')) hosts.add(host);
    } catch {
      // Not a URL: skipped.
    }
  }
  return [...hosts].slice(0, 10);
}

function siteFilter(c: Context<HonoEnv>, column = 'site_id'): { sql: string; params: unknown[] } {
  // An API key sees its own site only.
  const site = c.get('apiKey')?.site_id ?? c.req.query('site');
  return site ? { sql: ` AND ${column} = ?`, params: [site] } : { sql: '', params: [] };
}

adminRoutes.get('/overview', async (c) => {
  await currentAdmin(c);
  const d = db(c);
  const now = c.get('helppuff').platform.now();
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 30) || 30, 1), 365);
  const offset = (Number(c.req.query('tz') ?? 0) || 0) * 60_000;
  const since = now - days * DAY;
  const previous = since - days * DAY;
  const f = siteFilter(c);

  const totals = (from: number, to: number) =>
    d
      .prepare(
        `SELECT COUNT(*) AS conversations, COALESCE(SUM(message_count), 0) AS messages, COUNT(lead_id) AS withLead
         FROM conversations WHERE started_at >= ? AND started_at < ?${f.sql}`,
      )
      .bind(from, to, ...f.params)
      .first<{ conversations: number; messages: number; withLead: number }>();
  const leadCount = (from: number, to: number) =>
    d
      .prepare(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND created_at < ?${f.sql}`)
      .bind(from, to, ...f.params)
      .first<{ n: number }>();

  const [current, before, leads, leadsBefore, daily, pages, countries, questions, recentLeads] = await Promise.all([
    totals(since, now + 1),
    totals(previous, since),
    leadCount(since, now + 1),
    leadCount(previous, since),
    d
      .prepare(
        `SELECT CAST((started_at + ?) / ${DAY} AS INTEGER) AS day, COUNT(*) AS conversations, COUNT(lead_id) AS leads
         FROM conversations WHERE started_at >= ?${f.sql} GROUP BY day ORDER BY day`,
      )
      .bind(offset, since, ...f.params)
      .all<{ day: number; conversations: number; leads: number }>(),
    d
      .prepare(
        `SELECT page_url AS url, COUNT(*) AS count FROM conversations
         WHERE started_at >= ? AND page_url IS NOT NULL${f.sql} GROUP BY page_url ORDER BY count DESC LIMIT 6`,
      )
      .bind(since, ...f.params)
      .all<{ url: string; count: number }>(),
    d
      .prepare(
        `SELECT country, COUNT(*) AS count FROM conversations
         WHERE started_at >= ? AND country IS NOT NULL${f.sql} GROUP BY country ORDER BY count DESC LIMIT 6`,
      )
      .bind(since, ...f.params)
      .all<{ country: string; count: number }>(),
    d
      .prepare(
        `SELECT id, first_message AS text, started_at AS at FROM conversations
         WHERE first_message IS NOT NULL${f.sql} ORDER BY started_at DESC LIMIT 8`,
      )
      .bind(...f.params)
      .all(),
    d
      .prepare(`SELECT id, name, email, phone, status, created_at AS at, conversation_id AS conversationId FROM leads WHERE 1=1${f.sql} ORDER BY created_at DESC LIMIT 6`)
      .bind(...f.params)
      .all(),
  ]);

  // Every day in the range, zero-filled, so a chart never skips a quiet day.
  const byDay = new Map(daily.results.map((row) => [row.day, row]));
  const first = Math.floor((since + offset) / DAY) + 1;
  const series = Array.from({ length: days }, (_, i) => {
    const day = first + i;
    const row = byDay.get(day);
    return { date: new Date(day * DAY).toISOString().slice(0, 10), conversations: row?.conversations ?? 0, leads: row?.leads ?? 0 };
  });

  // Waiting now, whatever the range: a callback is a task, not a statistic.
  const openCallbacks = await d.prepare(`SELECT COUNT(*) AS n FROM callbacks WHERE status = 'open'${f.sql}`).bind(...f.params).first<{ n: number }>().catch(() => null);

  return c.json({
    range: { days, since },
    openCallbacks: openCallbacks?.n ?? 0,
    totals: {
      conversations: current?.conversations ?? 0,
      messages: current?.messages ?? 0,
      leads: leads?.n ?? 0,
      conversion: current?.conversations ? (current.withLead ?? 0) / current.conversations : 0,
      avgMessages: current?.conversations ? (current.messages ?? 0) / current.conversations : 0,
    },
    previous: {
      conversations: before?.conversations ?? 0,
      messages: before?.messages ?? 0,
      leads: leadsBefore?.n ?? 0,
      conversion: before?.conversations ? (before.withLead ?? 0) / before.conversations : 0,
      avgMessages: before?.conversations ? (before.messages ?? 0) / before.conversations : 0,
    },
    series,
    topPages: pages.results,
    countries: countries.results,
    recentQuestions: questions.results,
    recentLeads: recentLeads.results,
  });
});

adminRoutes.get('/conversations', async (c) => {
  await currentAdmin(c);
  // D1 refuses LIKE patterns over 50 bytes: `%q%` must fit.
  const q = (c.req.query('q') ?? '').trim().slice(0, 48);
  const filter = c.req.query('filter') ?? 'all';
  const before = Number(c.req.query('before') ?? 0) || null;
  const limit = Math.min(Number(c.req.query('limit') ?? 30) || 30, 100);
  const f = siteFilter(c, 'c.site_id');
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (q) {
    where.push(
      `(c.first_message LIKE ? OR c.summary LIKE ? OR l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?
        OR c.id IN (SELECT conversation_id FROM messages WHERE text LIKE ?))`,
    );
    params.push(...Array(6).fill(`%${q}%`));
  }
  const externalId = c.req.query('externalId');
  if (externalId) {
    where.push('c.id IN (SELECT id FROM api_sessions WHERE external_id = ?)');
    params.push(externalId.slice(0, 128));
  }
  if (filter === 'leads') where.push('c.lead_id IS NOT NULL');
  if (filter === 'unsummarized') where.push('c.summary IS NULL');
  if (filter === 'callbacks') where.push("EXISTS (SELECT 1 FROM callbacks cb WHERE cb.conversation_id = c.id AND cb.status = 'open')");
  const cutoff = await closeCutoff(c);
  const status = c.req.query('status');
  if (status && status !== 'all') {
    if (!(CONVERSATION_STATUSES as readonly string[]).includes(status)) throw new HelpPuffError('bad_request', { message: 'Status is all, bot, live or closed.', detail: 'conversation_bad_status' });
    where.push(statusFilter(status as ConversationStatus));
    params.push(cutoff);
  }
  // Live chats waiting for a reply from the team.
  if (filter === 'waiting') where.push("c.status = 'live' AND c.waiting_since IS NOT NULL");
  const label = c.req.query('label');
  if (label) {
    where.push('c.id IN (SELECT cl.conversation_id FROM conversation_labels cl JOIN labels lb ON lb.id = cl.label_id WHERE lb.id = ? OR lb.name = ? COLLATE NOCASE)');
    params.push(label.slice(0, 64), label.slice(0, 64));
  }
  const assigned = c.req.query('assigned');
  if (assigned === 'me') {
    where.push('c.assigned_to = ?');
    params.push((await currentAdmin(c)).email);
  } else if (assigned === 'none') where.push('c.assigned_to IS NULL');
  else if (assigned) {
    where.push('c.assigned_to = ?');
    params.push(assigned.toLowerCase().slice(0, 320));
  }
  if (before) {
    where.push('c.last_at < ?');
    params.push(before);
  }
  const rows = await db(c)
    .prepare(
      `SELECT c.id, c.site_id AS site, c.started_at AS startedAt, c.last_at AS lastAt, c.page_url AS pageUrl,
              c.country, c.first_message AS firstMessage, c.message_count AS messageCount, c.summary, c.intent,
              ${statusSql('c')} AS status, c.assigned_to AS assignedTo, c.assigned_name AS assignedName,
              CASE WHEN c.status = 'live' THEN c.waiting_since END AS waitingSince, c.attributes, ${labelsSql('c')} AS labels,
              l.name AS leadName, l.email AS leadEmail, l.phone AS leadPhone, l.status AS leadStatus,
              (SELECT cb.status FROM callbacks cb WHERE cb.conversation_id = c.id ORDER BY cb.status = 'open' DESC, cb.requested_at DESC LIMIT 1) AS callback
       FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id
       WHERE ${where.join(' AND ')}${f.sql}
       ORDER BY c.last_at DESC LIMIT ?`,
    )
    .bind(cutoff, ...params, ...f.params, limit + 1)
    .all<{ lastAt: number; attributes: string | null; labels: string | null; status: string; waitingSince: number | null }>();
  const more = rows.results.length > limit;
  const items = rows.results.slice(0, limit).map((row) => ({
    ...row,
    // A closed chat is waiting for no one.
    waitingSince: row.status === 'live' ? row.waitingSince : null,
    attributes: parseJsonObject(row.attributes),
    labels: parseLabels(row.labels),
  }));
  return c.json({ items, next: more ? items.at(-1)?.lastAt : null });
});

async function loadConversation(d: D1Like, id: string, cutoff = 0) {
  const conversation = await d.prepare(`SELECT c.*, ${statusSql('c')} AS status FROM conversations c WHERE c.id = ?`).bind(cutoff, id).first<Record<string, unknown>>();
  if (!conversation) throw new HelpPuffError('not_found', { message: 'No such conversation.', detail: 'admin_conversation_missing' });
  const [messages, lead, callbacks, extras] = await Promise.all([
    d
      .prepare('SELECT id, role, type, text, payload, ts, feedback, author FROM messages WHERE conversation_id = ? ORDER BY ts, id')
      .bind(id)
      .all<{ id: string; role: string; type: string; text: string | null; payload: string | null; ts: number }>(),
    conversation['lead_id'] ? d.prepare('SELECT * FROM leads WHERE id = ?').bind(conversation['lead_id']).first<Record<string, unknown>>() : null,
    d.prepare('SELECT * FROM callbacks WHERE conversation_id = ? ORDER BY requested_at DESC').bind(id).all<Parameters<typeof callbackView>[0]>(),
    conversationExtras(d, id),
  ]);
  // The salted IP hash the per-visitor limits count by is not for anyone to read.
  const { visitor: _visitor, attributes: _attributes, data: _data, ...shown } = conversation;
  return {
    conversation: { ...shown, waiting_since: shown['status'] === 'live' ? (shown['waiting_since'] ?? null) : null, attributes: extras.attributes, data: extras.data } as Record<string, unknown>,
    lead: lead && leadOut(lead),
    callbacks: callbacks.results.map(callbackView),
    labels: extras.labels,
    notes: extras.notes,
    messages: messages.results.map((m) => ({ ...m, payload: m.payload ? (JSON.parse(m.payload) as unknown) : null })),
  };
}

/** A lead row as answered: attributes parsed. */
export function leadOut(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, attributes: parseJsonObject(row['attributes']) };
}

adminRoutes.get('/conversations/:id', async (c) => {
  await currentAdmin(c);
  const found = await loadConversation(db(c), c.req.param('id'), await closeCutoff(c));
  assertSiteAccess(c, found.conversation['site_id'], 'conversation');
  return c.json(found);
});

adminRoutes.post('/conversations/:id/summary', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const ctx = c.get('helppuff');
  const ai = ctx.env['AI'] as Partial<AiRunner> | undefined;
  if (!ai || typeof ai.run !== 'function') {
    throw new HelpPuffError('not_found', { message: 'Summaries need Workers AI. Redeploy with `helppuff deploy`.', detail: 'admin_no_ai' });
  }
  const id = c.req.param('id');
  const { conversation } = await loadConversation(db(c), id);
  assertSiteAccess(c, conversation['site_id'], 'conversation');
  const model = await summaryModel(ctx, String(conversation['site_id']));
  let result;
  try {
    result = await summarizeConversation({ db: db(c), ai: ai as AiRunner, now: () => ctx.platform.now() }, id, model);
  } catch {
    throw new HelpPuffError('connector_error', { message: 'The summary could not be generated. Try again.', detail: 'admin_summary_unparsable' });
  }
  if (!result) throw new HelpPuffError('bad_request', { message: 'Nothing to summarise yet.', detail: 'admin_empty' });
  emit(ctx, result.siteId, 'conversation.summarized', { conversationId: id, ...result.summary });
  return c.json({ ...result.summary, lead: result.contact });
});

adminRoutes.get('/leads', async (c) => {
  await currentAdmin(c);
  // D1 refuses LIKE patterns over 50 bytes: `%q%` must fit.
  const q = (c.req.query('q') ?? '').trim().slice(0, 48);
  const status = c.req.query('status');
  const f = siteFilter(c);
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (q) {
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR notes LIKE ? OR company LIKE ? OR attributes LIKE ?)');
    params.push(...Array(6).fill(`%${q}%`));
  }
  if (status && (LEAD_STATUSES as readonly string[]).includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  const rows = await db(c)
    .prepare(
      `SELECT id, site_id AS site, conversation_id AS conversationId, name, email, phone, company, address, fields, attributes, source, status, notes,
              created_at AS createdAt, updated_at AS updatedAt,
              (SELECT COUNT(*) FROM conversations c WHERE c.lead_id = leads.id) AS conversations,
              (SELECT c.id FROM conversations c WHERE c.lead_id = leads.id ORDER BY c.last_at DESC LIMIT 1) AS lastConversationId,
              (SELECT COUNT(*) FROM callbacks cb JOIN conversations c ON c.id = cb.conversation_id WHERE c.lead_id = leads.id AND cb.status = 'open') AS openCallbacks
       FROM leads WHERE ${where.join(' AND ')}${f.sql} ORDER BY updated_at DESC LIMIT 500`,
    )
    .bind(...params, ...f.params)
    .all<Record<string, unknown>>();
  const counts = await db(c)
    .prepare(`SELECT status, COUNT(*) AS n FROM leads WHERE 1=1${f.sql} GROUP BY status`)
    .bind(...f.params)
    .all<{ status: string; n: number }>();
  return c.json({ items: rows.results.map(leadOut), counts: Object.fromEntries(counts.results.map((r) => [r.status, r.n])) });
});

/** A lead as webhooks send it: no internal columns, form fields parsed. */
function leadView(row: Record<string, unknown>) {
  let fields: unknown = null;
  try {
    fields = typeof row['fields'] === 'string' ? JSON.parse(row['fields']) : null;
  } catch {
    // Kept as null.
  }
  return {
    name: row['name'] ?? null,
    email: row['email'] ?? null,
    phone: row['phone'] ?? null,
    company: row['company'] ?? null,
    address: row['address'] ?? null,
    status: row['status'],
    notes: row['notes'] ?? null,
    source: row['source'],
    fields,
    attributes: parseJsonObject(row['attributes']),
  };
}

adminRoutes.patch('/leads/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown> & { status?: unknown; notes?: unknown; name?: unknown };
  const sets: string[] = [];
  const params: unknown[] = [];
  const existing = await db(c).prepare('SELECT site_id, email, attributes FROM leads WHERE id = ?').bind(c.req.param('id')).first<{ site_id: string; email: string | null; attributes: string | null }>();
  if (!existing) throw new HelpPuffError('not_found', { message: 'No such lead.', detail: 'admin_lead_missing' });
  assertSiteAccess(c, existing.site_id, 'lead');
  // Contact details: a string sets, an empty string or null clears (the email can be changed, never cleared, and stays one per site).
  for (const [key, max] of [['phone', 40], ['company', 200], ['address', 500]] as const) {
    if (body[key] === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(typeof body[key] === 'string' ? leadText(body[key], max) : null);
  }
  if (typeof body['email'] === 'string') {
    const email = leadText(body['email'], 200)?.toLowerCase() ?? null;
    if (!email || !LEAD_EMAIL.test(email)) throw new HelpPuffError('bad_request', { message: 'Check email: not an email address.', detail: 'lead_bad_email' });
    if (email !== existing.email) {
      const taken = await db(c).prepare('SELECT id FROM leads WHERE site_id = ? AND email = ? AND id != ?').bind(existing.site_id, email, c.req.param('id')).first<{ id: string }>();
      if (taken) throw new HelpPuffError('conflict', { message: `A lead with this email exists: ${taken.id}.`, detail: 'lead_email_taken' });
    }
    sets.push('email = ?');
    params.push(email);
  }
  if (body['attributes'] !== undefined) {
    sets.push('attributes = ?');
    params.push(attributesJson(mergeAttributes(parseJsonObject(existing.attributes), body['attributes'])));
  }
  if (typeof body.status === 'string') {
    if (!(LEAD_STATUSES as readonly string[]).includes(body.status)) throw new HelpPuffError('bad_request', { message: 'Unknown status.' });
    sets.push('status = ?');
    params.push(body.status);
  }
  if (typeof body.notes === 'string') {
    sets.push('notes = ?');
    params.push(body.notes.slice(0, 5000));
  }
  if (typeof body.name === 'string') {
    sets.push('name = ?');
    params.push(body.name.slice(0, 200));
  }
  if (!sets.length) throw new HelpPuffError('bad_request', { message: 'Nothing to update.' });
  sets.push('updated_at = ?');
  params.push(c.get('helppuff').platform.now());
  await db(c)
    .prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...params, c.req.param('id'))
    .run();
  const lead = await db(c).prepare('SELECT * FROM leads WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (lead) {
    const changed = Object.fromEntries(
      (['status', 'notes', 'name', 'email', 'phone', 'company', 'address', 'attributes'] as const)
        .filter((k) => body[k] !== undefined)
        .map((k) => [k, k === 'attributes' ? parseJsonObject(lead[k]) : (lead[k] ?? null)]),
    );
    emit(c.get('helppuff'), String(lead['site_id']), 'lead.updated', { leadId: lead['id'], conversationId: lead['conversation_id'] ?? null, changed, lead: leadView(lead) });
  }
  return c.json(lead && leadOut(lead));
});

const LEAD_EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
const leadText = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? cleanText(value, 'line').slice(0, max) : null);

/** Add a contact from elsewhere (your CRM, a form, an import). One per email per site: a second gets 409 with the first one's id. */
adminRoutes.post('/leads', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const name = leadText(body['name'], 200);
  const email = leadText(body['email'], 200)?.toLowerCase() ?? null;
  const phone = leadText(body['phone'], 40);
  const company = leadText(body['company'], 200);
  const address = leadText(body['address'], 500);
  const attributes = body['attributes'] === undefined ? {} : mergeAttributes({}, body['attributes']);
  if (!name && !email && !phone) throw new HelpPuffError('bad_request', { message: 'Give at least a name, an email or a phone.', detail: 'lead_empty' });
  if (email && !LEAD_EMAIL.test(email)) throw new HelpPuffError('bad_request', { message: 'Check email: not an email address.', detail: 'lead_bad_email' });
  const status = body['status'] === undefined ? 'new' : body['status'];
  if (!(LEAD_STATUSES as readonly unknown[]).includes(status)) throw new HelpPuffError('bad_request', { message: 'Unknown status.', detail: 'lead_bad_status' });
  const rawFields = body['fields'] && typeof body['fields'] === 'object' && !Array.isArray(body['fields']) ? (body['fields'] as Record<string, unknown>) : {};
  const fields = Object.fromEntries(
    Object.entries(rawFields)
      .slice(0, 20)
      .filter(([key, value]) => /^[\w-]{1,64}$/.test(key) && typeof value === 'string' && value.trim())
      .map(([key, value]) => [key, cleanText(value as string, 'input').slice(0, 2000)]),
  );
  const d = db(c);
  if (email) {
    const taken = await d.prepare('SELECT id FROM leads WHERE site_id = ? AND email = ?').bind(siteId, email).first<{ id: string }>();
    if (taken) throw new HelpPuffError('conflict', { message: `A lead with this email exists: ${taken.id}. Update it with PATCH /leads/${taken.id}.`, detail: 'lead_email_taken' });
  }
  const now = c.get('helppuff').platform.now();
  const id = `lead_${crypto.randomUUID()}`;
  const notes = typeof body['notes'] === 'string' ? body['notes'].slice(0, 5000) : null;
  await d
    .prepare(
      `INSERT INTO leads (id, site_id, conversation_id, name, email, phone, company, address, fields, attributes, source, status, notes, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'api', ?, ?, ?, ?)`,
    )
    .bind(id, siteId, name, email, phone, company, address, Object.keys(fields).length ? JSON.stringify(fields) : null, attributesJson(attributes), status, notes, now, now)
    .run();
  const lead = (await d.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Record<string, unknown>>())!;
  emit(c.get('helppuff'), siteId, 'lead.captured', { conversationId: null, source: 'api', name, email, phone, fields });
  return c.json(leadOut(lead), 201);
});

/** One lead, with the conversations linked to it. */
adminRoutes.get('/leads/:id', async (c) => {
  await currentAdmin(c);
  const d = db(c);
  const lead = await d.prepare('SELECT * FROM leads WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!lead) throw new HelpPuffError('not_found', { message: 'No such lead.', detail: 'admin_lead_missing' });
  assertSiteAccess(c, lead['site_id'], 'lead');
  const cutoff = await closeCutoff(c, String(lead['site_id']));
  const [conversations, notes, callbacks] = await Promise.all([
    d
      .prepare(
        `SELECT c.id, c.started_at AS startedAt, c.last_at AS lastAt, c.page_url AS pageUrl, c.first_message AS firstMessage, c.message_count AS messageCount, c.summary, c.intent, c.channel,
                ${statusSql('c')} AS status, c.assigned_to AS assignedTo, c.assigned_name AS assignedName, ${labelsSql('c')} AS labels, c.attributes
         FROM conversations c WHERE c.lead_id = ? ORDER BY c.last_at DESC LIMIT 100`,
      )
      .bind(cutoff, lead['id'])
      .all<Record<string, unknown>>(),
    d
      .prepare(
        `SELECT id, conversation_id AS conversationId, author, author_name AS authorName, text, created_at AS createdAt, updated_at AS updatedAt FROM notes
         WHERE lead_id = ? OR conversation_id IN (SELECT id FROM conversations WHERE lead_id = ?) ORDER BY created_at DESC LIMIT 200`,
      )
      .bind(lead['id'], lead['id'])
      .all(),
    d.prepare('SELECT cb.* FROM callbacks cb WHERE cb.lead_id = ? ORDER BY cb.requested_at DESC LIMIT 50').bind(lead['id']).all<Parameters<typeof callbackView>[0]>(),
  ]);
  return c.json({
    ...leadOut(lead),
    conversations: conversations.results.map((row) => ({ ...row, labels: parseLabels(row['labels']), attributes: parseJsonObject(row['attributes']) })),
    /** The team's dated notes (`notes` is the lead's own notes field). */
    teamNotes: notes.results,
    callbacks: callbacks.results.map(callbackView),
  });
});

/**
 * Delete a lead. `?erase=conversations` also deletes every conversation linked
 * to it, with their messages and callback requests: a person's "forget me".
 */
adminRoutes.delete('/leads/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const d = db(c);
  const id = c.req.param('id');
  const lead = await d.prepare('SELECT id, site_id FROM leads WHERE id = ?').bind(id).first<{ id: string; site_id: string }>();
  if (!lead) throw new HelpPuffError('not_found', { message: 'No such lead.', detail: 'admin_lead_missing' });
  assertSiteAccess(c, lead.site_id, 'lead');
  const erase = c.req.query('erase') === 'conversations';
  const linked = erase ? (await d.prepare('SELECT id FROM conversations WHERE lead_id = ?').bind(id).all<{ id: string }>()).results.map((r) => r.id) : [];
  await deleteConversations(d, linked);
  await d.batch([
    d.prepare('UPDATE conversations SET lead_id = NULL WHERE lead_id = ?').bind(id),
    d.prepare('UPDATE callbacks SET lead_id = NULL WHERE lead_id = ?').bind(id),
    d.prepare('DELETE FROM notes WHERE lead_id = ? AND conversation_id IS NULL').bind(id),
    d.prepare('DELETE FROM leads WHERE id = ?').bind(id),
  ]);
  return c.json({ id, deleted: true, conversationsDeleted: linked.length });
});

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  // A leading =, +, -, @, tab or carriage return would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

adminRoutes.get('/leads.csv', async (c) => {
  await currentAdmin(c);
  const f = siteFilter(c);
  const rows = await db(c)
    .prepare(`SELECT created_at, name, email, phone, company, address, status, source, notes, attributes, site_id, conversation_id FROM leads WHERE 1=1${f.sql} ORDER BY created_at DESC`)
    .bind(...f.params)
    .all<Record<string, unknown>>();
  const header = ['created', 'name', 'email', 'phone', 'company', 'address', 'status', 'source', 'notes', 'attributes', 'site', 'conversation'];
  const lines = rows.results.map((r) =>
    [new Date(Number(r['created_at'])).toISOString(), r['name'], r['email'], r['phone'], r['company'], r['address'], r['status'], r['source'], r['notes'], r['attributes'], r['site_id'], r['conversation_id']]
      .map(csvCell)
      .join(','),
  );
  return new Response([header.join(','), ...lines].join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

adminRoutes.get('/admins', async (c) => {
  const me = await currentAdmin(c);
  const owner = String(c.get('helppuff').env['ADMIN_EMAIL'] ?? '').toLowerCase();
  const rows = await db(c)
    .prepare("SELECT email, name, COALESCE(role, 'admin') AS role, created_at AS createdAt, last_login_at AS lastLoginAt FROM admins ORDER BY created_at")
    .all<{ email: string; role: string }>();
  // Without an owner in Worker config, the first account is the owner.
  const first = owner ? null : rows.results[0]?.email;
  return c.json({ me: me.email, owner, admins: rows.results.map((row) => (row.email === first ? { ...row, role: 'owner' } : row)) });
});

// ------------------------------------------------------------ prompt versions


/** 409 carries the version that won, so the editor can say who moved first and reload. */
function published(c: Context<HonoEnv>, result: PublishResult) {
  if (result.status !== 'conflict') return c.json(result);
  return c.json(
    {
      error: { code: 'bad_request', message: `Someone published version ${result.version} while you were editing. Reload to see it.` },
      ...result,
    },
    409,
  );
}

/**
 * Everything the model is told besides the owner's prompt, in order, for the
 * dashboard to show read-only: HelpPuff's settings and rules around it, then
 * what the backend adds. Null when the backend owns its prompt.
 */
async function builtInView(c: Context<HonoEnv>, siteId: string, connector: { type: string; options?: unknown }): Promise<string | null> {
  try {
    const ctx = c.get('helppuff');
    const site = { ...(await resolveSite(ctx, siteId)), connector } as SiteConfig;
    const found = getConnector(connector.type);
    const options = found.parseOptions(resolveSecrets(connector.options ?? {}, ctx.env));
    if (!found.promptOption(options)) return null;
    const { before, after } = guidanceFor(site);
    return [before, '## Instructions from the business\n(your instructions, above)', after, found.builtInPrompt(options)].filter(Boolean).join('\n\n');
  } catch {
    return null;
  }
}

adminRoutes.get('/prompt', async (c) => {
  await currentAdmin(c);
  const site = siteParam(c, c.req.query('site'));
  const d = db(c);
  const state = await readPromptState(promptCtx(c), d, site);
  const versions = await d.prepare(PROMPT_SQL.list).bind(site, 200).all<PromptVersionRow>();
  return c.json({
    site,
    connector: state.connector,
    builtIn: await builtInView(c, site, state.connectorConfig),
    overlaps: promptOverlaps(state.text, state.connector),
    editable: state.editable,
    reason: state.reason,
    text: state.text,
    hash: state.hash,
    version: state.version,
    meta: state.meta,
    limit: PROMPT_LIMIT,
    versions: versions.results,
  });
});

adminRoutes.get('/prompt/versions/:version', async (c) => {
  await currentAdmin(c);
  const site = siteParam(c, c.req.query('site'));
  const row = await db(c)
    .prepare(PROMPT_SQL.get)
    .bind(site, Number(c.req.param('version')))
    .first<PromptVersionRow & { text: string }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such version.', detail: 'admin_prompt_version_missing' });
  return c.json(row);
});

adminRoutes.post('/prompt', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as { site?: unknown; text?: unknown; note?: unknown; baseVersion?: unknown };
  if (typeof body.text !== 'string' || typeof body.baseVersion !== 'number') {
    throw new HelpPuffError('bad_request', { message: 'Send the new text and the version it was based on.', detail: 'admin_prompt_body' });
  }
  const site = siteParam(c, body.site);
  const result = await publishPrompt(promptCtx(c), db(c), site, {
    text: body.text,
    baseVersion: body.baseVersion,
    note: typeof body.note === 'string' ? body.note : null,
    source: 'dashboard',
    by: admin.email,
  });
  return published(c, result);
});

adminRoutes.post('/prompt/restore', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as { site?: unknown; version?: unknown; baseVersion?: unknown };
  if (typeof body.version !== 'number' || typeof body.baseVersion !== 'number') {
    throw new HelpPuffError('bad_request', { message: 'Send the version to restore and the current version.', detail: 'admin_prompt_body' });
  }
  const site = siteParam(c, body.site);
  const d = db(c);
  const row = await d.prepare(PROMPT_SQL.get).bind(site, body.version).first<{ text: string }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such version.', detail: 'admin_prompt_version_missing' });
  const result = await publishPrompt(promptCtx(c), d, site, {
    text: row.text,
    baseVersion: body.baseVersion,
    note: `Restored version ${body.version}`,
    source: 'restore',
    restoredFrom: body.version,
    by: admin.email,
  });
  return published(c, result);
});

// The knowledge base, settings and one-time links live in their own files;
// mounted here so the `/admin/api/*` middleware above covers them too.
adminRoutes.route('/', knowledgeRoutes);
adminRoutes.route('/', settingsRoutes);
adminRoutes.route('/', setupRoutes);
adminRoutes.route('/', signInRoutes);
adminRoutes.route('/', webhookRoutes);
adminRoutes.route('/', toolRoutes);
adminRoutes.route('/', agentRoutes);
adminRoutes.route('/', callbackRoutes);
adminRoutes.route('/', versionRoutes);
adminRoutes.route('/', chatRoutes);
adminRoutes.route('/', accessRoutes);
adminRoutes.route('/', inboxRoutes);
adminRoutes.route('/', liveRoutes);
adminRoutes.route('/', jobRoutes);
adminRoutes.route('/', homeRoutes);
adminRoutes.route('/', assistantRoutes);
