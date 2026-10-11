import type { Calendar, ExternalEvent } from '../bookings/calendar.js';
import { arr, callJson, obj, ProviderError, str, time, type Fetcher } from './http.js';

/**
 * Cal.com's API v2, cloud or self-hosted (the instance's API base URL).
 * Checked against cal.com/docs on 2026-10-11: `cal-api-version` is per
 * endpoint (slots 2024-09-04, event types 2024-06-14, bookings 2026-02-25,
 * the bookings list 2026-05-01); a missing or older value falls back to an
 * older version of the endpoint.
 */

export const CALCOM_CLOUD = 'https://api.cal.com/v2';
const V = { slots: '2024-09-04', eventTypes: '2024-06-14', bookings: '2026-02-25', list: '2026-05-01' } as const;

export function calcomCalendar(input: { key: string; baseUrl?: string | null; eventType?: string | null; fetch: Fetcher }): Calendar {
  const base = (input.baseUrl || CALCOM_CLOUD).replace(/\/+$/, '');
  const call = (path: string, version: string, init: { method?: string; body?: unknown } = {}) =>
    callJson(input.fetch, `${base}${path}`, { ...init, headers: { Authorization: `Bearer ${input.key}`, 'cal-api-version': version } });
  const eventTypeId = (): number => {
    const id = Number(input.eventType);
    if (!input.eventType || !Number.isInteger(id) || id <= 0) throw new ProviderError(400, 'Choose the Cal.com event type in Settings → Bookings.');
    return id;
  };
  const booked = (data: Record<string, unknown>, fallback: { start: number; end: number }) => {
    const start = time(data['start']) ?? fallback.start;
    return {
      externalId: str(data['uid']),
      start,
      end: time(data['end']) ?? fallback.end,
      location: str(data['location']) ?? str(data['meetingUrl']),
    };
  };

  return {
    kind: 'calcom',
    async slots(window, duration) {
      const params = new URLSearchParams({ eventTypeId: String(eventTypeId()), start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString(), timeZone: 'UTC', format: 'range' });
      const body = obj(await call(`/slots?${params}`, V.slots));
      const out: { start: number; end: number }[] = [];
      for (const day of Object.values(obj(body['data']))) {
        for (const slot of arr(day)) {
          // Objects with start (and end, with format=range); the schema also allows plain strings.
          const start = typeof slot === 'string' ? time(slot) : time(obj(slot)['start']);
          if (start === null) continue;
          const end = typeof slot === 'string' ? null : time(obj(slot)['end']);
          out.push({ start, end: end ?? start + duration * 60_000 });
        }
      }
      return out.sort((a, b) => a.start - b.start);
    },
    async book(b) {
      const attendee: Record<string, string> = { name: b.attendee.name, email: b.attendee.email, timeZone: b.attendee.timezone };
      // Cal.com takes an international number only (+61…); anything else stays with HelpPuff's record.
      if (b.attendee.phone && /^\+\d{6,15}$/.test(b.attendee.phone.replace(/[\s()-]/g, ''))) attendee['phoneNumber'] = b.attendee.phone.replace(/[\s()-]/g, '');
      const body = obj(
        await call('/bookings', V.bookings, {
          method: 'POST',
          body: { start: new Date(b.start).toISOString(), eventTypeId: eventTypeId(), attendee, metadata: { helppuff: b.idem.slice(0, 500) } },
        }),
      );
      // A recurring event type answers with a list; the first is this booking.
      const data = Array.isArray(body['data']) ? obj(body['data'][0]) : obj(body['data']);
      return booked(data, b);
    },
    async cancel(uid, reason) {
      await call(`/bookings/${encodeURIComponent(uid)}/cancel`, V.bookings, { method: 'POST', body: { cancellationReason: (reason ?? 'Cancelled').slice(0, 500) } });
    },
    async reschedule(uid, start, end) {
      const body = obj(await call(`/bookings/${encodeURIComponent(uid)}/reschedule`, V.bookings, { method: 'POST', body: { start: new Date(start).toISOString(), reschedulingReason: 'Moved from HelpPuff' } }));
      const data = Array.isArray(body['data']) ? obj(body['data'][0]) : obj(body['data']);
      // A rescheduled booking gets its own uid (rescheduledToUid links them); keep the new one.
      return booked(data, { start, end });
    },
    async list(window) {
      const events: ExternalEvent[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page++) {
        const params = new URLSearchParams({ afterStart: new Date(window.start).toISOString(), beforeEnd: new Date(window.end).toISOString(), limit: '100' });
        if (input.eventType) params.set('eventTypeId', String(input.eventType));
        if (cursor) params.set('cursor', cursor);
        const body = obj(await call(`/bookings?${params}`, V.list));
        for (const raw of arr(body['data'])) {
          const b = obj(raw);
          const uid = str(b['uid']);
          const start = time(b['start']);
          const end = time(b['end']);
          if (!uid || start === null || end === null) continue;
          const status = String(b['status'] ?? '').toLowerCase();
          events.push({
            id: uid,
            start,
            end,
            title: str(b['title']) ?? 'Booking',
            attendees: arr(b['attendees']).flatMap((a) => {
              const email = str(obj(a)['email']);
              return email ? [{ email, name: str(obj(a)['name']) ?? undefined }] : [];
            }),
            cancelled: status === 'cancelled' || status === 'rejected',
            busy: true,
            location: str(b['location']),
          });
        }
        const pagination = obj(body['pagination']);
        cursor = str(pagination['nextCursor']);
        if (!cursor || pagination['hasMore'] === false) break;
      }
      return events;
    },
    async test() {
      const body = obj(await call('/event-types', V.eventTypes));
      // The 2024-06-14 list is an array; older answers grouped them.
      const raw = Array.isArray(body['data']) ? body['data'] : arr(obj(body['data'])['eventTypeGroups']).flatMap((g) => arr(obj(g)['eventTypes']));
      const eventTypes = raw.flatMap((e) => {
        const o = obj(e);
        const id = o['id'];
        if (typeof id !== 'number' && typeof id !== 'string') return [];
        const length = Number(o['lengthInMinutes'] ?? o['length']);
        return [{ id: String(id), name: str(o['title']) ?? str(o['slug']) ?? String(id), duration: Number.isFinite(length) ? length : null }];
      });
      return { detail: eventTypes.length ? `Connected: ${eventTypes.length} event type${eventTypes.length === 1 ? '' : 's'}.` : 'Connected, but there are no event types yet: make one in Cal.com.', eventTypes };
    },
  };
}
