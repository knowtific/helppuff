import { Hono, type Context } from 'hono';
import { HelpPuffError } from '../core/errors.js';
import { getConnector } from '../core/registry.js';
import { guidanceFor } from '../core/guidance.js';
import { promptOverlaps } from './overlaps.js';
import type { SiteConfig } from '../config/schema.js';
import { resolveSecrets } from '../config/load.js';
import { hitWindow, rateLimited } from '../core/ratelimit.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { issueSession, sessionCookie, verifyPassword } from './auth.js';
import { assertSameOrigin, currentAdmin, db, isSecure, siteParam } from './guard.js';
import { knowledgeRoutes } from './knowledge.js';
import { resolveSite } from '../config/site.js';
import { knowledgeEnv, ownsKnowledge } from '../knowledge/env.js';
import { settingsRoutes } from './settings.js';
import { setupRoutes } from './setup.js';
import { webhookRoutes } from './webhooks.js';
import { callbackRoutes, callbackView } from './callbacks.js';
import { versionRoutes } from './version.js';
import { dbFrom, ensureSchema, type D1Like } from '../db/d1.js';
import { emit } from '../webhooks/deliver.js';
import { summarizeConversation, type AiRunner } from '../conversations/summary.js';
import { summaryModel } from '../conversations/complete.js';
export { extractJson } from '../conversations/summary.js';
import { PROMPT_LIMIT, PROMPT_SQL, publishPrompt, readPromptState, type PromptCtx, type PromptVersionRow, type PublishResult } from './prompts.js';
import type { KvStore } from '@helppuff/connector-types';

/**
 * The dashboard API, under `/admin/api`. Everything but sign-in needs a
 * session; everything that changes data also needs a same-origin request.
 * Admin accounts themselves are managed from the CLI, not from here, which
 * keeps the web-facing surface to reading and triaging.
 */

export const adminRoutes = new Hono<HonoEnv>();

const DAY = 86_400_000;
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'] as const;

adminRoutes.use('/admin/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  if (dbFrom(c.get('helppuff').env)) await ensureSchema(dbFrom(c.get('helppuff').env)!);
  await next();
});

adminRoutes.post('/admin/api/login', async (c) => {
  assertSameOrigin(c);
  const ctx = c.get('helppuff');
  const secret = requireSecret(ctx);
  // The owner's CLI (proven by HELPPUFF_SECRET) checks a new password took effect; it is not a guesser.
  if (!(await ctx.isOwner())) {
    const verdict = await hitWindow(ctx.platform.kv, 'login', await ctx.ipKey(), 10, 900);
    if (!verdict.allowed) throw rateLimited(verdict, 'admin_login');
  }

  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const refuse = () => new HelpPuffError('unauthorized', { message: 'That email and password do not match.', detail: 'admin_bad_login' });
  if (!email || !password) throw refuse();

  let ok: boolean;
  const owner = String(ctx.env['ADMIN_EMAIL'] ?? '').toLowerCase();
  const ownerHash = String(ctx.env['ADMIN_PASSWORD_HASH'] ?? '');
  if (owner && email === owner && ownerHash) ok = await verifyPassword(ownerHash, password);
  else {
    const row = await db(c).prepare('SELECT password_hash FROM admins WHERE email = ?').bind(email).first<{ password_hash: string }>();
    // Hash anyway on a miss, so timing does not reveal which emails exist.
    ok = await verifyPassword(row?.password_hash ?? 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password);
    if (ok) await db(c).prepare('UPDATE admins SET last_login_at = ? WHERE email = ?').bind(ctx.platform.now(), email).run();
  }
  if (!ok) throw refuse();

  c.header('Set-Cookie', sessionCookie(await issueSession(secret, email, ctx.platform.now()), isSecure(c)));
  return c.json({ email });
});

adminRoutes.post('/admin/api/logout', (c) => {
  c.header('Set-Cookie', sessionCookie('', isSecure(c), 0));
  return c.json({ ok: true });
});

adminRoutes.get('/admin/api/me', async (c) => {
  const admin = await currentAdmin(c);
  const config = c.get('helppuff').config;
  const origin = new URL(c.req.url).origin;
  const ctx = c.get('helppuff');
  const sites = await Promise.all(
    Object.keys(config.sites).map(async (id) => {
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
      };
    }),
  );
  return c.json({ admin, sites, summaries: Boolean(ctx.env['AI']) });
});

function siteFilter(c: Context<HonoEnv>, column = 'site_id'): { sql: string; params: unknown[] } {
  const site = c.req.query('site');
  return site ? { sql: ` AND ${column} = ?`, params: [site] } : { sql: '', params: [] };
}

adminRoutes.get('/admin/api/overview', async (c) => {
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

adminRoutes.get('/admin/api/conversations', async (c) => {
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
  if (filter === 'leads') where.push('c.lead_id IS NOT NULL');
  if (filter === 'unsummarized') where.push('c.summary IS NULL');
  if (filter === 'callbacks') where.push("EXISTS (SELECT 1 FROM callbacks cb WHERE cb.conversation_id = c.id AND cb.status = 'open')");
  if (before) {
    where.push('c.last_at < ?');
    params.push(before);
  }
  const rows = await db(c)
    .prepare(
      `SELECT c.id, c.site_id AS site, c.started_at AS startedAt, c.last_at AS lastAt, c.page_url AS pageUrl,
              c.country, c.first_message AS firstMessage, c.message_count AS messageCount, c.summary, c.intent,
              l.name AS leadName, l.email AS leadEmail, l.phone AS leadPhone, l.status AS leadStatus,
              (SELECT cb.status FROM callbacks cb WHERE cb.conversation_id = c.id ORDER BY cb.status = 'open' DESC, cb.requested_at DESC LIMIT 1) AS callback
       FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id
       WHERE ${where.join(' AND ')}${f.sql}
       ORDER BY c.last_at DESC LIMIT ?`,
    )
    .bind(...params, ...f.params, limit + 1)
    .all<{ lastAt: number }>();
  const more = rows.results.length > limit;
  const items = rows.results.slice(0, limit);
  return c.json({ items, next: more ? items.at(-1)?.lastAt : null });
});

async function loadConversation(d: D1Like, id: string) {
  const conversation = await d.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!conversation) throw new HelpPuffError('not_found', { message: 'No such conversation.', detail: 'admin_conversation_missing' });
  const [messages, lead, callbacks] = await Promise.all([
    d
      .prepare('SELECT id, role, type, text, payload, ts, feedback FROM messages WHERE conversation_id = ? ORDER BY ts, id')
      .bind(id)
      .all<{ id: string; role: string; type: string; text: string | null; payload: string | null; ts: number }>(),
    conversation['lead_id'] ? d.prepare('SELECT * FROM leads WHERE id = ?').bind(conversation['lead_id']).first() : null,
    d.prepare('SELECT * FROM callbacks WHERE conversation_id = ? ORDER BY requested_at DESC').bind(id).all<Parameters<typeof callbackView>[0]>(),
  ]);
  return {
    conversation,
    lead,
    callbacks: callbacks.results.map(callbackView),
    messages: messages.results.map((m) => ({ ...m, payload: m.payload ? (JSON.parse(m.payload) as unknown) : null })),
  };
}

adminRoutes.get('/admin/api/conversations/:id', async (c) => {
  await currentAdmin(c);
  return c.json(await loadConversation(db(c), c.req.param('id')));
});

adminRoutes.post('/admin/api/conversations/:id/summary', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const ctx = c.get('helppuff');
  const ai = ctx.env['AI'] as Partial<AiRunner> | undefined;
  if (!ai || typeof ai.run !== 'function') {
    throw new HelpPuffError('not_found', { message: 'Summaries need Workers AI. Redeploy with `helppuff deploy`.', detail: 'admin_no_ai' });
  }
  const id = c.req.param('id');
  const { conversation } = await loadConversation(db(c), id);
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

adminRoutes.get('/admin/api/leads', async (c) => {
  await currentAdmin(c);
  // D1 refuses LIKE patterns over 50 bytes: `%q%` must fit.
  const q = (c.req.query('q') ?? '').trim().slice(0, 48);
  const status = c.req.query('status');
  const f = siteFilter(c);
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (q) {
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR notes LIKE ?)');
    params.push(...Array(4).fill(`%${q}%`));
  }
  if (status && (LEAD_STATUSES as readonly string[]).includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  const rows = await db(c)
    .prepare(
      `SELECT id, site_id AS site, conversation_id AS conversationId, name, email, phone, fields, source, status, notes,
              created_at AS createdAt, updated_at AS updatedAt,
              (SELECT COUNT(*) FROM conversations c WHERE c.lead_id = leads.id) AS conversations,
              (SELECT c.id FROM conversations c WHERE c.lead_id = leads.id ORDER BY c.last_at DESC LIMIT 1) AS lastConversationId,
              (SELECT COUNT(*) FROM callbacks cb JOIN conversations c ON c.id = cb.conversation_id WHERE c.lead_id = leads.id AND cb.status = 'open') AS openCallbacks
       FROM leads WHERE ${where.join(' AND ')}${f.sql} ORDER BY updated_at DESC LIMIT 500`,
    )
    .bind(...params, ...f.params)
    .all();
  const counts = await db(c)
    .prepare(`SELECT status, COUNT(*) AS n FROM leads WHERE 1=1${f.sql} GROUP BY status`)
    .bind(...f.params)
    .all<{ status: string; n: number }>();
  return c.json({ items: rows.results, counts: Object.fromEntries(counts.results.map((r) => [r.status, r.n])) });
});

/** A lead as webhooks send it: no internal columns, form fields parsed. */
function leadView(row: Record<string, unknown>) {
  let fields: unknown = null;
  try {
    fields = typeof row['fields'] === 'string' ? JSON.parse(row['fields']) : null;
  } catch {
    // Kept as null.
  }
  return { name: row['name'] ?? null, email: row['email'] ?? null, phone: row['phone'] ?? null, status: row['status'], notes: row['notes'] ?? null, source: row['source'], fields };
}

adminRoutes.patch('/admin/api/leads/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown; notes?: unknown; name?: unknown };
  const sets: string[] = [];
  const params: unknown[] = [];
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
    const changed = Object.fromEntries((['status', 'notes', 'name'] as const).filter((k) => typeof body[k] === 'string').map((k) => [k, lead[k]]));
    emit(c.get('helppuff'), String(lead['site_id']), 'lead.updated', { leadId: lead['id'], conversationId: lead['conversation_id'] ?? null, changed, lead: leadView(lead) });
  }
  return c.json(lead);
});

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  // A leading =, +, - or @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

adminRoutes.get('/admin/api/leads.csv', async (c) => {
  await currentAdmin(c);
  const f = siteFilter(c);
  const rows = await db(c)
    .prepare(`SELECT created_at, name, email, phone, status, source, notes, site_id, conversation_id FROM leads WHERE 1=1${f.sql} ORDER BY created_at DESC`)
    .bind(...f.params)
    .all<Record<string, unknown>>();
  const header = ['created', 'name', 'email', 'phone', 'status', 'source', 'notes', 'site', 'conversation'];
  const lines = rows.results.map((r) =>
    [new Date(Number(r['created_at'])).toISOString(), r['name'], r['email'], r['phone'], r['status'], r['source'], r['notes'], r['site_id'], r['conversation_id']]
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

adminRoutes.get('/admin/api/admins', async (c) => {
  const me = await currentAdmin(c);
  const owner = String(c.get('helppuff').env['ADMIN_EMAIL'] ?? '').toLowerCase();
  const rows = await db(c).prepare('SELECT email, name, created_at AS createdAt, last_login_at AS lastLoginAt FROM admins ORDER BY created_at').all();
  return c.json({ me: me.email, owner, admins: rows.results });
});

// ------------------------------------------------------------ prompt versions

function promptCtx(c: Context<HonoEnv>): PromptCtx {
  const ctx = c.get('helppuff');
  const kv = ctx.env['HELPPUFF_KV'] as KvStore | undefined;
  if (!kv) throw new HelpPuffError('internal', { message: 'This deployment has no KV namespace.', detail: 'admin_no_kv' });
  return { config: ctx.config, kv, now: () => ctx.platform.now() };
}

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

adminRoutes.get('/admin/api/prompt', async (c) => {
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

adminRoutes.get('/admin/api/prompt/versions/:version', async (c) => {
  await currentAdmin(c);
  const site = siteParam(c, c.req.query('site'));
  const row = await db(c)
    .prepare(PROMPT_SQL.get)
    .bind(site, Number(c.req.param('version')))
    .first<PromptVersionRow & { text: string }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such version.', detail: 'admin_prompt_version_missing' });
  return c.json(row);
});

adminRoutes.post('/admin/api/prompt', async (c) => {
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

adminRoutes.post('/admin/api/prompt/restore', async (c) => {
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
adminRoutes.route('/', webhookRoutes);
adminRoutes.route('/', callbackRoutes);
adminRoutes.route('/', versionRoutes);
