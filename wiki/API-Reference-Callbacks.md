<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Callbacks API

Visitors who asked to be called back, as tasks. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List callback requests|API-Reference-Callbacks#list-callback-requests]]: `GET /callbacks`
- [[Update a callback request|API-Reference-Callbacks#update-a-callback-request]]: `PATCH /callbacks/:id`

## List callback requests

`GET /callbacks` · scope `callbacks:read`

Open ones oldest first (the queue); others most recent first. Up to 500, with counts by status.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `status` | query | no | `open` (default), `done`, `dismissed` or `all`. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/callbacks" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/callbacks`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListCallbackRequestsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "items": [
    {
      "id": "cb_mfx2k1a9b3c",
      "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
      "leadId": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
      "name": "Ada Lovelace",
      "phone": "0400 111 222",
      "email": "ada@example.com",
      "reason": "A quote for two rooms",
      "status": "open",
      "note": null,
      "requestedAt": 1760000000000,
      "closedAt": null,
      "closedBy": null,
      "pageUrl": "https://acme.example/pricing"
    }
  ],
  "counts": {
    "open": 1,
    "done": 4,
    "dismissed": 0
  }
}
```
```ts [Type]
type ListCallbackRequestsResponse = {
  items: Array<{
    id: string;
    conversationId: string;
    leadId: string;
    name: string;
    phone: string;
    email: string;
    reason: string;
    status: string;
    note: string | null;
    requestedAt: number;
    closedAt: number | null;
    closedBy: string | null;
    pageUrl: string;
  }>;
  counts: Record<string, number>;
};
```
<!-- /tabs -->

## Update a callback request

`PATCH /callbacks/:id` · scope `callbacks:write`

Mark it done or dismissed (or reopen it), or change its note. Sends `callback.updated`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `status` | no | `open`, `done` or `dismissed`. |
| `note` | no | What happened (up to 2000 characters); empty clears it. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/callbacks/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "status": "done",
  "note": "Booked for Tuesday 9am."
}'
```
```ts [TypeScript]
type UpdateCallbackRequestRequest = {
  /** `open`, `done` or `dismissed`. */
  status?: string;
  /** What happened (up to 2000 characters); empty clears it. */
  note?: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/callbacks/${id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    status: 'done',
    note: 'Booked for Tuesday 9am.'
  } satisfies UpdateCallbackRequestRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as UpdateCallbackRequestResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "cb_mfx2k1a9b3c",
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "leadId": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
  "name": "Ada Lovelace",
  "phone": "0400 111 222",
  "email": "ada@example.com",
  "reason": "A quote for two rooms",
  "status": "done",
  "note": "Booked for Tuesday 9am.",
  "requestedAt": 1760000000000,
  "closedAt": 1760003600000,
  "closedBy": "key:k7m3p9q2r4s8",
  "pageUrl": "https://acme.example/pricing"
}
```
```ts [Type]
type UpdateCallbackRequestResponse = {
  id: string;
  conversationId: string;
  leadId: string;
  name: string;
  phone: string;
  email: string;
  reason: string;
  status: string;
  note: string;
  requestedAt: number;
  closedAt: number;
  closedBy: string;
  pageUrl: string;
};
```
<!-- /tabs -->
