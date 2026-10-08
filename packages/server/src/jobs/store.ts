import { cleanText } from '@helppuff/protocol';
import { HelpPuffError } from '../core/errors.js';
import type { D1Like, D1Statement } from '../db/d1.js';
import { BASIC, FIELD_TYPES, templateById, type FieldType, type StageKind, type Template } from './templates.js';

/**
 * Jobs and the site's pipeline, over D1. One pipeline per site: its stages
 * and fields come from a template (`templates.ts`) and are then the owner's
 * to edit. Every change to a job is written to its history (`job_events`).
 * No webhooks or alerts here: the callers (routes, the chat) send those.
 */

export type Stage = { id: string; name: string; color: string; position: number; kind: StageKind; rotDays: number | null };
export type JobField = {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  question: string | null;
  position: number;
  inQuote: boolean;
  quotePosition: number | null;
  archived: boolean;
};
export type Pipeline = {
  siteId: string;
  template: string;
  itemSingular: string;
  itemPlural: string;
  chosenBy: 'ai' | 'owner' | 'default';
  reason: string | null;
  /** The assistant may create jobs from the chat (its `create_job` tool). */
  assistantJobs: boolean;
  /** The widget offers the quote questions ("Get a quote"), with this label. */
  quote: { enabled: boolean; label: string; askContact: boolean };
  editedAt: number | null;
  stages: Stage[];
  fields: JobField[];
};

export const DEFAULT_QUOTE_LABEL = 'Get a quote';

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const bad = (message: string, detail: string) => new HelpPuffError('bad_request', { message, detail });
const COLOR = /^#[0-9a-f]{6}$/i;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,40}$/;

// ------------------------------------------------------------------ pipeline

type StageRow = { id: string; name: string; color: string; position: number; kind: StageKind; rot_days: number | null };
type FieldRow = { id: string; name: string; label: string; type: FieldType; required: number; options: string | null; question: string | null; position: number; in_quote: number; quote_position: number | null; archived: number };

export async function readPipeline(db: D1Like, siteId: string): Promise<Pipeline | null> {
  const [row, stages, fields] = await Promise.all([
    db.prepare('SELECT * FROM pipelines WHERE site_id = ?').bind(siteId).first<{
      template: string;
      item_singular: string;
      item_plural: string;
      chosen_by: Pipeline['chosenBy'];
      reason: string | null;
      assistant_jobs: number;
      quote_enabled: number;
      quote_label: string | null;
      quote_contact: number;
      edited_at: number | null;
    }>(),
    db.prepare('SELECT id, name, color, position, kind, rot_days FROM pipeline_stages WHERE site_id = ? ORDER BY position').bind(siteId).all<StageRow>(),
    db.prepare('SELECT * FROM job_fields WHERE site_id = ? ORDER BY position').bind(siteId).all<FieldRow>(),
  ]);
  if (!row) return null;
  return {
    siteId,
    template: row.template,
    itemSingular: row.item_singular,
    itemPlural: row.item_plural,
    chosenBy: row.chosen_by,
    reason: row.reason,
    assistantJobs: Boolean(row.assistant_jobs),
    quote: { enabled: Boolean(row.quote_enabled), label: row.quote_label ?? DEFAULT_QUOTE_LABEL, askContact: Boolean(row.quote_contact) },
    editedAt: row.edited_at,
    stages: stages.results.map((s) => ({ id: s.id, name: s.name, color: s.color, position: s.position, kind: s.kind, rotDays: s.rot_days })),
    fields: fields.results.map((f) => ({
      id: f.id,
      name: f.name,
      label: f.label,
      type: f.type,
      required: Boolean(f.required),
      options: f.options ? (JSON.parse(f.options) as string[]) : [],
      question: f.question,
      position: f.position,
      inQuote: Boolean(f.in_quote),
      quotePosition: f.quote_position,
      archived: Boolean(f.archived),
    })),
  };
}

/** The site's pipeline, made from the basic template the first time it is needed. */
export async function ensurePipeline(db: D1Like, siteId: string, now: number): Promise<Pipeline> {
  const found = await readPipeline(db, siteId);
  if (found) return found;
  await applyTemplate(db, siteId, templateById(BASIC)!, { chosenBy: 'default', reason: null }, now);
  return (await readPipeline(db, siteId))!;
}

/**
 * Make the pipeline from a template (or a customised copy of one). Stages are
 * replaced; jobs keep their place by kind and order (the 2nd open stage's jobs
 * go to the new 2nd open stage, won to won, lost to lost). Fields with a name
 * the template has are updated, others archived: jobs keep their values.
 */
export async function applyTemplate(db: D1Like, siteId: string, template: Template, meta: { chosenBy: Pipeline['chosenBy']; reason: string | null }, now: number): Promise<void> {
  validateTemplate(template);
  const current = await readPipeline(db, siteId);
  const stages = template.stages.map((s, position) => ({ ...s, id: id('stg'), position }));
  const statements: D1Statement[] = [
    db
      .prepare(
        `INSERT INTO pipelines (site_id, template, chosen_by, reason, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (site_id) DO UPDATE SET template = excluded.template, chosen_by = excluded.chosen_by, reason = excluded.reason, updated_at = excluded.updated_at,
           edited_at = CASE WHEN excluded.chosen_by = 'owner' THEN excluded.updated_at ELSE pipelines.edited_at END`,
      )
      .bind(siteId, template.id, meta.chosenBy, meta.reason, now),
    ...stages.map((s) => db.prepare('INSERT INTO pipeline_stages (id, site_id, name, color, position, kind, rot_days) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(s.id, siteId, s.name, s.color, s.position, s.kind, s.rotDays ?? null)),
  ];
  // Jobs follow their stage's kind and order.
  if (current) {
    for (const kind of ['open', 'won', 'lost'] as const) {
      const before = current.stages.filter((s) => s.kind === kind);
      const after = stages.filter((s) => s.kind === kind);
      before.forEach((old, index) => {
        const target = after[Math.min(index, after.length - 1)]!;
        statements.push(db.prepare('UPDATE jobs SET stage_id = ? WHERE site_id = ? AND stage_id = ?').bind(target.id, siteId, old.id));
      });
    }
    statements.push(db.prepare(`DELETE FROM pipeline_stages WHERE site_id = ? AND id NOT IN (${stages.map(() => '?').join(', ')})`).bind(siteId, ...stages.map((s) => s.id)));
  }
  const names = new Set(template.fields.map((f) => f.name));
  template.fields.forEach((f, position) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO job_fields (id, site_id, name, label, type, required, options, question, position, in_quote, quote_position, archived)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT (site_id, name) DO UPDATE SET label = excluded.label, type = excluded.type, required = excluded.required, options = excluded.options,
             question = excluded.question, position = excluded.position, in_quote = excluded.in_quote, quote_position = excluded.quote_position, archived = 0`,
        )
        .bind(id('fld'), siteId, f.name, f.label, f.type, f.required ? 1 : 0, f.options?.length ? JSON.stringify(f.options) : null, f.question, position, f.quote ? 1 : 0, f.quote ? position : null),
    );
  });
  for (const field of current?.fields ?? []) {
    if (!names.has(field.name)) statements.push(db.prepare('UPDATE job_fields SET archived = 1, in_quote = 0 WHERE id = ?').bind(field.id));
  }
  await db.batch(statements);
}

export function validateTemplate(template: Pick<Template, 'stages' | 'fields'>): void {
  if (!template.stages.some((s) => s.kind === 'open')) throw bad('Keep at least one open stage.', 'pipeline_no_open');
  if (!template.stages.some((s) => s.kind === 'won')) throw bad('Keep at least one won stage (the job went ahead).', 'pipeline_no_won');
  if (!template.stages.some((s) => s.kind === 'lost')) throw bad('Keep at least one lost stage.', 'pipeline_no_lost');
  if (template.stages.length > 20) throw bad('At most 20 stages.', 'pipeline_too_many_stages');
  if (template.fields.length > 40) throw bad('At most 40 fields.', 'pipeline_too_many_fields');
  const names = new Set<string>();
  for (const f of template.fields) {
    if (!FIELD_NAME.test(f.name)) throw bad(`Field "${f.name}": lowercase letters, digits and _.`, 'pipeline_field_name');
    if (names.has(f.name)) throw bad(`Two fields are called "${f.name}".`, 'pipeline_field_twice');
    names.add(f.name);
    if (!(FIELD_TYPES as readonly string[]).includes(f.type)) throw bad(`Field "${f.name}": unknown type.`, 'pipeline_field_type');
  }
}

export type StageInput = { id?: string; name: string; color?: string; kind: StageKind; rotDays?: number | null };
export type FieldInput = { id?: string; name?: string; label: string; type: FieldType; required?: boolean; options?: string[]; question?: string | null; inQuote?: boolean };

/** A label as a field name: "Preferred date" → `preferred_date`. */
export const fieldName = (label: string) =>
  label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'f_$1')
    .slice(0, 40) || 'field';

/**
 * The owner edits the pipeline. `stages` and `fields` are the whole lists in
 * order (missing stages are removed, their jobs moved to `moveTo[stageId]` or
 * the first stage of the same kind; missing fields are archived). `quote` is
 * the quote questions: field names, in order.
 */
export async function savePipeline(
  db: D1Like,
  siteId: string,
  patch: {
    itemSingular?: string;
    itemPlural?: string;
    stages?: StageInput[];
    fields?: FieldInput[];
    quote?: string[];
    quoteEnabled?: boolean;
    quoteLabel?: string;
    quoteContact?: boolean;
    assistantJobs?: boolean;
    moveTo?: Record<string, string>;
  },
  now: number,
): Promise<Pipeline> {
  const current = await ensurePipeline(db, siteId, now);
  const statements: D1Statement[] = [];
  const line = (value: unknown, max: number) => (typeof value === 'string' ? cleanText(value, 'line').trim().slice(0, max) : '');

  if (patch.itemSingular !== undefined || patch.itemPlural !== undefined) {
    const singular = line(patch.itemSingular ?? current.itemSingular, 30) || 'Job';
    const plural = line(patch.itemPlural ?? current.itemPlural, 30) || `${singular}s`;
    statements.push(db.prepare('UPDATE pipelines SET item_singular = ?, item_plural = ? WHERE site_id = ?').bind(singular, plural, siteId));
  }

  if (patch.quoteEnabled !== undefined || patch.quoteLabel !== undefined || patch.quoteContact !== undefined || patch.assistantJobs !== undefined) {
    statements.push(
      db
        .prepare('UPDATE pipelines SET quote_enabled = ?, quote_label = ?, quote_contact = ?, assistant_jobs = ? WHERE site_id = ?')
        .bind(
          (patch.quoteEnabled ?? current.quote.enabled) ? 1 : 0,
          line(patch.quoteLabel ?? current.quote.label, 40) || DEFAULT_QUOTE_LABEL,
          (patch.quoteContact ?? current.quote.askContact) ? 1 : 0,
          (patch.assistantJobs ?? current.assistantJobs) ? 1 : 0,
          siteId,
        ),
    );
  }

  if (patch.stages) {
    const stages = patch.stages.map((s, position) => {
      const name = line(s.name, 40);
      if (!name) throw bad('Every stage needs a name.', 'pipeline_stage_name');
      if (!['open', 'won', 'lost'].includes(s.kind)) throw bad(`Stage "${name}": its kind is open, won or lost.`, 'pipeline_stage_kind');
      const known = s.id ? current.stages.find((c) => c.id === s.id) : undefined;
      if (s.id && !known) throw bad(`No stage ${s.id}.`, 'pipeline_stage_unknown');
      const rot = s.rotDays === null || s.rotDays === undefined ? null : Math.max(1, Math.min(365, Math.round(Number(s.rotDays))));
      return { id: known?.id ?? id('stg'), name, color: s.color && COLOR.test(s.color) ? s.color.toLowerCase() : (known?.color ?? '#6b7280'), position, kind: s.kind, rotDays: Number.isFinite(rot) ? rot : null };
    });
    validateTemplate({ stages: stages.map((s) => ({ ...s, rotDays: s.rotDays ?? undefined })), fields: [] });
    const kept = new Set(stages.map((s) => s.id));
    for (const gone of current.stages.filter((s) => !kept.has(s.id))) {
      const target = patch.moveTo?.[gone.id] && kept.has(patch.moveTo[gone.id]!) ? patch.moveTo[gone.id]! : stages.find((s) => s.kind === gone.kind)!.id;
      statements.push(db.prepare('UPDATE jobs SET stage_id = ? WHERE site_id = ? AND stage_id = ?').bind(target, siteId, gone.id));
      statements.push(db.prepare('DELETE FROM pipeline_stages WHERE id = ?').bind(gone.id));
    }
    for (const s of stages) {
      statements.push(
        db
          .prepare(
            `INSERT INTO pipeline_stages (id, site_id, name, color, position, kind, rot_days) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color, position = excluded.position, kind = excluded.kind, rot_days = excluded.rot_days`,
          )
          .bind(s.id, siteId, s.name, s.color, s.position, s.kind, s.rotDays),
      );
    }
  }

  let fieldNames = current.fields.filter((f) => !f.archived).map((f) => f.name);
  if (patch.fields) {
    const used = new Set<string>();
    const fields = patch.fields.map((f, position) => {
      const label = line(f.label, 60);
      if (!label) throw bad('Every field needs a label.', 'pipeline_field_label');
      const known = f.id ? current.fields.find((c) => c.id === f.id) : undefined;
      if (f.id && !known) throw bad(`No field ${f.id}.`, 'pipeline_field_unknown');
      let name = known?.name ?? (f.name && FIELD_NAME.test(f.name) ? f.name : fieldName(label));
      // A new field never takes over an archived one's name (its old values stay its own).
      if (!known) while (current.fields.some((c) => c.name === name) || used.has(name)) name = `${name.slice(0, 36)}_${Math.floor(Math.random() * 90 + 10)}`;
      used.add(name);
      if (!(FIELD_TYPES as readonly string[]).includes(f.type)) throw bad(`Field "${label}": unknown type.`, 'pipeline_field_type');
      const options = f.type === 'select' ? [...new Set((f.options ?? []).map((o) => line(o, 80)).filter(Boolean))].slice(0, 50) : [];
      return { id: known?.id ?? id('fld'), name, label, type: f.type, required: Boolean(f.required), options, question: line(f.question, 200) || null, position, inQuote: f.inQuote };
    });
    if (fields.length > 40) throw bad('At most 40 fields.', 'pipeline_too_many_fields');
    const kept = new Set(fields.map((f) => f.id));
    for (const gone of current.fields.filter((f) => !kept.has(f.id) && !f.archived)) {
      statements.push(db.prepare('UPDATE job_fields SET archived = 1, in_quote = 0 WHERE id = ?').bind(gone.id));
    }
    for (const f of fields) {
      statements.push(
        db
          .prepare(
            `INSERT INTO job_fields (id, site_id, name, label, type, required, options, question, position, in_quote, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
             ON CONFLICT (site_id, name) DO UPDATE SET label = excluded.label, type = excluded.type, required = excluded.required, options = excluded.options,
               question = excluded.question, position = excluded.position, archived = 0${f.inQuote === undefined ? '' : ', in_quote = excluded.in_quote'}`,
          )
          .bind(f.id, siteId, f.name, f.label, f.type, f.required ? 1 : 0, f.options.length ? JSON.stringify(f.options) : null, f.question, f.position, f.inQuote ? 1 : 0),
      );
    }
    fieldNames = fields.map((f) => f.name);
  }

  if (patch.quote) {
    const quote = [...new Set(patch.quote)].filter((name) => fieldNames.includes(name)).slice(0, 10);
    statements.push(db.prepare('UPDATE job_fields SET in_quote = 0, quote_position = NULL WHERE site_id = ?').bind(siteId));
    quote.forEach((name, position) => statements.push(db.prepare('UPDATE job_fields SET in_quote = 1, quote_position = ? WHERE site_id = ? AND name = ?').bind(position, siteId, name)));
  }

  statements.push(db.prepare("UPDATE pipelines SET chosen_by = 'owner', edited_at = ?, updated_at = ? WHERE site_id = ?").bind(now, now, siteId));
  await db.batch(statements);
  return (await readPipeline(db, siteId))!;
}

/** The quote questions, in order: the fields marked for them, live (not archived). */
export function quoteFields(pipeline: Pipeline): JobField[] {
  return pipeline.fields
    .filter((f) => f.inQuote && !f.archived)
    .sort((a, b) => (a.quotePosition ?? a.position) - (b.quotePosition ?? b.position));
}

// --------------------------------------------------------------------- jobs

export type Actor = { id: string; name: string | null };
export type JobRow = {
  id: string;
  site_id: string;
  number: number;
  stage_id: string;
  title: string;
  details: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  source: string;
  fields: string | null;
  value_cents: number | null;
  currency: string | null;
  due_at: number | null;
  assigned_to: string | null;
  assigned_name: string | null;
  position: number;
  stage_changed_at: number;
  closed_at: number | null;
  lost_reason: string | null;
  created_at: number;
  updated_at: number;
};

export const JOB_SOURCES = ['chat', 'quote', 'api', 'manual', 'callback'] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

/**
 * Field values, checked against the pipeline's fields: known names only
 * (unless `lenient`, which drops the rest, for the chat), strings cleaned and
 * capped, numbers and dates as given, select values one of the options
 * (when the field has any).
 */
export function cleanFields(pipeline: Pipeline, input: unknown, lenient: boolean): Record<string, string> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw bad('Fields are an object of values by field name.', 'job_fields_invalid');
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
    const field = pipeline.fields.find((f) => f.name === name && !f.archived);
    if (!field) {
      if (lenient) continue;
      throw bad(`No field "${name.slice(0, 40)}". The fields are: ${pipeline.fields.filter((f) => !f.archived).map((f) => f.name).join(', ')}.`, 'job_field_unknown');
    }
    if (raw === null || raw === '') continue;
    const text = cleanText(String(raw), field.type === 'textarea' ? 'input' : 'line').trim().slice(0, field.type === 'textarea' ? 4000 : 500);
    if (!text) continue;
    if (field.type === 'number' && !Number.isFinite(Number(text))) {
      if (lenient) continue;
      throw bad(`Field "${name}" is a number.`, 'job_field_number');
    }
    if (field.type === 'select' && field.options.length && !field.options.includes(text)) {
      // A close answer from a person or the AI still counts: matched without case.
      const match = field.options.find((o) => o.toLowerCase() === text.toLowerCase());
      if (match) out[name] = match;
      else if (lenient) out[name] = text;
      else throw bad(`Field "${name}" is one of: ${field.options.join(', ')}.`, 'job_field_option');
      continue;
    }
    out[name] = text;
  }
  return out;
}

/** The fields a job still needs: required, live, and empty. */
export const missingFields = (pipeline: Pipeline, values: Record<string, string>) => pipeline.fields.filter((f) => f.required && !f.archived && !values[f.name]);

/** A job's title when none is given: what the request is about, else who it is from. */
export function titleFor(pipeline: Pipeline, values: Record<string, string>, contactName: string | null): string {
  const about = ['service', 'project_type', 'product', 'product_area', 'use_case', 'description'].map((name) => values[name]).find(Boolean);
  const first = about?.split(/[.\n]/)[0]?.trim().slice(0, 80);
  const who = contactName ? ` for ${contactName}` : '';
  return first ? `${first}${who}` : contactName ? `${pipeline.itemSingular} from ${contactName}` : `New ${pipeline.itemSingular.toLowerCase()}`;
}

/**
 * The contact for a job: given, the conversation's, or matched by email then
 * phone, else created. An unverified source fills details in, never
 * overwrites them (the rule leads follow everywhere).
 */
async function contactFor(db: D1Like, siteId: string, input: { leadId?: string | null; conversationId?: string | null; contact?: { name?: string; email?: string; phone?: string } | null; source: JobSource }, now: number): Promise<{ id: string | null; name: string | null }> {
  if (input.leadId) {
    const row = await db.prepare('SELECT id, name, email FROM leads WHERE id = ? AND site_id = ?').bind(input.leadId, siteId).first<{ id: string; name: string | null; email: string | null }>();
    if (!row) throw new HelpPuffError('not_found', { message: 'No such contact.', detail: 'job_contact_missing' });
    return { id: row.id, name: row.name ?? row.email };
  }
  // The conversation's own contact (its lead form, or one recorded with it).
  const own = input.conversationId
    ? await db
        .prepare('SELECT l.id, l.name, l.email FROM leads l WHERE l.id = (SELECT lead_id FROM conversations WHERE id = ?) OR l.conversation_id = ? LIMIT 1')
        .bind(input.conversationId, input.conversationId)
        .first<{ id: string; name: string | null; email: string | null }>()
    : null;
  if (own && !input.contact) return { id: own.id, name: own.name ?? own.email };
  const contact = input.contact ?? {};
  const email = contact.email ? cleanText(contact.email, 'line').trim().toLowerCase().slice(0, 200) : null;
  const phone = contact.phone ? cleanText(contact.phone, 'line').trim().slice(0, 40) : null;
  const name = contact.name ? cleanText(contact.name, 'line').trim().slice(0, 200) : null;
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(email)) throw bad('Check contact.email: not an email address.', 'job_contact_email');
  if (!email && !phone && !name) return own ? { id: own.id, name: own.name ?? own.email } : { id: null, name: null };
  const fillIn = async (lead: { id: string; name: string | null }) => {
    await db
      .prepare('UPDATE leads SET name = COALESCE(name, ?), phone = COALESCE(phone, ?), email = COALESCE(email, ?), updated_at = ? WHERE id = ?')
      .bind(name, phone, email, now, lead.id)
      .run();
    if (input.conversationId) await db.prepare('UPDATE conversations SET lead_id = COALESCE(lead_id, ?) WHERE id = ?').bind(lead.id, input.conversationId).run();
    return { id: lead.id, name: lead.name ?? name ?? email };
  };
  const byEmail = email ? await db.prepare('SELECT id, name FROM leads WHERE site_id = ? AND email = ?').bind(siteId, email).first<{ id: string; name: string | null }>() : null;
  if (byEmail) return fillIn(byEmail);
  // Not someone else's email: this conversation's contact, with what was missing filled in.
  if (own && (!email || !own.email || own.email === email)) return fillIn(own);
  const byPhone = !email && phone ? await db.prepare('SELECT id, name FROM leads WHERE site_id = ? AND phone = ? ORDER BY created_at LIMIT 1').bind(siteId, phone).first<{ id: string; name: string | null }>() : null;
  if (byPhone) return fillIn(byPhone);
  const leadId = `lead_${crypto.randomUUID()}`;
  // The conversation's lead is the one with its id; another contact for the same chat is kept without it.
  const done = (await db
    .prepare(
      `INSERT INTO leads (id, site_id, conversation_id, name, email, phone, source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?) ON CONFLICT DO NOTHING`,
    )
    .bind(leadId, siteId, own ? null : (input.conversationId ?? null), name, email, phone, input.source === 'api' ? 'api' : 'form', now, now)
    .run()) as { meta?: { changes?: number }; changes?: number } | null;
  if ((done?.meta?.changes ?? done?.changes ?? 1) === 0) {
    // Written meanwhile (the chat's own recording, or the same email at once): that one.
    const raced = await db
      .prepare('SELECT id, name FROM leads WHERE (site_id = ? AND email = ?) OR conversation_id = ? LIMIT 1')
      .bind(siteId, email, input.conversationId ?? null)
      .first<{ id: string; name: string | null }>();
    if (raced) return fillIn(raced);
  }
  if (input.conversationId && !own) await db.prepare('UPDATE conversations SET lead_id = COALESCE(lead_id, ?) WHERE id = ?').bind(leadId, input.conversationId).run();
  return { id: leadId, name: name ?? email ?? phone };
}

export type CreateJob = {
  siteId: string;
  title?: string | null;
  details?: string | null;
  fields?: unknown;
  lenient?: boolean;
  contact?: { name?: string; email?: string; phone?: string } | null;
  leadId?: string | null;
  conversationId?: string | null;
  source: JobSource;
  stageId?: string | null;
  valueCents?: number | null;
  currency?: string | null;
  dueAt?: number | null;
  assignedTo?: Actor | null;
  actor: Actor;
};

export async function createJob(db: D1Like, input: CreateJob, now: number): Promise<JobRow> {
  const pipeline = await ensurePipeline(db, input.siteId, now);
  const values = cleanFields(pipeline, input.fields, Boolean(input.lenient));
  const stage = input.stageId ? pipeline.stages.find((s) => s.id === input.stageId) : pipeline.stages.find((s) => s.kind === 'open');
  if (!stage) throw bad(`No stage ${String(input.stageId)}.`, 'job_stage_unknown');
  const contact = await contactFor(db, input.siteId, input, now);
  const title = (input.title ? cleanText(input.title, 'line').trim().slice(0, 160) : '') || titleFor(pipeline, values, contact.name);
  const details = input.details ? cleanText(input.details, 'input').trim().slice(0, 10_000) || null : null;
  const jobId = id('job');
  const closed = stage.kind === 'open' ? null : now;
  await db.batch([
    db
      .prepare(
        `INSERT INTO jobs (id, site_id, number, stage_id, title, details, lead_id, conversation_id, source, fields, value_cents, currency, due_at,
           assigned_to, assigned_name, position, stage_changed_at, closed_at, created_at, updated_at)
         SELECT ?, ?, COALESCE(MAX(number), 1000) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           COALESCE((SELECT MIN(position) FROM jobs WHERE site_id = ? AND stage_id = ?), 1) - 1, ?, ?, ?, ?
         FROM jobs WHERE site_id = ?`,
      )
      .bind(
        jobId,
        input.siteId,
        stage.id,
        title,
        details,
        contact.id,
        input.conversationId ?? null,
        input.source,
        Object.keys(values).length ? JSON.stringify(values) : null,
        input.valueCents ?? null,
        input.currency ?? null,
        input.dueAt ?? null,
        input.assignedTo?.id ?? null,
        input.assignedTo?.name ?? null,
        input.siteId,
        stage.id,
        now,
        closed,
        now,
        now,
        input.siteId,
      ),
    eventStatement(db, jobId, now, input.actor, 'created', { source: input.source, stage: stage.name }),
  ]);
  return (await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first<JobRow>())!;
}

function eventStatement(db: D1Like, jobId: string, at: number, actor: Actor, kind: string, data: Record<string, unknown>): D1Statement {
  return db.prepare('INSERT INTO job_events (id, job_id, at, actor, actor_name, kind, data) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id('evt'), jobId, at, actor.id, actor.name, kind, JSON.stringify(data));
}

export async function jobRow(db: D1Like, jobId: string): Promise<JobRow> {
  const row = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first<JobRow>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such job.', detail: 'job_missing' });
  return row;
}

export type JobPatch = {
  title?: string;
  details?: string | null;
  fields?: unknown;
  valueCents?: number | null;
  currency?: string | null;
  dueAt?: number | null;
  assignedTo?: Actor | null;
};

/** Change a job: each change is a history event (field changes say old → new). */
export async function updateJob(db: D1Like, job: JobRow, patch: JobPatch, actor: Actor, now: number): Promise<JobRow> {
  const pipeline = await ensurePipeline(db, job.site_id, now);
  const sets: string[] = [];
  const params: unknown[] = [];
  const events: D1Statement[] = [];
  if (patch.title !== undefined) {
    const title = cleanText(patch.title, 'line').trim().slice(0, 160);
    if (!title) throw bad('The title cannot be empty.', 'job_title_empty');
    if (title !== job.title) {
      sets.push('title = ?');
      params.push(title);
      events.push(eventStatement(db, job.id, now, actor, 'edited', { field: 'title', from: job.title, to: title }));
    }
  }
  if (patch.details !== undefined) {
    const details = patch.details ? cleanText(patch.details, 'input').trim().slice(0, 10_000) || null : null;
    if (details !== job.details) {
      sets.push('details = ?');
      params.push(details);
      events.push(eventStatement(db, job.id, now, actor, 'edited', { field: 'details' }));
    }
  }
  if (patch.fields !== undefined) {
    const current = job.fields ? (JSON.parse(job.fields) as Record<string, string>) : {};
    const changes = cleanFields(pipeline, patch.fields, false);
    // Null or "" removes a value.
    const removed = Object.entries(patch.fields as Record<string, unknown>).filter(([, v]) => v === null || v === '').map(([k]) => k);
    const next = { ...current, ...changes };
    for (const key of removed) delete next[key];
    for (const key of new Set([...Object.keys(changes), ...removed])) {
      if ((current[key] ?? null) !== (next[key] ?? null)) {
        const label = pipeline.fields.find((f) => f.name === key)?.label ?? key;
        events.push(eventStatement(db, job.id, now, actor, 'field', { field: key, label, from: current[key] ?? null, to: next[key] ?? null }));
      }
    }
    sets.push('fields = ?');
    params.push(Object.keys(next).length ? JSON.stringify(next) : null);
  }
  if (patch.valueCents !== undefined && patch.valueCents !== job.value_cents) {
    if (patch.valueCents !== null && (!Number.isInteger(patch.valueCents) || patch.valueCents < 0)) throw bad('The value is a whole number of cents, 0 or more.', 'job_value');
    sets.push('value_cents = ?');
    params.push(patch.valueCents);
    events.push(eventStatement(db, job.id, now, actor, 'value', { from: job.value_cents, to: patch.valueCents }));
  }
  if (patch.currency !== undefined) {
    sets.push('currency = ?');
    params.push(patch.currency && /^[A-Z]{3}$/.test(patch.currency) ? patch.currency : null);
  }
  if (patch.dueAt !== undefined && patch.dueAt !== job.due_at) {
    sets.push('due_at = ?');
    params.push(patch.dueAt);
    events.push(eventStatement(db, job.id, now, actor, 'edited', { field: 'due', from: job.due_at, to: patch.dueAt }));
  }
  if (patch.assignedTo !== undefined && (patch.assignedTo?.id ?? null) !== job.assigned_to) {
    sets.push('assigned_to = ?', 'assigned_name = ?');
    params.push(patch.assignedTo?.id ?? null, patch.assignedTo?.name ?? null);
    events.push(eventStatement(db, job.id, now, actor, 'assigned', { to: patch.assignedTo?.id ?? null, name: patch.assignedTo?.name ?? null }));
  }
  if (!sets.length) return job;
  await db.batch([db.prepare(`UPDATE jobs SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, now, job.id), ...events]);
  return jobRow(db, job.id);
}

/**
 * Move a job: another stage (a history event; into won or lost closes it, and
 * a won job's contact becomes won), and/or another place in its column
 * (`before`: the job it now sits above; none: the bottom).
 */
export async function moveJob(
  db: D1Like,
  job: JobRow,
  input: { stageId?: string; before?: string | null; lostReason?: string | null },
  actor: Actor,
  now: number,
): Promise<{ job: JobRow; from: Stage; to: Stage }> {
  const pipeline = await ensurePipeline(db, job.site_id, now);
  const from = pipeline.stages.find((s) => s.id === job.stage_id) ?? pipeline.stages[0]!;
  const to = input.stageId ? pipeline.stages.find((s) => s.id === input.stageId) : from;
  if (!to) throw bad(`No stage ${String(input.stageId)}.`, 'job_stage_unknown');
  let position = job.position;
  if (input.before !== undefined || to.id !== from.id) {
    const column = (
      await db.prepare('SELECT id, position FROM jobs WHERE site_id = ? AND stage_id = ? AND id != ? ORDER BY position').bind(job.site_id, to.id, job.id).all<{ id: string; position: number }>()
    ).results;
    const at = input.before ? column.findIndex((j) => j.id === input.before) : -1;
    if (at === -1) position = (column.at(-1)?.position ?? 0) + 1;
    else position = at === 0 ? column[0]!.position - 1 : (column[at - 1]!.position + column[at]!.position) / 2;
  }
  const statements: D1Statement[] = [];
  if (to.id !== from.id) {
    const reason = to.kind === 'lost' && input.lostReason ? cleanText(input.lostReason, 'line').trim().slice(0, 200) || null : null;
    statements.push(
      db
        .prepare('UPDATE jobs SET stage_id = ?, position = ?, stage_changed_at = ?, closed_at = ?, lost_reason = ?, updated_at = ? WHERE id = ?')
        .bind(to.id, position, now, to.kind === 'open' ? null : now, reason, now, job.id),
      eventStatement(db, job.id, now, actor, 'stage', { from: from.name, to: to.name, kind: to.kind, ...(reason ? { reason } : {}) }),
    );
    if (to.kind === 'won' && job.lead_id) statements.push(db.prepare("UPDATE leads SET status = 'won', updated_at = ? WHERE id = ?").bind(now, job.lead_id));
  } else {
    statements.push(db.prepare('UPDATE jobs SET position = ? WHERE id = ?').bind(position, job.id));
  }
  await db.batch(statements);
  return { job: await jobRow(db, job.id), from, to };
}

/** An update to the details, kept in the history (the original details stay). */
export async function addUpdate(db: D1Like, job: JobRow, text: string, actor: Actor, now: number): Promise<void> {
  const clean = cleanText(text, 'input').trim().slice(0, 4000);
  if (!clean) throw bad('Write the update first.', 'job_update_empty');
  await db.batch([eventStatement(db, job.id, now, actor, 'update', { text: clean }), db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').bind(now, job.id)]);
}

export async function deleteJob(db: D1Like, job: JobRow): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM job_events WHERE job_id = ?').bind(job.id),
    db.prepare('DELETE FROM notes WHERE job_id = ?').bind(job.id),
    db.prepare('DELETE FROM jobs WHERE id = ?').bind(job.id),
  ]);
}

/** A job as the API answers it: fields parsed, the stage named, the contact's name. */
export function jobView(row: JobRow & { contact_name?: string | null; contact_email?: string | null; contact_phone?: string | null }, pipeline: Pipeline, now: number) {
  const stage = pipeline.stages.find((s) => s.id === row.stage_id);
  const stale = stage?.kind === 'open' && stage.rotDays ? now - row.stage_changed_at > stage.rotDays * 86_400_000 : false;
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    details: row.details,
    stage: stage ? { id: stage.id, name: stage.name, kind: stage.kind } : null,
    status: stage?.kind ?? 'open',
    fields: row.fields ? (JSON.parse(row.fields) as Record<string, string>) : {},
    contact: row.lead_id ? { id: row.lead_id, name: row.contact_name ?? null, email: row.contact_email ?? null, phone: row.contact_phone ?? null } : null,
    conversationId: row.conversation_id,
    source: row.source,
    value: row.value_cents === null ? null : row.value_cents / 100,
    valueCents: row.value_cents,
    currency: row.currency,
    dueAt: row.due_at,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name,
    position: row.position,
    stale,
    stageChangedAt: row.stage_changed_at,
    closedAt: row.closed_at,
    lostReason: row.lost_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
