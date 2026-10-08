import { Hono, type Context } from 'hono';
import type { KvStore } from '@helppuff/connector-types';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import type { HonoEnv, RequestCtx } from '../core/request.js';
import { aiSettingsFor } from '../knowledge/env.js';
import { emit } from '../webhooks/deliver.js';
import type { AiRunner } from '../conversations/summary.js';
import { liveDeps, publish } from '../live/service.js';
import { addUpdate, applyTemplate, createJob, deleteJob, ensurePipeline, jobRow, jobView, moveJob, savePipeline, updateJob, type Actor, type JobPatch, type JobRow, type Pipeline } from '../jobs/store.js';
import { awaitingSetup, setupJobs, siteText, textOfHtml } from '../jobs/setup.js';
import { TEMPLATES, templateById } from '../jobs/templates.js';
import { forgetPipeline, publishQuote, quoteWidget } from '../jobs/widget.js';
import { assertAdmin, assertSameOrigin, assertSiteAccess, currentAdmin, db, jsonBody, siteParam, type Admin } from './guard.js';
import { actorOf } from './inbox.js';
import { displayName } from './live.js';

/**
 * Jobs: the site's pipeline (stages, fields, quote questions, the template
 * the AI chose), and the jobs on it. People in the dashboard, API keys and
 * the chat create jobs; every change goes into the job's history.
 */

export const jobRoutes = new Hono<HonoEnv>();

const actorFor = (admin: Admin): Actor => ({ id: actorOf(admin), name: admin.via === 'session' ? displayName(admin) : admin.via === 'key' ? admin.name : 'CLI' });

/** Tell the site's webhooks, and the team's dashboards (a new job is an alert, like a live chat). */
export function announceJob(ctx: RequestCtx, siteId: string, type: 'job.created' | 'job.updated' | 'job.stage_changed' | 'job.won' | 'job.lost', job: ReturnType<typeof jobView>, extra: Record<string, unknown> = {}): void {
  emit(ctx, siteId, type, { job, ...extra });
  const deps = liveDeps(ctx);
  if (deps && type === 'job.created') {
    ctx.platform.waitUntil(publish(deps, siteId, { type: 'job', jobId: job.id, number: job.number, title: job.title, who: job.contact?.name ?? job.contact?.email ?? null, source: job.source }).catch(() => {}));
  }
}

async function viewOf(c: Context<HonoEnv>, row: JobRow, pipeline?: Pipeline) {
  const d = db(c);
  const contact = row.lead_id ? await d.prepare('SELECT name, email, phone FROM leads WHERE id = ?').bind(row.lead_id).first<{ name: string | null; email: string | null; phone: string | null }>() : null;
  return jobView({ ...row, contact_name: contact?.name ?? null, contact_email: contact?.email ?? null, contact_phone: contact?.phone ?? null }, pipeline ?? (await ensurePipeline(d, row.site_id, c.get('helppuff').platform.now())), c.get('helppuff').platform.now());
}

async function ownJob(c: Context<HonoEnv>): Promise<JobRow> {
  const row = await jobRow(db(c), c.req.param('id') ?? '');
  assertSiteAccess(c, row.site_id, 'job');
  return row;
}

/** "me", a team member's email, or null: who a job is assigned to. */
async function assigneeOf(c: Context<HonoEnv>, admin: Admin, value: unknown): Promise<Actor | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value === 'me') {
    if (admin.via !== 'session') throw new HelpPuffError('bad_request', { message: 'A key cannot be assigned: give an email on the team.', detail: 'job_assign_key' });
    return { id: admin.email, name: displayName(admin) };
  }
  if (typeof value !== 'string') throw new HelpPuffError('bad_request', { message: 'assignedTo is "me", a team member\'s email, or null.', detail: 'job_assign_body' });
  const email = value.trim().toLowerCase();
  const owner = String(c.get('helppuff').env['ADMIN_EMAIL'] ?? '').toLowerCase();
  const row = await db(c).prepare('SELECT email, name FROM admins WHERE email = ?').bind(email).first<{ email: string; name: string | null }>();
  if (!row && email !== owner) throw new HelpPuffError('bad_request', { message: `${email} is not on the team.`, detail: 'job_assign_unknown' });
  return { id: email, name: displayName({ email, name: row?.name ?? null }) };
}

const numberOrNull = (value: unknown, what: string): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HelpPuffError('bad_request', { message: `${what} is a number, 0 or more.`, detail: 'job_number' });
  return n;
};
const dateOrNull = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const t = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(t)) throw new HelpPuffError('bad_request', { message: 'dueAt is a date (ISO 8601) or milliseconds.', detail: 'job_due' });
  return t;
};

// ----------------------------------------------------------------- pipeline

function pipelineView(pipeline: Pipeline) {
  return { ...pipeline, quotePreview: quoteWidget(pipeline)?.flow.steps ?? [] };
}

const templatesView = () => TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, stages: t.stages, fields: t.fields }));

jobRoutes.get('/jobs/pipeline', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  return c.json({ pipeline: pipelineView(await ensurePipeline(db(c), siteId, c.get('helppuff').platform.now())), templates: templatesView() });
});

async function saved(c: Context<HonoEnv>, siteId: string, pipeline: Pipeline) {
  forgetPipeline(siteId);
  await publishQuote(c.get('helppuff').env['HELPPUFF_KV'] as KvStore | undefined, siteId, pipeline);
  return c.json({ pipeline: pipelineView(pipeline), templates: templatesView() });
}

/** Stages, fields, quote questions and their options, the item's name. Whole lists: see `savePipeline`. */
jobRoutes.put('/jobs/pipeline', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const pipeline = await savePipeline(db(c), siteId, body as Parameters<typeof savePipeline>[2], c.get('helppuff').platform.now());
  return saved(c, siteId, pipeline);
});

/** Use another template: stages and fields are replaced; jobs keep their place by kind. */
jobRoutes.post('/jobs/pipeline/template', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const template = templateById(String(body['template'] ?? ''));
  if (!template) throw new HelpPuffError('bad_request', { message: `Template is one of: ${TEMPLATES.map((t) => t.id).join(', ')}.`, detail: 'job_template_unknown' });
  const now = c.get('helppuff').platform.now();
  await applyTemplate(db(c), siteId, template, { chosenBy: 'owner', reason: null }, now);
  return saved(c, siteId, await ensurePipeline(db(c), siteId, now));
});

/** Let the AI choose (again) from the website: what the crawl learned, else the home page. */
jobRoutes.post('/jobs/setup', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const ctx = c.get('helppuff');
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  // force: false (after a deploy): only if it was never set up, and once there is something to read.
  const result = body['force'] === false ? await maybeSetup(ctx, siteId) : { status: 'done' as const, ...(await runSetup(ctx, siteId, { force: true })) };
  return c.json({ ...result, pipeline: pipelineView(await ensurePipeline(db(c), siteId, ctx.platform.now())) });
});

/** The set-up step, shared by the route, the crawl's end and the CLI. */
export async function runSetup(ctx: Pick<RequestCtx, 'env' | 'config' | 'platform'>, siteId: string, options: { force?: boolean } = {}) {
  const d = ctx.env['HELPPUFF_DB'] as Parameters<typeof setupJobs>[0]['db'];
  const site = await resolveSite(ctx, siteId);
  let text = await siteText(d, siteId).catch(() => '');
  if (!text) {
    // No crawl (another backend, or not yet): the website's home page.
    const website = site.knowledge.website ?? site.origins.find((o) => /^https:/.test(o) && !/workers\.dev/.test(o));
    if (website) {
      try {
        const response = await fetch(website, { headers: { 'User-Agent': 'HelpPuff (setting up Jobs)' }, redirect: 'follow' });
        if (response.ok && (response.headers.get('content-type') ?? '').includes('html')) text = textOfHtml(await response.text());
      } catch {
        // Unreachable: the basic template.
      }
    }
  }
  const ai = ctx.env['AI'] as Partial<AiRunner> | undefined;
  const result = await setupJobs({ db: d, ai: ai && typeof ai.run === 'function' ? (ai as AiRunner) : undefined, model: aiSettingsFor(site).chatModel, now: () => ctx.platform.now() }, siteId, text, options);
  forgetPipeline(siteId);
  await publishQuote(ctx.env['HELPPUFF_KV'] as KvStore | undefined, siteId, await ensurePipeline(d, siteId, ctx.platform.now()));
  return result;
}

// --------------------------------------------------------------------- jobs

/** Jobs, with filters: open (default), won, lost or all; a stage; who has them; what they say. */
jobRoutes.get('/jobs', async (c) => {
  await currentAdmin(c);
  const d = db(c);
  const siteId = siteParam(c, c.req.query('site'));
  const now = c.get('helppuff').platform.now();
  const pipeline = await ensurePipeline(d, siteId, now);
  const where = ['j.site_id = ?'];
  const params: unknown[] = [siteId];
  const status = c.req.query('status') ?? 'open';
  if (status !== 'all') {
    if (!['open', 'won', 'lost'].includes(status)) throw new HelpPuffError('bad_request', { message: 'Status is open, won, lost or all.', detail: 'job_status' });
    const ids = pipeline.stages.filter((s) => s.kind === status).map((s) => s.id);
    where.push(`j.stage_id IN (${ids.map(() => '?').join(', ') || "''"})`);
    params.push(...ids);
  }
  const stage = c.req.query('stage');
  if (stage) {
    where.push('j.stage_id = ?');
    params.push(stage);
  }
  const assigned = c.req.query('assigned');
  if (assigned === 'me') {
    where.push('j.assigned_to = ?');
    params.push((await currentAdmin(c)).email);
  } else if (assigned === 'none') where.push('j.assigned_to IS NULL');
  else if (assigned) {
    where.push('j.assigned_to = ?');
    params.push(assigned.toLowerCase());
  }
  const source = c.req.query('source');
  if (source) {
    where.push('j.source = ?');
    params.push(source);
  }
  const leadId = c.req.query('contact');
  if (leadId) {
    where.push('j.lead_id = ?');
    params.push(leadId);
  }
  const conversation = c.req.query('conversation');
  if (conversation) {
    where.push('j.conversation_id = ?');
    params.push(conversation);
  }
  const q = (c.req.query('q') ?? '').trim().slice(0, 48);
  if (q) {
    where.push("(j.title LIKE ? OR j.details LIKE ? OR j.fields LIKE ? OR l.name LIKE ? OR l.email LIKE ? OR CAST(j.number AS TEXT) = ?)");
    params.push(...Array(5).fill(`%${q}%`), q.replace(/^#/, ''));
  }
  const rows = await d
    .prepare(
      `SELECT j.*, l.name AS contact_name, l.email AS contact_email, l.phone AS contact_phone FROM jobs j LEFT JOIN leads l ON l.id = j.lead_id
       WHERE ${where.join(' AND ')} ORDER BY j.position, j.created_at DESC LIMIT 500`,
    )
    .bind(...params)
    .all<JobRow & { contact_name: string | null; contact_email: string | null; contact_phone: string | null }>();
  const counts = await d.prepare('SELECT stage_id, COUNT(*) AS n, COALESCE(SUM(value_cents), 0) AS value FROM jobs WHERE site_id = ? GROUP BY stage_id').bind(siteId).all<{ stage_id: string; n: number; value: number }>();
  return c.json({
    items: rows.results.map((row) => jobView(row, pipeline, now)),
    stages: pipeline.stages.map((s) => {
      const count = counts.results.find((r) => r.stage_id === s.id);
      return { ...s, count: count?.n ?? 0, valueCents: count?.value ?? 0 };
    }),
  });
});

/** A job: from the dashboard (source `manual`), a key (`api`), or a conversation, callback or contact. */
jobRoutes.post('/jobs', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const ctx = c.get('helppuff');
  const d = db(c);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  let conversationId = typeof body['conversationId'] === 'string' ? body['conversationId'] : null;
  let leadId = typeof body['contactId'] === 'string' ? body['contactId'] : null;
  let details = typeof body['details'] === 'string' ? body['details'] : null;
  let source: 'manual' | 'api' | 'callback' = admin.via === 'session' ? 'manual' : 'api';
  if (typeof body['callbackId'] === 'string') {
    const cb = await d.prepare('SELECT conversation_id, lead_id, reason, site_id FROM callbacks WHERE id = ?').bind(body['callbackId']).first<{ conversation_id: string; lead_id: string | null; reason: string | null; site_id: string }>();
    if (!cb || cb.site_id !== siteId) throw new HelpPuffError('not_found', { message: 'No such callback request.', detail: 'job_callback_missing' });
    conversationId ??= cb.conversation_id;
    leadId ??= cb.lead_id;
    details ??= cb.reason;
    source = 'callback';
  }
  if (conversationId) {
    const conv = await d.prepare('SELECT site_id, summary, first_message FROM conversations WHERE id = ?').bind(conversationId).first<{ site_id: string; summary: string | null; first_message: string | null }>();
    if (!conv || conv.site_id !== siteId) throw new HelpPuffError('not_found', { message: 'No such conversation.', detail: 'job_conversation_missing' });
    if (!details) {
      let summary: string | null;
      try {
        summary = conv.summary ? ((JSON.parse(conv.summary) as { summary?: string }).summary ?? null) : null;
      } catch {
        summary = conv.summary;
      }
      details = summary ?? conv.first_message;
    }
  }
  const contact = body['contact'] && typeof body['contact'] === 'object' ? (body['contact'] as { name?: string; email?: string; phone?: string }) : null;
  const value = numberOrNull(body['value'], 'value');
  const now = ctx.platform.now();
  const row = await createJob(
    d,
    {
      siteId,
      title: typeof body['title'] === 'string' ? body['title'] : null,
      details,
      fields: body['fields'],
      contact,
      leadId,
      conversationId,
      source,
      stageId: typeof body['stageId'] === 'string' ? body['stageId'] : null,
      valueCents: value === undefined || value === null ? null : Math.round(value * 100),
      currency: typeof body['currency'] === 'string' ? body['currency'].toUpperCase() : null,
      dueAt: dateOrNull(body['dueAt']) ?? null,
      assignedTo: (await assigneeOf(c, admin, body['assignedTo'])) ?? null,
      actor: actorFor(admin),
    },
    now,
  );
  const view = await viewOf(c, row);
  announceJob(ctx, siteId, 'job.created', view);
  return c.json(view, 201);
});

/** A job, with its history, notes, contact and the conversation it came from. */
jobRoutes.get('/jobs/:id', async (c) => {
  await currentAdmin(c);
  const row = await ownJob(c);
  const d = db(c);
  const [events, notes, conversation] = await Promise.all([
    d.prepare('SELECT id, at, actor, actor_name AS actorName, kind, data FROM job_events WHERE job_id = ? ORDER BY at, rowid').bind(row.id).all<{ data: string | null }>(),
    d.prepare('SELECT id, author, author_name AS authorName, text, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE job_id = ? ORDER BY created_at').bind(row.id).all(),
    row.conversation_id ? d.prepare('SELECT id, first_message AS firstMessage, started_at AS startedAt FROM conversations WHERE id = ?').bind(row.conversation_id).first() : null,
  ]);
  return c.json({
    ...(await viewOf(c, row)),
    history: events.results.map((e) => ({ ...e, data: e.data ? (JSON.parse(e.data) as unknown) : null })),
    notes: notes.results,
    conversation,
  });
});

jobRoutes.patch('/jobs/:id', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const row = await ownJob(c);
  const body = await jsonBody(c);
  const value = numberOrNull(body['value'], 'value');
  const patch: JobPatch = {
    ...(typeof body['title'] === 'string' ? { title: body['title'] } : {}),
    ...(body['details'] !== undefined ? { details: typeof body['details'] === 'string' ? body['details'] : null } : {}),
    ...(body['fields'] !== undefined ? { fields: body['fields'] } : {}),
    ...(value !== undefined ? { valueCents: value === null ? null : Math.round(value * 100) } : {}),
    ...(body['currency'] !== undefined ? { currency: typeof body['currency'] === 'string' ? body['currency'].toUpperCase() : null } : {}),
    ...(body['dueAt'] !== undefined ? { dueAt: dateOrNull(body['dueAt']) ?? null } : {}),
  };
  const assignee = await assigneeOf(c, admin, body['assignedTo']);
  if (assignee !== undefined) {
    if (admin.role === 'member' && assignee && assignee.id !== admin.email) throw new HelpPuffError('forbidden', { message: 'Only an admin can give a job to someone else.', detail: 'admin_role_member' });
    patch.assignedTo = assignee;
  }
  const updated = await updateJob(db(c), row, patch, actorFor(admin), c.get('helppuff').platform.now());
  const view = await viewOf(c, updated);
  if (updated.updated_at !== row.updated_at) announceJob(c.get('helppuff'), row.site_id, 'job.updated', view);
  return c.json(view);
});

/** Move to another stage (won or lost closes it), and/or another place in the column (`before`: the job it now sits above). */
jobRoutes.post('/jobs/:id/move', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const row = await ownJob(c);
  const body = await jsonBody(c);
  const moved = await moveJob(
    db(c),
    row,
    {
      ...(typeof body['stageId'] === 'string' ? { stageId: body['stageId'] } : {}),
      ...(body['before'] !== undefined ? { before: typeof body['before'] === 'string' ? body['before'] : null } : {}),
      ...(typeof body['lostReason'] === 'string' ? { lostReason: body['lostReason'] } : {}),
    },
    actorFor(admin),
    c.get('helppuff').platform.now(),
  );
  const view = await viewOf(c, moved.job);
  if (moved.from.id !== moved.to.id) {
    const ctx = c.get('helppuff');
    announceJob(ctx, row.site_id, 'job.stage_changed', view, { from: moved.from.name, to: moved.to.name });
    if (moved.to.kind === 'won') announceJob(ctx, row.site_id, 'job.won', view);
    if (moved.to.kind === 'lost') announceJob(ctx, row.site_id, 'job.lost', view, { reason: view.lostReason });
  }
  return c.json(view);
});

/** An update for the history ("Parts ordered, back Thursday"): the details stay as they were. */
jobRoutes.post('/jobs/:id/updates', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const row = await ownJob(c);
  await addUpdate(db(c), row, String((await jsonBody(c))['text'] ?? ''), actorFor(admin), c.get('helppuff').platform.now());
  return c.json({ id: row.id, added: true }, 201);
});

/** A private note on a job. */
jobRoutes.post('/jobs/:id/notes', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const row = await ownJob(c);
  const text = String((await jsonBody(c))['text'] ?? '').trim().slice(0, 5000);
  if (!text) throw new HelpPuffError('bad_request', { message: 'Write the note (up to 5000 characters).', detail: 'note_empty' });
  const now = c.get('helppuff').platform.now();
  const id = `note_${now.toString(36)}${crypto.randomUUID().slice(0, 8)}`;
  await db(c)
    .prepare('INSERT INTO notes (id, site_id, conversation_id, lead_id, job_id, author, author_name, text, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, row.site_id, row.lead_id, row.id, actorOf(admin), admin.name ?? (admin.via === 'session' ? displayName(admin) : null), text, now, now)
    .run();
  return c.json({ id, jobId: row.id, author: actorOf(admin), authorName: admin.name, text, createdAt: now, updatedAt: now }, 201);
});

jobRoutes.delete('/jobs/:id', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const row = await ownJob(c);
  await deleteJob(db(c), row);
  return c.json({ id: row.id, deleted: true });
});

export type SetupState = { status: 'kept' | 'waiting' | 'done' } & Partial<Awaited<ReturnType<typeof runSetup>>>;

/**
 * Set Jobs up from the website once: right after a deploy (`helppuff deploy`
 * calls `POST /jobs/setup` with `force: false`), and in the background when
 * the dashboard loads; the crawl's end does the same (`setupAfterLearning`).
 * The pipeline exists at once, so the assistant can make jobs from the first
 * visitor; the AI chooses its template when there is something to read: the
 * learned pages (HelpPuff's own knowledge base, `waiting` until the crawl has
 * some), else the home page. Never twice, never over the owner's pipeline.
 */
export async function maybeSetup(ctx: Pick<RequestCtx, 'env' | 'config' | 'platform'>, siteId: string): Promise<SetupState | null> {
  const d = ctx.env['HELPPUFF_DB'] as Parameters<typeof setupJobs>[0]['db'] | undefined;
  if (!d) return null;
  if (!(await awaitingSetup(d, siteId))) return { status: 'kept' };
  await ensurePipeline(d, siteId, ctx.platform.now());
  const site = await resolveSite(ctx, siteId);
  if (site.connector.type === 'workers-ai') {
    const learned = await d.prepare('SELECT 1 AS x FROM chunks WHERE site_id = ? LIMIT 1').bind(siteId).first();
    if (!learned) return { status: 'waiting' };
  }
  return { status: 'done', ...(await runSetup(ctx, siteId, { force: false })) };
}
