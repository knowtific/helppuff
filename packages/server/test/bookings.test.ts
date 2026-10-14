import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractPage, bookingProvider } from '@helppuff/rag';
import { summarizeReply } from '@helppuff/connector-types';
import { makeSlots, inPart, byDay, dayWindow } from '../src/bookings/slots.js';
import { addDays, atZoned, zoned, weekdayOf } from '../src/bookings/time.js';
import { effectiveBooking, withBooking } from '../src/bookings/found.js';
import { signSlot, suggestedBooking, verifySlot } from '../src/bookings/chat.js';
import { calcomCalendar } from '../src/integrations/calcom.js';
import { calendlyCalendar } from '../src/integrations/calendly.js';
import { composioClient, googleCalendar, outlookCalendar } from '../src/integrations/composio.js';
import { calcomWebhookSecret, verifyCalcomSignature } from '../src/integrations/webhook.js';
import { sanitizeConnectorMessages } from '../src/core/sanitize.js';
import { guidanceFor } from '../src/core/guidance.js';
import { bookingsConfigSchema, siteConfigSchema, type SiteConfig } from '../src/config/schema.js';
import { runScheduledBookings } from '../src/bookings/cron.js';
import { resolveSite } from '../src/config/site.js';
import { chat, world } from './inbox-helpers.js';
import { SECRET } from './helpers.js';
import { resetMemoryLimits } from '../src/core/ratelimit.js';
import type { KvStore } from '@helppuff/connector-types';

/**
 * Appointments: the slot rules and time zones, the booking link found on a
 * website, the picker's calls (the visitor books; the server checks the
 * time it offered, holds it once, writes the calendar, puts it on a job), the
 * dashboard and API, and each calendar's client against its documented API.
 */

type Json = Record<string, any>;
const json = async (response: Response) => (await response.json()) as Json;
const rules = (over: Partial<Parameters<typeof makeSlots>[0]> = {}) => ({
  hours: { mon: ['09:00-17:00'], tue: ['09:00-17:00'], wed: ['09:00-17:00'], thu: ['09:00-17:00'], fri: ['09:00-12:00'], sat: [], sun: [] },
  duration: 30,
  buffer: 0,
  notice: 0,
  daysAhead: 30,
  timezone: 'Australia/Melbourne',
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('wall-clock time in a time zone', () => {
  it('turns a local time into the instant and back, across zones and a clock change', () => {
    const t = atZoned('2026-10-15', '06:00', 'Australia/Perth');
    expect(new Date(t).toISOString()).toBe('2026-10-14T22:00:00.000Z');
    expect(zoned(t, 'Australia/Perth')).toMatchObject({ date: '2026-10-15', hour: 6, minute: 0, weekday: 'thu' });
    expect(zoned(t, 'Australia/Melbourne')).toMatchObject({ date: '2026-10-15', hour: 9 });
    // Melbourne moved to daylight time on 4 October 2026: 10 am is 23:00 UTC the day before.
    expect(new Date(atZoned('2026-10-05', '10:00', 'Australia/Melbourne')).toISOString()).toBe('2026-10-04T23:00:00.000Z');
    expect(new Date(atZoned('2026-09-30', '10:00', 'Australia/Melbourne')).toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(weekdayOf('2026-10-11')).toBe('sun');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('free times from working hours', () => {
  const now = atZoned('2026-10-11', '10:00', 'Australia/Melbourne'); // a Sunday
  const week = { start: atZoned('2026-10-12', '00:00', 'Australia/Melbourne'), end: atZoned('2026-10-19', '00:00', 'Australia/Melbourne') };

  it('offers each half hour within the hours, closed days and the short Friday kept', () => {
    const slots = makeSlots(rules(), week, [], now);
    const days = byDay(slots, 'Australia/Melbourne');
    expect(days.map((d) => d.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    expect(days[0]!.slots).toHaveLength(16);
    expect(days[4]!.slots).toHaveLength(6);
    expect(zoned(days[0]!.slots[0]!.start, 'Australia/Melbourne')).toMatchObject({ hour: 9, minute: 0 });
    expect(zoned(days[0]!.slots.at(-1)!.start, 'Australia/Melbourne')).toMatchObject({ hour: 16, minute: 30 });
  });

  it('keeps out what is busy (with the gap after it), the notice and the days ahead', () => {
    const busy = { start: atZoned('2026-10-12', '10:00', 'Australia/Melbourne'), end: atZoned('2026-10-12', '11:00', 'Australia/Melbourne') };
    const monday = byDay(makeSlots(rules({ buffer: 15 }), week, [busy], now), 'Australia/Melbourne')[0]!.slots.map((s) => zoned(s.start, 'Australia/Melbourne'));
    // 9:30 would end at 10:00, inside the 15 minutes before; 11:00 starts inside the 15 after.
    expect(monday.map((z) => `${z.hour}:${String(z.minute).padStart(2, '0')}`)).not.toEqual(expect.arrayContaining(['9:30', '10:00', '10:30', '11:00']));
    expect(monday.map((z) => `${z.hour}:${String(z.minute).padStart(2, '0')}`)).toEqual(expect.arrayContaining(['9:00', '11:30']));
    const lateSunday = atZoned('2026-10-12', '15:00', 'Australia/Melbourne');
    expect(makeSlots(rules({ notice: 120 }), week, [], lateSunday).every((s) => s.start >= lateSunday + 7_200_000)).toBe(true);
    expect(byDay(makeSlots(rules({ daysAhead: 2 }), week, [], now), 'Australia/Melbourne').map((d) => d.date)).toEqual(['2026-10-12', '2026-10-13']);
  });

  it('shows a Perth visitor their own days and parts of the day', () => {
    const slots = makeSlots(rules(), week, [], now);
    const mornings = byDay(inPart(slots, 'morning', 'Australia/Perth'), 'Australia/Perth');
    // 9 am Melbourne is 6 am Perth: all of Thursday's morning times start before noon in Perth.
    const thursday = mornings.find((d) => d.date === '2026-10-15')!;
    expect(zoned(thursday.slots[0]!.start, 'Australia/Perth')).toMatchObject({ hour: 6 });
    expect(thursday.slots.every((s) => zoned(s.start, 'Australia/Perth').hour < 12)).toBe(true);
    expect(dayWindow('2026-10-12', '2026-12-30', 'Australia/Perth', 14).to).toBe('2026-10-25');
  });
});

describe('the booking link on a website', () => {
  it('finds a provider in links, embeds and iframes, else a booking page on the site', () => {
    const page = (body: string) => extractPage(`<html><body><main><h1>Acme</h1>${body}</main></body></html>`, 'https://acme.example/contact').facts.filter((f) => f.key === 'booking' || f.key === 'bookingPage');
    expect(page('<a href="https://calendly.com/acme/consultation">Book a call</a>')).toEqual([{ key: 'booking', value: 'https://calendly.com/acme/consultation' }]);
    expect(page('<div class="calendly-inline-widget" data-url="https://calendly.com/acme/30min"></div>')[0]).toMatchObject({ key: 'booking' });
    expect(page('<button data-cal-link="acme/intro">Book</button>')).toEqual([{ key: 'booking', value: 'https://cal.com/acme/intro' }]);
    expect(page('<iframe src="https://acme.as.me/schedule.php"></iframe>')[0]).toMatchObject({ key: 'booking' });
    expect(page('<a href="/book-online">Book online</a>')).toEqual([{ key: 'bookingPage', value: 'https://acme.example/book-online' }]);
    expect(page('<a href="https://cal.com/pricing">Pricing</a><a href="/about">About</a>')).toEqual([]);
    expect(bookingProvider('https://meetings.hubspot.com/ada')).toBe('HubSpot Meetings');
    expect(bookingProvider('http://calendly.com/acme')).toBeNull();
  });

  it('is offered while the owner has not chosen, and never over their choice', () => {
    const site = (bookings: Json = {}) => siteConfigSchema.parse({ origins: ['https://acme.example'], connector: { type: 'echo' }, bookings });
    const found = { url: 'https://calendly.com/acme/consultation', provider: 'Calendly', page: null, at: 1 };
    expect(effectiveBooking(site(), found)).toMatchObject({ mode: 'link', link: found.url, chosen: false });
    expect(effectiveBooking(site(), null)).toMatchObject({ mode: 'none', chosen: false });
    expect(effectiveBooking(site({ mode: 'none' }), found)).toMatchObject({ mode: 'none', chosen: true });
    expect(effectiveBooking(site({ mode: 'link', link: 'https://acme.example/book' }), found)).toMatchObject({ mode: 'link', link: 'https://acme.example/book' });
    expect(effectiveBooking(site({ mode: 'picker' }), found)).toMatchObject({ mode: 'picker' });

    const widget = site().widget;
    const withQuote = { ...widget, home: { ...widget.home, shortcuts: [{ id: 'job-quote', label: 'Get a quote', action: { id: 'job-quote', kind: 'flow' as const, label: 'Get a quote', flowId: 'job-quote' } }] } };
    const shown = withBooking(withQuote, effectiveBooking(site({ mode: 'picker' }), null)).home.shortcuts!;
    expect(shown.map((s) => s.id)).toEqual(['job-quote', 'booking']);
    expect(shown[1]!.action).toMatchObject({ kind: 'booking' });
    expect(withBooking(widget, effectiveBooking(site(), found)).home.shortcuts![0]!.action).toMatchObject({ kind: 'url', url: found.url, newTab: true });
  });

  it('tells the model about the link or the calendar, and today\'s date', () => {
    const site = (bookings: Json, connector = 'assistant') => siteConfigSchema.parse({ origins: ['https://acme.example'], connector: { type: connector, options: { timezone: 'Australia/Melbourne' } }, bookings });
    const now = atZoned('2026-10-11', '10:00', 'Australia/Melbourne');
    expect(guidanceFor(site({}), now).before).toContain('Now: Sunday 11 October 2026, 10:00 am (Australia/Melbourne).');
    expect(guidanceFor(site({ mode: 'link', link: 'https://cal.com/acme' })).after).toContain('https://cal.com/acme');
    const picker = guidanceFor(site({ mode: 'picker' })).after;
    expect(picker).toContain('use show_booking');
    expect(picker).toContain('Never book, hold or confirm a time yourself');
    expect(guidanceFor(site({ mode: 'picker' }, 'echo')).after).toContain('"Book a time" button');
    expect(guidanceFor(site({ mode: 'none' })).after).not.toContain('book');
  });
});

describe('what the model and the visitor are shown', () => {
  it('drops a booked appointment a backend made up; keeps a picker it opened', () => {
    const platform = { log: () => {}, now: () => 1 };
    const booked = { id: 'x', ts: 1, role: 'agent', type: 'booking', booked: { id: 'apt_1', title: 'Consultation', start: 1, end: 2, timezone: 'UTC', status: 'confirmed' } };
    const picker = { id: 'y', ts: 1, role: 'agent', type: 'booking', from: '2026-10-12' };
    expect(sanitizeConnectorMessages([booked, picker], platform).map((m) => m.id)).toEqual(['y']);
  });

  it('tells the model what the calendar booked, as a fact it did not do', () => {
    const text = summarizeReply([{ id: 'b', ts: 1, role: 'agent', type: 'booking', booked: { id: 'apt_1', title: 'Consultation', start: Date.UTC(2026, 9, 14, 22), end: Date.UTC(2026, 9, 14, 22, 30), timezone: 'Australia/Perth', status: 'confirmed' } }]);
    expect(text).toBe('[The calendar booked: Consultation, 2026-10-14 22:00 UTC (Australia/Perth), reference apt_1]');
  });

  it('suggests the button after a question about booking, for a backend without show_booking', () => {
    const site = siteConfigSchema.parse({ origins: ['https://acme.example'], connector: { type: 'echo' }, bookings: { mode: 'picker' } }) as SiteConfig;
    const reply = [{ id: 'a', ts: 1, role: 'agent' as const, type: 'text' as const, text: 'Sure!' }];
    expect(suggestedBooking(site, 'Can I book an appointment for Tuesday?', reply, false, 1)).toMatchObject({ type: 'card', actions: [{ kind: 'booking', label: 'Book a time' }] });
    expect(suggestedBooking(site, 'What are your prices?', reply, false, 1)).toBeNull();
    expect(suggestedBooking(site, 'Can I book?', reply, true, 1)).toBeNull();
  });
});

describe('slot ids', () => {
  it('are signed for one conversation, and refuse a changed time or another chat', async () => {
    const id = await signSlot(SECRET, 'demo', 'sess-1', 1_760_000_000_000, 1_760_001_800_000);
    expect(await verifySlot(SECRET, 'demo', 'sess-1', id)).toEqual({ start: 1_760_000_000_000, end: 1_760_001_800_000 });
    expect(await verifySlot(SECRET, 'demo', 'sess-2', id)).toBeNull();
    const [tag, , end, sig] = id.split('.');
    expect(await verifySlot(SECRET, 'demo', 'sess-1', [tag, (1_760_003_600_000).toString(36), end, sig].join('.'))).toBeNull();
    expect(await verifySlot(SECRET, 'demo', 'sess-1', 'nonsense')).toBeNull();
  });
});

/** A site with the picker on, hours all day every day, so there are always times. */
const ALL_DAY = { mon: ['00:00-24:00'], tue: ['00:00-24:00'], wed: ['00:00-24:00'], thu: ['00:00-24:00'], fri: ['00:00-24:00'], sat: ['00:00-24:00'], sun: ['00:00-24:00'] };
const pickerSite = (over: Json = {}) => ({ bookings: bookingsConfigSchema.parse({ mode: 'picker', hours: ALL_DAY, notice: 60, title: 'Consultation', timezone: 'Australia/Melbourne', location: 'Our office', ...over }) });

async function picker(over: Json = {}) {
  resetMemoryLimits();
  const w = await world({ ...pickerSite(over), security: { limits: { bookingsPerIpPerHour: 100, slotLookupsPerIpPerMinute: 600, messagesPerIpPerMinute: 600, sessionsPerIpPerHour: 1000 } } });
  const visitor = async () => {
    const started = await chat(w.h, 'Hi');
    const auth = { headers: { Authorization: `Bearer ${started.token}` } };
    return {
      ...started,
      slots: async (query: Record<string, string> = {}) => w.h.post('/v1/sessions/booking/slots', { tz: 'Australia/Perth', ...query }, auth),
      book: async (body: Json) => w.h.post('/v1/sessions/booking', body, auth),
      cancel: async (appointment: string) => w.h.post('/v1/sessions/booking/cancel', { appointment }, auth),
    };
  };
  return { ...w, visitor };
}

describe('booking in the chat', () => {
  it('offers signed times, books the one picked once, on a job, and tells the webhooks', async () => {
    const w = await picker();
    await w.owner.send('POST', '/webhooks', { url: 'https://hooks.example.com/x', events: ['appointment.created', 'job.created'] });
    const delivered: Json[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (String(url).startsWith('https://hooks.example.com')) delivered.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 200 });
    });
    const v = await w.visitor();
    const slots = await json(await v.slots());
    expect(slots).toMatchObject({ timezone: 'Australia/Perth', phone: 'optional', title: 'Consultation' });
    const slot = slots['days'][0].slots[2];
    expect(slot.id).toMatch(/^s\./);

    const booked = await v.book({ slot: slot.id, name: 'Ada Lovelace', email: 'Ada@Example.com', phone: '0400 111 222', timezone: 'Australia/Perth' });
    expect(booked.status).toBe(200);
    const body = await json(booked);
    expect(body['messages'][0]).toMatchObject({ type: 'booking', booked: { title: 'Consultation', start: slot.start, end: slot.end, status: 'confirmed', location: 'Our office', cancel: true, change: true } });
    await w.settle();

    const row = w.db.raw.prepare('SELECT * FROM appointments').get() as Json;
    expect(row).toMatchObject({ status: 'confirmed', source: 'chat', provider: 'none', starts_at: slot.start, conversation_id: v.id, attendee_email: 'ada@example.com', slot_lock: String(slot.start) });
    const job = w.db.raw.prepare('SELECT * FROM jobs WHERE id = ?').get(row['job_id']) as Json;
    expect(job).toMatchObject({ source: 'booking', title: 'Consultation: Ada Lovelace', conversation_id: v.id });
    expect((w.db.raw.prepare('SELECT email FROM leads WHERE id = ?').get(job['lead_id']) as Json)['email']).toBe('ada@example.com');
    expect(w.db.raw.prepare("SELECT kind FROM job_events WHERE job_id = ? AND kind = 'appointment'").get(job['id'])).toBeTruthy();
    expect(delivered.map((d) => d['type'])).toEqual(expect.arrayContaining(['appointment.created', 'job.created']));
    // In the transcript, and in what the model reads next turn.
    const turn = w.db.raw.prepare("SELECT text FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY ts DESC").get(v.id) as Json;
    expect(turn['text']).toMatch(/^Booked /);

    // The same press again: the same appointment, not a second one.
    const again = await json(await v.book({ slot: slot.id, name: 'Ada Lovelace', email: 'ada@example.com' }));
    expect(again['messages'][0].booked.id).toBe(body['messages'][0].booked.id);
    expect((w.db.raw.prepare('SELECT count(*) AS n FROM appointments').get() as Json)['n']).toBe(1);

    // Someone else, the same time: taken. And it is no longer offered.
    const other = await w.visitor();
    const otherSlots = await json(await other.slots());
    expect(otherSlots['days'][0].slots.some((s: Json) => s.start === slot.start)).toBe(false);
    const forged = await other.book({ slot: slot.id, name: 'Bob', email: 'bob@example.com' });
    expect(forged.status).toBe(400);
    const theirs = otherSlots['days'][0].slots.find((s: Json) => s.start < slot.start + 3_600_000 && s.start > slot.start - 3_600_000 && s.start !== slot.start);
    if (theirs) {
      // An overlapping time is not offered either: both are 30 minutes from the same hours.
      expect(Math.abs(theirs.start - slot.start)).toBeGreaterThanOrEqual(30 * 60_000);
    }
  });

  it('moves and cancels from the chat, only this chat\'s appointment', async () => {
    const w = await picker();
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
    const v = await w.visitor();
    const slots = await json(await v.slots());
    const [first, second] = [slots['days'][0].slots[0], slots['days'][0].slots[4]];
    const made = (await json(await v.book({ slot: first.id, name: 'Ada', email: 'ada@example.com' })))['messages'][0].booked;

    const moving = await json(await v.slots({ reschedule: made.id }));
    const target = moving['days'][0].slots.find((s: Json) => s.start === second.start);
    const moved = await json(await v.book({ slot: target.id, name: 'Ada', email: 'ada@example.com', reschedule: made.id }));
    expect(moved['messages'][0].booked).toMatchObject({ id: made.id, start: second.start });
    expect((w.db.raw.prepare('SELECT slot_lock FROM appointments WHERE id = ?').get(made.id) as Json)['slot_lock']).toBe(String(second.start));

    const stranger = await w.visitor();
    expect((await stranger.cancel(made.id)).status).toBe(404);
    const cancelled = await json(await v.cancel(made.id));
    expect(cancelled['messages'][0].booked).toMatchObject({ id: made.id, status: 'cancelled' });
    expect(cancelled['messages'][0].booked.cancel).toBeUndefined();
    expect(w.db.raw.prepare('SELECT status, slot_lock FROM appointments WHERE id = ?').get(made.id)).toMatchObject({ status: 'cancelled', slot_lock: null });
    // The time is free again.
    const free = await json(await stranger.slots());
    expect(free['days'][0].slots.some((s: Json) => s.start === second.start)).toBe(true);
  });

  it('refuses the picker\'s calls when the site does not book in the chat, and asks for a phone when told to', async () => {
    const off = await world();
    const started = await chat(off.h);
    expect((await off.h.post('/v1/sessions/booking/slots', {}, { headers: { Authorization: `Bearer ${started.token}` } })).status).toBe(404);

    const w = await picker({ phone: 'required' });
    const v = await w.visitor();
    const slot = (await json(await v.slots()))['days'][0].slots[0];
    const noPhone = await v.book({ slot: slot.id, name: 'Ada', email: 'ada@example.com' });
    expect([noPhone.status, (await json(noPhone))['error'].message]).toEqual([400, 'Please add a phone number.']);
    expect((await v.book({ slot: slot.id, name: 'Ada', email: 'not-an-email' })).status).toBe(400);
  });

  it('puts the button on the home screen and the picker in the assistant\'s hands', async () => {
    const w = await picker();
    const config = (await json(await w.h.fetch('/v1/sites/demo/config')))['widget'];
    expect(config.home.shortcuts[0]).toMatchObject({ id: 'booking', label: 'Book a time', action: { kind: 'booking' } });
    // The echo backend has no show_booking: a question about booking gets the button.
    const v = await w.visitor();
    const reply = await json(await w.h.post('/v1/sessions/messages', { clientId: 'c1', kind: 'text', text: 'Can I book an appointment?' }, { headers: { Authorization: `Bearer ${v.token}` } }));
    expect(reply['messages'].at(-1)).toMatchObject({ type: 'card', actions: [{ kind: 'booking' }] });
  });
});

describe('appointments in the dashboard and the API', () => {
  it('books by hand on a job, refuses an overlap unless forced, moves, marks and deletes', async () => {
    const w = await picker();
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
    const job = await json(await w.owner.send('POST', '/jobs', { title: 'Hot water', contact: { name: 'Grace Hopper', email: 'grace@example.com' } }));
    const start = Date.now() + 3 * 86_400_000;
    const made = await w.owner.send('POST', '/appointments', { start: new Date(start).toISOString(), duration: 60, jobId: job['id'], title: 'Site visit' });
    expect(made.status).toBe(201);
    const a = await json(made);
    expect(a).toMatchObject({ title: 'Site visit', end: a['start'] + 3_600_000, source: 'dashboard', job: { id: job['id'], number: job['number'] }, contact: { name: 'Grace Hopper' }, attendee: { email: 'grace@example.com' } });

    const clash = await w.owner.send('POST', '/appointments', { start: new Date(start + 30 * 60_000).toISOString(), contact: { name: 'Bob' } });
    expect(clash.status).toBe(409);
    expect((await w.owner.send('POST', '/appointments', { start: new Date(start + 30 * 60_000).toISOString(), contact: { name: 'Bob' }, force: true })).status).toBe(201);

    const list = await json(await w.owner.get(`/appointments?job=${job['id']}`));
    expect(list['items']).toHaveLength(1);
    const moved = await json(await w.owner.send('PATCH', `/appointments/${a['id']}`, { start: new Date(start + 86_400_000).toISOString() }));
    expect(moved['start']).toBe(a['start'] + 86_400_000);
    expect(await json(await w.owner.send('PATCH', `/appointments/${a['id']}`, { status: 'completed', notes: 'Done, quote to follow' }))).toMatchObject({ status: 'completed', notes: 'Done, quote to follow' });
    expect((await w.owner.send('PATCH', `/appointments/${a['id']}`, { status: 'busy' })).status).toBe(400);
    const detail = await json(await w.owner.get(`/jobs/${job['id']}`));
    expect(detail['history'].filter((e: Json) => e.kind === 'appointment').map((e: Json) => e.data.change)).toEqual(['booked', 'moved']);

    // A member sees and books, but does not delete.
    const member = await w.member();
    expect((await member.get('/appointments')).status).toBe(200);
    expect((await member.send('DELETE', `/appointments/${a['id']}`)).status).toBe(403);
    expect(await json(await w.owner.send('DELETE', `/appointments/${a['id']}`))).toEqual({ id: a['id'], deleted: true });
  });

  it('says appointments are off without the date picker', async () => {
    const w = await world();
    const off = await w.owner.get('/appointments');
    expect([off.status, (await json(off))['error'].message]).toEqual([400, expect.stringContaining('turn on the date picker')]);
    const status = await json(await w.owner.get('/bookings'));
    expect(status).toMatchObject({ effective: { mode: 'none', chosen: false }, calendar: { sync: 'none' } });
  });

  it('saves the bookings settings: a mode, hours, and null hands the choice back to the website', async () => {
    const w = await world();
    const saved = await json(await w.owner.send('PUT', '/settings', { settings: { bookings: { mode: 'picker', duration: 45, hours: { ...ALL_DAY, sun: [] } } } }));
    expect(saved['settings'].bookings).toMatchObject({ mode: 'picker', duration: 45, sync: 'none', createMeetingLink: true });
    const withoutMeet = await json(await w.owner.send('PUT', '/settings', { settings: { bookings: { createMeetingLink: false } } }));
    expect(withoutMeet['settings'].bookings.createMeetingLink).toBe(false);
    expect((await json(await w.owner.get('/me')))['sites'][0].bookings).toBe('picker');
    const bad = await w.owner.send('PUT', '/settings', { settings: { bookings: { hours: { ...ALL_DAY, mon: ['17:00-09:00'] } } } });
    expect(bad.status).toBe(400);
    const back = await json(await w.owner.send('PUT', '/settings', { settings: { bookings: { mode: null } } }));
    expect(back['settings'].bookings.mode).toBeUndefined();

    // A link found on the website is offered while no mode is chosen.
    const kv = w.env['HELPPUFF_KV'] as KvStore;
    await kv.put('booking:demo', JSON.stringify({ url: 'https://calendly.com/acme/intro', provider: 'Calendly', page: null, at: 1 }));
    const { forgetFoundBooking } = await import('../src/bookings/found.js');
    forgetFoundBooking();
    const site = await resolveSite({ config: { sites: { demo: siteConfigSchema.parse({ origins: ['https://example.com'], connector: { type: 'echo' } }) } } as never, platform: { kv, log: () => {} } }, 'demo');
    expect(site.bookingFound?.url).toBe('https://calendly.com/acme/intro');
  });

  it('keeps integration keys sealed, checks them, and syncs Cal.com both ways', async () => {
    const w = await picker({ sync: 'calcom', eventType: '1234' });
    const start = Date.now() + 2 * 86_400_000;
    const calls: { url: string; method: string; headers: Record<string, string>; body: Json | null }[] = [];
    let cancelledInCalcom = false;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      calls.push({ url: String(url), method: init.method ?? 'GET', headers, body: init.body ? JSON.parse(String(init.body)) : null });
      const u = new URL(String(url));
      if (u.pathname === '/v2/event-types') return Response.json({ status: 'success', data: [{ id: 1234, title: '30 min intro', lengthInMinutes: 30 }] });
      if (u.pathname === '/v2/slots') {
        const day = new Date(start).toISOString().slice(0, 10);
        return Response.json({ status: 'success', data: { [day]: [{ start: new Date(start).toISOString(), end: new Date(start + 1_800_000).toISOString() }] } });
      }
      if (u.pathname === '/v2/bookings' && init.method === 'POST') return Response.json({ status: 'success', data: { uid: 'bk_uid_1', start: new Date(start).toISOString(), end: new Date(start + 1_800_000).toISOString(), location: 'https://cal.com/video/x' } }, { status: 201 });
      if (u.pathname === '/v2/bookings' && (init.method ?? 'GET') === 'GET') {
        return Response.json({
          status: 'success',
          data: [
            { uid: 'bk_uid_1', start: new Date(start).toISOString(), end: new Date(start + 1_800_000).toISOString(), status: cancelledInCalcom ? 'cancelled' : 'accepted', title: 'Intro', attendees: [{ email: 'ada@example.com' }] },
            { uid: 'bk_uid_2', start: new Date(start + 86_400_000).toISOString(), end: new Date(start + 88_200_000).toISOString(), status: 'accepted', title: 'Someone else', attendees: [{ email: 'nobody@else.example' }] },
          ],
          pagination: { nextCursor: null, hasMore: false },
        });
      }
      return new Response('{}', { status: 200 });
    });

    const notConnected = await w.visitor();
    expect((await notConnected.slots()).status).toBe(400);

    const savedResponse = await w.owner.send('PUT', '/integrations/calcom', { key: 'cal_live_secret_key' });
    const saved = await json(savedResponse);
    expect(saved).toMatchObject({ kind: 'calcom', connected: true, check: { ok: true, detail: 'Connected: 1 event type.' } });
    expect(JSON.stringify(saved)).not.toContain('cal_live_secret_key');
    expect(String((w.db.raw.prepare('SELECT secret FROM integrations').get() as Json)['secret'])).not.toContain('cal_live');
    expect(calls.find((c) => c.url.endsWith('/v2/event-types'))!.headers).toMatchObject({ authorization: 'Bearer cal_live_secret_key', 'cal-api-version': '2024-06-14' });

    const v = await w.visitor();
    const slot = (await json(await v.slots()))['days'][0].slots[0];
    expect(calls.find((c) => c.url.includes('/v2/slots'))!.headers['cal-api-version']).toBe('2024-09-04');
    const booked = await json(await v.book({ slot: slot.id, name: 'Ada Lovelace', email: 'ada@example.com', phone: '+61 400 111 222', timezone: 'Australia/Perth' }));
    expect(booked['messages'][0].booked).toMatchObject({ location: 'https://cal.com/video/x' });
    const post = calls.find((c) => c.url.endsWith('/v2/bookings') && c.method === 'POST')!;
    expect(post.headers['cal-api-version']).toBe('2026-02-25');
    expect(post.body).toMatchObject({ start: new Date(start).toISOString(), eventTypeId: 1234, attendee: { name: 'Ada Lovelace', email: 'ada@example.com', timeZone: 'Australia/Perth', phoneNumber: '+61400111222' } });
    expect(w.db.raw.prepare('SELECT external_id, provider FROM appointments').get()).toMatchObject({ external_id: 'bk_uid_1', provider: 'calcom' });

    // The pull: someone not a contact is busy time; then a cancellation in Cal.com cancels here.
    const synced = await json(await w.owner.send('POST', '/appointments/sync', { force: true }));
    expect(synced).toMatchObject({ synced: true, added: 0, busy: 1, cancelled: 0 });
    cancelledInCalcom = true;
    expect(await json(await w.owner.send('POST', '/appointments/sync', { force: true }))).toMatchObject({ cancelled: 1 });
    expect((w.db.raw.prepare("SELECT status FROM appointments WHERE external_id = 'bk_uid_1'").get() as Json)['status']).toBe('cancelled');

    // Cal.com's webhook: signed, and it starts a sync.
    const secret = await calcomWebhookSecret(SECRET, 'demo');
    const raw = JSON.stringify({ triggerEvent: 'BOOKING_CREATED' });
    const { createHmac } = await import('node:crypto');
    const good = await w.h.fetch('/v1/integrations/calcom/demo', { method: 'POST', body: raw, headers: { 'x-cal-signature-256': createHmac('sha256', secret).update(raw).digest('hex') } });
    expect(good.status).toBe(200);
    expect((await w.h.fetch('/v1/integrations/calcom/demo', { method: 'POST', body: raw, headers: { 'x-cal-signature-256': 'bad' } })).status).toBe(401);
    expect(await verifyCalcomSignature(secret, raw, `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)).toBe(true);
  });

  it('the cron reads synced calendars when due and sends reminders a day ahead, once', async () => {
    const w = await picker();
    const delivered: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (String(url).startsWith('https://hooks.example.com')) delivered.push(JSON.parse(String(init.body))['type']);
      return new Response('{}', { status: 200 });
    });
    await w.owner.send('POST', '/webhooks', { url: 'https://hooks.example.com/r', events: ['appointment.reminder'] });
    const soon = Date.now() + 20 * 3_600_000;
    await w.owner.send('POST', '/appointments', { start: new Date(soon).toISOString(), contact: { name: 'Ada' } });
    w.db.raw.prepare('UPDATE appointments SET created_at = ?').run(Date.now() - 2 * 3_600_000);
    const site = siteConfigSchema.parse({ origins: ['https://example.com'], connector: { type: 'echo' }, ...pickerSite() });
    expect((await runScheduledBookings({ HELPPUFF_SECRET: SECRET }, w.db, { demo: site }, Date.now())).reminded).toBe(1);
    expect((await runScheduledBookings({ HELPPUFF_SECRET: SECRET }, w.db, { demo: site }, Date.now())).reminded).toBe(0);
    expect(delivered).toEqual(['appointment.reminder']);
  });
});

describe('the calendars\' clients, against their documented APIs', () => {
  const recorder = (answer: (url: URL, init: RequestInit) => unknown) => {
    const calls: { url: URL; init: RequestInit }[] = [];
    const fetcher = (async (input: string, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      const body = answer(url, init);
      return body instanceof Response ? body : Response.json(body);
    }) as typeof fetch;
    return { calls, fetcher };
  };

  it('Cal.com: a self-hosted base, slots as strings, cancel and reschedule', async () => {
    const { calls, fetcher } = recorder((url) => (url.pathname.endsWith('/slots') ? { data: { '2026-10-15': ['2026-10-15T00:00:00.000Z'] } } : url.pathname.endsWith('/reschedule') ? { data: { uid: 'new_uid', start: '2026-10-16T00:00:00.000Z', end: '2026-10-16T00:30:00.000Z' } } : {}));
    const cal = calcomCalendar({ key: 'k', baseUrl: 'https://cal.acme.example/api/v2/', eventType: '9', fetch: fetcher });
    expect(await cal.slots!({ start: 0, end: 1 }, 30)).toEqual([{ start: Date.parse('2026-10-15T00:00:00.000Z'), end: Date.parse('2026-10-15T00:30:00.000Z') }]);
    expect(calls[0]!.url.origin + calls[0]!.url.pathname).toBe('https://cal.acme.example/api/v2/slots');
    await cal.cancel('u 1', 'Changed plans');
    expect(calls[1]!.url.pathname).toBe('/api/v2/bookings/u%201/cancel');
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ cancellationReason: 'Changed plans' });
    expect(await cal.reschedule!('u1', 1, 2)).toMatchObject({ externalId: 'new_uid' });
    await expect(calcomCalendar({ key: 'k', eventType: null, fetch: fetcher }).slots!({ start: 0, end: 1 }, 30)).rejects.toThrow(/event type/);
  });

  it('Calendly: available times with their booking pages, a free plan finishes on Calendly, the pull reads invitees', async () => {
    const eventType = 'https://api.calendly.com/event_types/ET1';
    const { calls, fetcher } = recorder((url, init) => {
      if (url.pathname === '/event_type_available_times') return { collection: [{ status: 'available', start_time: '2026-10-15T00:00:00Z', invitees_remaining: 1, scheduling_url: 'https://calendly.com/acme/intro/2026-10-15T00:00:00Z' }] };
      if (url.pathname === '/invitees' && init.method === 'POST') return new Response(JSON.stringify({ title: 'Permission Denied', message: 'Upgrade to Standard' }), { status: 403 });
      if (url.pathname === '/users/me') return { resource: { uri: 'https://api.calendly.com/users/U1', name: 'Ada', email: 'ada@acme.example' } };
      if (url.pathname === '/scheduled_events') return { collection: url.searchParams.get('status') === 'active' ? [{ uri: 'https://api.calendly.com/scheduled_events/E1', start_time: '2026-10-15T00:00:00Z', end_time: '2026-10-15T00:30:00Z', name: 'Intro', event_type: eventType, location: { join_url: 'https://zoom.us/j/1' } }] : [], pagination: {} };
      if (url.pathname === '/scheduled_events/E1/invitees') return { collection: [{ email: 'grace@example.com', name: 'Grace' }] };
      return {};
    });
    let plan: string | null = null;
    const cal = calendlyCalendar({ key: 'k', eventType, fetch: fetcher, onPlan: (p) => (plan = p) });
    const slots = await cal.slots!({ start: Date.now(), end: Date.now() + 40 * 86_400_000 }, 30);
    expect(slots[0]).toMatchObject({ url: 'https://calendly.com/acme/intro/2026-10-15T00:00:00Z' });
    // Over 31 days is asked in two windows.
    expect(calls.filter((c) => c.url.pathname === '/event_type_available_times')).toHaveLength(2);
    const result = await cal.book({ start: slots[0]!.start, end: slots[0]!.end, title: 'Intro', attendee: { name: 'Ada Lovelace', email: 'ada@example.com', timezone: 'Australia/Perth' }, idem: 'x' }, { url: slots[0]!.url });
    expect(result).toEqual({ redirect: 'https://calendly.com/acme/intro/2026-10-15T00:00:00Z?name=Ada+Lovelace&email=ada%40example.com' });
    expect(plan).toBe('free');
    expect(cal.reschedule).toBeNull();
    const events = await cal.list({ start: 0, end: 1 });
    expect(events).toEqual([expect.objectContaining({ id: 'E1', attendees: [{ email: 'grace@example.com', name: 'Grace' }], cancelled: false, location: 'https://zoom.us/j/1' })]);
  });

  it('Composio: tools by slug with the site as the user, Google\'s and Graph\'s events read', async () => {
    const { calls, fetcher } = recorder((url, init) => {
      const slug = url.pathname.split('/').pop();
      const args = init.body ? (JSON.parse(String(init.body)) as Json)['arguments'] : {};
      if (slug === 'GOOGLECALENDAR_EVENTS_LIST') return { successful: true, data: { items: [{ id: 'g1', summary: 'Dentist', start: { dateTime: '2026-10-15T09:00:00+11:00' }, end: { dateTime: '2026-10-15T10:00:00+11:00' }, attendees: [{ email: 'me@acme.example', self: true }, { email: 'ada@example.com' }] }, { id: 'g2', summary: 'Lunch?', transparency: 'transparent', start: { dateTime: '2026-10-15T12:00:00+11:00' }, end: { dateTime: '2026-10-15T13:00:00+11:00' } }] } };
      if (slug === 'GOOGLECALENDAR_CREATE_EVENT') return { successful: true, data: { response_data: { id: 'g_new', hangoutLink: 'https://meet.google.com/abc' }, echo: args } };
      if (slug === 'OUTLOOK_GET_CALENDAR_VIEW') return { successful: true, data: { value: [{ id: 'o1', subject: 'Board', start: { dateTime: '2026-10-15T01:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-15T02:00:00.0000000', timeZone: 'UTC' }, showAs: 'busy', attendees: [{ emailAddress: { address: 'grace@example.com', name: 'Grace' } }] }] } };
      if (url.pathname.endsWith('/auth_configs') && init.method !== 'POST') return { items: [] };
      if (url.pathname.endsWith('/auth_configs')) return { auth_config: { id: 'ac_1' } };
      if (url.pathname.endsWith('/connected_accounts/link')) return { redirect_url: 'https://connect.composio.dev/link/x' };
      return { successful: false, error: 'nope' };
    });
    const client = composioClient({ key: 'ck', userId: 'acme', fetch: fetcher });
    const google = googleCalendar(client, { account: 'ca_1' });
    expect(await google.busy!({ start: 0, end: 1 })).toEqual([{ start: Date.parse('2026-10-15T09:00:00+11:00'), end: Date.parse('2026-10-15T10:00:00+11:00') }]);
    const list = JSON.parse(String(calls[0]!.init.body)) as Json;
    expect(calls[0]!.url.href).toBe('https://backend.composio.dev/api/v3.1/tools/execute/GOOGLECALENDAR_EVENTS_LIST');
    expect((calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('ck');
    expect(list).toMatchObject({ user_id: 'acme', connected_account_id: 'ca_1', arguments: { calendarId: 'primary', singleEvents: true } });
    const made = await google.book({ start: Date.parse('2026-10-15T00:00:00Z'), end: Date.parse('2026-10-15T00:30:00Z'), title: 'Consultation', attendee: { name: 'Ada', email: 'ada@example.com', timezone: 'Australia/Perth' }, idem: 'x' });
    expect(made).toMatchObject({ externalId: 'g_new', location: 'https://meet.google.com/abc' });
    expect((JSON.parse(String(calls[1]!.init.body)) as Json)['arguments']).toMatchObject({ start_datetime: '2026-10-15T08:00:00', end_datetime: '2026-10-15T08:30:00', timezone: 'Australia/Perth', attendees: ['ada@example.com'], create_meeting_room: true });
    await googleCalendar(client, { createMeetingLink: false }).book({ start: Date.parse('2026-10-15T00:00:00Z'), end: Date.parse('2026-10-15T00:30:00Z'), title: 'Consultation', attendee: { name: 'Ada', email: 'ada@example.com', timezone: 'Australia/Perth' }, idem: 'y' });
    expect((JSON.parse(String(calls[2]!.init.body)) as Json)['arguments']).toMatchObject({ create_meeting_room: false });
    const outlook = outlookCalendar(client, {});
    expect(await outlook.list({ start: 0, end: 1 })).toEqual([expect.objectContaining({ id: 'o1', start: Date.parse('2026-10-15T01:00:00Z'), busy: true, attendees: [{ email: 'grace@example.com', name: 'Grace' }] })]);
    expect(await client.connectLink('googlecalendar', 'https://chat.acme.example/admin/')).toBe('https://connect.composio.dev/link/x');
    expect(JSON.parse(String(calls.at(-2)!.init.body))).toEqual({ toolkit: { slug: 'googlecalendar' }, auth_config: { type: 'use_composio_managed_auth' } });
    expect(JSON.parse(String(calls.at(-1)!.init.body))).toEqual({ auth_config_id: 'ac_1', user_id: 'acme', callback_url: 'https://chat.acme.example/admin/' });
    await expect(client.execute('NOPE', {})).rejects.toThrow('nope');
  });
});
