import { Hono, type Context } from 'hono';
import { MurmurError } from '../core/errors.js';
import { hitWindow, rateLimited } from '../core/ratelimit.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { cookieValue, issueSession, readSession, SESSION_COOKIE, sessionCookie, verifyPassword } from './auth.js';
import { dbFrom, ensureSchema, type D1Like } from './db.js';
import { leadUpsert } from './record.js';
import { PROMPT_LIMIT, PROMPT_SQL, publishPrompt, readPromptState, type PromptCtx, type PromptVersionRow, type PublishResult } from './prompts.js';
import type { KvStore } from '@murmur/connector-types';

/**
 * The dashboard API, under `/admin/api`. Everything but sign-in needs a
 * session; everything that changes data also needs a same-origin request.
 * Admin accounts themselves are managed from the CLI, not from here, which
 * keeps the web-facing surface to reading and triaging.
 */

export const adminRoutes = new Hono<HonoEnv>();

const DAY = 86_400_000;
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'] as const;
const DEFAULT_SUMMARY_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function db(c: Context<HonoEnv>): D1Like {
  const found = dbFrom(c.get('mm').env);
  if (!found) {
    throw new MurmurError('not_found', {
      message: 'The dashboard is not enabled for this deployment. Run `murmur deploy` with dashboard enabled.',
      detail: 'admin_no_db',
    });
  }
  return found;
}

function isSecure(c: Context<HonoEnv>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

/** Mutations must come from the dashboard's own origin. */
function assertSameOrigin(c: Context<HonoEnv>): void {
  const origin = c.req.header('Origin');
  if (origin && origin !== new URL(c.req.url).origin) {
    throw new MurmurError('forbidden_origin', { message: 'Cross-origin request refused.', detail: 'admin_cross_origin' });
  }
}

type Admin = { email: string; owner: boolean };

async function currentAdmin(c: Context<HonoEnv>): Promise<Admin> {
  const ctx = c.get('mm');
  const session = await readSession(requireSecret(ctx), cookieValue(c.req.header('Cookie'), SESSION_COOKIE), ctx.platform.now());
  if (!session) throw new MurmurError('unauthorized', { message: 'Please sign in.', detail: 'admin_no_session' });
  const owner = String(ctx.env['ADMIN_EMAIL'] ?? '').toLowerCase();
  if (session.email === owner) return { email: session.email, owner: true };
  // Removed accounts lose access at their next request, not in seven days.
  const row = await db(c).prepare('SELECT email FROM admins WHERE email = ?').bind(session.email).first();
  if (!row) throw new MurmurError('unauthorized', { message: 'Please sign in.', detail: 'admin_revoked' });
  return { email: session.email, owner: false };
}

adminRoutes.use('/admin/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  if (dbFrom(c.get('mm').env)) await ensureSchema(dbFrom(c.get('mm').env)!);
  await next();
});

adminRoutes.post('/admin/api/login', async (c) => {
  assertSameOrigin(c);
  const ctx = c.get('mm');
  const secret = requireSecret(ctx);
  // The owner's CLI (proven by MURMUR_SECRET) checks a new password took effect; it is not a guesser.
  if (!(await ctx.isOwner())) {
    const verdict = await hitWindow(ctx.platform.kv, 'login', await ctx.ipKey(), 10, 900);
    if (!verdict.allowed) throw rateLimited(verdict, 'admin_login');
  }

  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const refuse = () => new MurmurError('unauthorized', { message: 'That email and password do not match.', detail: 'admin_bad_login' });
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
  const config = c.get('mm').config;
  const origin = new URL(c.req.url).origin;
  const sites = Object.entries(config.sites).map(([id, site]) => ({
    id,
    name: site.widget.brand.name,
    accent: site.widget.brand.accent,
    avatar: site.widget.brand.avatar ?? null,
    embed: `<script src="${origin}/loader.js" data-site="${id}" async></script>`,
  }));
  return c.json({ admin, sites, summaries: Boolean(c.get('mm').env['AI']) });
});

function siteFilter(c: Context<HonoEnv>, column = 'site_id'): { sql: string; params: unknown[] } {
  const site = c.req.query('site');
  return site ? { sql: ` AND ${column} = ?`, params: [site] } : { sql: '', params: [] };
}

adminRoutes.get('/admin/api/overview', async (c) => {
  await currentAdmin(c);
  const d = db(c);
  const now = c.get('mm').platform.now();
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

  return c.json({
    range: { days, since },
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
  const q = (c.req.query('q') ?? '').trim().slice(0, 100);
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
  if (before) {
    where.push('c.last_at < ?');
    params.push(before);
  }
  const rows = await db(c)
    .prepare(
      `SELECT c.id, c.site_id AS site, c.started_at AS startedAt, c.last_at AS lastAt, c.page_url AS pageUrl,
              c.country, c.first_message AS firstMessage, c.message_count AS messageCount, c.summary, c.intent,
              l.name AS leadName, l.email AS leadEmail, l.phone AS leadPhone, l.status AS leadStatus
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
  if (!conversation) throw new MurmurError('not_found', { message: 'No such conversation.', detail: 'admin_conversation_missing' });
  const [messages, lead] = await Promise.all([
    d
      .prepare('SELECT id, role, type, text, payload, ts FROM messages WHERE conversation_id = ? ORDER BY ts, id')
      .bind(id)
      .all<{ id: string; role: string; type: string; text: string | null; payload: string | null; ts: number }>(),
    conversation['lead_id'] ? d.prepare('SELECT * FROM leads WHERE id = ?').bind(conversation['lead_id']).first() : null,
  ]);
  return {
    conversation,
    lead,
    messages: messages.results.map((m) => ({ ...m, payload: m.payload ? (JSON.parse(m.payload) as unknown) : null })),
  };
}

adminRoutes.get('/admin/api/conversations/:id', async (c) => {
  await currentAdmin(c);
  return c.json(await loadConversation(db(c), c.req.param('id')));
});

type AiBinding = { run(model: string, input: object): Promise<unknown> };

/** First JSON object in a model's reply, tolerating prose or fences around it. */
export function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

adminRoutes.post('/admin/api/conversations/:id/summary', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const ctx = c.get('mm');
  const ai = ctx.env['AI'] as Partial<AiBinding> | undefined;
  if (!ai || typeof ai.run !== 'function') {
    throw new MurmurError('not_found', { message: 'Summaries need Workers AI. Redeploy with `murmur deploy`.', detail: 'admin_no_ai' });
  }
  const d = db(c);
  const id = c.req.param('id');
  const { conversation, messages } = await loadConversation(d, id);
  const transcript = messages
    .filter((m) => m.text)
    .map((m) => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.text}`)
    .join('\n')
    .slice(-12_000);
  if (!transcript) throw new MurmurError('bad_request', { message: 'Nothing to summarise yet.', detail: 'admin_empty' });

  const model = typeof ctx.env['MURMUR_SUMMARY_MODEL'] === 'string' ? String(ctx.env['MURMUR_SUMMARY_MODEL']) : DEFAULT_SUMMARY_MODEL;
  const result = (await ai.run!(model, {
    messages: [
      {
        role: 'system',
        content:
          'You summarise website chat conversations for a small business owner. Reply with JSON only: ' +
          '{"summary": "2-3 sentences: what the visitor wanted and how it ended", "intent": "2-4 word label, e.g. Pricing question", ' +
          '"sentiment": "positive|neutral|negative", "followUp": "one concrete next step for the business, or empty", ' +
          '"contact": {"name": "", "email": "", "phone": ""}}. Use empty strings for anything not stated. Never invent contact details.',
      },
      { role: 'user', content: transcript },
    ],
    max_tokens: 400,
  })) as { response?: unknown };
  const raw = typeof result?.response === 'string' ? result.response : JSON.stringify(result?.response ?? '');
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed['summary'] !== 'string') {
    throw new MurmurError('connector_error', { message: 'The summary could not be generated. Try again.', detail: 'admin_summary_unparsable' });
  }
  const now = ctx.platform.now();
  const summary = {
    summary: String(parsed['summary']).slice(0, 1000),
    intent: typeof parsed['intent'] === 'string' ? parsed['intent'].slice(0, 60) : null,
    sentiment: ['positive', 'neutral', 'negative'].includes(String(parsed['sentiment'])) ? String(parsed['sentiment']) : null,
    followUp: typeof parsed['followUp'] === 'string' ? parsed['followUp'].slice(0, 300) : null,
  };
  const statements = [
    d
      .prepare('UPDATE conversations SET summary = ?, intent = ?, summarized_at = ? WHERE id = ?')
      .bind(JSON.stringify(summary), summary.intent, now, id),
  ];
  const contact = (parsed['contact'] ?? {}) as Record<string, unknown>;
  const pick = (key: string) => (typeof contact[key] === 'string' && String(contact[key]).trim() ? String(contact[key]).trim().slice(0, 200) : undefined);
  const found = { name: pick('name'), email: pick('email'), phone: pick('phone') };
  // Only details the visitor actually typed: the transcript must contain them.
  const inTranscript = (value?: string) => (value && transcript.includes(value) ? value : undefined);
  const verified = { name: inTranscript(found.name), email: inTranscript(found.email), phone: inTranscript(found.phone) };
  if (verified.email || verified.phone || (verified.name && conversation['lead_id'])) {
    statements.push(
      leadUpsert(
        d,
        String(conversation['site_id']),
        id,
        Object.fromEntries(Object.entries(verified).filter(([, v]) => v)) as { name?: string; email?: string; phone?: string },
        'ai',
        now,
      ),
      d.prepare('UPDATE conversations SET lead_id = ? WHERE id = ?').bind(`lead_${id}`, id),
    );
  }
  await d.batch(statements);
  return c.json({ ...summary, lead: verified });
});

adminRoutes.get('/admin/api/leads', async (c) => {
  await currentAdmin(c);
  const q = (c.req.query('q') ?? '').trim().slice(0, 100);
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
              created_at AS createdAt, updated_at AS updatedAt
       FROM leads WHERE ${where.join(' AND ')}${f.sql} ORDER BY created_at DESC LIMIT 500`,
    )
    .bind(...params, ...f.params)
    .all();
  const counts = await db(c)
    .prepare(`SELECT status, COUNT(*) AS n FROM leads WHERE 1=1${f.sql} GROUP BY status`)
    .bind(...f.params)
    .all<{ status: string; n: number }>();
  return c.json({ items: rows.results, counts: Object.fromEntries(counts.results.map((r) => [r.status, r.n])) });
});

adminRoutes.patch('/admin/api/leads/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown; notes?: unknown; name?: unknown };
  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof body.status === 'string') {
    if (!(LEAD_STATUSES as readonly string[]).includes(body.status)) throw new MurmurError('bad_request', { message: 'Unknown status.' });
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
  if (!sets.length) throw new MurmurError('bad_request', { message: 'Nothing to update.' });
  sets.push('updated_at = ?');
  params.push(c.get('mm').platform.now());
  await db(c)
    .prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...params, c.req.param('id'))
    .run();
  return c.json(await db(c).prepare('SELECT * FROM leads WHERE id = ?').bind(c.req.param('id')).first());
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
  const owner = String(c.get('mm').env['ADMIN_EMAIL'] ?? '').toLowerCase();
  const rows = await db(c).prepare('SELECT email, name, created_at AS createdAt, last_login_at AS lastLoginAt FROM admins ORDER BY created_at').all();
  return c.json({ me: me.email, owner, admins: rows.results });
});

// ------------------------------------------------------------ prompt versions

function promptCtx(c: Context<HonoEnv>): PromptCtx {
  const ctx = c.get('mm');
  const kv = ctx.env['MURMUR_KV'] as KvStore | undefined;
  if (!kv) throw new MurmurError('internal', { message: 'This deployment has no KV namespace.', detail: 'admin_no_kv' });
  return { config: ctx.config, kv, now: () => ctx.platform.now() };
}

/** The site asked for, or the only one — a CLI deployment has exactly one. */
function promptSite(c: Context<HonoEnv>, value: unknown): string {
  const sites = Object.keys(c.get('mm').config.sites);
  const site = typeof value === 'string' && value ? value : sites[0];
  if (!site || !sites.includes(site)) throw new MurmurError('not_found', { message: 'No such site.', detail: 'admin_unknown_site' });
  return site;
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

adminRoutes.get('/admin/api/prompt', async (c) => {
  await currentAdmin(c);
  const site = promptSite(c, c.req.query('site'));
  const d = db(c);
  const state = await readPromptState(promptCtx(c), d, site);
  const versions = await d.prepare(PROMPT_SQL.list).bind(site, 200).all<PromptVersionRow>();
  return c.json({
    site,
    connector: state.connector,
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
  const site = promptSite(c, c.req.query('site'));
  const row = await db(c)
    .prepare(PROMPT_SQL.get)
    .bind(site, Number(c.req.param('version')))
    .first<PromptVersionRow & { text: string }>();
  if (!row) throw new MurmurError('not_found', { message: 'No such version.', detail: 'admin_prompt_version_missing' });
  return c.json(row);
});

adminRoutes.post('/admin/api/prompt', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as { site?: unknown; text?: unknown; note?: unknown; baseVersion?: unknown };
  if (typeof body.text !== 'string' || typeof body.baseVersion !== 'number') {
    throw new MurmurError('bad_request', { message: 'Send the new text and the version it was based on.', detail: 'admin_prompt_body' });
  }
  const site = promptSite(c, body.site);
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
    throw new MurmurError('bad_request', { message: 'Send the version to restore and the current version.', detail: 'admin_prompt_body' });
  }
  const site = promptSite(c, body.site);
  const d = db(c);
  const row = await d.prepare(PROMPT_SQL.get).bind(site, body.version).first<{ text: string }>();
  if (!row) throw new MurmurError('not_found', { message: 'No such version.', detail: 'admin_prompt_version_missing' });
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
