/**
 * Appointments, as the widget and the server share them. Zod-free, so the
 * widget's booking chunk can import them (`@helppuff/protocol/bookings`).
 *
 * The assistant never books (wiki: AI-Booking-Tests): it opens a picker, the
 * visitor picks a time the server offered, and the server books it.
 */

/** How visitors book (Settings → Bookings): nothing, a link to another site, or the picker in the chat. */
export const BOOKING_MODES = ['none', 'link', 'picker'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

/** Which calendar the picker syncs with: where free time is read from and bookings are written. */
export const CALENDAR_SYNCS = ['none', 'calcom', 'calendly', 'google', 'outlook'] as const;
export type CalendarSync = (typeof CALENDAR_SYNCS)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Parts of the day the assistant may narrow the picker to. */
export const DAY_PARTS = ['morning', 'afternoon', 'evening'] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/** Hours (local, inclusive start) each part of the day covers. */
export const DAY_PART_HOURS: Record<DayPart, [number, number]> = { morning: [0, 12], afternoon: [12, 17], evening: [17, 24] };

/** A local picker the widget opens itself (a shortcut, a card's button): `bk_<suffix>`. */
export const BOOKING_PICKER_PREFIX = 'bk_';

/** One time the visitor can pick. `id` is signed by the server: only times it offered can be booked. */
export type BookingSlot = { id: string; start: number; end: number };
export type BookingDay = { date: string; slots: BookingSlot[] };

/** `POST /v1/sessions/booking/slots` { from?, to?, tz?, part?, reschedule? } */
export type BookingSlotsResponse = {
  /** The time zone the days are in (the visitor's, when it is valid). */
  timezone: string;
  days: BookingDay[];
  /** The first day after this window, when there may be more times. */
  next: string | null;
  /** What the visitor is asked for besides their name and email. */
  phone: 'off' | 'optional' | 'required';
  title: string;
  duration: number;
};

/** `POST /v1/sessions/booking` */
export type BookingRequest = {
  slot: string;
  name: string;
  email: string;
  phone?: string;
  timezone?: string;
  /** An appointment of this conversation to move to the new time. */
  reschedule?: string;
};

/** What the visitor's appointment looks like in the chat, after booking. */
export type BookedAppointment = {
  id: string;
  title: string;
  start: number;
  end: number;
  timezone: string;
  status: 'confirmed' | 'cancelled';
  location?: string;
  /** What the visitor may do from the chat. */
  cancel?: boolean;
  change?: boolean;
};

/** `YYYY-MM-DD` */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A booking time, in a time zone, the way every part of HelpPuff writes it: "Thu 15 Oct, 6:00 am". */
export function formatSlot(ms: number, timeZone: string, locale = 'en-AU'): string {
  try {
    const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(ms);
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(ms);
    return `${day}, ${time.replace(/\s?([ap])\.?m\.?$/i, (_m, x: string) => ` ${x.toLowerCase()}m`)}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}
