import { Hono, type Context } from 'hono';
import { DATE_RE } from '@helppuff/protocol';
import { resolveSite } from '../config/site.js';
import type { SiteConfig } from '../config/schema.js';
import { HelpPuffError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import { bookingDeps } from '../bookings/deps.js';
import { effectiveBooking } from '../bookings/found.js';
import {
  bookAppointment,
  bookingsOf,
  calendarFor,
  cancelAppointment,
  freeSlots,
  lastSynced,
  rescheduleAppointment,
  syncCalendar,
  viewOf,
  type Bookings,
} from '../bookings/service.js';
import { byDay, dayWindow } from '../bookings/slots.js';
import { APPOINTMENT_STATUSES, SETTABLE_STATUSES, appointmentView, block, deleteAppointment, line, listAppointments, patchAppointment, requireAppointment } from '../bookings/store.js';
import { addDays, validTimeZone, zoned } from '../bookings/time.js';
import { ProviderError } from '../integrations/http.js';
import { integrationRow, integrationView } from '../integrations/store.js';
import type { Actor } from '../jobs/store.js';
import { assertSameOrigin, assertSiteAccess, currentAdmin, db, jsonBody, siteParam, type Admin } from './guard.js';
import { actorOf } from './inbox.js';
import { displayName } from './live.js';

/**
 * Bookings (Settings → Bookings) and appointments (the Calendar page, a
 * job's Appointments, the API, `helppuff appointments`). The settings
 * themselves are part of `/settings` (`bookings`); these routes are the rest:
 * what is in force, the preview's free times, the connection check, the
 * appointments and the sync.
 */

export const bookingRoutes = new Hono<HonoEnv>();

const actorFor = (admin: Admin): Actor => ({ id: actorOf(admin), name: admin.via === 'session' ? displayName(admin) : admin.via === 'key' ? admin.name : 'CLI' });

async function siteFor(c: Context<HonoEnv>, value: unknown): Promise<{ siteId: string; site: SiteConfig; b: Bookings }> {
  const siteId = siteParam(c, value);
  const site = await resolveSite(c.get('helppuff'), siteId);
  return { siteId, site, b: bookingsOf(site) };
}

/** Appointments are on with the date picker only; the records stay when it is off. */
function assertPicker(site: SiteConfig): void {
  if (effectiveBooking(site, site.bookingFound ?? null).mode !== 'picker') {
    throw new HelpPuffError('bad_request', { message: 'Appointments are off: turn on the date picker in Settings → Bookings (or `helppuff bookings mode picker`).', detail: 'appointments_off' });
  }
}

const time = (value: unknown, what: string): number => {
  const t = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(t)) throw new HelpPuffError('bad_request', { message: `${what} is a date and time (ISO 8601) or milliseconds.`, detail: 'appointment_time' });
  return t;
};

// ------------------------------------------------------------- bookings

/** What is in force: the mode (the owner's, or the website's link), the calendar and its connection. */
bookingRoutes.get('/bookings', async (c) => {
  await currentAdmin(c);
  const { siteId, site, b } = await siteFor(c, c.req.query('site'));
  const d = db(c);
  const integrationKind = b.sync === 'calcom' ? 'calcom' : b.sync === 'calendly' ? 'calendly' : b.sync === 'none' ? null : 'composio';
  const integration = integrationKind ? await integrationRow(d, siteId, integrationKind) : null;
  const now = c.get('helppuff').platform.now();
  const upcoming = await d
    .prepare("SELECT count(*) AS n FROM appointments WHERE site_id = ? AND status IN ('confirmed', 'pending') AND starts_at > ?")
    .bind(siteId, now)
    .first<{ n: number }>();
  return c.json({
    site: siteId,
    effective: effectiveBooking(site, site.bookingFound ?? null),
    found: site.bookingFound ?? null,
    timezone: b.timezone,
    calendar: {
      sync: b.sync,
      integration: integration ? integrationView(integration) : null,
      ready: b.sync === 'none' || Boolean(integration?.secret && (b.sync === 'google' || b.sync === 'outlook' || b.eventType)),
    },
    syncedAt: await lastSynced(d, siteId, b),
    upcoming: upcoming?.n ?? 0,
  });
});

/** The preview's free times: the real ones, with the settings in force (nothing is booked). */
bookingRoutes.get('/bookings/slots', async (c) => {
  await currentAdmin(c);
  const { siteId, b } = await siteFor(c, c.req.query('site'));
  const ctx = c.get('helppuff');
  const zone = validTimeZone(c.req.query('tz')) ? c.req.query('tz')! : b.timezone;
  const today = zoned(ctx.platform.now(), zone).date;
  const from = DATE_RE.test(c.req.query('from') ?? '') && c.req.query('from')! > today ? c.req.query('from')! : today;
  const to = DATE_RE.test(c.req.query('to') ?? '') ? c.req.query('to')! : addDays(from, 6);
  const window = dayWindow(from, to, zone, 14);
  const slots = await freeSlots(bookingDeps(ctx, siteId), siteId, b, window);
  return c.json({ timezone: zone, days: byDay(slots.map((s) => ({ start: s.start, end: s.end })), zone), next: addDays(window.to, 1), title: b.title, duration: b.duration, phone: b.phone });
});

/** Check the calendar connection, and list its event types (Cal.com, Calendly). */
bookingRoutes.post('/bookings/test', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, b } = await siteFor(c, body['site']);
  const sync = (['calcom', 'calendly', 'google', 'outlook'] as const).find((s) => s === body['sync']) ?? b.sync;
  if (sync === 'none') return c.json({ ok: true, detail: 'HelpPuff keeps the appointments: nothing to connect.', eventTypes: [] });
  const ctx = c.get('helppuff');
  try {
    const calendar = await calendarFor(bookingDeps(ctx, siteId), siteId, { ...b, sync });
    const result = await calendar!.test();
    return c.json({ ok: true, detail: result.detail, eventTypes: result.eventTypes ?? [] });
  } catch (thrown) {
    if (thrown instanceof HelpPuffError) return c.json({ ok: false, detail: thrown.message, eventTypes: [] });
    return c.json({ ok: false, detail: thrown instanceof ProviderError ? thrown.message : 'The calendar could not be reached.', eventTypes: [] });
  }
});

// --------------------------------------------------------- appointments

bookingRoutes.get('/appointments', async (c) => {
  await currentAdmin(c);
  const { siteId, site } = await siteFor(c, c.req.query('site'));
  assertPicker(site);
  const q = (name: string) => c.req.query(name) || undefined;
  const status = q('status');
  if (status && !['active', 'all', 'appointments', ...APPOINTMENT_STATUSES].includes(status)) {
    throw new HelpPuffError('bad_request', { message: `status is active, all, appointments, or one of: ${APPOINTMENT_STATUSES.join(', ')}.`, detail: 'appointment_status' });
  }
  const rows = await listAppointments(db(c), siteId, {
    ...(q('from') ? { from: time(q('from'), 'from') } : {}),
    ...(q('to') ? { to: time(q('to'), 'to') } : {}),
    status: status ?? 'active',
    ...(q('job') ? { job: q('job')! } : {}),
    ...(q('contact') ? { contact: q('contact')! } : {}),
    ...(q('conversation') ? { conversation: q('conversation')! } : {}),
  });
  return c.json({ items: rows.map(appointmentView) });
});

bookingRoutes.get('/appointments/:id', async (c) => {
  await currentAdmin(c);
  const row = await requireAppointment(db(c), c.req.param('id'));
  assertSiteAccess(c, row.site_id, 'appointment');
  return c.json(appointmentView(row));
});

/** Book by hand: written to the synced calendar, then here, on a job (given, the contact's open one, or a new one). */
bookingRoutes.post('/appointments', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, site, b } = await siteFor(c, body['site']);
  assertPicker(site);
  const ctx = c.get('helppuff');
  const d = db(c);
  const start = time(body['start'], 'start');
  const duration = body['duration'] === undefined ? b.duration : Number(body['duration']);
  const end = body['end'] !== undefined ? time(body['end'], 'end') : start + (Number.isFinite(duration) ? duration : b.duration) * 60_000;
  if (end <= start || end - start > 24 * 3_600_000) throw new HelpPuffError('bad_request', { message: 'end comes after start, within a day.', detail: 'appointment_end' });
  const timezone = validTimeZone(body['timezone']) ? (body['timezone'] as string) : b.timezone;

  // Who it is with: a job's contact, a contact, or the details given.
  const jobId = typeof body['jobId'] === 'string' ? body['jobId'] : null;
  const job = jobId ? await d.prepare('SELECT id, site_id, lead_id FROM jobs WHERE id = ?').bind(jobId).first<{ id: string; site_id: string; lead_id: string | null }>() : null;
  if (jobId && (!job || job.site_id !== siteId)) throw new HelpPuffError('not_found', { message: 'No such job.', detail: 'job_missing' });
  const leadId = typeof body['contactId'] === 'string' ? body['contactId'] : (job?.lead_id ?? null);
  const lead = leadId ? await d.prepare('SELECT id, site_id, name, email, phone FROM leads WHERE id = ?').bind(leadId).first<{ id: string; site_id: string; name: string | null; email: string | null; phone: string | null }>() : null;
  if (leadId && (!lead || lead.site_id !== siteId)) throw new HelpPuffError('not_found', { message: 'No such contact.', detail: 'job_contact_missing' });
  const given = body['contact'] && typeof body['contact'] === 'object' ? (body['contact'] as Record<string, unknown>) : {};
  const email = line(given['email'], 200)?.toLowerCase() ?? lead?.email ?? '';
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(email)) throw new HelpPuffError('bad_request', { message: 'Check contact.email: not an email address.', detail: 'appointment_email' });
  const attendee = { name: line(given['name'], 200) ?? lead?.name ?? '', email, ...((line(given['phone'], 40) ?? lead?.phone) ? { phone: (line(given['phone'], 40) ?? lead?.phone)! } : {}), timezone };

  // A clash with another appointment is refused unless asked for.
  const force = body['force'] === true;
  if (!force) {
    const clash = await d
      .prepare("SELECT id FROM appointments WHERE site_id = ? AND status IN ('confirmed', 'pending', 'busy') AND starts_at < ? AND ends_at > ? LIMIT 1")
      .bind(siteId, end, start)
      .first<{ id: string }>();
    if (clash) throw new HelpPuffError('conflict', { message: 'That time overlaps another appointment. Pick another, or send force: true to book it anyway.', detail: 'appointment_overlap' });
  }
  const result = await bookAppointment(bookingDeps(ctx, siteId), b, {
    siteId,
    start,
    end,
    ...(line(body['title'], 160) ? { title: line(body['title'], 160)! } : {}),
    attendee,
    jobId: job?.id ?? null,
    leadId: lead?.id ?? null,
    notes: block(body['notes'], 4000),
    location: line(body['location'], 300),
    source: admin.via === 'session' ? 'dashboard' : 'api',
    actor: actorFor(admin),
    lock: !force,
  });
  if ('redirect' in result) {
    throw new HelpPuffError('bad_request', { message: 'This Calendly plan cannot book from another app: book it in Calendly, and it will show here after the next sync.', detail: 'appointment_calendly_free' });
  }
  return c.json(result.appointment, 201);
});

bookingRoutes.patch('/appointments/:id', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const d = db(c);
  const row = await requireAppointment(d, c.req.param('id'));
  assertSiteAccess(c, row.site_id, 'appointment');
  const { site, b } = await siteFor(c, row.site_id);
  assertPicker(site);
  const body = await jsonBody(c);
  const ctx = c.get('helppuff');
  const deps = bookingDeps(ctx, row.site_id);
  const actor = actorFor(admin);
  const now = ctx.platform.now();

  const status = body['status'];
  if (status !== undefined && !(SETTABLE_STATUSES as readonly unknown[]).includes(status)) {
    throw new HelpPuffError('bad_request', { message: `status is one of: ${SETTABLE_STATUSES.join(', ')}.`, detail: 'appointment_status' });
  }
  if (status === 'cancelled') {
    return c.json(await cancelAppointment(deps, b, row, actor, line(body['reason'], 300) ?? undefined));
  }
  if (body['start'] !== undefined || body['end'] !== undefined) {
    const start = body['start'] !== undefined ? time(body['start'], 'start') : row.starts_at;
    const end = body['end'] !== undefined ? time(body['end'], 'end') : start + (row.ends_at - row.starts_at);
    if (end <= start) throw new HelpPuffError('bad_request', { message: 'end comes after start.', detail: 'appointment_end' });
    if (start !== row.starts_at || end !== row.ends_at) await rescheduleAppointment(deps, b, row, start, end, actor);
  }
  const text = {
    ...(body['title'] !== undefined ? { title: line(body['title'], 160) ?? row.title } : {}),
    ...(body['notes'] !== undefined ? { notes: block(body['notes'], 4000) } : {}),
    ...(body['location'] !== undefined ? { location: line(body['location'], 300) } : {}),
    ...(status !== undefined ? { status: status as 'confirmed' | 'completed' | 'no_show' } : {}),
  };
  if (Object.keys(text).length) {
    if (row.status === 'cancelled' && status !== undefined) throw new HelpPuffError('bad_request', { message: 'This appointment was cancelled: book a new one.', detail: 'appointment_cancelled' });
    await patchAppointment(d, row.id, { ...text, ...(status === 'confirmed' ? { slot_lock: String(row.starts_at) } : {}) }, now).catch(() => patchAppointment(d, row.id, text, now));
    deps.emit('appointment.updated', { appointment: await viewOf(d, row.id) });
  }
  return c.json(await viewOf(d, row.id));
});

/** Cancel at the synced calendar (when still on), then delete the record. */
bookingRoutes.delete('/appointments/:id', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const d = db(c);
  const row = await requireAppointment(d, c.req.param('id'));
  assertSiteAccess(c, row.site_id, 'appointment');
  const { b } = await siteFor(c, row.site_id);
  if (row.status !== 'cancelled' && row.status !== 'busy') await cancelAppointment(bookingDeps(c.get('helppuff'), row.site_id), b, row, actorFor(admin), 'Deleted');
  await deleteAppointment(d, row.id);
  return c.json({ id: row.id, deleted: true });
});

/** Read the synced calendar now (also on opening the Calendar; at most once a minute unless `force`). */
bookingRoutes.post('/appointments/sync', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const { siteId, site, b } = await siteFor(c, body['site']);
  assertPicker(site);
  const ctx = c.get('helppuff');
  if (b.sync === 'none') return c.json({ synced: false, reason: 'HelpPuff keeps the appointments: there is no calendar to read.', added: 0, updated: 0, cancelled: 0, busy: 0, at: null });
  const last = await lastSynced(db(c), siteId, b);
  if (body['force'] !== true && last && ctx.platform.now() - last < 60_000) {
    return c.json({ synced: false, reason: 'Read less than a minute ago.', added: 0, updated: 0, cancelled: 0, busy: 0, at: last });
  }
  const result = await syncCalendar(bookingDeps(ctx, siteId), siteId, b);
  return c.json({ synced: true, ...result });
});
