import type { Calendar, ExternalEvent } from '../bookings/calendar.js';
import { localIso } from '../bookings/time.js';
import { arr, callJson, obj, ProviderError, str, time, type Fetcher } from './http.js';

/**
 * Composio: Google Calendar and Outlook without an OAuth app of the owner's
 * own (Composio holds the credentials; the owner signs in through a Connect
 * Link). REST v3.1, `x-api-key`. Checked against docs.composio.dev on
 * 2026-10-11:
 *
 *  - `POST /tools/execute/{slug}` { arguments, user_id, connected_account_id }
 *    → { data, successful, error };
 *  - `GET /connected_accounts` (user_ids, toolkit_slugs, statuses);
 *  - `GET|POST /auth_configs` (a Composio-managed one per toolkit), then
 *    `POST /connected_accounts/link` → { redirect_url }.
 *
 * The site id is Composio's user id, so each site sees only its own
 * accounts. Tool outputs are the provider's own shapes (Google's events,
 * Microsoft Graph's), read defensively.
 */

const BASE = 'https://backend.composio.dev/api/v3.1';
export const TOOLKITS = { google: 'googlecalendar', outlook: 'outlook' } as const;
export type ComposioToolkit = (typeof TOOLKITS)[keyof typeof TOOLKITS];

export function composioClient(input: { key: string; userId: string; fetch: Fetcher }) {
  const call = (path: string, init: { method?: string; body?: unknown } = {}) => callJson(input.fetch, `${BASE}${path}`, { ...init, headers: { 'x-api-key': input.key } });
  return {
    async execute(slug: string, args: Record<string, unknown>, account?: string | null): Promise<Record<string, unknown>> {
      const body = obj(await call(`/tools/execute/${encodeURIComponent(slug)}`, { method: 'POST', body: { arguments: args, user_id: input.userId, ...(account ? { connected_account_id: account } : {}) } }));
      if (body['successful'] === false) throw new ProviderError(502, str(body['error'])?.slice(0, 200) ?? 'The calendar refused the request.');
      // `data` is the tool's output; some tools wrap the provider's answer in `response_data`.
      const data = obj(body['data']);
      return Object.keys(obj(data['response_data'])).length ? obj(data['response_data']) : data;
    },
    /** The site's active connected accounts, for one toolkit or all. */
    async accounts(toolkit?: ComposioToolkit): Promise<{ id: string; toolkit: string; label: string; status: string }[]> {
      const params = new URLSearchParams({ user_ids: input.userId, limit: '50' });
      if (toolkit) params.set('toolkit_slugs', toolkit);
      const body = obj(await call(`/connected_accounts?${params}`));
      return arr(body['items']).flatMap((raw) => {
        const a = obj(raw);
        const id = str(a['id']);
        if (!id) return [];
        const val = obj(obj(a['state'])['val']);
        const label = str(a['alias']) ?? str(val['email']) ?? str(val['displayName']) ?? str(val['account_id']) ?? id;
        return [{ id, toolkit: str(obj(a['toolkit'])['slug']) ?? '', label, status: str(a['status']) ?? 'UNKNOWN' }];
      });
    },
    /** A Connect Link for the owner to sign in to a toolkit, with a Composio-managed auth config (made once). */
    async connectLink(toolkit: ComposioToolkit, callbackUrl?: string): Promise<string> {
      const configs = obj(await call(`/auth_configs?${new URLSearchParams({ toolkit_slug: toolkit, is_composio_managed: 'true' })}`));
      let configId = arr(configs['items']).map((c) => obj(c)).find((c) => c['status'] !== 'DISABLED')?.['id'];
      if (typeof configId !== 'string') {
        const made = obj(await call('/auth_configs', { method: 'POST', body: { toolkit: { slug: toolkit }, auth_config: { type: 'use_composio_managed_auth' } } }));
        configId = str(obj(made['auth_config'])['id']) ?? undefined;
      }
      if (typeof configId !== 'string') throw new ProviderError(502, 'Composio did not make an auth config for this calendar.');
      const link = obj(await call('/connected_accounts/link', { method: 'POST', body: { auth_config_id: configId, user_id: input.userId, ...(callbackUrl ? { callback_url: callbackUrl } : {}) } }));
      const url = str(link['redirect_url']);
      if (!url) throw new ProviderError(502, 'Composio did not return a sign-in link.');
      return url;
    },
  };
}
export type ComposioClient = ReturnType<typeof composioClient>;

/** An event list from a tool's output: Google's `items`, Graph's `value`, or a wrapper's `events`. */
function eventsOf(data: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ['items', 'value', 'events']) if (Array.isArray(data[key])) return (data[key] as unknown[]).map(obj);
  for (const inner of Object.values(data)) {
    const o = obj(inner);
    for (const key of ['items', 'value', 'events']) if (Array.isArray(o[key])) return (o[key] as unknown[]).map(obj);
  }
  return [];
}

/** The id of what a create made: at the top, or one level in. */
function idOf(data: Record<string, unknown>): string | null {
  if (str(data['id'])) return str(data['id']);
  for (const inner of Object.values(data)) if (str(obj(inner)['id'])) return str(obj(inner)['id']);
  return null;
}

/** A Graph `dateTimeTimeZone` asked for in UTC: no offset means UTC. */
const graphTime = (value: unknown): number | null => {
  const o = obj(value);
  const raw = str(o['dateTime']);
  if (!raw) return null;
  return time(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
};

export function googleCalendar(client: ComposioClient, input: { account?: string | null; calendar?: string | null }): Calendar {
  const calendarId = input.calendar || 'primary';
  const list = async (window: { start: number; end: number }): Promise<ExternalEvent[]> => {
    const data = await client.execute('GOOGLECALENDAR_EVENTS_LIST', { calendarId, timeMin: new Date(window.start).toISOString(), timeMax: new Date(window.end).toISOString(), singleEvents: true, maxResults: 250, showDeleted: true }, input.account);
    return eventsOf(data).flatMap((e) => {
      const id = str(e['id']);
      const start = time(obj(e['start'])['dateTime']) ?? time(obj(e['start'])['date']);
      const end = time(obj(e['end'])['dateTime']) ?? time(obj(e['end'])['date']);
      if (!id || start === null || end === null) return [];
      return [
        {
          id,
          start,
          end,
          title: str(e['summary']) ?? 'Busy',
          attendees: arr(e['attendees']).flatMap((a) => {
            const email = str(obj(a)['email']);
            return email && !obj(a)['self'] ? [{ email, name: str(obj(a)['displayName']) ?? undefined }] : [];
          }),
          cancelled: e['status'] === 'cancelled',
          busy: e['transparency'] !== 'transparent',
          location: str(e['hangoutLink']) ?? str(e['location']),
        },
      ];
    });
  };
  return {
    kind: 'google',
    async busy(window) {
      return (await list(window)).filter((e) => e.busy && !e.cancelled).map((e) => ({ start: e.start, end: e.end }));
    },
    async book(b) {
      const data = await client.execute(
        'GOOGLECALENDAR_CREATE_EVENT',
        {
          calendar_id: calendarId,
          summary: (b.attendee.name ? `${b.title}: ${b.attendee.name}` : b.title).slice(0, 200),
          start_datetime: localIso(b.start, b.attendee.timezone),
          end_datetime: localIso(b.end, b.attendee.timezone),
          timezone: b.attendee.timezone,
          attendees: b.attendee.email ? [b.attendee.email] : [],
          description: [b.notes, b.attendee.phone ? `Phone: ${b.attendee.phone}` : null, 'Booked in the chat (HelpPuff).'].filter(Boolean).join('\n'),
          send_updates: 'all',
          // A meeting link only when the business did not say where it happens.
          create_meeting_room: !b.location,
          ...(b.location ? { location: b.location } : {}),
        },
        input.account,
      );
      return { externalId: idOf(data), start: b.start, end: b.end, location: str(data['hangoutLink']) ?? b.location ?? null };
    },
    async cancel(id) {
      await client.execute('GOOGLECALENDAR_DELETE_EVENT', { event_id: id, calendar_id: calendarId, send_updates: 'all' }, input.account);
    },
    async reschedule(id, start, end) {
      await client.execute('GOOGLECALENDAR_PATCH_EVENT', { event_id: id, calendar_id: calendarId, start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), send_updates: 'all' }, input.account);
      return { externalId: id, start, end };
    },
    list,
    async test() {
      const accounts = await client.accounts(TOOLKITS.google);
      const active = accounts.filter((a) => a.status === 'ACTIVE');
      if (!active.length) throw new ProviderError(404, 'No Google Calendar account is connected in Composio yet: use Connect.');
      await list({ start: Date.now(), end: Date.now() + 86_400_000 });
      return { detail: `Connected: ${active.map((a) => a.label).join(', ')}.` };
    },
  };
}

export function outlookCalendar(client: ComposioClient, input: { account?: string | null; calendar?: string | null }): Calendar {
  const list = async (window: { start: number; end: number }): Promise<ExternalEvent[]> => {
    const data = await client.execute(
      'OUTLOOK_GET_CALENDAR_VIEW',
      { start_datetime: new Date(window.start).toISOString(), end_datetime: new Date(window.end).toISOString(), timezone: 'UTC', top: 250, ...(input.calendar ? { calendar_id: input.calendar } : {}) },
      input.account,
    );
    return eventsOf(data).flatMap((e) => {
      const id = str(e['id']);
      const start = graphTime(e['start']);
      const end = graphTime(e['end']);
      if (!id || start === null || end === null) return [];
      return [
        {
          id,
          start,
          end,
          title: str(e['subject']) ?? 'Busy',
          attendees: arr(e['attendees']).flatMap((a) => {
            const address = obj(obj(a)['emailAddress']);
            const email = str(address['address']);
            return email ? [{ email, name: str(address['name']) ?? undefined }] : [];
          }),
          cancelled: e['isCancelled'] === true,
          busy: e['showAs'] !== 'free',
          location: str(obj(e['onlineMeeting'])['joinUrl']) ?? str(obj(e['location'])['displayName']),
        },
      ];
    });
  };
  return {
    kind: 'outlook',
    async busy(window) {
      return (await list(window)).filter((e) => e.busy && !e.cancelled).map((e) => ({ start: e.start, end: e.end }));
    },
    async book(b) {
      const data = await client.execute(
        'OUTLOOK_CALENDAR_CREATE_EVENT',
        {
          subject: (b.attendee.name ? `${b.title}: ${b.attendee.name}` : b.title).slice(0, 200),
          start_datetime: localIso(b.start, b.attendee.timezone),
          end_datetime: localIso(b.end, b.attendee.timezone),
          time_zone: b.attendee.timezone,
          ...(b.attendee.email ? { attendees_info: [{ email: b.attendee.email, name: b.attendee.name }] } : {}),
          body: [b.notes, b.attendee.phone ? `Phone: ${b.attendee.phone}` : null, 'Booked in the chat (HelpPuff).'].filter(Boolean).join('\n'),
          ...(b.location ? { location: b.location } : {}),
          ...(input.calendar ? { calendar_id: input.calendar } : {}),
        },
        input.account,
      );
      return { externalId: idOf(data), start: b.start, end: b.end, location: b.location ?? null };
    },
    async cancel(id) {
      await client.execute('OUTLOOK_DELETE_CALENDAR_EVENT', { event_id: id }, input.account);
    },
    async reschedule(id, start, end) {
      await client.execute('OUTLOOK_UPDATE_CALENDAR_EVENT', { event_id: id, start_datetime: localIso(start, 'UTC'), end_datetime: localIso(end, 'UTC'), time_zone: 'UTC' }, input.account);
      return { externalId: id, start, end };
    },
    list,
    async test() {
      const accounts = await client.accounts(TOOLKITS.outlook);
      const active = accounts.filter((a) => a.status === 'ACTIVE');
      if (!active.length) throw new ProviderError(404, 'No Outlook account is connected in Composio yet: use Connect.');
      await list({ start: Date.now(), end: Date.now() + 86_400_000 });
      return { detail: `Connected: ${active.map((a) => a.label).join(', ')}.` };
    },
  };
}
