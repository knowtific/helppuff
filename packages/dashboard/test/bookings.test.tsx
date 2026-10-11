import { afterEach, describe, expect, it } from 'vitest';
import { BookingsSettings } from '../src/components/BookingsSettings';
import { Integrations } from '../src/components/Integrations';
import { Calendar } from '../src/pages/Calendar';
import type { Appointment, BookingsSettings as Bookings, Me } from '../src/lib/api';
import { button, byText, click, fakeApi, flush, mount, type, unmount } from './helpers';

/** Appointments in the dashboard: Settings → Bookings, Settings → Integrations, and the Calendar. */

afterEach(async () => {
  await unmount();
});

const HOURS = { mon: ['09:00-17:00'], tue: ['09:00-17:00'], wed: ['09:00-17:00'], thu: ['09:00-17:00'], fri: ['09:00-17:00'], sat: [], sun: [] };
const bookings = (over: Partial<Bookings> = {}): Bookings => ({ label: 'Book a time', sync: 'none', title: 'Appointment', duration: 30, hours: HOURS, buffer: 0, notice: 120, daysAhead: 30, phone: 'optional', syncMinutes: 15, ...over });
const view = (b: Bookings) => ({ site: 'acme', connector: 'assistant', settings: { accent: '#5B5BF7', bookings: b }, hash: 'h', meta: null });
const status = (mode: 'none' | 'link' | 'picker', found: unknown = null, chosen = false) => ({
  site: 'acme',
  effective: { mode, link: mode === 'link' ? 'https://calendly.com/acme/intro' : null, label: 'Book a time', chosen },
  found,
  timezone: 'Australia/Melbourne',
  calendar: { sync: 'none', integration: null, ready: true },
  syncedAt: null,
  upcoming: 0,
});
const SLOTS = { timezone: 'Australia/Melbourne', days: [{ date: '2026-10-15', slots: [{ start: Date.UTC(2026, 9, 14, 22), end: Date.UTC(2026, 9, 14, 22, 30) }] }], next: '2026-10-22', title: 'Appointment', duration: 30, phone: 'optional' };

describe('Settings → Bookings', () => {
  it('shows the link found on the website until the owner chooses, then saves the date picker with its hours', async () => {
    let saved: Bookings = bookings();
    const calls = fakeApi({
      'GET /settings': () => view(saved),
      'GET /bookings': () => status(saved.mode ?? 'link', { url: 'https://calendly.com/acme/intro', provider: 'Calendly', page: null, at: 1 }, Boolean(saved.mode)),
      'GET /bookings/slots': SLOTS,
      'PUT /settings': (c: { body: unknown }) => {
        saved = { ...saved, ...((c.body as { settings: { bookings: Bookings } }).settings.bookings) };
        return view(saved);
      },
    });
    const page = await mount(<BookingsSettings />);
    expect(byText(page, /the booking link found on your website/)).toBeTruthy();
    expect(byText(page, 'https://calendly.com/acme/intro')).toBeTruthy();

    await click(byText(page, 'Date picker in the chat'));
    expect(byText(page, /The AI suggests times but never books/)).toBeTruthy();
    expect(page.querySelector('[aria-label="Calendar to sync with"]')).toBeTruthy();
    // Saturday on, then save.
    const saturday = [...page.querySelectorAll('label')].find((l) => l.textContent === 'Saturday')!.querySelector('input')!;
    await click(saturday);
    await click(button(page, 'Save'));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect((put.body as { settings: { bookings: Bookings } }).settings.bookings).toMatchObject({ mode: 'picker', hours: { ...HOURS, sat: ['09:00-17:00'] } });
    expect(byText(page, /Saved. Live on the widget/)).toBeTruthy();
    // The preview: the real free times, then the details and a Book that books nothing.
    await flush();
    const time = [...page.querySelectorAll('[aria-label="Preview of the date picker"] button')].find((b) => /\d:\d\d/.test(b.textContent ?? ''));
    await click(time);
    await click(button(page.querySelector('[aria-label="Preview of the date picker"]')!, 'Book'));
    expect(byText(page, 'A preview: nothing was booked.')).toBeTruthy();
  });

  it('asks for the event type with a calendar that has them, and links to Integrations', async () => {
    fakeApi({
      'GET /settings': view(bookings({ mode: 'picker', sync: 'calcom' })),
      'GET /bookings': status('picker', null, true),
      'GET /bookings/slots': SLOTS,
      'POST /bookings/test': { ok: true, detail: 'Connected: 2 event types.', eventTypes: [{ id: '11', name: '30 min intro', duration: 30 }, { id: '12', name: 'Site visit', duration: 60 }] },
    });
    const page = await mount(<BookingsSettings />);
    await flush();
    expect(byText(page, 'Connected: 2 event types.')).toBeTruthy();
    expect(byText(page, '30 min intro · 30 min')).toBeTruthy();
    expect(page.querySelector('a[href="#/settings/integrations"]')).toBeTruthy();
    // The event type sets the length and hours: no hours here.
    expect(page.querySelector('[aria-label="When"]')).toBeNull();
  });
});

describe('Settings → Integrations', () => {
  it('saves a key without showing it again, and says what the check found', async () => {
    const calls = fakeApi({
      'GET /integrations': {
        items: (['composio', 'calcom', 'calendly'] as const).map((kind) => ({ kind, name: kind === 'calcom' ? 'Cal.com' : kind === 'composio' ? 'Composio' : 'Calendly', connected: false, baseUrl: null, status: 'none', lastError: null, lastAt: null, account: null, plan: null, createdAt: null, updatedAt: null })),
        help: { composio: { name: 'Composio', key: 'API key', help: 'c' }, calcom: { name: 'Cal.com', key: 'API key (cal_live_…)', help: 'k' }, calendly: { name: 'Calendly', key: 'Personal access token', help: 't' } },
      },
      'PUT /integrations/calcom': { kind: 'calcom', name: 'Cal.com', connected: true, status: 'ok', check: { ok: true, detail: 'Connected: 1 event type.' } },
    });
    const page = await mount(<Integrations />);
    const card = page.querySelector('[aria-label="Cal.com"]')!;
    await type(card.querySelector('input[type="password"]'), 'cal_live_abc');
    await click(button(card, 'Connect'));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ key: 'cal_live_abc', baseUrl: null });
    expect(byText(card, /Connected: 1 event type./)).toBeTruthy();
    expect((card.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('');
  });
});

describe('the Calendar', () => {
  const me = { admin: { email: 'owner@acme.com', owner: true, role: 'owner' }, sites: [{ id: 'acme', name: 'Acme', bookings: 'picker' }], summaries: true } as unknown as Me;
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const appointment: Appointment = {
    id: 'apt_1',
    title: 'Site visit',
    start: start.getTime(),
    end: start.getTime() + 3_600_000,
    startIso: start.toISOString(),
    endIso: new Date(start.getTime() + 3_600_000).toISOString(),
    timezone: 'Australia/Sydney',
    status: 'confirmed',
    source: 'chat',
    provider: 'none',
    externalId: null,
    location: 'Balmain',
    notes: null,
    attendee: { name: 'Ada Lovelace', email: 'ada@example.com', phone: null },
    job: { id: 'job_1', number: 1042, title: 'Hot water' },
    contact: { id: 'lead_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    conversationId: 'conv_1',
    rescheduleUrl: null,
    createdBy: 'Ada',
    createdAt: 1,
    updatedAt: 1,
    syncedAt: null,
  };

  it('shows the appointments in the week and opens one to mark it completed', async () => {
    const calls = fakeApi({
      'GET /appointments': { items: [appointment] },
      'GET /bookings': status('picker', null, true),
      'GET /settings': view(bookings({ mode: 'picker' })),
      'PATCH /appointments/apt_1': { ...appointment, status: 'completed' },
    });
    localStorage.setItem('hp-calendar-view', 'week');
    const page = await mount(<Calendar me={me} />);
    await flush();
    const block = [...page.querySelectorAll('button')].find((b) => b.textContent?.includes('Site visit'));
    expect(block?.textContent).toContain('Ada Lovelace');
    await click(block);
    const dialog = page.querySelector('[role="dialog"]')!;
    expect(byText(dialog, '#1042 Hot water')).toBeTruthy();
    expect(dialog.querySelector('a[href="#/conversations/conv_1"]')).toBeTruthy();
    await click(button(dialog, 'Completed'));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ status: 'completed' });
    // A calendar synced with nothing has nothing to read on opening.
    expect(calls.some((c) => c.path === '/appointments/sync')).toBe(false);
  });
});
