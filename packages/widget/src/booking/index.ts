import { BOOKING_PICKER_PREFIX, type BookingSlot, type BookingSlotsResponse } from '@helppuff/protocol/bookings';

/**
 * Booking in the chat: its own small chunk (`booking-*.js`), loaded only when
 * a booking message is shown, so sites without the date picker never
 * download it. No Preact and no Zod: plain DOM, styled by the widget's own
 * classes inside its shadow root.
 *
 * Two faces of one message type:
 *  - the picker: days, then times (the server's, signed), then name and
 *    email and **Book**. The server books; the assistant never does;
 *  - the appointment card, after booking: when, where, and Change time /
 *    Cancel from the chat.
 *
 * Fail-safe like the rest of the widget: nothing here throws into the host
 * page; a failure says so in the message and offers to try again.
 */

type BookingMessage = {
  id: string;
  text?: string;
  from?: string;
  to?: string;
  part?: 'morning' | 'afternoon' | 'evening';
  prefill?: { name?: string; email?: string; phone?: string };
  reschedule?: string;
  booked?: { id: string; title: string; start: number; end: number; timezone: string; status: 'confirmed' | 'cancelled'; location?: string; cancel?: boolean; change?: boolean };
};

export type BookingOptions = {
  apiBase: string;
  token: () => string | null | undefined;
  message: BookingMessage;
  consumed: boolean;
  onConsumed: () => void;
  /** New messages from the server (the appointment card, a link), for the app to validate and add. */
  onMessages: (messages: unknown[]) => void;
  /** What the visitor already told us (the pre-chat form, identify()). */
  lead: () => Record<string, string> | null | undefined;
  /** The site's string overrides (`widget.strings`). */
  strings?: Record<string, string> | undefined;
  /** For tests. */
  fetch?: typeof fetch;
  now?: () => number;
};

export type BookingHandle = { destroy: () => void };

const DEFAULTS: Record<string, string> = {
  bookingLabel: 'Book a time',
  bookingLoading: 'Finding free times…',
  bookingPickDay: 'Pick a day',
  bookingPickTime: 'Pick a time',
  bookingZone: 'Times are in {zone}.',
  bookingNone: 'No free times on these days.',
  bookingNoneAtAll: 'No times are free right now. Please ask us in the chat.',
  bookingLater: 'Later dates',
  bookingEarlier: 'Earlier dates',
  bookingName: 'Your name',
  bookingEmail: 'Email',
  bookingPhone: 'Phone',
  bookingPhoneOptional: 'Phone (optional)',
  bookingSubmit: 'Book',
  bookingMoveSubmit: 'Move to this time',
  bookingBusy: 'Booking…',
  bookingBack: 'Change time',
  bookingPicked: 'A time was picked.',
  bookingBooked: 'Booked',
  bookingCancelled: 'Cancelled',
  bookingCancel: 'Cancel booking',
  bookingCancelAsk: 'Cancel this appointment?',
  bookingCancelYes: 'Yes, cancel',
  bookingCancelNo: 'Keep it',
  bookingChange: 'Change time',
  bookingError: 'Something went wrong. Please try again.',
  bookingRetry: 'Try again',
  bookingRequired: 'Please fill this in.',
  bookingEmailInvalid: 'Please check your email address.',
};

const STYLE = `
.hpb { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: var(--hp-radius-md); background: var(--hp-surface); max-width: 92%; }
.hpb-head { font-size: var(--hp-text-md); font-weight: 600; letter-spacing: var(--hp-tracking-tight); }
.hpb-sub { font-size: var(--hp-text-xs); color: var(--hp-text-3); }
.hpb-days { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.hpb-days .hp-chip { flex: none; display: flex; flex-direction: column; align-items: center; gap: 0; min-width: 58px; padding: 6px 8px; line-height: 1.2; }
.hpb-day-w { font-size: var(--hp-text-xs); opacity: .8; }
.hpb .hp-chip[aria-pressed="true"], .hpb .hp-chip[aria-pressed="true"]:hover { background: var(--hp-accent); color: var(--hp-accent-fg); border-color: var(--hp-accent); }
.hpb-times { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; }
.hpb-times .hp-chip { justify-content: center; }
.hpb-nav { display: flex; gap: 8px; justify-content: space-between; }
.hpb-nav > :last-child { margin-inline-start: auto; }
.hpb-link { background: none; border: 0; padding: 4px 0; color: var(--hp-accent); font-size: var(--hp-text-sm); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.hpb-link[disabled] { opacity: .45; cursor: default; }
.hpb-when { font-size: var(--hp-text-md); font-weight: 600; }
.hpb-msg { font-size: var(--hp-text-sm); color: var(--hp-text-2); }
.hpb-err { font-size: var(--hp-text-sm); color: var(--hp-danger); }
.hpb-done { font-size: var(--hp-text-sm); color: var(--hp-text-3); padding: 2px 0; }
.hpb-badge { display: inline-flex; align-items: center; gap: 6px; font-size: var(--hp-text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--hp-accent); }
.hpb-badge.off { color: var(--hp-text-3); }
.hpb-card.off .hpb-when { text-decoration: line-through; color: var(--hp-text-3); }
.hpb-row { display: flex; flex-wrap: wrap; gap: 8px; }
.hpb-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

/** "Perth time" from "Australia/Perth"; the id itself when it has no city. */
function zoneName(zone: string): string {
  const city = zone.split('/').pop()?.replace(/_/g, ' ');
  return city && city !== zone ? `${city} time` : zone;
}

function fmt(ms: number, zone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}
const dayLabel = (date: string, zone: string) => fmt(Date.parse(`${date}T12:00:00Z`), 'UTC', { weekday: 'short', day: 'numeric', month: 'short' }) || zone;
const timeLabel = (ms: number, zone: string) => fmt(ms, zone, { hour: 'numeric', minute: '2-digit' });
const whenLabel = (start: number, end: number, zone: string) => `${fmt(start, zone, { weekday: 'long', day: 'numeric', month: 'long' })}, ${timeLabel(start, zone)} – ${timeLabel(end, zone)}`;

function visitorZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

type Problem = { status: number; message: string };

export function mountBooking(root: HTMLElement, options: BookingOptions): BookingHandle {
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const strings = { ...DEFAULTS, ...(options.strings ?? {}) };
  const t = (key: string, vars: Record<string, string> = {}) => (strings[key] ?? DEFAULTS[key] ?? key).replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? '');
  const message = options.message;
  const zone = visitorZone();
  let destroyed = false;
  let consumed = options.consumed;

  const style = el('style');
  style.textContent = STYLE;
  const live = el('div', { class: 'hpb-sr', 'aria-live': 'polite' });
  const body = el('div');
  root.replaceChildren(style, body, live);
  const say = (text: string) => {
    live.textContent = '';
    setTimeout(() => {
      if (!destroyed) live.textContent = text;
    }, 50);
  };

  async function call<T>(method: 'POST', path: string, payload?: unknown): Promise<T> {
    const token = options.token();
    if (!token) throw { status: 401, message: t('bookingError') } satisfies Problem;
    let response: Response;
    try {
      response = await doFetch(`${options.apiBase}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    } catch {
      throw { status: 0, message: t('bookingError') } satisfies Problem;
    }
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const error = json && typeof json['error'] === 'object' && json['error'] ? (json['error'] as Record<string, unknown>) : {};
      // The server's message is always safe to show a visitor.
      throw { status: response.status, message: typeof error['message'] === 'string' ? error['message'] : t('bookingError') } satisfies Problem;
    }
    return json as T;
  }

  const show = (...children: Child[]) => {
    if (destroyed) return;
    body.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  };

  // ------------------------------------------------------------ the card

  function card(): void {
    const b = message.booked!;
    const cancelled = b.status === 'cancelled';
    const past = b.start <= now();
    const actions = el('div', { class: 'hpb-row' });
    const error = el('p', { class: 'hpb-err', role: 'alert', hidden: true });
    const canAct = !cancelled && !past && !consumed;
    if (canAct && b.change) {
      const change = el('button', { type: 'button', class: 'hp-chip' }, t('bookingChange'));
      change.addEventListener('click', () => {
        consumed = true;
        options.onConsumed();
        options.onMessages([{ id: `${BOOKING_PICKER_PREFIX}${Math.random().toString(36).slice(2, 10)}`, ts: now(), role: 'agent', type: 'booking', reschedule: b.id }]);
        card();
      });
      actions.append(change);
    }
    if (canAct && b.cancel) {
      const cancel = el('button', { type: 'button', class: 'hp-chip' }, t('bookingCancel'));
      cancel.addEventListener('click', () => {
        const yes = el('button', { type: 'button', class: 'hp-chip' }, t('bookingCancelYes'));
        const no = el('button', { type: 'button', class: 'hp-chip' }, t('bookingCancelNo'));
        actions.replaceChildren(el('span', { class: 'hpb-msg' }, t('bookingCancelAsk')), yes, no);
        no.addEventListener('click', card);
        yes.addEventListener('click', () => void (async () => {
          yes.setAttribute('disabled', '');
          no.setAttribute('disabled', '');
          try {
            const result = await call<{ messages: unknown[] }>('POST', '/v1/sessions/booking/cancel', { appointment: b.id });
            consumed = true;
            options.onConsumed();
            options.onMessages(result.messages ?? []);
            card();
          } catch (thrown) {
            error.textContent = (thrown as Problem).message ?? t('bookingError');
            error.hidden = false;
            card();
          }
        })());
        yes.focus();
      });
      actions.append(cancel);
    }
    show(
      el(
        'div',
        { class: `hpb hpb-card${cancelled ? ' off' : ''}`, role: 'group', 'aria-label': `${b.title}: ${cancelled ? t('bookingCancelled') : t('bookingBooked')}` },
        el('span', { class: `hpb-badge${cancelled ? ' off' : ''}` }, cancelled ? t('bookingCancelled') : `✓ ${t('bookingBooked')}`),
        el('div', { class: 'hpb-head' }, b.title),
        el('div', { class: 'hpb-when' }, whenLabel(b.start, b.end, zone)),
        el('div', { class: 'hpb-sub' }, zone === b.timezone ? zoneName(zone) : `${zoneName(zone)} · ${timeLabel(b.start, b.timezone)} ${zoneName(b.timezone)}`),
        b.location ? el('div', { class: 'hpb-msg' }, b.location) : null,
        actions.childNodes.length ? actions : null,
        error,
      ),
    );
  }

  // ----------------------------------------------------------- the picker

  let range = { from: message.from ?? '', to: message.to ?? '' };
  const firstFrom = message.from ?? '';
  let data: BookingSlotsResponse | null = null;
  let day: string | null = null;

  async function load(focusDays = false): Promise<void> {
    show(el('div', { class: 'hpb', 'aria-busy': 'true' }, el('p', { class: 'hpb-msg' }, t('bookingLoading'))));
    // A POST: a same-origin GET would carry no Origin header for the server to check.
    const query = { tz: zone, ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}), ...(message.part ? { part: message.part } : {}), ...(message.reschedule ? { reschedule: message.reschedule } : {}) };
    try {
      data = await call<BookingSlotsResponse>('POST', '/v1/sessions/booking/slots', query);
    } catch (thrown) {
      failed((thrown as Problem).message, () => void load());
      return;
    }
    if (destroyed) return;
    day = data.days[0]?.date ?? null;
    days(focusDays);
  }

  function failed(text: string, retry: () => void): void {
    const again = el('button', { type: 'button', class: 'hp-chip' }, t('bookingRetry'));
    again.addEventListener('click', retry);
    show(el('div', { class: 'hpb' }, el('p', { class: 'hpb-err', role: 'alert' }, text), again));
  }

  function shift(direction: 1 | -1): void {
    if (!data) return;
    if (direction === 1 && data.next) range = { from: data.next, to: addDays(data.next, 6) };
    else if (direction === -1 && range.from) {
      const from = addDays(range.from, -7);
      range = { from: firstFrom && from < firstFrom ? firstFrom : from, to: addDays(from < firstFrom ? firstFrom : from, 6) };
    }
    void load(true);
  }

  function days(focus = false): void {
    if (!data) return;
    const d = data;
    const head = el('div', { class: 'hpb-head' }, message.reschedule ? t('bookingChange') : (message.text ?? d.title));
    const nav = el('div', { class: 'hpb-nav' });
    const atStart = !range.from || range.from <= (firstFrom || '');
    const earlier = el('button', { type: 'button', class: 'hpb-link', hidden: atStart }, `‹ ${t('bookingEarlier')}`);
    earlier.addEventListener('click', () => shift(-1));
    const later = el('button', { type: 'button', class: 'hpb-link', disabled: !d.next }, `${t('bookingLater')} ›`);
    later.addEventListener('click', () => shift(1));
    nav.append(earlier, later);
    if (!d.days.length) {
      show(el('div', { class: 'hpb', role: 'group', 'aria-label': t('bookingLabel') }, head, el('p', { class: 'hpb-msg' }, d.next ? t('bookingNone') : t('bookingNoneAtAll')), nav));
      say(d.next ? t('bookingNone') : t('bookingNoneAtAll'));
      return;
    }
    const strip = el('div', { class: 'hpb-days', role: 'group', 'aria-label': t('bookingPickDay') });
    for (const entry of d.days) {
      const [weekday = '', ...rest] = dayLabel(entry.date, d.timezone).split(/,?\s+/);
      const button = el('button', { type: 'button', class: 'hp-chip', 'aria-pressed': entry.date === day ? 'true' : 'false', 'aria-label': `${dayLabel(entry.date, d.timezone)}: ${entry.slots.length}` }, el('span', { class: 'hpb-day-w' }, weekday), el('span', {}, rest.join(' ')));
      button.addEventListener('click', () => {
        day = entry.date;
        days();
        (body.querySelector('.hpb-times .hp-chip') as HTMLElement | null)?.focus();
      });
      strip.append(button);
    }
    const slots = d.days.find((x) => x.date === day)?.slots ?? [];
    const times = el('div', { class: 'hpb-times', role: 'group', 'aria-label': t('bookingPickTime') });
    for (const slot of slots) {
      const button = el('button', { type: 'button', class: 'hp-chip' }, timeLabel(slot.start, d.timezone));
      button.addEventListener('click', () => details(slot));
      times.append(button);
    }
    show(el('div', { class: 'hpb', role: 'group', 'aria-label': t('bookingLabel') }, head, strip, times, el('p', { class: 'hpb-sub' }, t('bookingZone', { zone: zoneName(d.timezone) })), nav));
    if (focus) (body.querySelector('.hpb-days .hp-chip') as HTMLElement | null)?.focus();
  }

  function input(name: string, label: string, type: string, value: string, autocomplete: string, required: boolean) {
    const id = `hpb-${message.id}-${name}`.replace(/[^\w-]/g, '');
    const field = el('input', { id, class: 'hp-input', type, name, autocomplete, value, required: required ? true : undefined, 'aria-required': required ? 'true' : undefined }) as HTMLInputElement;
    field.value = value;
    const error = el('span', { class: 'hpb-err', id: `${id}-e`, hidden: true });
    const row = el('div', { class: 'hp-field' }, el('label', { for: id, class: 'hp-label-text' }, label), field, error);
    return { row, field, error };
  }

  function details(slot: BookingSlot): void {
    if (!data) return;
    const d = data;
    const lead = options.lead() ?? {};
    const prefill = message.prefill ?? {};
    const name = input('name', t('bookingName'), 'text', lead['name'] ?? prefill.name ?? '', 'name', true);
    const email = input('email', t('bookingEmail'), 'email', lead['email'] ?? prefill.email ?? '', 'email', true);
    const phone = d.phone === 'off' ? null : input('phone', d.phone === 'required' ? t('bookingPhone') : t('bookingPhoneOptional'), 'tel', lead['phone'] ?? prefill.phone ?? '', 'tel', d.phone === 'required');
    const error = el('p', { class: 'hpb-err', role: 'alert', hidden: true });
    const submit = el('button', { type: 'submit', class: 'hp-btn' }, message.reschedule ? t('bookingMoveSubmit') : t('bookingSubmit'));
    const back = el('button', { type: 'button', class: 'hpb-link' }, `‹ ${t('bookingBack')}`);
    back.addEventListener('click', () => {
      days();
      (body.querySelector('.hpb-times .hp-chip') as HTMLElement | null)?.focus();
    });
    const form = el(
      'form',
      { class: 'hpb', novalidate: true, 'aria-label': t('bookingLabel') },
      el('div', { class: 'hpb-when' }, whenLabel(slot.start, slot.end, d.timezone)),
      el('p', { class: 'hpb-sub' }, `${d.title} · ${zoneName(d.timezone)}`),
      message.reschedule ? null : name.row,
      message.reschedule ? null : email.row,
      message.reschedule ? null : phone?.row,
      error,
      submit,
      back,
    );
    const check = (f: { field: HTMLInputElement; error: HTMLElement }, problem: string | null) => {
      f.error.textContent = problem ?? '';
      f.error.hidden = !problem;
      if (problem) {
        f.field.setAttribute('aria-invalid', 'true');
        f.field.setAttribute('aria-describedby', f.error.id);
      } else f.field.removeAttribute('aria-invalid');
      return !problem;
    };
    form.addEventListener('submit', (event) => void submitted(event));
    const submitted = async (event: Event) => {
      event.preventDefault();
      if (!message.reschedule) {
        const ok = [
          check(name, name.field.value.trim() ? null : t('bookingRequired')),
          check(email, EMAIL.test(email.field.value.trim()) ? null : t('bookingEmailInvalid')),
          phone ? check(phone, d.phone === 'required' && !phone.field.value.trim() ? t('bookingRequired') : null) : true,
        ].every(Boolean);
        if (!ok) {
          (form.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus();
          return;
        }
      }
      submit.setAttribute('disabled', '');
      submit.textContent = t('bookingBusy');
      error.hidden = true;
      try {
        const result = await call<{ messages: unknown[]; redirect?: string }>('POST', '/v1/sessions/booking', {
          slot: slot.id,
          name: name.field.value.trim() || lead['name'] || 'Visitor',
          email: email.field.value.trim() || lead['email'] || '',
          ...(phone?.field.value.trim() ? { phone: phone.field.value.trim() } : {}),
          timezone: zone,
          ...(message.reschedule ? { reschedule: message.reschedule } : {}),
        });
        consumed = true;
        options.onConsumed();
        // The visitor finishes on the provider's page (a Calendly free plan): open it.
        if (result.redirect) {
          try {
            globalThis.open?.(result.redirect, '_blank', 'noopener');
          } catch {
            // The link is in the messages too.
          }
        }
        options.onMessages(result.messages ?? []);
        done();
      } catch (thrown) {
        const problem = thrown as Problem;
        submit.removeAttribute('disabled');
        submit.textContent = message.reschedule ? t('bookingMoveSubmit') : t('bookingSubmit');
        if (problem.status === 409 || problem.status === 400) {
          // Taken meanwhile, or no longer offered: the times again, with why.
          await load();
          const note = el('p', { class: 'hpb-err', role: 'alert' }, problem.message);
          body.querySelector('.hpb')?.insertBefore(note, body.querySelector('.hpb-days'));
          return;
        }
        error.textContent = problem.message ?? t('bookingError');
        error.hidden = false;
      }
    };
    show(form);
    say(whenLabel(slot.start, slot.end, d.timezone));
    (message.reschedule ? submit : name.field.value ? (email.field.value ? submit : email.field) : name.field).focus();
  }

  function done(): void {
    show(el('p', { class: 'hpb-done' }, `✓ ${t('bookingPicked')}`));
  }

  if (message.booked) card();
  else if (consumed) done();
  else void load();

  return {
    destroy: () => {
      destroyed = true;
      root.replaceChildren();
    },
  };
}
