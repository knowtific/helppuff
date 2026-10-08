<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Jobs API

Requests, quotes, projects or tickets on the site's pipeline: create them from your own forms and systems, move them through the stages, read their history. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List jobs|API-Reference-Jobs#list-jobs]]: `GET /jobs`
- [[Create a job|API-Reference-Jobs#create-a-job]]: `POST /jobs`
- [[Get a job|API-Reference-Jobs#get-a-job]]: `GET /jobs/:id`
- [[Change a job|API-Reference-Jobs#change-a-job]]: `PATCH /jobs/:id`
- [[Move a job|API-Reference-Jobs#move-a-job]]: `POST /jobs/:id/move`
- [[Add an update|API-Reference-Jobs#add-an-update]]: `POST /jobs/:id/updates`
- [[Add a note to a job|API-Reference-Jobs#add-a-note-to-a-job]]: `POST /jobs/:id/notes`
- [[Delete a job|API-Reference-Jobs#delete-a-job]]: `DELETE /jobs/:id`
- [[The pipeline|API-Reference-Jobs#the-pipeline]]: `GET /jobs/pipeline`
- [[Change the pipeline|API-Reference-Jobs#change-the-pipeline]]: `PUT /jobs/pipeline`
- [[Use another template|API-Reference-Jobs#use-another-template]]: `POST /jobs/pipeline/template`
- [[Let the AI set the pipeline up|API-Reference-Jobs#let-the-ai-set-the-pipeline-up]]: `POST /jobs/setup`

## List jobs

`GET /jobs` · scope `jobs:read`

In board order, up to 500, with each stage's count and total value. Open jobs by default.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `status` | query | no | `open` (default), `won`, `lost` or `all`. |
| `stage` | query | no | One stage's id. |
| `assigned` | query | no | `me`, `none`, or a team member's email. |
| `source` | query | no | `chat`, `quote`, `api`, `manual` or `callback`. |
| `contact` | query | no | One contact's jobs (their lead id). |
| `conversation` | query | no | The jobs that came from one conversation. |
| `q` | query | no | Search title, details, fields, the contact, or a number (`1042`). |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/jobs" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListJobsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "items": [
    {
      "id": "job_7c2e9a41b5d03f68",
      "number": 1042,
      "title": "Blocked kitchen drain for Ada Lovelace",
      "details": "Kitchen sink drains slowly and gurgles.",
      "stage": {
        "id": "stg_3f2a1b0c9d8e7f6a",
        "name": "New request",
        "kind": "open"
      },
      "status": "open",
      "fields": {
        "service": "Blocked drains",
        "address": "Balmain",
        "urgency": "This week"
      },
      "contact": {
        "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "phone": "0400 111 222"
      },
      "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
      "source": "api",
      "value": 450,
      "valueCents": 45000,
      "currency": "AUD",
      "dueAt": null,
      "assignedTo": "sam@acme.example",
      "assignedName": "Sam",
      "position": 0,
      "stale": false,
      "stageChangedAt": 1760000000000,
      "closedAt": null,
      "lostReason": null,
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000
    }
  ],
  "stages": [
    {
      "id": "stg_3f2a1b0c9d8e7f6a",
      "name": "New request",
      "color": "#3b82f6",
      "position": 0,
      "kind": "open",
      "rotDays": 1,
      "count": 3,
      "valueCents": 135000
    }
  ]
}
```
```ts [Type]
type ListJobsResponse = {
  items: Array<{
    id: string;
    number: number;
    title: string;
    details: string | null;
    stage: {
      id: string;
      name: string;
      kind: string;
    };
    status: string;
    fields: Record<string, string>;
    contact: Record<string, string> | null;
    conversationId: string | null;
    source: string;
    value: number | null;
    valueCents: number | null;
    currency: string | null;
    dueAt: number | null;
    assignedTo: string | null;
    assignedName: string | null;
    position: number;
    stale: boolean;
    stageChangedAt: number;
    closedAt: number | null;
    lostReason: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  stages: Array<{
    id: string;
    name: string;
    color: string;
    position: number;
    kind: string;
    rotDays: number;
    count: number;
    valueCents: number | null;
  }>;
};
```
<!-- /tabs -->

## Create a job

`POST /jobs` · scope `jobs:write`

From your own form, CRM or automation (Zapier, Make). The contact is matched by email, then phone, or created. `fields` are by field name and checked against the site's fields (`GET /jobs/pipeline`): an unknown field or a value that is not one of a choice's options is refused, a missing required field is not (the team fills it in). Lands in the first stage unless `stageId` says otherwise. Sends `job.created`.

| Body field | Required | Description |
| --- | --- | --- |
| `title` | no | Up to 160 characters. Left out: made from the fields and the contact. |
| `details` | no | What is needed, up to 10,000 characters. |
| `fields` | no | Values by field name, e.g. `{ "service": "Blocked drains" }`. A select field takes one of its options. |
| `contact` | no | `{ name, email, phone }`: matched by email, then phone, or created. |
| `contactId` | no | An existing contact's id, instead of `contact`. |
| `conversationId` | no | The conversation it came from. |
| `callbackId` | no | A callback request to turn into a job (its contact, conversation and reason). |
| `stageId` | no | The stage to start in. |
| `value` | no | What it is worth, e.g. `450` (in `currency`). |
| `currency` | no | ISO 4217, e.g. `AUD`. |
| `dueAt` | no | ISO 8601 date, or milliseconds. |
| `assignedTo` | no | A team member's email. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/jobs" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "title": "Blocked kitchen drain",
  "details": "Kitchen sink drains slowly and gurgles.",
  "fields": {
    "service": "Blocked drains",
    "address": "Balmain",
    "urgency": "This week"
  },
  "contact": {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "0400 111 222"
  },
  "value": 450,
  "currency": "AUD"
}'
```
```ts [TypeScript]
type CreateJobRequest = {
  /** Up to 160 characters. Left out: made from the fields and the contact. */
  title?: string;
  /** What is needed, up to 10,000 characters. */
  details?: string;
  /**
   * Values by field name, e.g. `{ "service": "Blocked drains" }`. A select
   * field takes one of its options.
   */
  fields?: Record<string, string>;
  /** `{ name, email, phone }`: matched by email, then phone, or created. */
  contact?: Record<string, string>;
  /** An existing contact's id, instead of `contact`. */
  contactId?: string;
  /** The conversation it came from. */
  conversationId?: string;
  /**
   * A callback request to turn into a job (its contact, conversation and
   * reason).
   */
  callbackId?: string;
  /** The stage to start in. */
  stageId?: string;
  /** What it is worth, e.g. `450` (in `currency`). */
  value?: number;
  /** ISO 4217, e.g. `AUD`. */
  currency?: string;
  /** ISO 8601 date, or milliseconds. */
  dueAt?: string;
  /** A team member's email. */
  assignedTo?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'Blocked kitchen drain',
    details: 'Kitchen sink drains slowly and gurgles.',
    fields: {
      service: 'Blocked drains',
      address: 'Balmain',
      urgency: 'This week'
    },
    contact: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '0400 111 222'
    },
    value: 450,
    currency: 'AUD'
  } satisfies CreateJobRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as CreateJobResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "job_7c2e9a41b5d03f68",
  "number": 1042,
  "title": "Blocked kitchen drain for Ada Lovelace",
  "details": "Kitchen sink drains slowly and gurgles.",
  "stage": {
    "id": "stg_3f2a1b0c9d8e7f6a",
    "name": "New request",
    "kind": "open"
  },
  "status": "open",
  "fields": {
    "service": "Blocked drains",
    "address": "Balmain",
    "urgency": "This week"
  },
  "contact": {
    "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "0400 111 222"
  },
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "source": "api",
  "value": 450,
  "valueCents": 45000,
  "currency": "AUD",
  "dueAt": null,
  "assignedTo": "sam@acme.example",
  "assignedName": "Sam",
  "position": 0,
  "stale": false,
  "stageChangedAt": 1760000000000,
  "closedAt": null,
  "lostReason": null,
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type CreateJobResponse = {
  id: string;
  number: number;
  title: string;
  details: string | null;
  stage: {
    id: string;
    name: string;
    kind: string;
  };
  status: string;
  fields: Record<string, string>;
  contact: Record<string, string> | null;
  conversationId: string | null;
  source: string;
  value: number | null;
  valueCents: number | null;
  currency: string | null;
  dueAt: number | null;
  assignedTo: string | null;
  assignedName: string | null;
  position: number;
  stale: boolean;
  stageChangedAt: number;
  closedAt: number | null;
  lostReason: string | null;
  createdAt: number;
  updatedAt: number;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | An unknown field, a value not among a select field's options, or a bad email. |

## Get a job

`GET /jobs/:id` · scope `jobs:read`

The job with its history (every change, with who and when), notes, and the conversation it came from.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/jobs/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs/${id}`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as GetJobResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "job_7c2e9a41b5d03f68",
  "number": 1042,
  "title": "Blocked kitchen drain for Ada Lovelace",
  "details": "Kitchen sink drains slowly and gurgles.",
  "stage": {
    "id": "stg_3f2a1b0c9d8e7f6a",
    "name": "New request",
    "kind": "open"
  },
  "status": "open",
  "fields": {
    "service": "Blocked drains",
    "address": "Balmain",
    "urgency": "This week"
  },
  "contact": {
    "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "0400 111 222"
  },
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "source": "api",
  "value": 450,
  "valueCents": 45000,
  "currency": "AUD",
  "dueAt": null,
  "assignedTo": "sam@acme.example",
  "assignedName": "Sam",
  "position": 0,
  "stale": false,
  "stageChangedAt": 1760000000000,
  "closedAt": null,
  "lostReason": null,
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000,
  "history": [
    {
      "id": "evt_9b1c2d3e4f5a6b7c",
      "at": 1760000000000,
      "actor": "api",
      "actorName": "Website backend",
      "kind": "created",
      "data": {
        "source": "api",
        "stage": "New request"
      }
    }
  ],
  "notes": [
    {
      "id": "note_mfx2k1a9",
      "author": "sam@acme.example",
      "authorName": "Sam",
      "text": "Called, booking Tuesday.",
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000
    }
  ],
  "conversation": {
    "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
    "firstMessage": "My kitchen drain is blocked",
    "startedAt": 1760000000000
  }
}
```
```ts [Type]
type GetJobResponse = {
  id: string;
  number: number;
  title: string;
  details: string | null;
  stage: {
    id: string;
    name: string;
    kind: string;
  };
  status: string;
  fields: Record<string, string>;
  contact: Record<string, string> | null;
  conversationId: string | null;
  source: string;
  value: number | null;
  valueCents: number | null;
  currency: string | null;
  dueAt: number | null;
  assignedTo: string | null;
  assignedName: string | null;
  position: number;
  stale: boolean;
  stageChangedAt: number;
  closedAt: number | null;
  lostReason: string | null;
  createdAt: number;
  updatedAt: number;
  history: Array<{
    id: string;
    at: number;
    actor: string;
    actorName: string;
    kind: string;
    data: {
      source: string;
      stage: string;
    };
  }>;
  notes: Array<{
    id: string;
    author: string;
    authorName: string;
    text: string;
    createdAt: number;
    updatedAt: number;
  }>;
  conversation: {
    id: string;
    firstMessage: string;
    startedAt: number;
  } | null;
};
```
<!-- /tabs -->

## Change a job

`PATCH /jobs/:id` · scope `jobs:write`

Title, details, fields (merged: `null` clears one), value, currency, due date, assignee. Each change goes into the history. Sends `job.updated`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `title` | no | Up to 160 characters. |
| `details` | no | Replaces the details. To add to them, use `POST /jobs/:id/updates`. |
| `fields` | no | Values by field name; `null` clears one. |
| `value` | no | A number, or null. |
| `currency` | no | ISO 4217. |
| `dueAt` | no | ISO 8601 date, milliseconds, or null. |
| `assignedTo` | no | A team member's email, or null. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/jobs/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "fields": {
    "urgency": "Emergency"
  },
  "value": 520
}'
```
```ts [TypeScript]
type ChangeJobRequest = {
  /** Up to 160 characters. */
  title?: string;
  /** Replaces the details. To add to them, use `POST /jobs/:id/updates`. */
  details?: string;
  /** Values by field name; `null` clears one. */
  fields?: Record<string, string>;
  /** A number, or null. */
  value?: number;
  /** ISO 4217. */
  currency?: string;
  /** ISO 8601 date, milliseconds, or null. */
  dueAt?: string;
  /** A team member's email, or null. */
  assignedTo?: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs/${id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    fields: {
      urgency: 'Emergency'
    },
    value: 520
  } satisfies ChangeJobRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ChangeJobResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "job_7c2e9a41b5d03f68",
  "number": 1042,
  "title": "Blocked kitchen drain for Ada Lovelace",
  "details": "Kitchen sink drains slowly and gurgles.",
  "stage": {
    "id": "stg_3f2a1b0c9d8e7f6a",
    "name": "New request",
    "kind": "open"
  },
  "status": "open",
  "fields": {
    "service": "Blocked drains",
    "address": "Balmain",
    "urgency": "Emergency"
  },
  "contact": {
    "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "0400 111 222"
  },
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "source": "api",
  "value": 520,
  "valueCents": 52000,
  "currency": "AUD",
  "dueAt": null,
  "assignedTo": "sam@acme.example",
  "assignedName": "Sam",
  "position": 0,
  "stale": false,
  "stageChangedAt": 1760000000000,
  "closedAt": null,
  "lostReason": null,
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type ChangeJobResponse = {
  id: string;
  number: number;
  title: string;
  details: string | null;
  stage: {
    id: string;
    name: string;
    kind: string;
  };
  status: string;
  fields: Record<string, string>;
  contact: Record<string, string> | null;
  conversationId: string | null;
  source: string;
  value: number | null;
  valueCents: number | null;
  currency: string | null;
  dueAt: number | null;
  assignedTo: string | null;
  assignedName: string | null;
  position: number;
  stale: boolean;
  stageChangedAt: number;
  closedAt: number | null;
  lostReason: string | null;
  createdAt: number;
  updatedAt: number;
};
```
<!-- /tabs -->

## Move a job

`POST /jobs/:id/move` · scope `jobs:write`

To another stage (a won stage closes it and makes the contact won; a lost one closes it, with `lostReason`), and/or another place in its column (`before`: the job it now sits above; null: the bottom). Sends `job.stage_changed`, then `job.won` or `job.lost`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `stageId` | no | The stage to move it to. |
| `before` | no | The id of the job it now sits above, or null for the bottom. |
| `lostReason` | no | Why, when moving to a lost stage. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/jobs/ID/move" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "stageId": "stg_8d7c6b5a4f3e2d1c"
}'
```
```ts [TypeScript]
type MoveJobRequest = {
  /** The stage to move it to. */
  stageId?: string;
  /** The id of the job it now sits above, or null for the bottom. */
  before?: string;
  /** Why, when moving to a lost stage. */
  lostReason?: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs/${id}/move`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    stageId: 'stg_8d7c6b5a4f3e2d1c'
  } satisfies MoveJobRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as MoveJobResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "job_7c2e9a41b5d03f68",
  "number": 1042,
  "title": "Blocked kitchen drain for Ada Lovelace",
  "details": "Kitchen sink drains slowly and gurgles.",
  "stage": {
    "id": "stg_8d7c6b5a4f3e2d1c",
    "name": "Quote sent",
    "kind": "open"
  },
  "status": "open",
  "fields": {
    "service": "Blocked drains",
    "address": "Balmain",
    "urgency": "This week"
  },
  "contact": {
    "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "0400 111 222"
  },
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "source": "api",
  "value": 450,
  "valueCents": 45000,
  "currency": "AUD",
  "dueAt": null,
  "assignedTo": "sam@acme.example",
  "assignedName": "Sam",
  "position": 0,
  "stale": false,
  "stageChangedAt": 1760000000000,
  "closedAt": null,
  "lostReason": null,
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type MoveJobResponse = {
  id: string;
  number: number;
  title: string;
  details: string | null;
  stage: {
    id: string;
    name: string;
    kind: string;
  };
  status: string;
  fields: Record<string, string>;
  contact: Record<string, string> | null;
  conversationId: string | null;
  source: string;
  value: number | null;
  valueCents: number | null;
  currency: string | null;
  dueAt: number | null;
  assignedTo: string | null;
  assignedName: string | null;
  position: number;
  stale: boolean;
  stageChangedAt: number;
  closedAt: number | null;
  lostReason: string | null;
  createdAt: number;
  updatedAt: number;
};
```
<!-- /tabs -->

## Add an update

`POST /jobs/:id/updates` · scope `jobs:write`

A dated update in the job's history ("Parts ordered, back Thursday"). The details stay as they were.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `text` | yes | Up to 4000 characters. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/jobs/ID/updates" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "text": "Parts ordered, back Thursday."
}'
```
```ts [TypeScript]
type AddUpdateRequest = {
  /** Up to 4000 characters. */
  text: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs/${id}/updates`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'Parts ordered, back Thursday.'
  } satisfies AddUpdateRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AddUpdateResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "job_7c2e9a41b5d03f68",
  "added": true
}
```
```ts [Type]
type AddUpdateResponse = {
  id: string;
  added: boolean;
};
```
<!-- /tabs -->

## Add a note to a job

`POST /jobs/:id/notes` · scope `jobs:write`

A private note for the team.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `text` | yes | Up to 5000 characters. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/jobs/ID/notes" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "text": "Gate code 4471."
}'
```
```ts [TypeScript]
type AddNoteToJobRequest = {
  /** Up to 5000 characters. */
  text: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs/${id}/notes`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'Gate code 4471.'
  } satisfies AddNoteToJobRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AddNoteToJobResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "note_mfx2k1a9",
  "jobId": "job_7c2e9a41b5d03f68",
  "author": "key:k7m3p9q2r4s8",
  "authorName": "Website backend",
  "text": "Gate code 4471.",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type AddNoteToJobResponse = {
  id: string;
  jobId: string;
  author: string;
  authorName: string | null;
  text: string;
  createdAt: number;
  updatedAt: number;
};
```
<!-- /tabs -->

## Delete a job

`DELETE /jobs/:id` · scope `jobs:write`

With its history and notes. The contact stays.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/jobs/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as DeleteJobResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "job_7c2e9a41b5d03f68",
  "deleted": true
}
```
```ts [Type]
type DeleteJobResponse = {
  id: string;
  deleted: boolean;
};
```
<!-- /tabs -->

## The pipeline

`GET /jobs/pipeline` · scope `jobs:read`

The stages (in order; `kind` open, won or lost), the fields a job has (and the question asked for each), the quote questions, which template it came from and why, and the templates there are.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/jobs/pipeline" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs/pipeline`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as PipelineResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "pipeline": {
    "siteId": "acme",
    "template": "service-quote",
    "itemSingular": "Job",
    "itemPlural": "Jobs",
    "chosenBy": "ai",
    "reason": "A plumbing business with free on-site quotes.",
    "assistantJobs": true,
    "quote": {
      "enabled": true,
      "label": "Get a quote",
      "askContact": true
    },
    "editedAt": null,
    "stages": [
      {
        "id": "stg_3f2a1b0c9d8e7f6a",
        "name": "New request",
        "color": "#3b82f6",
        "position": 0,
        "kind": "open",
        "rotDays": 1
      }
    ],
    "fields": [
      {
        "id": "fld_1a2b3c4d5e6f7a8b",
        "name": "service",
        "label": "Service",
        "type": "select",
        "required": false,
        "options": [
          "Blocked drains",
          "Hot water"
        ],
        "question": "Which service do you need?",
        "position": 0,
        "inQuote": true,
        "quotePosition": 0,
        "archived": false
      }
    ],
    "quotePreview": [
      {
        "field": "service",
        "ask": "Which service do you need?",
        "input": "choice",
        "choices": [
          "Blocked drains",
          "Hot water"
        ]
      }
    ]
  },
  "templates": [
    {
      "id": "service-quote",
      "name": "Service quote",
      "description": "Trades and home or business services that quote before the work.",
      "stages": [
        {
          "name": "New request",
          "kind": "open",
          "color": "#3b82f6",
          "rotDays": 1
        }
      ],
      "fields": [
        {
          "name": "service",
          "label": "Service",
          "type": "select",
          "options": [],
          "question": "Which service do you need?",
          "quote": true
        }
      ]
    }
  ]
}
```
```ts [Type]
type PipelineResponse = {
  pipeline: {
    siteId: string;
    template: string;
    itemSingular: string;
    itemPlural: string;
    chosenBy: string;
    reason: string | null;
    assistantJobs: boolean;
    quote: {
      enabled: boolean;
      label: string;
      askContact: boolean;
    };
    editedAt: number | null;
    stages: Array<{
      id: string;
      name: string;
      color: string;
      position: number;
      kind: string;
      rotDays: number;
    }>;
    fields: Array<{
      id: string;
      name: string;
      label: string;
      type: string;
      required: boolean;
      options: string[];
      question: string;
      position: number;
      inQuote: boolean;
      quotePosition: number;
      archived: boolean;
    }>;
    quotePreview: Array<{
      field: string;
      ask: string;
      input: string;
      choices: string[];
    }>;
  };
  templates: Array<{
    id: string;
    name: string;
    description: string;
    stages: Array<{
      name: string;
      kind: string;
      color: string;
      rotDays: number;
    }>;
    fields: Array<{
      name: string;
      label: string;
      type: string;
      options: string[];
      question: string;
      quote: boolean;
    }>;
  }>;
};
```
<!-- /tabs -->

## Change the pipeline

`PUT /jobs/pipeline` · scope `settings:write`

`stages` and `fields` are the whole lists, in order: an item with an `id` is changed, one without is added, one left out is removed (a removed stage's jobs go to `moveTo[stageId]`, else the first stage of the same kind; a removed field is archived, and jobs keep its values). Keep at least one open, one won and one lost stage. `quote` is the quote questions: field names, in order.

| Body field | Required | Description |
| --- | --- | --- |
| `stages` | no | `[{ id?, name, kind: "open"\|"won"\|"lost", color?, rotDays? }]`. |
| `fields` | no | `[{ id?, label, type: "text"\|"textarea"\|"number"\|"date"\|"select"\|"email"\|"tel", required?, options?, question? }]`. |
| `quote` | no | Field names asked by the widget's quote questions, in order (up to 10). |
| `quoteEnabled` | no | Offer the quote questions in the widget ("Get a quote"). |
| `quoteLabel` | no | The button's label. |
| `quoteContact` | no | Also ask for name, email and phone at the end. |
| `assistantJobs` | no | Let the assistant create jobs from the chat. |
| `itemSingular` | no | What a job is called, e.g. "Ticket". |
| `itemPlural` | no | Its plural. |
| `moveTo` | no | `{ <removed stage id>: <stage id> }`. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PUT "$HELPPUFF_URL/api/v1/jobs/pipeline" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "quote": [
    "service",
    "description",
    "address"
  ],
  "quoteLabel": "Get a free quote"
}'
```
```ts [TypeScript]
type ChangePipelineRequest = {
  /** `[{ id?, name, kind: "open"|"won"|"lost", color?, rotDays? }]`. */
  stages?: string;
  /**
   * `[{ id?, label, type:
   * "text"|"textarea"|"number"|"date"|"select"|"email"|"tel", required?,
   * options?, question? }]`.
   */
  fields?: string;
  /** Field names asked by the widget's quote questions, in order (up to 10). */
  quote?: string[];
  /** Offer the quote questions in the widget ("Get a quote"). */
  quoteEnabled?: string;
  /** The button's label. */
  quoteLabel?: string;
  /** Also ask for name, email and phone at the end. */
  quoteContact?: string;
  /** Let the assistant create jobs from the chat. */
  assistantJobs?: string;
  /** What a job is called, e.g. "Ticket". */
  itemSingular?: string;
  /** Its plural. */
  itemPlural?: string;
  /** `{ <removed stage id>: <stage id> }`. */
  moveTo?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs/pipeline`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    quote: [
      'service',
      'description',
      'address'
    ],
    quoteLabel: 'Get a free quote'
  } satisfies ChangePipelineRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ChangePipelineResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "pipeline": {
    "siteId": "acme",
    "template": "service-quote",
    "itemSingular": "Job",
    "itemPlural": "Jobs",
    "chosenBy": "owner",
    "reason": "A plumbing business with free on-site quotes.",
    "assistantJobs": true,
    "quote": {
      "enabled": true,
      "label": "Get a free quote",
      "askContact": true
    },
    "editedAt": null,
    "stages": [
      {
        "id": "stg_3f2a1b0c9d8e7f6a",
        "name": "New request",
        "color": "#3b82f6",
        "position": 0,
        "kind": "open",
        "rotDays": 1
      }
    ],
    "fields": [
      {
        "id": "fld_1a2b3c4d5e6f7a8b",
        "name": "service",
        "label": "Service",
        "type": "select",
        "required": false,
        "options": [
          "Blocked drains",
          "Hot water"
        ],
        "question": "Which service do you need?",
        "position": 0,
        "inQuote": true,
        "quotePosition": 0,
        "archived": false
      }
    ],
    "quotePreview": [
      {
        "field": "service",
        "ask": "Which service do you need?",
        "input": "choice",
        "choices": [
          "Blocked drains",
          "Hot water"
        ]
      }
    ]
  },
  "templates": [
    {
      "id": "service-quote",
      "name": "Service quote",
      "description": "Trades and home or business services that quote before the work.",
      "stages": [
        {
          "name": "New request",
          "kind": "open",
          "color": "#3b82f6",
          "rotDays": 1
        }
      ],
      "fields": [
        {
          "name": "service",
          "label": "Service",
          "type": "select",
          "options": [],
          "question": "Which service do you need?",
          "quote": true
        }
      ]
    }
  ]
}
```
```ts [Type]
type ChangePipelineResponse = {
  pipeline: {
    siteId: string;
    template: string;
    itemSingular: string;
    itemPlural: string;
    chosenBy: string;
    reason: string | null;
    assistantJobs: boolean;
    quote: {
      enabled: boolean;
      label: string;
      askContact: boolean;
    };
    editedAt: number | null;
    stages: Array<{
      id: string;
      name: string;
      color: string;
      position: number;
      kind: string;
      rotDays: number;
    }>;
    fields: Array<{
      id: string;
      name: string;
      label: string;
      type: string;
      required: boolean;
      options: string[];
      question: string;
      position: number;
      inQuote: boolean;
      quotePosition: number;
      archived: boolean;
    }>;
    quotePreview: Array<{
      field: string;
      ask: string;
      input: string;
      choices: string[];
    }>;
  };
  templates: Array<{
    id: string;
    name: string;
    description: string;
    stages: Array<{
      name: string;
      kind: string;
      color: string;
      rotDays: number;
    }>;
    fields: Array<{
      name: string;
      label: string;
      type: string;
      options: string[];
      question: string;
      quote: boolean;
    }>;
  }>;
};
```
<!-- /tabs -->

## Use another template

`POST /jobs/pipeline/template` · scope `settings:write`

Replaces the stages and fields with a template's. Jobs keep their place by stage kind and order; fields the new template lacks are archived.

| Body field | Required | Description |
| --- | --- | --- |
| `template` | yes | `service-quote`, `projects`, `support`, `sales-demo`, `bookings`, `custom-orders` or `basic`. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/jobs/pipeline/template" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "template": "projects"
}'
```
```ts [TypeScript]
type UseAnotherTemplateRequest = {
  /**
   * `service-quote`, `projects`, `support`, `sales-demo`, `bookings`,
   * `custom-orders` or `basic`.
   */
  template: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs/pipeline/template`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    template: 'projects'
  } satisfies UseAnotherTemplateRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as UseAnotherTemplateResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "pipeline": {
    "siteId": "acme",
    "template": "projects",
    "itemSingular": "Job",
    "itemPlural": "Jobs",
    "chosenBy": "owner",
    "reason": "A plumbing business with free on-site quotes.",
    "assistantJobs": true,
    "quote": {
      "enabled": true,
      "label": "Get a quote",
      "askContact": true
    },
    "editedAt": null,
    "stages": [
      {
        "id": "stg_3f2a1b0c9d8e7f6a",
        "name": "New request",
        "color": "#3b82f6",
        "position": 0,
        "kind": "open",
        "rotDays": 1
      }
    ],
    "fields": [
      {
        "id": "fld_1a2b3c4d5e6f7a8b",
        "name": "service",
        "label": "Service",
        "type": "select",
        "required": false,
        "options": [
          "Blocked drains",
          "Hot water"
        ],
        "question": "Which service do you need?",
        "position": 0,
        "inQuote": true,
        "quotePosition": 0,
        "archived": false
      }
    ],
    "quotePreview": [
      {
        "field": "service",
        "ask": "Which service do you need?",
        "input": "choice",
        "choices": [
          "Blocked drains",
          "Hot water"
        ]
      }
    ]
  },
  "templates": [
    {
      "id": "service-quote",
      "name": "Service quote",
      "description": "Trades and home or business services that quote before the work.",
      "stages": [
        {
          "name": "New request",
          "kind": "open",
          "color": "#3b82f6",
          "rotDays": 1
        }
      ],
      "fields": [
        {
          "name": "service",
          "label": "Service",
          "type": "select",
          "options": [],
          "question": "Which service do you need?",
          "quote": true
        }
      ]
    }
  ]
}
```
```ts [Type]
type UseAnotherTemplateResponse = {
  pipeline: {
    siteId: string;
    template: string;
    itemSingular: string;
    itemPlural: string;
    chosenBy: string;
    reason: string | null;
    assistantJobs: boolean;
    quote: {
      enabled: boolean;
      label: string;
      askContact: boolean;
    };
    editedAt: number | null;
    stages: Array<{
      id: string;
      name: string;
      color: string;
      position: number;
      kind: string;
      rotDays: number;
    }>;
    fields: Array<{
      id: string;
      name: string;
      label: string;
      type: string;
      required: boolean;
      options: string[];
      question: string;
      position: number;
      inQuote: boolean;
      quotePosition: number;
      archived: boolean;
    }>;
    quotePreview: Array<{
      field: string;
      ask: string;
      input: string;
      choices: string[];
    }>;
  };
  templates: Array<{
    id: string;
    name: string;
    description: string;
    stages: Array<{
      name: string;
      kind: string;
      color: string;
      rotDays: number;
    }>;
    fields: Array<{
      name: string;
      label: string;
      type: string;
      options: string[];
      question: string;
      quote: boolean;
    }>;
  }>;
};
```
<!-- /tabs -->

## Let the AI set the pipeline up

`POST /jobs/setup` · scope `settings:write`

Reads the website (what the assistant learned, else the home page), chooses a template and customises it (the site's services as options, a stage for its process). Not sure: the basic template. With `force` (the default) it replaces the current pipeline. `helppuff deploy` calls it with `force: false`, which sets Jobs up only if it never was: `status` is `kept` (already set up), `waiting` (the website is still being learned; it is set up when learning finishes) or `done`. Uses Workers AI (a few hundred neurons).

| Body field | Required | Description |
| --- | --- | --- |
| `force` | no | Default true: choose again. False: only the first time, never over a pipeline the owner or the AI set up. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/jobs/setup" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "force": true
}'
```
```ts [TypeScript]
type LetAISetPipelineUpRequest = {
  /**
   * Default true: choose again. False: only the first time, never over a
   * pipeline the owner or the AI set up.
   */
  force?: boolean;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/jobs/setup`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    force: true
  } satisfies LetAISetPipelineUpRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as LetAISetPipelineUpResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "status": "done",
  "template": "service-quote",
  "chosenBy": "ai",
  "reason": "A plumbing business with free on-site quotes.",
  "applied": true,
  "pipeline": {
    "siteId": "acme",
    "template": "service-quote",
    "itemSingular": "Job",
    "itemPlural": "Jobs",
    "chosenBy": "ai",
    "reason": "A plumbing business with free on-site quotes.",
    "assistantJobs": true,
    "quote": {
      "enabled": true,
      "label": "Get a quote",
      "askContact": true
    },
    "editedAt": null,
    "stages": [
      {
        "id": "stg_3f2a1b0c9d8e7f6a",
        "name": "New request",
        "color": "#3b82f6",
        "position": 0,
        "kind": "open",
        "rotDays": 1
      }
    ],
    "fields": [
      {
        "id": "fld_1a2b3c4d5e6f7a8b",
        "name": "service",
        "label": "Service",
        "type": "select",
        "required": false,
        "options": [
          "Blocked drains",
          "Hot water"
        ],
        "question": "Which service do you need?",
        "position": 0,
        "inQuote": true,
        "quotePosition": 0,
        "archived": false
      }
    ],
    "quotePreview": [
      {
        "field": "service",
        "ask": "Which service do you need?",
        "input": "choice",
        "choices": [
          "Blocked drains",
          "Hot water"
        ]
      }
    ]
  }
}
```
```ts [Type]
type LetAISetPipelineUpResponse = {
  status: string;
  template: string;
  chosenBy: string;
  reason: string | null;
  applied: boolean;
  pipeline: {
    siteId: string;
    template: string;
    itemSingular: string;
    itemPlural: string;
    chosenBy: string;
    reason: string | null;
    assistantJobs: boolean;
    quote: {
      enabled: boolean;
      label: string;
      askContact: boolean;
    };
    editedAt: number | null;
    stages: Array<{
      id: string;
      name: string;
      color: string;
      position: number;
      kind: string;
      rotDays: number;
    }>;
    fields: Array<{
      id: string;
      name: string;
      label: string;
      type: string;
      required: boolean;
      options: string[];
      question: string;
      position: number;
      inQuote: boolean;
      quotePosition: number;
      archived: boolean;
    }>;
    quotePreview: Array<{
      field: string;
      ask: string;
      input: string;
      choices: string[];
    }>;
  };
};
```
<!-- /tabs -->
