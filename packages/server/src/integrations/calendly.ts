import type { Calendar, ExternalEvent } from '../bookings/calendar.js';
import { arr, callJson, obj, ProviderError, str, time, type Fetcher } from './http.js';

/**
 * Calendly's API v2, with a personal access token. Checked against
 * Calendly's OpenAPI spec on 2026-10-11:
 *
 *  - available times: `GET /event_type_available_times` (a window of 31 days
 *    at most), each with the `scheduling_url` that books that very time;
 *  - booking: `POST /invitees` is for paid plans (Standard and above); a free
 *    plan gets 403, so the visitor finishes on Calendly's page for the time
 *    they picked and the sync reads the booking back;
 *  - the pull: `GET /scheduled_events` (status `active` or `canceled`), the
 *    invitees of an event for its attendee;
 *  - cancel: `POST /scheduled_events/{uuid}/cancellation`. There is no API to
 *    move a booking: it is moved with the invitee's reschedule link.
 */

const BASE = 'https://api.calendly.com';
const MAX_WINDOW = 31 * 86_400_000;

const uuidOf = (uri: string | null) => (uri ? (uri.split('/').pop() ?? null) : null);

export function calendlyCalendar(input: { key: string; eventType?: string | null; user?: string | null; plan?: string | null; fetch: Fetcher; onPlan?: (plan: 'free' | 'paid') => void }): Calendar {
  const call = (path: string, init: { method?: string; body?: unknown } = {}) => callJson(input.fetch, path.startsWith('https://') ? path : `${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${input.key}` } });
  const eventType = (): string => {
    if (!input.eventType || !/^https:\/\/api\.calendly\.com\/event_types\//.test(input.eventType)) throw new ProviderError(400, 'Choose the Calendly event type in Settings → Bookings.');
    return input.eventType;
  };
  let user = input.user ?? null;
  const me = async (): Promise<Record<string, unknown>> => obj(obj(await call('/users/me'))['resource']);
  const userUri = async () => (user ??= str((await me())['uri']));

  return {
    kind: 'calendly',
    async slots(window, duration) {
      const out: { start: number; end: number; url?: string }[] = [];
      // Calendly wants a start in the future and windows of 31 days at most.
      let from = Math.max(window.start, Date.now() + 60_000);
      while (from < window.end) {
        const to = Math.min(window.end, from + MAX_WINDOW);
        const params = new URLSearchParams({ event_type: eventType(), start_time: new Date(from).toISOString(), end_time: new Date(to).toISOString() });
        const body = obj(await call(`/event_type_available_times?${params}`));
        for (const raw of arr(body['collection'])) {
          const t = obj(raw);
          const start = time(t['start_time']);
          if (start === null || (t['status'] && t['status'] !== 'available')) continue;
          out.push({ start, end: start + duration * 60_000, ...(str(t['scheduling_url']) ? { url: str(t['scheduling_url'])! } : {}) });
        }
        from = to;
      }
      return out.sort((a, b) => a.start - b.start);
    },
    async book(b, slot) {
      const finish = () => {
        if (!slot?.url) throw new ProviderError(403, 'This Calendly plan cannot book from another site, and the time has no booking page.');
        const url = new URL(slot.url);
        // Calendly fills its form in from these.
        url.searchParams.set('name', b.attendee.name);
        url.searchParams.set('email', b.attendee.email);
        return { redirect: url.toString() };
      };
      if (input.plan === 'free') return finish();
      const invitee: Record<string, string> = { name: b.attendee.name, email: b.attendee.email, timezone: b.attendee.timezone };
      if (b.attendee.phone && /^\+\d{6,15}$/.test(b.attendee.phone.replace(/[\s()-]/g, ''))) invitee['text_reminder_number'] = b.attendee.phone.replace(/[\s()-]/g, '');
      try {
        const resource = obj(obj(await call('/invitees', { method: 'POST', body: { event_type: eventType(), start_time: new Date(b.start).toISOString(), invitee } }))['resource']);
        input.onPlan?.('paid');
        const meta: Record<string, string> = {};
        for (const key of ['cancel_url', 'reschedule_url', 'uri'] as const) if (str(resource[key])) meta[key] = str(resource[key])!;
        return { externalId: uuidOf(str(resource['event'])), start: b.start, end: b.end, meta };
      } catch (thrown) {
        // Free plan: Calendly says 403 for the Scheduling API.
        if (thrown instanceof ProviderError && thrown.status === 403) {
          input.onPlan?.('free');
          return finish();
        }
        throw thrown;
      }
    },
    async cancel(uuid, reason) {
      await call(`/scheduled_events/${encodeURIComponent(uuid)}/cancellation`, { method: 'POST', body: { reason: (reason ?? 'Cancelled').slice(0, 1000) } });
    },
    reschedule: null,
    async list(window) {
      const owner = await userUri();
      if (!owner) return [];
      const events: ExternalEvent[] = [];
      let invitees = 0;
      for (const status of ['active', 'canceled'] as const) {
        let token: string | null = null;
        for (let page = 0; page < 3; page++) {
          const params = new URLSearchParams({ user: owner, status, min_start_time: new Date(window.start).toISOString(), max_start_time: new Date(window.end).toISOString(), count: '100', sort: 'start_time:asc' });
          if (token) params.set('page_token', token);
          const body = obj(await call(`/scheduled_events?${params}`));
          for (const raw of arr(body['collection'])) {
            const e = obj(raw);
            const id = uuidOf(str(e['uri']));
            const start = time(e['start_time']);
            const end = time(e['end_time']);
            if (!id || start === null || end === null) continue;
            if (input.eventType && str(e['event_type']) && e['event_type'] !== input.eventType) continue;
            // Who booked: one more call an event, so only for the first few (the rest next time).
            let attendees: ExternalEvent['attendees'] = [];
            if (status === 'active' && invitees < 15) {
              invitees++;
              const list = obj(await call(`/scheduled_events/${encodeURIComponent(id)}/invitees?count=5`).catch(() => ({})));
              attendees = arr(list['collection']).flatMap((i) => {
                const email = str(obj(i)['email']);
                return email ? [{ email, name: str(obj(i)['name']) ?? undefined }] : [];
              });
            }
            const location = obj(e['location']);
            events.push({ id, start, end, title: str(e['name']) ?? 'Calendly event', attendees, cancelled: status === 'canceled', busy: true, location: str(location['join_url']) ?? str(location['location']) });
          }
          token = str(obj(body['pagination'])['next_page_token']);
          if (!token) break;
        }
      }
      return events;
    },
    async test() {
      const resource = await me();
      user = str(resource['uri']);
      const types = user ? obj(await call(`/event_types?${new URLSearchParams({ user, active: 'true', count: '100' })}`)) : {};
      const eventTypes = arr(types['collection']).flatMap((t) => {
        const o = obj(t);
        const uri = str(o['uri']);
        return uri ? [{ id: uri, name: str(o['name']) ?? 'Event type', duration: typeof o['duration'] === 'number' ? o['duration'] : null }] : [];
      });
      return {
        detail: `Connected as ${str(resource['name']) ?? str(resource['email']) ?? 'your Calendly account'}.`,
        meta: { user, account: str(resource['email']) },
        eventTypes,
      };
    },
  };
}
