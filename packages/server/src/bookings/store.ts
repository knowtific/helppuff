import { cleanText } from '@helppuff/protocol';
import { HelpPuffError } from '../core/errors.js';
import type { D1Like } from '../db/d1.js';
import type { Interval } from './slots.js';

/**
 * Appointments: kept in D1 whichever calendar is synced. Each belongs to a
 * job, except `busy` time read from the synced calendar that matched no
 * contact. `slot_lock` (the start, while active) makes a time bookable once.
 */

export const APPOINTMENT_STATUSES = ['confirmed', 'pending', 'cancelled', 'completed', 'no_show', 'busy'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
/** What a person may set: `busy` and `pending` are the sync's and the booking's own. */
export const SETTABLE_STATUSES = ['confirmed', 'cancelled', 'completed', 'no_show'] as const;
export const APPOINTMENT_SOURCES = ['chat', 'dashboard', 'api', 'provider'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

/** Statuses that take up time. */
const ACTIVE = "('confirmed', 'pending', 'busy', 'completed', 'no_show')";

export type AppointmentRow = {
  id: string;
  site_id: string;
  job_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  title: string;
  starts_at: number;
  ends_at: number;
  timezone: string;
  location: string | null;
  status: AppointmentStatus;
  source: AppointmentSource;
  provider: string;
  external_id: string | null;
  attendee_name: string | null;
  attendee_email: string | null;
  attendee_phone: string | null;
  notes: string | null;
  meta: string | null;
  idem_key: string | null;
  slot_lock: string | null;
  reminded_at: number | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: number;
  updated_at: number;
  synced_at: number | null;
};

type Joined = AppointmentRow & { job_number?: number | null; job_title?: string | null; contact_name?: string | null; contact_email?: string | null };

export const newAppointmentId = () => `apt_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

const metaOf = (row: Pick<AppointmentRow, 'meta'>): Record<string, string> => {
  try {
    const parsed = row.meta ? (JSON.parse(row.meta) as unknown) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};

/** An appointment as the API answers it. */
export function appointmentView(row: Joined) {
  const meta = metaOf(row);
  return {
    id: row.id,
    title: row.title,
    start: row.starts_at,
    end: row.ends_at,
    startIso: new Date(row.starts_at).toISOString(),
    endIso: new Date(row.ends_at).toISOString(),
    timezone: row.timezone,
    status: row.status,
    source: row.source,
    provider: row.provider,
    externalId: row.external_id,
    location: row.location,
    notes: row.notes,
    attendee: row.attendee_name || row.attendee_email || row.attendee_phone ? { name: row.attendee_name, email: row.attendee_email, phone: row.attendee_phone } : null,
    job: row.job_id ? { id: row.job_id, number: row.job_number ?? null, title: row.job_title ?? null } : null,
    contact: row.lead_id ? { id: row.lead_id, name: row.contact_name ?? null, email: row.contact_email ?? null } : null,
    conversationId: row.conversation_id,
    rescheduleUrl: meta['reschedule_url'] ?? null,
    createdBy: row.created_by_name ?? row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
  };
}
export type AppointmentView = ReturnType<typeof appointmentView>;

const SELECT = `SELECT a.*, j.number AS job_number, j.title AS job_title, l.name AS contact_name, l.email AS contact_email
  FROM appointments a LEFT JOIN jobs j ON j.id = a.job_id LEFT JOIN leads l ON l.id = a.lead_id`;

export async function appointmentRow(db: D1Like, id: string): Promise<Joined | null> {
  return db.prepare(`${SELECT} WHERE a.id = ?`).bind(id).first<Joined>();
}

export async function requireAppointment(db: D1Like, id: string): Promise<Joined> {
  const row = await appointmentRow(db, id);
  if (!row) throw new HelpPuffError('not_found', { message: 'No such appointment.', detail: 'appointment_missing' });
  return row;
}

export type AppointmentFilter = { from?: number; to?: number; status?: string; job?: string; contact?: string; conversation?: string; limit?: number };

export async function listAppointments(db: D1Like, siteId: string, filter: AppointmentFilter): Promise<Joined[]> {
  const where = ['a.site_id = ?'];
  const binds: unknown[] = [siteId];
  if (filter.from !== undefined) {
    where.push('a.ends_at > ?');
    binds.push(filter.from);
  }
  if (filter.to !== undefined) {
    where.push('a.starts_at < ?');
    binds.push(filter.to);
  }
  if (filter.status === 'active') where.push(`a.status IN ${ACTIVE}`);
  else if (filter.status === 'appointments') where.push("a.status != 'busy'");
  else if (filter.status && filter.status !== 'all') {
    where.push('a.status = ?');
    binds.push(filter.status);
  }
  for (const [key, column] of [['job', 'job_id'], ['contact', 'lead_id'], ['conversation', 'conversation_id']] as const) {
    if (filter[key]) {
      where.push(`a.${column} = ?`);
      binds.push(filter[key]);
    }
  }
  const limit = Math.min(Math.max(filter.limit ?? 500, 1), 1000);
  return (await db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.starts_at LIMIT ${limit}`).bind(...binds).all<Joined>()).results;
}

/** Time HelpPuff already holds in a window: its appointments and the synced calendar's busy time. */
export async function heldTime(db: D1Like, siteId: string, window: Interval, except?: string): Promise<Interval[]> {
  const rows = (
    await db
      .prepare(`SELECT id, starts_at, ends_at FROM appointments WHERE site_id = ? AND status IN ${ACTIVE} AND ends_at > ? AND starts_at < ?`)
      .bind(siteId, window.start, window.end)
      .all<{ id: string; starts_at: number; ends_at: number }>()
  ).results;
  return rows.filter((r) => r.id !== except).map((r) => ({ start: r.starts_at, end: r.ends_at }));
}

export type NewAppointment = Omit<AppointmentRow, 'reminded_at' | 'synced_at' | 'created_at' | 'updated_at'> & { synced_at?: number | null };

/** Insert one. A clash on `slot_lock` (the time was just booked) or `idem_key` (the same booking again) answers null. */
export async function insertAppointment(db: D1Like, a: NewAppointment, now: number): Promise<AppointmentRow | null> {
  const result = (await db
    .prepare(
      `INSERT INTO appointments (id, site_id, job_id, lead_id, conversation_id, title, starts_at, ends_at, timezone, location, status, source, provider, external_id,
         attendee_name, attendee_email, attendee_phone, notes, meta, idem_key, slot_lock, created_by, created_by_name, created_at, updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .bind(
      a.id, a.site_id, a.job_id, a.lead_id, a.conversation_id, a.title, a.starts_at, a.ends_at, a.timezone, a.location, a.status, a.source, a.provider, a.external_id,
      a.attendee_name, a.attendee_email, a.attendee_phone, a.notes, a.meta, a.idem_key, a.slot_lock, a.created_by, a.created_by_name, now, now, a.synced_at ?? null,
    )
    .run()) as { meta?: { changes?: number }; changes?: number } | null;
  if ((result?.meta?.changes ?? result?.changes ?? 1) === 0) return null;
  return db.prepare('SELECT * FROM appointments WHERE id = ?').bind(a.id).first<AppointmentRow>();
}

export async function byIdem(db: D1Like, siteId: string, idem: string): Promise<AppointmentRow | null> {
  return db.prepare('SELECT * FROM appointments WHERE site_id = ? AND idem_key = ?').bind(siteId, idem).first<AppointmentRow>();
}

export type AppointmentPatch = Partial<Pick<AppointmentRow, 'title' | 'starts_at' | 'ends_at' | 'status' | 'location' | 'notes' | 'external_id' | 'job_id' | 'lead_id' | 'meta' | 'slot_lock' | 'synced_at' | 'reminded_at' | 'attendee_name' | 'attendee_email' | 'attendee_phone'>>;

export async function patchAppointment(db: D1Like, id: string, patch: AppointmentPatch, now: number): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  await db
    .prepare(`UPDATE appointments SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...entries.map(([, v]) => v), now, id)
    .run();
}

export async function deleteAppointment(db: D1Like, id: string): Promise<void> {
  await db.prepare('DELETE FROM appointments WHERE id = ?').bind(id).run();
}

/** A line of text a person typed, cleaned and capped; empty is null. */
export const line = (value: unknown, max: number): string | null => (typeof value === 'string' ? cleanText(value, 'line').trim().slice(0, max) || null : null);
export const block = (value: unknown, max: number): string | null => (typeof value === 'string' ? cleanText(value, 'input').trim().slice(0, max) || null : null);
