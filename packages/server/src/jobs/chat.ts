import { JOB_FORM_PREFIX, type Message } from '@helppuff/protocol';
import type { ConnectorContext } from '@helppuff/connector-types';
import { messageId, notice } from '@helppuff/connector-types';
import type { RequestCtx } from '../core/request.js';
import { dbFrom } from '../db/d1.js';
import { announceJob } from '../admin/jobs.js';
import { cleanFields, createJob, jobView, missingFields, type JobField, type JobRow, type Pipeline } from './store.js';
import { CONTACT_FIELDS, cachedPipeline, readQuote } from './widget.js';

/**
 * Jobs from the chat: the assistant's `create_job` tool (with a short form
 * for required details still missing), and the widget's quote questions.
 * Every write here is the visitor's request being saved, which is the point
 * of the turn, so it is awaited like the reply it confirms.
 */

const ASSISTANT = { id: 'assistant', name: 'The assistant' };
const VISITOR = { id: 'visitor', name: 'The visitor' };

/** A form for the fields a job still needs; its id names the job, so the answers complete that job. */
export function jobFormMessage(job: Pick<JobRow, 'id' | 'number'>, fields: JobField[], pipeline: Pipeline): Message {
  return {
    id: `${JOB_FORM_PREFIX}${job.id}`.slice(0, 64),
    ts: Date.now(),
    role: 'agent',
    type: 'form',
    title: `${pipeline.itemSingular} #${job.number}: a few details`,
    fields: fields.slice(0, 12).map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type === 'textarea' ? 'textarea' : f.type === 'select' && f.options.length ? 'select' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text',
      required: f.required,
      ...(f.type === 'select' && f.options.length ? { options: f.options.slice(0, 50) } : {}),
    })),
    submitLabel: 'Send',
  } as Message;
}

/**
 * The `jobs` handle for the connector, when the site lets the assistant
 * create jobs. `added` collects what the server appends to the reply (the
 * form for missing details).
 */
export async function jobsHandle(ctx: RequestCtx, siteId: string, sessionId: string, added: Message[]): Promise<ConnectorContext<unknown>['jobs'] | undefined> {
  const db = dbFrom(ctx.env);
  if (!db) return undefined;
  const pipeline = await cachedPipeline(db, siteId, ctx.platform.now());
  if (!pipeline || !pipeline.assistantJobs) return undefined;
  const live = pipeline.fields.filter((f) => !f.archived);
  let created = false;
  return {
    itemSingular: pipeline.itemSingular,
    fields: live.map((f) => ({ name: f.name, label: f.label, type: f.type, required: f.required, options: f.options, question: f.question })),
    create: async (input) => {
      // One job per turn: a model calling the tool twice does not make two.
      if (created) return null;
      created = true;
      try {
        const row = await createJob(
          db,
          { siteId, title: input.title ?? null, details: input.summary ?? null, fields: input.fields, lenient: true, conversationId: sessionId, source: 'chat', actor: ASSISTANT },
          ctx.platform.now(),
        );
        const values = row.fields ? (JSON.parse(row.fields) as Record<string, string>) : {};
        const missing = missingFields(pipeline, values);
        if (missing.length) added.push(jobFormMessage(row, missing, pipeline));
        announceJob(ctx, siteId, 'job.created', jobView(row, pipeline, ctx.platform.now()));
        return { number: row.number, missing: missing.map((f) => f.label) };
      } catch {
        ctx.platform.log('jobs.create_failed', { siteId });
        return null;
      }
    },
  };
}

const parseAnswers = (value: string): Record<string, string> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
};

/**
 * The answers to a job's form (`job_<jobId>`): added to that job, if it is
 * this conversation's. Null when the form is not a job's.
 */
export async function completeJobForm(ctx: RequestCtx, siteId: string, sessionId: string, actionId: string, value: string): Promise<Message[] | null> {
  if (!actionId.startsWith(JOB_FORM_PREFIX)) return null;
  const db = dbFrom(ctx.env);
  if (!db) return null;
  const jobId = actionId.slice(JOB_FORM_PREFIX.length);
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ? AND site_id = ? AND conversation_id = ?').bind(jobId, siteId, sessionId).first<JobRow>();
  if (!job) return null;
  const now = ctx.platform.now();
  const pipeline = await cachedPipeline(db, siteId, now);
  if (!pipeline) return null;
  const answers = cleanFields(pipeline, parseAnswers(value), true);
  const current = job.fields ? (JSON.parse(job.fields) as Record<string, string>) : {};
  const next = { ...current, ...answers };
  const changed = Object.keys(answers).filter((k) => current[k] !== answers[k]);
  await db.batch([
    db.prepare('UPDATE jobs SET fields = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(next), now, job.id),
    ...changed.map((name) =>
      db
        .prepare('INSERT INTO job_events (id, job_id, at, actor, actor_name, kind, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(`evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, job.id, now, VISITOR.id, VISITOR.name, 'field', JSON.stringify({ field: name, label: pipeline.fields.find((f) => f.name === name)?.label ?? name, from: current[name] ?? null, to: next[name] })),
    ),
  ]);
  if (changed.length) {
    const contact = job.lead_id ? await db.prepare('SELECT name AS contact_name, email AS contact_email, phone AS contact_phone FROM leads WHERE id = ?').bind(job.lead_id).first<Record<string, string | null>>() : null;
    announceJob(ctx, siteId, 'job.updated', jobView({ ...job, fields: JSON.stringify(next), updated_at: now, contact_name: null, contact_email: null, contact_phone: null, ...(contact ?? {}) }, pipeline, now));
  }
  return [notice(`Thanks — that’s added to your request #${job.number}. The team will be in touch.`)];
}

/**
 * The quote questions' answers (a `job` flow): saved as a job, with the
 * contact from the contact questions, else the conversation's. Null when the
 * site has no quote questions (the action is refused like any unknown form).
 */
export async function submitQuote(ctx: RequestCtx, siteId: string, sessionId: string, value: string): Promise<{ messages: Message[]; contact: Record<string, string> } | null> {
  const db = dbFrom(ctx.env);
  if (!db || !(await readQuote(ctx.platform.kv, siteId))) return null;
  const now = ctx.platform.now();
  const pipeline = await cachedPipeline(db, siteId, now);
  if (!pipeline) return null;
  const answers = parseAnswers(value);
  const contact = {
    ...(answers[CONTACT_FIELDS.name] ? { name: answers[CONTACT_FIELDS.name] } : {}),
    ...(answers[CONTACT_FIELDS.email] ? { email: answers[CONTACT_FIELDS.email] } : {}),
    ...(answers[CONTACT_FIELDS.phone] ? { phone: answers[CONTACT_FIELDS.phone] } : {}),
  };
  const fields = Object.fromEntries(Object.entries(answers).filter(([k]) => !Object.values(CONTACT_FIELDS).includes(k as never)));
  const row = await createJob(
    db,
    {
      siteId,
      details: fields['description'] ?? null,
      fields,
      lenient: true,
      contact: Object.keys(contact).length ? contact : null,
      conversationId: sessionId,
      source: 'quote',
      actor: VISITOR,
    },
    now,
  );
  announceJob(ctx, siteId, 'job.created', jobView({ ...row, contact_name: contact.name ?? null, contact_email: contact.email ?? null, contact_phone: contact.phone ?? null }, pipeline, now));
  const first = contact.name?.split(/\s+/)[0];
  return {
    messages: [{ id: messageId('job'), ts: now, role: 'agent', type: 'text', text: `Thanks${first ? ` ${first}` : ''}! Your request is **#${row.number}**. The team will be in touch soon.` }],
    contact,
  };
}
