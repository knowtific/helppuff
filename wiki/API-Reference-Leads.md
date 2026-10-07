<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Leads API

The people who gave contact details: your CRM. Keyed by email per site. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List leads|API-Reference-Leads#list-leads]]: `GET /leads`
- [[Create a lead|API-Reference-Leads#create-a-lead]]: `POST /leads`
- [[Get a lead|API-Reference-Leads#get-a-lead]]: `GET /leads/:id`
- [[Update a lead|API-Reference-Leads#update-a-lead]]: `PATCH /leads/:id`
- [[Delete a lead|API-Reference-Leads#delete-a-lead]]: `DELETE /leads/:id`
- [[Export leads as CSV|API-Reference-Leads#export-leads-as-csv]]: `GET /leads.csv`

## List leads

`GET /leads` · scope `leads:read`

Most recently updated first, up to 500, with counts by status.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `q` | query | no | Search name, email, phone and notes. |
| `status` | query | no | `new`, `contacted`, `qualified`, `won` or `lost`. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/leads" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/leads`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListLeadsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "items": [
    {
      "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
      "site": "acme",
      "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "phone": "0400 111 222",
      "fields": "{\"company\":\"Analytical Engines\"}",
      "source": "form",
      "status": "new",
      "notes": null,
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "conversations": 2,
      "lastConversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
      "openCallbacks": 1
    }
  ],
  "counts": {
    "new": 1
  }
}
```
```ts [Type]
type ListLeadsResponse = {
  items: Array<{
    id: string;
    site: string;
    conversationId: string;
    name: string;
    email: string;
    phone: string;
    fields: string;
    source: string;
    status: string;
    notes: string | null;
    createdAt: number;
    updatedAt: number;
    conversations: number;
    lastConversationId: string;
    openCallbacks: number;
  }>;
  counts: Record<string, number>;
};
```
<!-- /tabs -->

## Create a lead

`POST /leads` · scope `leads:write`

Adds a contact from elsewhere (your CRM, an import). Needs a name, an email or a phone. One lead per email per site: a second answers 409 with the first one's id. Sends `lead.captured` with `source: "api"`.

| Body field | Required | Description |
| --- | --- | --- |
| `name` | no | Up to 200 characters. |
| `email` | no | One lead per email per site. |
| `phone` | no | Up to 40 characters. |
| `fields` | no | Any other details: up to 20 string values. |
| `status` | no | `new` (default), `contacted`, `qualified`, `won` or `lost`. |
| `notes` | no | Up to 5000 characters. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/leads" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Grace Hopper",
  "email": "grace@example.com",
  "phone": "0400 333 444",
  "fields": {
    "company": "Navy"
  },
  "status": "new",
  "notes": "Met at the expo."
}'
```
```ts [TypeScript]
type CreateLeadRequest = {
  /** Up to 200 characters. */
  name?: string;
  /** One lead per email per site. */
  email?: string;
  /** Up to 40 characters. */
  phone?: string;
  /** Any other details: up to 20 string values. */
  fields?: Record<string, string>;
  /** `new` (default), `contacted`, `qualified`, `won` or `lost`. */
  status?: string;
  /** Up to 5000 characters. */
  notes?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/leads`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Grace Hopper',
    email: 'grace@example.com',
    phone: '0400 333 444',
    fields: {
      company: 'Navy'
    },
    status: 'new',
    notes: 'Met at the expo.'
  } satisfies CreateLeadRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as CreateLeadResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "lead_7a1c…",
  "site_id": "acme",
  "conversation_id": null,
  "name": "Grace Hopper",
  "email": "grace@example.com",
  "phone": "0400 333 444",
  "fields": "{\"company\":\"Navy\"}",
  "source": "api",
  "status": "new",
  "notes": "Met at the expo.",
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```
```ts [Type]
type CreateLeadResponse = {
  id: string;
  site_id: string;
  conversation_id: string | null;
  name: string;
  email: string;
  phone: string;
  fields: string;
  source: string;
  status: string;
  notes: string;
  created_at: number;
  updated_at: number;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 409 | `conflict` | A lead with this email exists (its id is in the message). |

## Get a lead

`GET /leads/:id` · scope `leads:read`

The lead with the conversations linked to it.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/leads/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/leads/${id}`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as GetLeadResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
  "site_id": "acme",
  "conversation_id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "phone": "0400 111 222",
  "fields": "{\"company\":\"Analytical Engines\"}",
  "source": "form",
  "status": "new",
  "notes": null,
  "created_at": 1760000000000,
  "updated_at": 1760000000000,
  "conversations": [
    {
      "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
      "startedAt": 1760000000000,
      "lastAt": 1760000120000,
      "pageUrl": "https://acme.example/pricing",
      "firstMessage": "How much is a blocked drain?",
      "messageCount": 6,
      "summary": null,
      "channel": "widget"
    }
  ]
}
```
```ts [Type]
type GetLeadResponse = {
  id: string;
  site_id: string;
  conversation_id: string;
  name: string;
  email: string;
  phone: string;
  fields: string;
  source: string;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
  conversations: Array<{
    id: string;
    startedAt: number;
    lastAt: number;
    pageUrl: string;
    firstMessage: string;
    messageCount: number;
    summary: string | null;
    channel: string;
  }>;
};
```
<!-- /tabs -->

## Update a lead

`PATCH /leads/:id` · scope `leads:write`

Changes the status, notes or name. Sends `lead.updated`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `status` | no | `new`, `contacted`, `qualified`, `won` or `lost`. |
| `notes` | no | Replaces the notes (up to 5000 characters). |
| `name` | no | Up to 200 characters. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/leads/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "status": "contacted",
  "notes": "Called, booked for Tuesday."
}'
```
```ts [TypeScript]
type UpdateLeadRequest = {
  /** `new`, `contacted`, `qualified`, `won` or `lost`. */
  status?: string;
  /** Replaces the notes (up to 5000 characters). */
  notes?: string;
  /** Up to 200 characters. */
  name?: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/leads/${id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    status: 'contacted',
    notes: 'Called, booked for Tuesday.'
  } satisfies UpdateLeadRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as UpdateLeadResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
  "site_id": "acme",
  "conversation_id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "phone": "0400 111 222",
  "fields": "{\"company\":\"Analytical Engines\"}",
  "source": "form",
  "status": "contacted",
  "notes": "Called, booked for Tuesday.",
  "created_at": 1760000000000,
  "updated_at": 1760000000000
}
```
```ts [Type]
type UpdateLeadResponse = {
  id: string;
  site_id: string;
  conversation_id: string;
  name: string;
  email: string;
  phone: string;
  fields: string;
  source: string;
  status: string;
  notes: string;
  created_at: number;
  updated_at: number;
};
```
<!-- /tabs -->

## Delete a lead

`DELETE /leads/:id` · scope `leads:write`

Deletes the lead. With `?erase=conversations`, also every conversation linked to it, with their messages and callback requests: for a person who asks to be forgotten.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |
| `erase` | query | no | `conversations` to delete the linked conversations too. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/leads/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/leads/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as DeleteLeadResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
  "deleted": true,
  "conversationsDeleted": 2
}
```
```ts [Type]
type DeleteLeadResponse = {
  id: string;
  deleted: boolean;
  conversationsDeleted: number;
};
```
<!-- /tabs -->

## Export leads as CSV

`GET /leads.csv` · scope `leads:read`

Every lead, newest first. Cells that could run as a spreadsheet formula are prefixed with `'`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/leads.csv" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/leads.csv`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data: ExportLeadsAsCSVResponse = await response.text();
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```csv [Example]
created,name,email,phone,status,source,notes,site,conversation
2025-10-09T08:53:20.000Z,Ada Lovelace,ada@example.com,0400 111 222,new,form,,acme,1b0f6a52-…
```
```ts [Type]
/** CSV text. */
type ExportLeadsAsCSVResponse = string;
```
<!-- /tabs -->
