import { BOOKING_PICKER_PREFIX, DATE_RE, type DayPart, type Message } from '@helppuff/protocol';
import { messageId } from '@helppuff/connector-types';
import type { SiteConfig } from '../config/schema.js';
import { effectiveBooking } from './found.js';
import type { AppointmentView } from './store.js';

/**
 * Bookings in the conversation: the picker the assistant (or a button) opens,
 * the appointment card after booking, and slot ids the server signs, so only
 * a time it offered to this conversation can be booked.
 */

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();
const hmacKey = (secret: string) => {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(`helppuff-booking-slot:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keys.set(secret, key);
  }
  return key;
};
const b64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function signature(secret: string, siteId: string, sessionId: string, start: number, end: number): Promise<string> {
  return b64(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${siteId}\n${sessionId}\n${start}\n${end}`))).slice(0, 22);
}

/** `s.<start>.<end>.<signature>`: a time offered to this conversation. */
export async function signSlot(secret: string, siteId: string, sessionId: string, start: number, end: number): Promise<string> {
  return `s.${start.toString(36)}.${end.toString(36)}.${await signature(secret, siteId, sessionId, start, end)}`;
}

/** The time a slot id names, if this server offered it to this conversation. */
export async function verifySlot(secret: string, siteId: string, sessionId: string, id: unknown): Promise<{ start: number; end: number } | null> {
  if (typeof id !== 'string' || id.length > 80) return null;
  const [tag, s, e, sig] = id.split('.');
  if (tag !== 's' || !s || !e || !sig) return null;
  const start = parseInt(s, 36);
  const end = parseInt(e, 36);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 12 * 3_600_000) return null;
  const expected = await signature(secret, siteId, sessionId, start, end);
  // Compared in full, whatever differs first.
  let diff = expected.length ^ sig.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (sig.charCodeAt(i) || 0);
  return diff === 0 ? { start, end } : null;
}

export type PickerWindow = { from?: string; to?: string; part?: DayPart };

/** The picker, as a message: the widget asks the server for times when it shows it. */
export function pickerMessage(options: { text?: string; window?: PickerWindow; prefill?: { name?: string; email?: string; phone?: string }; reschedule?: string; now: number }): Message {
  const w = options.window ?? {};
  const prefill = Object.fromEntries(Object.entries(options.prefill ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v!.trim().slice(0, k === 'phone' ? 40 : 200)]));
  return {
    id: messageId('bkp'),
    ts: options.now,
    role: 'agent',
    type: 'booking',
    ...(options.text ? { text: options.text.slice(0, 600) } : {}),
    ...(w.from && DATE_RE.test(w.from) ? { from: w.from } : {}),
    ...(w.to && DATE_RE.test(w.to) ? { to: w.to } : {}),
    ...(w.part ? { part: w.part } : {}),
    ...(Object.keys(prefill).length ? { prefill } : {}),
    ...(options.reschedule ? { reschedule: options.reschedule } : {}),
  } as Message;
}

/** The appointment card, after booking (or cancelling). */
export function bookedMessage(appointment: AppointmentView, options: { canChange: boolean; now: number }): Message {
  const status = appointment.status === 'cancelled' ? 'cancelled' : 'confirmed';
  return {
    id: messageId('bkd'),
    ts: options.now,
    role: 'agent',
    type: 'booking',
    booked: {
      id: appointment.id,
      title: appointment.title.slice(0, 160),
      start: appointment.start,
      end: appointment.end,
      timezone: appointment.timezone,
      status,
      ...(appointment.location ? { location: appointment.location.slice(0, 300) } : {}),
      ...(status === 'confirmed' ? { cancel: true, change: options.canChange } : {}),
    },
  };
}

/** What the visitor's message would be in the record: "Booked Thu 15 Oct, 6:00 am". */
export const bookingLabel = (verb: string, when: string) => `${verb} ${when}`.slice(0, 200);

/** A visitor asking to book: offered the button, whatever backend runs the chat. */
const INTENT = /\b(book|booking|appointment|appointments|schedule|reschedule|reserve|reservation|consultation|available times?|availability|free slot|time slot|meet(ing)? (with|up)|come in|see (you|someone))\b/i;
export const wantsToBook = (text: string) => INTENT.test(text);

/**
 * The "Book a time" button after an answer about booking: for backends
 * without HelpPuff's assistant (whose `show_booking` opens the picker
 * itself), and for the booking link. Null when the site has no booking, or
 * the reply already has it.
 */
export function suggestedBooking(site: SiteConfig, visitorText: string, reply: readonly Message[], hasShowBooking: boolean, now: number): Message | null {
  const booking = effectiveBooking(site, site.bookingFound ?? null);
  if (booking.mode === 'none' || !wantsToBook(visitorText)) return null;
  if (reply.some((m) => m.type === 'booking')) return null;
  if (booking.mode === 'picker' && hasShowBooking) return null;
  if (booking.mode === 'link' && booking.link && reply.some((m) => JSON.stringify(m).includes(booking.link!))) return null;
  const action =
    booking.mode === 'link' && booking.link
      ? { id: 'booking', kind: 'url' as const, label: booking.label, url: booking.link, newTab: true }
      : { id: 'booking', kind: 'booking' as const, label: booking.label };
  return { id: messageId('bks'), ts: now, role: 'agent', type: 'card', title: booking.mode === 'link' ? 'Book online' : 'Pick a time', actions: [action] } as Message;
}

export const isLocalPicker = (id: string) => id.startsWith(BOOKING_PICKER_PREFIX);
