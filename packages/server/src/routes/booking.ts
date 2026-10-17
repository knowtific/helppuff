import { Hono, type Context } from 'hono';
import { cleanText, DATE_RE, DAY_PARTS, formatSlot, type BookingSlotsResponse, type DayPart, type Message } from '@helppuff/protocol';
import { messageId } from '@helppuff/connector-types';
import { HelpPuffError } from '../core/errors.js';
import type { HonoEnv, RequestCtx } from '../core/request.js';
import { hitMemory, rateLimited } from '../core/ratelimit.js';
import { visitorStanding } from '../core/visitor.js';
import { dispatchLead } from '../core/sinks.js';
import { recordLead, recordTurn } from '../admin/record.js';
import { readJsonBody } from './sessions.js';
import { authenticate, type Session } from './messages.js';
import { bookedMessage, signSlot, verifySlot } from '../bookings/chat.js';
import { bookingDeps } from '../bookings/deps.js';
import { effectiveBooking } from '../bookings/found.js';
import { bookAppointment, bookingsOf, cancelAppointment, freeSlots, rescheduleAppointment, syncCalendar, viewOf } from '../bookings/service.js';
import { resolveSite } from '../config/site.js';
import { calcomWebhookSecret, verifyCalcomSignature } from '../integrations/webhook.js';
import { byDay, dayWindow, inPart } from '../bookings/slots.js';
import { addDays, validTimeZone, zoned } from '../bookings/time.js';
import { byIdem, type AppointmentRow } from '../bookings/store.js';
import { reasonOf } from '../core/log.js';

/**
 * The booking picker's calls (Settings → Bookings: date picker in the chat),
 * on the chat's session token. The visitor picks a time the server offered
 * (signed slot ids), and the server books it: the assistant never does.
 */

export const bookingRoutes = new Hono<HonoEnv>();

/** The picker shows two weeks at a time at most. */
const MAX_DAYS = 14;
const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

async function pickerSession(c: Context<HonoEnv>, scope: 'slots' | 'book'): Promise<{ ctx: RequestCtx; session: Session }> {
  const ctx = c.get('helppuff');
  const session = await authenticate(ctx, c.req.header('Authorization'));
  if (effectiveBooking(session.site, session.site.bookingFound ?? null).mode !== 'picker') {
    throw new HelpPuffError('not_found', { message: 'Booking in the chat is not on for this site.', detail: 'bookings_off' });
  }
  if ((await visitorStanding(ctx, session.site.security)) === 'limited') {
    const limits = session.site.security.limits;
    const verdict =
      scope === 'slots'
        ? hitMemory('bkslots', `${session.payload.siteId}:${await ctx.ipKey()}`, limits.slotLookupsPerIpPerMinute, 60, ctx.platform.now())
        : hitMemory('bkbook', `${session.payload.siteId}:${await ctx.ipKey()}`, limits.bookingsPerIpPerHour, 3600, ctx.platform.now());
    if (!verdict.allowed) throw rateLimited(verdict, scope === 'slots' ? 'slot_lookups_per_ip' : 'bookings_per_ip');
  }
  return { ctx, session };
}

const VISITOR = (name: string) => ({ id: 'visitor', name: name || 'The visitor' });

/** An appointment of this conversation, for moving or cancelling it from the chat. */
async function ownAppointment(ctx: RequestCtx, session: Session, id: unknown): Promise<AppointmentRow> {
  const deps = bookingDeps(ctx, session.payload.siteId);
  const row = typeof id === 'string' && id.length <= 64 ? await deps.db.prepare('SELECT * FROM appointments WHERE id = ? AND site_id = ? AND conversation_id = ?').bind(id, session.payload.siteId, session.payload.sessionId).first<AppointmentRow>() : null;
  if (!row) throw new HelpPuffError('not_found', { message: 'That appointment is not part of this chat.', detail: 'appointment_not_yours' });
  return row;
}

/**
 * The free times. A POST, though it changes nothing: a same-origin GET carries
 * no Origin header (the deploy's own preview page), and the origin is checked.
 */
bookingRoutes.post('/v1/sessions/booking/slots', async (c) => {
  const { ctx, session } = await pickerSession(c, 'slots');
  const asked = ((await readJsonBody(c.req.raw).catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const q = (name: string) => (typeof asked[name] === 'string' ? (asked[name] as string) : undefined);
  const { siteId, sessionId } = session.payload;
  const b = bookingsOf(session.site);
  const zone = validTimeZone(q('tz')) ? q('tz')! : b.timezone;
  const today = zoned(ctx.platform.now(), zone).date;
  const askedFrom = q('from') ?? '';
  const from = DATE_RE.test(askedFrom) && askedFrom > today ? askedFrom : today;
  const askedTo = q('to') ?? '';
  const to = DATE_RE.test(askedTo) && askedTo >= from ? askedTo : addDays(from, 6);
  const part = (DAY_PARTS as readonly string[]).includes(q('part') ?? '') ? (q('part') as DayPart) : undefined;
  const window = dayWindow(from, to, zone, MAX_DAYS);
  const lastDay = addDays(zoned(ctx.platform.now(), b.timezone).date, b.daysAhead);
  const deps = bookingDeps(ctx, siteId);
  // Moving an appointment: its own time is not in the way.
  const moving = q('reschedule') ? (await ownAppointment(ctx, session, q('reschedule'))).id : undefined;
  const slots = window.from > lastDay ? [] : inPart(await freeSlots(deps, siteId, b, window, moving), part, zone);
  const signed = await Promise.all(slots.map(async (s) => ({ id: await signSlot(deps.secret, siteId, sessionId, s.start, s.end), start: s.start, end: s.end })));
  const body: BookingSlotsResponse = {
    timezone: zone,
    days: byDay(signed, zone),
    next: window.to < lastDay ? addDays(window.to, 1) : null,
    phone: b.phone,
    title: b.title,
    duration: b.duration,
  };
  return c.json(body);
});

bookingRoutes.post('/v1/sessions/booking', async (c) => {
  const { ctx, session } = await pickerSession(c, 'book');
  const { siteId, sessionId } = session.payload;
  const body = (await readJsonBody(c.req.raw)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HelpPuffError('bad_request', { detail: 'booking_body_invalid' });
  const b = bookingsOf(session.site);
  const deps = bookingDeps(ctx, siteId);

  const name = typeof body['name'] === 'string' ? cleanText(body['name'], 'line').trim().slice(0, 200) : '';
  const email = typeof body['email'] === 'string' ? cleanText(body['email'], 'line').trim().toLowerCase().slice(0, 200) : '';
  const phone = typeof body['phone'] === 'string' ? cleanText(body['phone'], 'line').trim().slice(0, 40) : '';
  if (!name) throw new HelpPuffError('bad_request', { message: 'Please add your name.', detail: 'booking_name' });
  if (!EMAIL.test(email)) throw new HelpPuffError('bad_request', { message: 'Please check your email address.', detail: 'booking_email' });
  if (b.phone === 'required' && !/^[+()\-.\s\d]{6,40}$/.test(phone)) throw new HelpPuffError('bad_request', { message: 'Please add a phone number.', detail: 'booking_phone' });
  const zone = validTimeZone(body['timezone']) ? (body['timezone'] as string) : b.timezone;

  const slot = await verifySlot(deps.secret, siteId, sessionId, body['slot']);
  if (!slot) throw new HelpPuffError('bad_request', { message: 'That time is no longer offered. Please pick another.', detail: 'booking_slot_invalid' });
  if (slot.start <= ctx.platform.now()) throw new HelpPuffError('bad_request', { message: 'That time has passed. Please pick another.', detail: 'booking_slot_past' });

  // Still free right now: the times around it, asked again.
  const reschedule = body['reschedule'] ? await ownAppointment(ctx, session, body['reschedule']) : null;
  // The same press again (a double click, a retry): the appointment it made, not "taken".
  if (!reschedule) {
    const again = await byIdem(deps.db, siteId, `${sessionId}:${slot.start}`);
    if (again && again.status !== 'cancelled') return c.json({ messages: [bookedMessage(await viewOf(deps.db, again.id), { canChange: b.sync !== 'calendly', now: ctx.platform.now() })] });
  }
  const around = await freeSlots(deps, siteId, b, { start: slot.start - 3_600_000, end: slot.start + 3_600_000 }, reschedule?.id);
  const still = around.find((s) => s.start === slot.start);
  if (!still) throw new HelpPuffError('conflict', { message: 'That time was just taken. Please pick another.', detail: 'booking_slot_taken' });
  const when = formatSlot(still.start, zone);
  const attendee = { name, email, ...(phone && b.phone !== 'off' ? { phone } : {}), timezone: zone };

  let messages: Message[];
  let redirect: string | undefined;
  if (reschedule) {
    const moved = await rescheduleAppointment(deps, b, reschedule, still.start, still.start + (reschedule.ends_at - reschedule.starts_at), VISITOR(name));
    messages = [bookedMessage(moved, { canChange: b.sync !== 'calendly', now: ctx.platform.now() })];
    recordTurn(ctx, { siteId, sessionId, request: { kind: 'action', actionId: 'booking', clientId: 'booking', label: `Moved my appointment to ${when}`, value: JSON.stringify({ appointment: moved.id, start: moved.start }) }, messages, status: 'keep' });
  } else {
    const result = await bookAppointment(deps, b, {
      siteId,
      start: still.start,
      end: still.end,
      attendee,
      conversationId: sessionId,
      source: 'chat',
      actor: VISITOR(name),
      idem: `${sessionId}:${still.start}`,
      ...(still.url ? { slotUrl: still.url } : {}),
    });
    if ('redirect' in result) {
      redirect = result.redirect;
      messages = [{ id: messageId('bkr'), ts: ctx.platform.now(), role: 'agent', type: 'links', title: 'Finish booking', links: [{ label: `Book ${when}`, url: result.redirect, description: 'Confirm your details on the booking page.' }] }];
    } else {
      messages = [bookedMessage(result.appointment, { canChange: b.sync !== 'calendly', now: ctx.platform.now() })];
    }
    recordTurn(ctx, { siteId, sessionId, request: { kind: 'action', actionId: 'booking', clientId: 'booking', label: `Booked ${when}`, value: JSON.stringify({ start: still.start, title: b.title }) }, messages, status: 'keep' });
    // The visitor gave their details to book: a lead, like any form.
    const lead = { name, email, ...(attendee.phone ? { phone: attendee.phone } : {}), request: 'appointment' };
    recordLead(ctx, { siteId, sessionId, lead, source: 'form' });
    dispatchLead(ctx, session.site, siteId, { sessionId, lead, context: { pageUrl: ctx.origin ?? 'unknown' } });
  }
  return c.json({ messages, ...(redirect ? { redirect } : {}) });
});

bookingRoutes.post('/v1/sessions/booking/cancel', async (c) => {
  const { ctx, session } = await pickerSession(c, 'book');
  const { siteId, sessionId } = session.payload;
  const body = (await readJsonBody(c.req.raw)) as Record<string, unknown> | null;
  const row = await ownAppointment(ctx, session, body?.['appointment']);
  const b = bookingsOf(session.site);
  const deps = bookingDeps(ctx, siteId);
  const cancelled = await cancelAppointment(deps, b, row, VISITOR(row.attendee_name ?? ''), 'Cancelled by the visitor in the chat');
  const messages = [bookedMessage(cancelled, { canChange: false, now: ctx.platform.now() })];
  recordTurn(ctx, { siteId, sessionId, request: { kind: 'action', actionId: 'booking', clientId: 'booking', label: `Cancelled my appointment on ${formatSlot(row.starts_at, row.timezone)}`, value: JSON.stringify({ appointment: row.id, cancel: true }) }, messages, status: 'keep' });
  return c.json({ messages });
});

/**
 * Cal.com's webhook (booking created, rescheduled, cancelled): a signed
 * delivery starts a sync of that site's calendar, so a change made in
 * Cal.com shows within seconds instead of at the next scheduled read.
 * The payload itself is not trusted or parsed beyond its signature.
 */
bookingRoutes.post('/v1/integrations/calcom/:site', async (c) => {
  const ctx = c.get('helppuff');
  const siteId = c.req.param('site');
  const raw = await c.req.text();
  const site = await resolveSite(ctx, siteId);
  const b = bookingsOf(site);
  const deps = bookingDeps(ctx, siteId);
  const secret = await calcomWebhookSecret(deps.secret, siteId);
  if (!(await verifyCalcomSignature(secret, raw, c.req.header('x-cal-signature-256') ?? ''))) throw new HelpPuffError('unauthorized', { detail: 'calcom_signature' });
  if (b.sync === 'calcom' && effectiveBooking(site, null).mode === 'picker') {
    ctx.platform.waitUntil(syncCalendar(deps, siteId, b).then(() => undefined).catch((thrown) => ctx.platform.log('bookings.sync_failed', { siteId, reason: reasonOf(thrown) })));
  }
  return c.json({ ok: true });
});
