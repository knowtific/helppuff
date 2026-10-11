<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Appointments API

Booking in the chat (Settings → Bookings: date picker): what is in force, the free times, appointments on jobs (from the chat, the dashboard, your systems or the synced calendar), and the sync. On only with the date picker; the assistant never books. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[How visitors book|API-Reference-Appointments#how-visitors-book]]: `GET /bookings`
- [[Free times|API-Reference-Appointments#free-times]]: `GET /bookings/slots`
- [[Check the calendar|API-Reference-Appointments#check-the-calendar]]: `POST /bookings/test`
- [[List appointments|API-Reference-Appointments#list-appointments]]: `GET /appointments`
- [[Get an appointment|API-Reference-Appointments#get-an-appointment]]: `GET /appointments/:id`
- [[Book an appointment|API-Reference-Appointments#book-an-appointment]]: `POST /appointments`
- [[Change an appointment|API-Reference-Appointments#change-an-appointment]]: `PATCH /appointments/:id`
- [[Delete an appointment|API-Reference-Appointments#delete-an-appointment]]: `DELETE /appointments/:id`
- [[Read the synced calendar now|API-Reference-Appointments#read-the-synced-calendar-now]]: `POST /appointments/sync`

## How visitors book

`GET /bookings` · scope `settings:read`

What is in force: `effective.mode` is `none`, `link` or `picker` (the owner's choice, `chosen: true`, else the booking link found on the website), the calendar the picker syncs with and its connection, when it was last read, and how many appointments are coming up. The settings themselves are `bookings` in `GET /settings`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/bookings" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/bookings`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as HowVisitorsBookResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "effective": {
    "mode": "picker",
    "link": null,
    "label": "Book a time",
    "chosen": true
  },
  "found": {
    "url": "https://calendly.com/acme/consultation",
    "provider": "Calendly",
    "page": "https://acme.example/contact",
    "at": 1760000000000
  },
  "timezone": "Australia/Melbourne",
  "calendar": {
    "sync": "calcom",
    "integration": {
      "kind": "calcom",
      "name": "Cal.com",
      "connected": true,
      "baseUrl": null,
      "status": "ok",
      "lastError": null,
      "lastAt": 1760000000000,
      "account": null,
      "plan": null,
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000
    },
    "ready": true
  },
  "syncedAt": 1760000000000,
  "upcoming": 3
}
```
```ts [Type]
type HowVisitorsBookResponse = {
  site: string;
  effective: {
    mode: string;
    link: string | null;
    label: string;
    chosen: boolean;
  };
  found: {
    url: string;
    provider: string;
    page: string;
    at: number;
  } | null;
  timezone: string;
  calendar: {
    sync: string;
    integration: {
      kind: string;
      name: string;
      connected: boolean;
      baseUrl: string | null;
      status: string;
      lastError: string | null;
      lastAt: number;
      account: string | null;
      plan: string | null;
      createdAt: number;
      updatedAt: number;
    };
    ready: boolean;
  };
  syncedAt: number | null;
  upcoming: number;
};
```
<!-- /tabs -->

## Free times

`GET /bookings/slots` · scope `settings:read`

The free times the date picker would offer now, by day, with the settings in force (up to 14 days from `from`). Nothing is booked: for previews and checks.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `from` | query | no | The first day, YYYY-MM-DD (default today). |
| `to` | query | no | The last day (default six days on). |
| `tz` | query | no | The time zone the days are in (default the business's). |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/bookings/slots" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/bookings/slots`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as FreeTimesResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "timezone": "Australia/Melbourne",
  "days": [
    {
      "date": "2025-10-15",
      "slots": [
        {
          "start": 1760500800000,
          "end": 1760502600000
        }
      ]
    }
  ],
  "next": "2025-10-22",
  "title": "Consultation",
  "duration": 30,
  "phone": "optional"
}
```
```ts [Type]
type FreeTimesResponse = {
  timezone: string;
  days: Array<{
    date: string;
    slots: Array<{
      start: number;
      end: number;
    }>;
  }>;
  next: string;
  title: string;
  duration: number;
  phone: string;
};
```
<!-- /tabs -->

## Check the calendar

`POST /bookings/test` · scope `settings:read`

Checks the synced calendar's connection (or another one, `sync`), and lists its event types (Cal.com, Calendly) to choose from.

| Body field | Required | Description |
| --- | --- | --- |
| `sync` | no | `calcom`, `calendly`, `google` or `outlook` (default the one in force). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/bookings/test" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "sync": "calcom"
}'
```
```ts [TypeScript]
type CheckCalendarRequest = {
  /** `calcom`, `calendly`, `google` or `outlook` (default the one in force). */
  sync?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/bookings/test`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    sync: 'calcom'
  } satisfies CheckCalendarRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as CheckCalendarResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "ok": true,
  "detail": "Connected: 2 event types.",
  "eventTypes": [
    {
      "id": "1234",
      "name": "30 min consultation",
      "duration": 30
    }
  ]
}
```
```ts [Type]
type CheckCalendarResponse = {
  ok: boolean;
  detail: string;
  eventTypes: Array<{
    id: string;
    name: string;
    duration: number;
  }>;
};
```
<!-- /tabs -->

## List appointments

`GET /appointments` · scope `jobs:read`

In time order, up to 500. By default every one that takes up time (not cancelled), including `busy` time read from the synced calendar that matched no contact.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `from` | query | no | Ends after this (ISO 8601 or milliseconds). |
| `to` | query | no | Starts before this. |
| `status` | query | no | `active` (default), `all`, `appointments` (not busy time), or one of `confirmed`, `pending`, `cancelled`, `completed`, `no_show`, `busy`. |
| `job` | query | no | One job's appointments. |
| `contact` | query | no | One contact's (their lead id). |
| `conversation` | query | no | The ones booked in one conversation. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/appointments" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/appointments`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListAppointmentsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "items": [
    {
      "id": "apt_4f1c2b9e8d7a6c5b4a3f",
      "title": "Consultation",
      "start": 1760500800000,
      "end": 1760502600000,
      "startIso": "2025-10-15T04:00:00.000Z",
      "endIso": "2025-10-15T04:30:00.000Z",
      "timezone": "Australia/Melbourne",
      "status": "confirmed",
      "source": "chat",
      "provider": "none",
      "externalId": null,
      "location": "Our office, 12 Smith St",
      "notes": null,
      "attendee": {
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "phone": "0400 111 222"
      },
      "job": {
        "id": "job_mfx2k1a9b3c4d5e6",
        "number": 1042,
        "title": "Consultation: Ada Lovelace"
      },
      "contact": {
        "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
        "name": "Ada Lovelace",
        "email": "ada@example.com"
      },
      "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
      "rescheduleUrl": null,
      "createdBy": "Ada Lovelace",
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "syncedAt": null
    }
  ]
}
```
```ts [Type]
type ListAppointmentsResponse = {
  items: Array<{
    id: string;
    title: string;
    start: number;
    end: number;
    startIso: string;
    endIso: string;
    timezone: string;
    status: string;
    source: string;
    provider: string;
    externalId: string | null;
    location: string | null;
    notes: string | null;
    attendee: {
      name: string;
      email: string;
      phone: string;
    } | null;
    job: {
      id: string;
      number: number;
      title: string;
    } | null;
    contact: Record<string, string> | null;
    conversationId: string | null;
    rescheduleUrl: string | null;
    createdBy: string | null;
    createdAt: number;
    updatedAt: number;
    syncedAt: number | null;
  }>;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | Appointments are off: the date picker is not on (Settings → Bookings). |

## Get an appointment

`GET /appointments/:id` · scope `jobs:read`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/appointments/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/appointments/${id}`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as GetAppointmentResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "apt_4f1c2b9e8d7a6c5b4a3f",
  "title": "Consultation",
  "start": 1760500800000,
  "end": 1760502600000,
  "startIso": "2025-10-15T04:00:00.000Z",
  "endIso": "2025-10-15T04:30:00.000Z",
  "timezone": "Australia/Melbourne",
  "status": "confirmed",
  "source": "chat",
  "provider": "none",
  "externalId": null,
  "location": "Our office, 12 Smith St",
  "notes": null,
  "attendee": {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "0400 111 222"
  },
  "job": {
    "id": "job_mfx2k1a9b3c4d5e6",
    "number": 1042,
    "title": "Consultation: Ada Lovelace"
  },
  "contact": {
    "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  },
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "rescheduleUrl": null,
  "createdBy": "Ada Lovelace",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000,
  "syncedAt": null
}
```
```ts [Type]
type GetAppointmentResponse = {
  id: string;
  title: string;
  start: number;
  end: number;
  startIso: string;
  endIso: string;
  timezone: string;
  status: string;
  source: string;
  provider: string;
  externalId: string | null;
  location: string | null;
  notes: string | null;
  attendee: {
    name: string;
    email: string;
    phone: string;
  } | null;
  job: {
    id: string;
    number: number;
    title: string;
  } | null;
  contact: Record<string, string> | null;
  conversationId: string | null;
  rescheduleUrl: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
};
```
<!-- /tabs -->

## Book an appointment

`POST /appointments` · scope `jobs:write`

From your own systems, or by hand: written to the synced calendar first (saved here only when it succeeded), then put on a job: `jobId`, else the contact's open job, else a new one. A time that overlaps another appointment is refused unless `force` is true. Sends `appointment.created` (and `job.created` for a new job).

| Body field | Required | Description |
| --- | --- | --- |
| `start` | yes | ISO 8601 or milliseconds. |
| `end` | no | Default: start + `duration` (or the bookings duration). |
| `duration` | no | Minutes, instead of `end`. |
| `title` | no | Default: the bookings title. |
| `jobId` | no | The job it belongs to (its contact is the attendee). |
| `contactId` | no | A contact's id. |
| `contact` | no | `{ name, email, phone }`: matched or created. |
| `timezone` | no | The attendee's time zone (default the business's). |
| `location` | no | Where, or the meeting link. |
| `notes` | no | For the team; up to 4000 characters. |
| `force` | no | Book it even if it overlaps another appointment. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/appointments" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "start": "2025-10-15T04:00:00Z",
  "duration": 30,
  "contact": {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "0400 111 222"
  },
  "title": "Consultation",
  "location": "Our office, 12 Smith St"
}'
```
```ts [TypeScript]
type BookAppointmentRequest = {
  /** ISO 8601 or milliseconds. */
  start: string;
  /** Default: start + `duration` (or the bookings duration). */
  end?: string;
  /** Minutes, instead of `end`. */
  duration?: number;
  /** Default: the bookings title. */
  title?: string;
  /** The job it belongs to (its contact is the attendee). */
  jobId?: string;
  /** A contact's id. */
  contactId?: string;
  /** `{ name, email, phone }`: matched or created. */
  contact?: Record<string, string>;
  /** The attendee's time zone (default the business's). */
  timezone?: string;
  /** Where, or the meeting link. */
  location?: string;
  /** For the team; up to 4000 characters. */
  notes?: string;
  /** Book it even if it overlaps another appointment. */
  force?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/appointments`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    start: '2025-10-15T04:00:00Z',
    duration: 30,
    contact: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '0400 111 222'
    },
    title: 'Consultation',
    location: 'Our office, 12 Smith St'
  } satisfies BookAppointmentRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as BookAppointmentResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "apt_4f1c2b9e8d7a6c5b4a3f",
  "title": "Consultation",
  "start": 1760500800000,
  "end": 1760502600000,
  "startIso": "2025-10-15T04:00:00.000Z",
  "endIso": "2025-10-15T04:30:00.000Z",
  "timezone": "Australia/Melbourne",
  "status": "confirmed",
  "source": "api",
  "provider": "none",
  "externalId": null,
  "location": "Our office, 12 Smith St",
  "notes": null,
  "attendee": {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "0400 111 222"
  },
  "job": {
    "id": "job_mfx2k1a9b3c4d5e6",
    "number": 1042,
    "title": "Consultation: Ada Lovelace"
  },
  "contact": {
    "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  },
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "rescheduleUrl": null,
  "createdBy": "Website backend",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000,
  "syncedAt": null
}
```
```ts [Type]
type BookAppointmentResponse = {
  id: string;
  title: string;
  start: number;
  end: number;
  startIso: string;
  endIso: string;
  timezone: string;
  status: string;
  source: string;
  provider: string;
  externalId: string | null;
  location: string | null;
  notes: string | null;
  attendee: {
    name: string;
    email: string;
    phone: string;
  } | null;
  job: {
    id: string;
    number: number;
    title: string;
  } | null;
  contact: Record<string, string> | null;
  conversationId: string | null;
  rescheduleUrl: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 409 | `conflict` | The time overlaps another appointment (without `force`), or was just taken. |
| 502 | `connector_error` | The synced calendar refused it (its reason is in the message). |

## Change an appointment

`PATCH /appointments/:id` · scope `jobs:write`

Move it (`start`, `end`: moved in the synced calendar first), set its `status` (`confirmed`, `completed`, `no_show`, or `cancelled`: cancelled there too), or change its title, place or notes. Sends `appointment.updated` or `appointment.cancelled`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `start` | no | A new start (keeps the length unless `end` is given). |
| `end` | no | A new end. |
| `status` | no | `confirmed`, `cancelled`, `completed` or `no_show`. |
| `reason` | no | Why, when cancelling. |
| `title` | no | Up to 160 characters. |
| `location` | no | Up to 300 characters; empty clears it. |
| `notes` | no | Up to 4000 characters; empty clears them. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/appointments/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "status": "completed",
  "notes": "Went well; quote to follow."
}'
```
```ts [TypeScript]
type ChangeAppointmentRequest = {
  /** A new start (keeps the length unless `end` is given). */
  start?: string;
  /** A new end. */
  end?: string;
  /** `confirmed`, `cancelled`, `completed` or `no_show`. */
  status?: string;
  /** Why, when cancelling. */
  reason?: string;
  /** Up to 160 characters. */
  title?: string;
  /** Up to 300 characters; empty clears it. */
  location?: string;
  /** Up to 4000 characters; empty clears them. */
  notes?: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/appointments/${id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    status: 'completed',
    notes: 'Went well; quote to follow.'
  } satisfies ChangeAppointmentRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ChangeAppointmentResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "apt_4f1c2b9e8d7a6c5b4a3f",
  "title": "Consultation",
  "start": 1760500800000,
  "end": 1760502600000,
  "startIso": "2025-10-15T04:00:00.000Z",
  "endIso": "2025-10-15T04:30:00.000Z",
  "timezone": "Australia/Melbourne",
  "status": "completed",
  "source": "chat",
  "provider": "none",
  "externalId": null,
  "location": "Our office, 12 Smith St",
  "notes": "Went well; quote to follow.",
  "attendee": {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "0400 111 222"
  },
  "job": {
    "id": "job_mfx2k1a9b3c4d5e6",
    "number": 1042,
    "title": "Consultation: Ada Lovelace"
  },
  "contact": {
    "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  },
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "rescheduleUrl": null,
  "createdBy": "Ada Lovelace",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000,
  "syncedAt": null
}
```
```ts [Type]
type ChangeAppointmentResponse = {
  id: string;
  title: string;
  start: number;
  end: number;
  startIso: string;
  endIso: string;
  timezone: string;
  status: string;
  source: string;
  provider: string;
  externalId: string | null;
  location: string | null;
  notes: string | null;
  attendee: {
    name: string;
    email: string;
    phone: string;
  } | null;
  job: {
    id: string;
    number: number;
    title: string;
  } | null;
  contact: Record<string, string> | null;
  conversationId: string | null;
  rescheduleUrl: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
};
```
<!-- /tabs -->

## Delete an appointment

`DELETE /appointments/:id` · scope `jobs:write`

Cancels it in the synced calendar (when it is still on), then deletes the record. To keep the record, `PATCH` its status to `cancelled` instead.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/appointments/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/appointments/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as DeleteAppointmentResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "apt_4f1c2b9e8d7a6c5b4a3f",
  "deleted": true
}
```
```ts [Type]
type DeleteAppointmentResponse = {
  id: string;
  deleted: boolean;
};
```
<!-- /tabs -->

## Read the synced calendar now

`POST /appointments/sync` · scope `jobs:write`

Reads 30 days back and 90 ahead: new events are added (on a job when an attendee is a contact, else as busy time), moved ones updated, cancelled or removed ones cancelled. The cron does this every `bookings.syncMinutes`; at most once a minute here unless `force`.

| Body field | Required | Description |
| --- | --- | --- |
| `force` | no | Read even if it was read less than a minute ago. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/appointments/sync" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "force": true
}'
```
```ts [TypeScript]
type ReadSyncedCalendarNowRequest = {
  /** Read even if it was read less than a minute ago. */
  force?: boolean;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/appointments/sync`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    force: true
  } satisfies ReadSyncedCalendarNowRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ReadSyncedCalendarNowResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "synced": true,
  "added": 2,
  "updated": 1,
  "cancelled": 0,
  "busy": 5,
  "at": 1760000000000
}
```
```ts [Type]
type ReadSyncedCalendarNowResponse = {
  synced: boolean;
  added: number;
  updated: number;
  cancelled: number;
  busy: number;
  at: number | null;
};
```
<!-- /tabs -->
