import type { WebhookEventType } from '@helppuff/protocol';
import type { BookingsConfig, SiteConfig } from '../config/schema.js';
import { HelpPuffError } from '../core/errors.js';
import type { D1Like } from '../db/d1.js';
import { createJob, ensurePipeline, jobView, type Actor, type JobRow } from '../jobs/store.js';
import { calcomCalendar } from '../integrations/calcom.js';
import { calendlyCalendar } from '../integrations/calendly.js';
import { composioClient, googleCalendar, outlookCalendar } from '../integrations/composio.js';
import { ProviderError, type Fetcher } from '../integrations/http.js';
import { markIntegration, openIntegration, type IntegrationKind } from '../integrations/store.js';
import { isRedirect, type Attendee, type Calendar, type ExternalEvent, type Redirect } from './calendar.js';
import { makeSlots, type Interval } from './slots.js';
import {
  appointmentRow,
  appointmentView,
  byIdem,
  heldTime,
  insertAppointment,
  newAppointmentId,
  patchAppointment,
  type AppointmentRow,
  type AppointmentSource,
  type AppointmentView,
} from './store.js';
import { validTimeZone } from './time.js';

/**
 * Bookings: free times, booking, moving, cancelling and the two-way sync,
 * the same for the widget's picker, the dashboard, the API and the cron.
 * HelpPuff always keeps the appointment; a synced calendar is written first
 * (saved here only when it succeeded) and is the source of truth for times.
 */

export type BookingDeps = {
  db: D1Like;
  /** HELPPUFF_SECRET: opens the integration keys. */
  secret: string;
  fetch: Fetcher;
  now: () => number;
  log: (event: string, data?: object) => void;
  emit: (type: WebhookEventType, data: Record<string, unknown>) => void;
  /** A job the booking made: the team's alert and `job.created`. */
  jobCreated?: (job: ReturnType<typeof jobView>) => void;
};

export type Bookings = BookingsConfig & { timezone: string };

/** The site's bookings settings, with the time zone settled: its own, the assistant's, else UTC. */
export function bookingsOf(site: Pick<SiteConfig, 'bookings' | 'connector'>): Bookings {
  const b = site.bookings;
  const assistantZone = (site.connector.options as { timezone?: unknown } | undefined)?.timezone;
  const timezone = validTimeZone(b.timezone) ? b.timezone : validTimeZone(assistantZone) ? assistantZone : 'UTC';
  return { ...b, timezone };
}

const NOT_CONNECTED: Record<Exclude<BookingsConfig['sync'], 'none'>, string> = {
  calcom: 'Connect Cal.com in Settings → Integrations first.',
  calendly: 'Connect Calendly in Settings → Integrations first.',
  google: 'Connect Composio in Settings → Integrations, then a Google Calendar account.',
  outlook: 'Connect Composio in Settings → Integrations, then an Outlook account.',
};

const INTEGRATION_OF: Record<Exclude<BookingsConfig['sync'], 'none'>, IntegrationKind> = { calcom: 'calcom', calendly: 'calendly', google: 'composio', outlook: 'composio' };

/** The synced calendar, or null when HelpPuff keeps the appointments alone. */
export async function calendarFor(deps: Pick<BookingDeps, 'db' | 'secret' | 'fetch' | 'now'>, siteId: string, b: BookingsConfig): Promise<Calendar | null> {
  if (b.sync === 'none') return null;
  const integration = await openIntegration(deps.db, deps.secret, siteId, INTEGRATION_OF[b.sync]);
  if (!integration) throw new HelpPuffError('bad_request', { message: NOT_CONNECTED[b.sync], detail: 'bookings_not_connected' });
  if (b.sync === 'calcom') return calcomCalendar({ key: integration.key, baseUrl: integration.baseUrl, eventType: b.eventType ?? null, fetch: deps.fetch });
  if (b.sync === 'calendly') {
    return calendlyCalendar({
      key: integration.key,
      eventType: b.eventType ?? null,
      user: typeof integration.meta['user'] === 'string' ? integration.meta['user'] : null,
      plan: typeof integration.meta['plan'] === 'string' ? integration.meta['plan'] : null,
      fetch: deps.fetch,
      // What Calendly answered once (a free plan cannot book from here) is remembered.
      onPlan: (plan) => {
        if (integration.meta['plan'] !== plan) void markIntegration(deps.db, integration.row, { ok: true, meta: { plan } }, deps.now()).catch(() => {});
      },
    });
  }
  const client = composioClient({ key: integration.key, userId: siteId, fetch: deps.fetch });
  const options = { account: b.account ?? null, calendar: b.calendar ?? null };
  return b.sync === 'google' ? googleCalendar(client, { ...options, createMeetingLink: b.createMeetingLink }) : outlookCalendar(client, options);
}

/** A provider's failure as the visitor or the team should hear it. */
function providerProblem(thrown: unknown, what: string): HelpPuffError {
  if (thrown instanceof HelpPuffError) return thrown;
  if (thrown instanceof ProviderError) {
    if (thrown.status === 409) return new HelpPuffError('conflict', { message: 'That time was just taken. Please pick another.', detail: 'booking_slot_taken' });
    if (thrown.status === 400 && /event type/i.test(thrown.message)) return new HelpPuffError('bad_request', { message: thrown.message, detail: 'bookings_event_type' });
    return new HelpPuffError('connector_error', { message: `The calendar could not ${what} (${thrown.message.slice(0, 120)})`, detail: 'bookings_calendar_failed' });
  }
  return new HelpPuffError('connector_error', { message: `The calendar could not ${what}.`, detail: 'bookings_calendar_failed' });
}

export type FreeSlot = Interval & { url?: string };

/**
 * Free times starting in a window: the provider's own slots (Cal.com,
 * Calendly), else the working hours less the synced calendar's busy time;
 * always less what HelpPuff already holds.
 */
export async function freeSlots(deps: BookingDeps, siteId: string, b: Bookings, window: Interval, except?: string): Promise<FreeSlot[]> {
  const now = deps.now();
  const [calendar, held] = await Promise.all([calendarFor(deps, siteId, b), heldTime(deps.db, siteId, window, except)]);
  const clear = (slot: Interval) => !held.some((h) => h.start < slot.end && h.end > slot.start);
  try {
    if (calendar?.slots) return (await calendar.slots(window, b.duration)).filter((s) => s.start >= now && clear(s));
    const busy = calendar?.busy ? await calendar.busy(window) : [];
    return makeSlots(b, window, [...held, ...busy], now);
  } catch (thrown) {
    deps.log('bookings.slots_failed', { siteId, provider: b.sync, status: thrown instanceof ProviderError ? thrown.status : null });
    throw providerProblem(thrown, 'find free times');
  }
}

/** The contact's open job to add an appointment to: this conversation's, else the contact's latest. */
async function openJobFor(db: D1Like, siteId: string, conversationId: string | null, leadId: string | null): Promise<JobRow | null> {
  const open = `SELECT j.* FROM jobs j JOIN pipeline_stages s ON s.id = j.stage_id WHERE j.site_id = ? AND s.kind = 'open'`;
  if (conversationId) {
    const own = await db.prepare(`${open} AND j.conversation_id = ? ORDER BY j.created_at DESC LIMIT 1`).bind(siteId, conversationId).first<JobRow>();
    if (own) return own;
  }
  if (leadId) return db.prepare(`${open} AND j.lead_id = ? ORDER BY j.created_at DESC LIMIT 1`).bind(siteId, leadId).first<JobRow>();
  return null;
}

async function jobEvent(db: D1Like, jobId: string, now: number, actor: Actor, data: Record<string, unknown>): Promise<void> {
  await db
    .prepare('INSERT INTO job_events (id, job_id, at, actor, actor_name, kind, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(`evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, jobId, now, actor.id, actor.name, 'appointment', JSON.stringify(data))
    .run();
}

export async function viewOf(db: D1Like, id: string): Promise<AppointmentView> {
  const row = await appointmentRow(db, id);
  if (!row) throw new HelpPuffError('not_found', { message: 'No such appointment.', detail: 'appointment_missing' });
  return appointmentView(row);
}

export type BookInput = {
  siteId: string;
  start: number;
  end: number;
  title?: string;
  attendee: Attendee;
  conversationId?: string | null;
  jobId?: string | null;
  leadId?: string | null;
  notes?: string | null;
  location?: string | null;
  source: AppointmentSource;
  actor: Actor;
  /** Repeat-safe: the same key books once (a double click, a retry). */
  idem?: string | null;
  /** The provider's page for this time (Calendly), for a plan that cannot book from here. */
  slotUrl?: string;
  /** False: the team books over another appointment on purpose (no lock on the start time). */
  lock?: boolean;
};

/**
 * Book a time: held in HelpPuff first (`slot_lock`: a time is bookable once),
 * then written to the synced calendar, then joined to a job. Answers the
 * existing appointment for a repeated `idem`, or the provider's page when the
 * visitor must finish there.
 */
export async function bookAppointment(deps: BookingDeps, b: Bookings, input: BookInput): Promise<{ appointment: AppointmentView; created: boolean } | Redirect> {
  const { db } = deps;
  const now = deps.now();
  if (input.idem) {
    const again = await byIdem(db, input.siteId, input.idem);
    if (again && again.status !== 'cancelled') return { appointment: await viewOf(db, again.id), created: false };
  }
  const id = newAppointmentId();
  const title = (input.title ?? b.title).slice(0, 160);
  const held = await insertAppointment(
    db,
    {
      id,
      site_id: input.siteId,
      job_id: input.jobId ?? null,
      lead_id: input.leadId ?? null,
      conversation_id: input.conversationId ?? null,
      title,
      starts_at: input.start,
      ends_at: input.end,
      timezone: input.attendee.timezone,
      location: input.location ?? (b.sync === 'none' ? (b.location ?? null) : null),
      status: 'pending',
      source: input.source,
      provider: b.sync,
      external_id: null,
      attendee_name: input.attendee.name || null,
      attendee_email: input.attendee.email || null,
      attendee_phone: input.attendee.phone ?? null,
      notes: input.notes ?? null,
      meta: null,
      idem_key: input.idem ?? null,
      slot_lock: input.lock === false ? null : String(input.start),
      created_by: input.actor.id,
      created_by_name: input.actor.name,
    },
    now,
  );
  if (!held) {
    // The same booking again (raced with itself), or someone else's on this time.
    const again = input.idem ? await byIdem(db, input.siteId, input.idem) : null;
    if (again && again.status !== 'cancelled') return { appointment: await viewOf(db, again.id), created: false };
    throw new HelpPuffError('conflict', { message: 'That time was just taken. Please pick another.', detail: 'booking_slot_taken' });
  }

  let externalId: string | null = null;
  let location = held.location;
  let meta: Record<string, string> | undefined;
  let times = { start: input.start, end: input.end };
  try {
    const calendar = await calendarFor(deps, input.siteId, b);
    if (calendar) {
      const made = await calendar.book({ start: input.start, end: input.end, title, attendee: input.attendee, notes: input.notes ?? null, location: b.location ?? null, idem: input.idem ?? id }, input.slotUrl ? { url: input.slotUrl } : undefined);
      if (isRedirect(made)) {
        await db.prepare('DELETE FROM appointments WHERE id = ?').bind(id).run();
        return made;
      }
      externalId = made.externalId;
      location = made.location ?? location;
      meta = made.meta;
      times = { start: made.start, end: made.end };
    }
  } catch (thrown) {
    await db.prepare('DELETE FROM appointments WHERE id = ?').bind(id).run();
    deps.log('bookings.book_failed', { siteId: input.siteId, provider: b.sync, status: thrown instanceof ProviderError ? thrown.status : null });
    throw providerProblem(thrown, 'book that time');
  }

  // The job it belongs to: given, the conversation's or the contact's open one, else a new one.
  let job: JobRow | null = input.jobId ? await db.prepare('SELECT * FROM jobs WHERE id = ? AND site_id = ?').bind(input.jobId, input.siteId).first<JobRow>() : null;
  let jobCreated = false;
  if (!job) job = await openJobFor(db, input.siteId, input.conversationId ?? null, input.leadId ?? null);
  if (!job) {
    job = await createJob(
      db,
      {
        siteId: input.siteId,
        title: input.attendee.name ? `${title}: ${input.attendee.name}`.slice(0, 160) : title,
        details: input.notes ?? null,
        ...(input.leadId ? { leadId: input.leadId } : { contact: { name: input.attendee.name, email: input.attendee.email, ...(input.attendee.phone ? { phone: input.attendee.phone } : {}) } }),
        conversationId: input.conversationId ?? null,
        source: 'booking',
        actor: input.actor,
      },
      now,
    );
    jobCreated = true;
  }
  await patchAppointment(
    db,
    id,
    {
      status: 'confirmed',
      external_id: externalId,
      starts_at: times.start,
      ends_at: times.end,
      slot_lock: input.lock === false ? null : String(times.start),
      location,
      job_id: job.id,
      lead_id: job.lead_id ?? input.leadId ?? null,
      ...(meta ? { meta: JSON.stringify(meta) } : {}),
      synced_at: externalId ? now : null,
    },
    now,
  );
  await jobEvent(db, job.id, now, input.actor, { appointmentId: id, title, start: times.start, end: times.end, timezone: input.attendee.timezone, change: 'booked' });
  const appointment = await viewOf(db, id);
  if (jobCreated && deps.jobCreated) {
    const pipeline = await ensurePipeline(db, input.siteId, now);
    deps.jobCreated(jobView({ ...job, contact_name: input.attendee.name || null, contact_email: input.attendee.email || null, contact_phone: input.attendee.phone ?? null }, pipeline, now));
  }
  deps.emit('appointment.created', { appointment });
  return { appointment, created: true };
}

/** Move an appointment: the synced calendar first, then here. */
export async function rescheduleAppointment(deps: BookingDeps, b: Bookings, row: AppointmentRow, start: number, end: number, actor: Actor): Promise<AppointmentView> {
  const now = deps.now();
  if (row.status === 'cancelled') throw new HelpPuffError('bad_request', { message: 'This appointment was cancelled: book a new one.', detail: 'appointment_cancelled' });
  if (row.status === 'busy') throw new HelpPuffError('bad_request', { message: 'This is busy time from your calendar: move it there.', detail: 'appointment_external' });
  // Hold the new time first: a clash means someone has it.
  try {
    await patchAppointment(deps.db, row.id, { slot_lock: String(start) }, now);
  } catch {
    throw new HelpPuffError('conflict', { message: 'That time was just taken. Please pick another.', detail: 'booking_slot_taken' });
  }
  let externalId = row.external_id;
  let times = { start, end };
  if (row.external_id && row.provider !== 'none') {
    try {
      const calendar = await calendarFor(deps, row.site_id, { ...b, sync: row.provider as Bookings['sync'] });
      if (calendar) {
        if (!calendar.reschedule) throw new HelpPuffError('bad_request', { message: 'Calendly appointments are moved in Calendly (or with the invitee\'s reschedule link); the change is read back here.', detail: 'appointment_move_unsupported' });
        const moved = await calendar.reschedule(row.external_id, start, end);
        externalId = moved.externalId ?? externalId;
        times = { start: moved.start, end: moved.end };
      }
    } catch (thrown) {
      await patchAppointment(deps.db, row.id, { slot_lock: String(row.starts_at) }, now).catch(() => {});
      throw providerProblem(thrown, 'move that appointment');
    }
  }
  await patchAppointment(deps.db, row.id, { starts_at: times.start, ends_at: times.end, slot_lock: String(times.start), external_id: externalId, reminded_at: null }, now);
  if (row.job_id) await jobEvent(deps.db, row.job_id, now, actor, { appointmentId: row.id, title: row.title, start: times.start, end: times.end, from: row.starts_at, change: 'moved' });
  const appointment = await viewOf(deps.db, row.id);
  deps.emit('appointment.updated', { appointment, previous: { start: row.starts_at, end: row.ends_at } });
  return appointment;
}

/** Cancel: at the synced calendar (already gone there is fine), then here. The record stays. */
export async function cancelAppointment(deps: BookingDeps, b: Bookings, row: AppointmentRow, actor: Actor, reason?: string, options: { atProvider?: boolean } = {}): Promise<AppointmentView> {
  const now = deps.now();
  if (row.status === 'cancelled') return viewOf(deps.db, row.id);
  if (row.external_id && row.provider !== 'none' && options.atProvider !== false && row.status !== 'busy') {
    try {
      const calendar = await calendarFor(deps, row.site_id, { ...b, sync: row.provider as Bookings['sync'] });
      await calendar?.cancel(row.external_id, reason);
    } catch (thrown) {
      if (!(thrown instanceof ProviderError && (thrown.status === 404 || thrown.status === 410))) throw providerProblem(thrown, 'cancel that appointment');
    }
  }
  await patchAppointment(deps.db, row.id, { status: 'cancelled', slot_lock: null }, now);
  if (row.job_id) await jobEvent(deps.db, row.job_id, now, actor, { appointmentId: row.id, title: row.title, start: row.starts_at, end: row.ends_at, change: 'cancelled', ...(reason ? { reason: reason.slice(0, 300) } : {}) });
  const appointment = await viewOf(deps.db, row.id);
  if (row.status !== 'busy') deps.emit('appointment.cancelled', { appointment, ...(reason ? { reason: reason.slice(0, 300) } : {}) });
  return appointment;
}

// --------------------------------------------------------------------- sync

/** What the pull reads: 30 days back, 90 ahead. */
export const SYNC_BACK_MS = 30 * 86_400_000;
export const SYNC_AHEAD_MS = 90 * 86_400_000;
const CALENDAR_ACTOR: Actor = { id: 'calendar', name: 'Calendar sync' };

export type SyncResult = { added: number; updated: number; cancelled: number; busy: number; at: number };

/**
 * Read the synced calendar into HelpPuff: new events added (an appointment
 * on a job when an attendee is a contact, else busy time), moved ones
 * updated (the calendar's time wins, HelpPuff's notes stay), cancelled or
 * removed ones cancelled. Matched by the provider's id.
 */
export async function syncCalendar(deps: BookingDeps, siteId: string, b: Bookings): Promise<SyncResult> {
  const now = deps.now();
  const result: SyncResult = { added: 0, updated: 0, cancelled: 0, busy: 0, at: now };
  if (b.sync === 'none') return result;
  const integration = await openIntegration(deps.db, deps.secret, siteId, INTEGRATION_OF[b.sync]);
  if (!integration) throw new HelpPuffError('bad_request', { message: NOT_CONNECTED[b.sync], detail: 'bookings_not_connected' });
  const window = { start: now - SYNC_BACK_MS, end: now + SYNC_AHEAD_MS };
  let events: ExternalEvent[];
  try {
    const calendar = await calendarFor(deps, siteId, b);
    events = calendar ? await calendar.list(window) : [];
  } catch (thrown) {
    await markIntegration(deps.db, integration.row, { ok: false, error: thrown instanceof Error ? thrown.message : 'sync failed' }, now).catch(() => {});
    throw providerProblem(thrown, 'be read');
  }
  const known = new Map(
    (
      await deps.db
        .prepare('SELECT * FROM appointments WHERE site_id = ? AND provider = ? AND external_id IS NOT NULL AND ends_at > ? AND starts_at < ?')
        .bind(siteId, b.sync, window.start, window.end)
        .all<AppointmentRow>()
    ).results.map((r) => [r.external_id!, r]),
  );
  const seen = new Set<string>();
  for (const event of events.slice(0, 500)) {
    seen.add(event.id);
    const row = known.get(event.id);
    if (row) {
      if (event.cancelled || !event.busy) {
        if (row.status !== 'cancelled') {
          await cancelAppointment(deps, b, row, CALENDAR_ACTOR, 'Cancelled in the calendar', { atProvider: false });
          result.cancelled++;
        }
      } else if (row.starts_at !== event.start || row.ends_at !== event.end) {
        if (row.status === 'cancelled') continue;
        await patchAppointment(deps.db, row.id, { starts_at: event.start, ends_at: event.end, slot_lock: row.status === 'busy' ? null : String(event.start), synced_at: now, reminded_at: null }, now).catch(async () => {
          // Another appointment holds that start: keep the time, drop the lock.
          await patchAppointment(deps.db, row.id, { starts_at: event.start, ends_at: event.end, slot_lock: null, synced_at: now }, now);
        });
        if (row.status !== 'busy') {
          if (row.job_id) await jobEvent(deps.db, row.job_id, now, CALENDAR_ACTOR, { appointmentId: row.id, title: row.title, start: event.start, end: event.end, from: row.starts_at, change: 'moved' });
          deps.emit('appointment.updated', { appointment: await viewOf(deps.db, row.id), previous: { start: row.starts_at, end: row.ends_at } });
        }
        result.updated++;
      }
      continue;
    }
    if (event.cancelled || !event.busy) continue;
    // New in the calendar: an appointment when an attendee is a contact, else busy time.
    const emails = event.attendees.map((a) => a.email.toLowerCase()).slice(0, 10);
    const lead = emails.length
      ? await deps.db.prepare(`SELECT id, name, email, phone FROM leads WHERE site_id = ? AND email IN (${emails.map(() => '?').join(', ')}) LIMIT 1`).bind(siteId, ...emails).first<{ id: string; name: string | null; email: string; phone: string | null }>()
      : null;
    const base = {
      site_id: siteId,
      conversation_id: null,
      title: event.title.slice(0, 160),
      starts_at: event.start,
      ends_at: event.end,
      timezone: b.timezone,
      location: event.location ?? null,
      source: 'provider' as const,
      provider: b.sync,
      external_id: event.id,
      notes: null,
      meta: event.meta ? JSON.stringify(event.meta) : null,
      idem_key: null,
      created_by: CALENDAR_ACTOR.id,
      created_by_name: CALENDAR_ACTOR.name,
      synced_at: now,
    };
    if (!lead) {
      const added = await insertAppointment(deps.db, { ...base, id: newAppointmentId(), job_id: null, lead_id: null, status: 'busy', attendee_name: event.attendees[0]?.name ?? null, attendee_email: event.attendees[0]?.email ?? null, attendee_phone: null, slot_lock: null }, now);
      if (added) result.busy++;
      continue;
    }
    let job = await openJobFor(deps.db, siteId, null, lead.id);
    let created = false;
    if (!job) {
      job = await createJob(deps.db, { siteId, title: `${event.title}`.slice(0, 160), leadId: lead.id, source: 'booking', actor: CALENDAR_ACTOR }, now);
      created = true;
    }
    const id = newAppointmentId();
    const added =
      (await insertAppointment(deps.db, { ...base, id, job_id: job.id, lead_id: lead.id, status: 'confirmed', attendee_name: lead.name, attendee_email: lead.email, attendee_phone: lead.phone, slot_lock: String(event.start) }, now)) ??
      // Another appointment holds that start: kept without the lock.
      (await insertAppointment(deps.db, { ...base, id, job_id: job.id, lead_id: lead.id, status: 'confirmed', attendee_name: lead.name, attendee_email: lead.email, attendee_phone: lead.phone, slot_lock: null }, now));
    if (!added) continue;
    await jobEvent(deps.db, job.id, now, CALENDAR_ACTOR, { appointmentId: id, title: base.title, start: event.start, end: event.end, change: 'booked' });
    if (created && deps.jobCreated) {
      const pipeline = await ensurePipeline(deps.db, siteId, now);
      deps.jobCreated(jobView({ ...job, contact_name: lead.name, contact_email: lead.email, contact_phone: lead.phone }, pipeline, now));
    }
    deps.emit('appointment.created', { appointment: await viewOf(deps.db, id) });
    result.added++;
  }
  // Gone from the calendar (and the list was whole): cancelled here too.
  if (events.length < 240) {
    for (const [externalId, row] of known) {
      if (seen.has(externalId) || row.status === 'cancelled' || row.starts_at < now) continue;
      await cancelAppointment(deps, b, row, CALENDAR_ACTOR, 'Removed from the calendar', { atProvider: false });
      result.cancelled++;
    }
  }
  await markIntegration(deps.db, integration.row, { ok: true, meta: { syncedAt: now } }, now).catch(() => {});
  return result;
}

/** When the site's calendar was last read (the cron reads it every `syncMinutes`). */
export async function lastSynced(db: D1Like, siteId: string, b: BookingsConfig): Promise<number | null> {
  if (b.sync === 'none') return null;
  const row = await db.prepare('SELECT meta FROM integrations WHERE site_id = ? AND kind = ?').bind(siteId, INTEGRATION_OF[b.sync]).first<{ meta: string | null }>();
  try {
    const at = row?.meta ? (JSON.parse(row.meta) as { syncedAt?: unknown }).syncedAt : null;
    return typeof at === 'number' ? at : null;
  } catch {
    return null;
  }
}

/**
 * `appointment.reminder` for confirmed appointments starting within a day,
 * once each, and not for one booked in the last hour (the confirmation is
 * its reminder).
 */
export async function sendReminders(deps: BookingDeps, siteId: string): Promise<number> {
  const now = deps.now();
  const rows = (
    await deps.db
      .prepare("SELECT id FROM appointments WHERE site_id = ? AND status = 'confirmed' AND reminded_at IS NULL AND starts_at > ? AND starts_at <= ? AND created_at < ? LIMIT 50")
      .bind(siteId, now, now + 86_400_000, now - 3_600_000)
      .all<{ id: string }>()
  ).results;
  for (const { id } of rows) {
    await patchAppointment(deps.db, id, { reminded_at: now }, now);
    deps.emit('appointment.reminder', { appointment: await viewOf(deps.db, id) });
  }
  return rows.length;
}
