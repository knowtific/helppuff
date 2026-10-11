import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountBooking, type BookingOptions } from '../src/booking/index.js';
import { parseMessage } from '../src/app/validate.js';

/**
 * The booking chunk: the picker (days, times, details, Book) and the
 * appointment card (Change time, Cancel), against a fake server. The
 * visitor books; nothing here decides a time.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const DAY1 = Date.UTC(2026, 9, 14, 22); // Thu 15 Oct, 6:00 am in Perth
const slots = {
  timezone: 'Australia/Perth',
  title: 'Consultation',
  duration: 30,
  phone: 'optional',
  next: '2026-10-22',
  days: [
    { date: '2026-10-15', slots: [{ id: 's.a', start: DAY1, end: DAY1 + 1_800_000 }, { id: 's.b', start: DAY1 + 3_600_000, end: DAY1 + 5_400_000 }] },
    { date: '2026-10-16', slots: [{ id: 's.c', start: DAY1 + 86_400_000, end: DAY1 + 88_200_000 }] },
  ],
};

type Call = { url: string; method: string; body: Record<string, unknown> | null };

function server(answer: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null };
    calls.push(call);
    const { status = 200, body } = answer(call);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetcher };
}

function mount(options: Partial<BookingOptions> & Pick<BookingOptions, 'fetch'>) {
  const root = document.createElement('div');
  document.body.append(root);
  const added: unknown[] = [];
  let consumed = false;
  const handle = mountBooking(root, {
    apiBase: 'https://chat.example',
    token: () => 'tok',
    message: { id: 'bk_1' },
    consumed: false,
    onConsumed: () => (consumed = true),
    onMessages: (messages) => added.push(...messages),
    lead: () => ({ name: 'Ada Lovelace' }),
    ...options,
  });
  const buttons = () => [...root.querySelectorAll('button')];
  const button = (text: string | RegExp) => buttons().find((b) => (typeof text === 'string' ? b.textContent?.includes(text) : text.test(b.textContent ?? '')))!;
  return { root, added, handle, consumed: () => consumed, buttons, button };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('the picker', () => {
  it('shows the days and times the server offered, then books the one picked with the visitor\'s details', async () => {
    const { calls, fetcher } = server((call) =>
      call.url.endsWith('/slots')
        ? { body: slots }
        : { body: { messages: [{ id: 'bkd_1', ts: 1, role: 'agent', type: 'booking', booked: { id: 'apt_1', title: 'Consultation', start: DAY1 + 3_600_000, end: DAY1 + 5_400_000, timezone: 'Australia/Perth', status: 'confirmed', cancel: true, change: true } }] } },
    );
    const w = mount({ fetch: fetcher, message: { id: 'bk_1', from: '2026-10-15', part: 'morning' } });
    await flush();
    expect(calls[0]).toMatchObject({ url: 'https://chat.example/v1/sessions/booking/slots', method: 'POST', body: { from: '2026-10-15', part: 'morning' } });
    const days = w.root.querySelectorAll('.hpb-days button');
    expect(days).toHaveLength(2);
    expect(days[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(w.root.querySelectorAll('.hpb-times button')).toHaveLength(2);
    (days[1] as HTMLButtonElement).click();
    expect(w.root.querySelectorAll('.hpb-times button')).toHaveLength(1);
    (w.root.querySelector('.hpb-days button') as HTMLButtonElement).click();
    (w.root.querySelectorAll('.hpb-times button')[1] as HTMLButtonElement).click();

    // The details: the name the visitor already gave is filled in; the email is asked.
    const name = w.root.querySelector('input[name="name"]') as HTMLInputElement;
    const email = w.root.querySelector('input[name="email"]') as HTMLInputElement;
    expect(name.value).toBe('Ada Lovelace');
    expect(document.activeElement).toBe(email);
    w.root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(calls).toHaveLength(1);
    email.value = 'ada@example.com';
    w.root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls[1]).toMatchObject({ url: 'https://chat.example/v1/sessions/booking', method: 'POST', body: { slot: 's.b', name: 'Ada Lovelace', email: 'ada@example.com' } });
    expect(w.consumed()).toBe(true);
    expect(w.added).toHaveLength(1);
    expect(parseMessage(w.added[0])).toMatchObject({ type: 'booking', booked: { id: 'apt_1' } });
    expect(w.root.textContent).toContain('A time was picked.');
  });

  it('shows the times again with why, when the one picked was just taken', async () => {
    let gets = 0;
    const { fetcher } = server((call) => (call.url.endsWith('/slots') ? (gets++, { body: slots }) : { status: 409, body: { error: { code: 'conflict', message: 'That time was just taken. Please pick another.' } } }));
    const w = mount({ fetch: fetcher, lead: () => ({ name: 'Ada', email: 'ada@example.com' }) });
    await flush();
    (w.root.querySelector('.hpb-times button') as HTMLButtonElement).click();
    w.root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await flush();
    expect(gets).toBe(2);
    expect(w.root.querySelector('[role="alert"]')!.textContent).toBe('That time was just taken. Please pick another.');
    expect(w.root.querySelectorAll('.hpb-times button').length).toBeGreaterThan(0);
    expect(w.consumed()).toBe(false);
  });

  it('opens the provider\'s page when the visitor must finish there (a Calendly free plan)', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { fetcher } = server((call) => (call.url.endsWith('/slots') ? { body: slots } : { body: { redirect: 'https://calendly.com/acme/intro/x', messages: [{ id: 'l', ts: 1, role: 'agent', type: 'links', links: [{ label: 'Book', url: 'https://calendly.com/acme/intro/x' }] }] } }));
    const w = mount({ fetch: fetcher, lead: () => ({ name: 'Ada', email: 'ada@example.com' }) });
    await flush();
    (w.root.querySelector('.hpb-times button') as HTMLButtonElement).click();
    w.root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(open).toHaveBeenCalledWith('https://calendly.com/acme/intro/x', '_blank', 'noopener');
    expect(w.added).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('says so, with Try again, when the times cannot load', async () => {
    let fail = true;
    const { fetcher } = server(() => (fail ? { status: 503, body: { error: { code: 'connector_error', message: 'The calendar could not find free times.' } } } : { body: slots }));
    const w = mount({ fetch: fetcher });
    await flush();
    expect(w.root.textContent).toContain('The calendar could not find free times.');
    fail = false;
    w.button('Try again').click();
    await flush();
    expect(w.root.querySelectorAll('.hpb-times button')).toHaveLength(2);
  });
});

describe('the appointment card', () => {
  const booked = { id: 'bkd_1', booked: { id: 'apt_1', title: 'Consultation', start: Date.now() + 86_400_000, end: Date.now() + 88_200_000, timezone: 'Australia/Perth', status: 'confirmed' as const, location: 'Our office', cancel: true, change: true } };

  it('cancels after asking, and offers the picker again to change the time', async () => {
    const { calls, fetcher } = server(() => ({ body: { messages: [{ id: 'bkd_2', ts: 1, role: 'agent', type: 'booking', booked: { ...booked.booked, status: 'cancelled' } }] } }));
    const w = mount({ fetch: fetcher, message: booked });
    expect(w.root.textContent).toContain('Booked');
    expect(w.root.textContent).toContain('Our office');
    w.button('Cancel booking').click();
    expect(w.root.textContent).toContain('Cancel this appointment?');
    w.button('Keep it').click();
    expect(calls).toHaveLength(0);
    w.button('Cancel booking').click();
    w.button('Yes, cancel').click();
    await flush();
    expect(calls[0]).toMatchObject({ url: 'https://chat.example/v1/sessions/booking/cancel', body: { appointment: 'apt_1' } });
    expect(w.consumed()).toBe(true);
    expect(w.buttons()).toHaveLength(0);

    const other = mount({ fetch: fetcher, message: booked });
    other.button('Change time').click();
    expect(other.added[0]).toMatchObject({ type: 'booking', reschedule: 'apt_1' });
    expect(parseMessage(other.added[0])).not.toBeNull();
  });

  it('shows a cancelled or past appointment without actions', () => {
    const { fetcher } = server(() => ({ body: {} }));
    expect(mount({ fetch: fetcher, message: { ...booked, booked: { ...booked.booked, status: 'cancelled' } } }).buttons()).toHaveLength(0);
    expect(mount({ fetch: fetcher, message: { ...booked, booked: { ...booked.booked, start: 1, end: 2 } } }).buttons()).toHaveLength(0);
  });
});
