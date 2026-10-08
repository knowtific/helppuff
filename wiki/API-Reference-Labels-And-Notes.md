<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Labels and notes API

Labels a site defines and puts on conversations (the AI can too), and the team's private notes on conversations and contacts. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[Add a note to a conversation|API-Reference-Labels-And-Notes#add-a-note-to-a-conversation]]: `POST /conversations/:id/notes`
- [[Edit a note|API-Reference-Labels-And-Notes#edit-a-note]]: `PATCH /notes/:id`
- [[Delete a note|API-Reference-Labels-And-Notes#delete-a-note]]: `DELETE /notes/:id`
- [[List labels|API-Reference-Labels-And-Notes#list-labels]]: `GET /labels`
- [[Create a label|API-Reference-Labels-And-Notes#create-a-label]]: `POST /labels`
- [[Change a label|API-Reference-Labels-And-Notes#change-a-label]]: `PATCH /labels/:id`
- [[Delete a label|API-Reference-Labels-And-Notes#delete-a-label]]: `DELETE /labels/:id`
- [[Add a note to a contact|API-Reference-Labels-And-Notes#add-a-note-to-a-contact]]: `POST /leads/:id/notes`

## Add a note to a conversation

`POST /conversations/:id/notes` · scope `conversations:write`

A private note for the team: never shown to the visitor or the assistant. It also shows on the contact.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `text` | yes | Up to 5000 characters. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/conversations/ID/notes" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "text": "Called her back, booked for Tuesday."
}'
```
```ts [TypeScript]
type AddNoteToConversationRequest = {
  /** Up to 5000 characters. */
  text: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}/notes`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'Called her back, booked for Tuesday.'
  } satisfies AddNoteToConversationRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AddNoteToConversationResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "note_mfx2k1a9b3c4",
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "leadId": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
  "author": "sam@acme.example",
  "authorName": "Sam",
  "text": "Called her back, booked for Tuesday.",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type AddNoteToConversationResponse = {
  id: string;
  conversationId: string;
  leadId: string | null;
  author: string;
  authorName: string | null;
  text: string;
  createdAt: number;
  updatedAt: number;
};
```
<!-- /tabs -->

## Edit a note

`PATCH /notes/:id` · scope `conversations:write`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `text` | yes | Up to 5000 characters. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/notes/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "text": "Booked for Tuesday 9am."
}'
```
```ts [TypeScript]
type EditNoteRequest = {
  /** Up to 5000 characters. */
  text: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/notes/${id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'Booked for Tuesday 9am.'
  } satisfies EditNoteRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as EditNoteResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "note_mfx2k1a9b3c4",
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "leadId": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
  "author": "sam@acme.example",
  "authorName": "Sam",
  "text": "Booked for Tuesday 9am.",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type EditNoteResponse = {
  id: string;
  conversationId: string | null;
  leadId: string | null;
  author: string;
  authorName: string | null;
  text: string;
  createdAt: number;
  updatedAt: number;
};
```
<!-- /tabs -->

## Delete a note

`DELETE /notes/:id` · scope `conversations:write`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/notes/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/notes/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as DeleteNoteResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "note_mfx2k1a9b3c4",
  "deleted": true
}
```
```ts [Type]
type DeleteNoteResponse = {
  id: string;
  deleted: boolean;
};
```
<!-- /tabs -->

## List labels

`GET /labels` · scope `conversations:read`

The site's labels, with the colours there are. `ai`: the AI may put it on a conversation when it goes quiet, guided by `description`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/labels" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/labels`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListLabelsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "labels": [
    {
      "id": "lbl_3f2a1b0c9d8e",
      "name": "Urgent",
      "color": "#ef4444",
      "description": "Needs an answer today",
      "ai": true
    }
  ],
  "colors": [
    "#6b7280",
    "#ef4444",
    "#3b82f6"
  ]
}
```
```ts [Type]
type ListLabelsResponse = {
  labels: Array<{
    id: string;
    name: string;
    color: string;
    description: string;
    ai: boolean;
  }>;
  colors: string[];
};
```
<!-- /tabs -->

## Create a label

`POST /labels` · scope `settings:write`

| Body field | Required | Description |
| --- | --- | --- |
| `name` | yes | Up to 40 characters, one per name. |
| `color` | no | A hex colour like `#3b82f6`; one is picked if left out. |
| `description` | no | What it means (up to 200 characters): the AI reads it to decide. |
| `ai` | no | Whether the AI may use it (default true). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/labels" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Urgent",
  "color": "#ef4444",
  "description": "Needs an answer today"
}'
```
```ts [TypeScript]
type CreateLabelRequest = {
  /** Up to 40 characters, one per name. */
  name: string;
  /** A hex colour like `#3b82f6`; one is picked if left out. */
  color?: string;
  /** What it means (up to 200 characters): the AI reads it to decide. */
  description?: string;
  /** Whether the AI may use it (default true). */
  ai?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/labels`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Urgent',
    color: '#ef4444',
    description: 'Needs an answer today'
  } satisfies CreateLabelRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as CreateLabelResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "lbl_3f2a1b0c9d8e",
  "name": "Urgent",
  "color": "#ef4444",
  "description": "Needs an answer today",
  "ai": true
}
```
```ts [Type]
type CreateLabelResponse = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  ai: boolean;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 409 | `conflict` | A label with this name exists. |

## Change a label

`PATCH /labels/:id` · scope `settings:write`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `name` | no | Up to 40 characters. |
| `color` | no | A hex colour. |
| `description` | no | What it means. |
| `ai` | no | Whether the AI may use it. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/labels/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "ai": false
}'
```
```ts [TypeScript]
type ChangeLabelRequest = {
  /** Up to 40 characters. */
  name?: string;
  /** A hex colour. */
  color?: string;
  /** What it means. */
  description?: string;
  /** Whether the AI may use it. */
  ai?: boolean;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/labels/${id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    ai: false
  } satisfies ChangeLabelRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ChangeLabelResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "lbl_3f2a1b0c9d8e",
  "name": "Urgent",
  "color": "#ef4444",
  "description": "Needs an answer today",
  "ai": false
}
```
```ts [Type]
type ChangeLabelResponse = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  ai: boolean;
};
```
<!-- /tabs -->

## Delete a label

`DELETE /labels/:id` · scope `settings:write`

Removes it from every conversation too.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/labels/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/labels/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as DeleteLabelResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "lbl_3f2a1b0c9d8e",
  "deleted": true
}
```
```ts [Type]
type DeleteLabelResponse = {
  id: string;
  deleted: boolean;
};
```
<!-- /tabs -->

## Add a note to a contact

`POST /leads/:id/notes` · scope `leads:write`

A private note for the team about this person.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `text` | yes | Up to 5000 characters. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/leads/ID/notes" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "text": "Prefers email. Owns two properties."
}'
```
```ts [TypeScript]
type AddNoteToContactRequest = {
  /** Up to 5000 characters. */
  text: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/leads/${id}/notes`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'Prefers email. Owns two properties.'
  } satisfies AddNoteToContactRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AddNoteToContactResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "note_mfx2k1a9b3c4",
  "conversationId": null,
  "leadId": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
  "author": "sam@acme.example",
  "authorName": "Sam",
  "text": "Prefers email. Owns two properties.",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type AddNoteToContactResponse = {
  id: string;
  conversationId: string | null;
  leadId: string;
  author: string;
  authorName: string | null;
  text: string;
  createdAt: number;
  updatedAt: number;
};
```
<!-- /tabs -->
