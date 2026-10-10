<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Conversations API

Read, summarise and delete conversations, from the widget and the API alike. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List conversations|API-Reference-Conversations#list-conversations]]: `GET /conversations`
- [[Get a conversation|API-Reference-Conversations#get-a-conversation]]: `GET /conversations/:id`
- [[Label a conversation, or set its attributes|API-Reference-Conversations#label-a-conversation-or-set-its-attributes]]: `PATCH /conversations/:id`
- [[Summarise a conversation|API-Reference-Conversations#summarise-a-conversation]]: `POST /conversations/:id/summary`
- [[Delete a conversation|API-Reference-Conversations#delete-a-conversation]]: `DELETE /conversations/:id`

## List conversations

`GET /conversations` · scope `conversations:read`

Newest activity first, 30 at a time. Pass `next` from the answer as `before` for the next page.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `q` | query | no | Search messages, summaries and lead details (up to 48 characters). |
| `filter` | query | no | `all`, `leads` (with a lead), `unsummarized`, `callbacks` (with an open callback request) or `waiting` (a live chat waiting for the team's reply). |
| `status` | query | no | `all`, `bot` (the assistant has it), `live` (a person has it) or `closed` (closed, or quiet for `live.closeAfterMinutes`). |
| `label` | query | no | Conversations with this label (its id or name). |
| `assigned` | query | no | `me`, `none`, or a team member's email. |
| `externalId` | query | no | Conversations started over the API with this `externalId`. |
| `before` | query | no | Cursor: the `next` of the previous page. |
| `limit` | query | no | 1–100, default 30. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/conversations" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListConversationsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "items": [
    {
      "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
      "site": "acme",
      "startedAt": 1760000000000,
      "lastAt": 1760000120000,
      "pageUrl": "https://acme.example/pricing",
      "country": "AU",
      "firstMessage": "How much is a blocked drain?",
      "messageCount": 6,
      "summary": "Ada asked about a blocked drain and booked a callback.",
      "intent": "Pricing question",
      "leadName": "Ada Lovelace",
      "leadEmail": "ada@example.com",
      "leadPhone": "0400 111 222",
      "leadStatus": "new",
      "callback": "open",
      "status": "live",
      "assignedTo": "sam@acme.example",
      "assignedName": "Sam",
      "waitingSince": 1760000120000,
      "attributes": {
        "orderId": "A-1042"
      },
      "labels": [
        {
          "id": "lbl_3f2a1b0c9d8e",
          "name": "Urgent",
          "color": "#ef4444"
        }
      ]
    }
  ],
  "next": null
}
```
```ts [Type]
type ListConversationsResponse = {
  items: Array<{
    id: string;
    site: string;
    startedAt: number;
    lastAt: number;
    pageUrl: string;
    country: string;
    firstMessage: string;
    messageCount: number;
    summary: string;
    intent: string;
    leadName: string;
    leadEmail: string;
    leadPhone: string;
    leadStatus: string;
    callback: string;
    status: string;
    assignedTo: string | null;
    assignedName: string | null;
    waitingSince: number | null;
    attributes: {
      orderId: string;
    };
    labels: Array<{
      id: string;
      name: string;
      color: string;
    }>;
  }>;
  next: string | null;
};
```
<!-- /tabs -->

## Get a conversation

`GET /conversations/:id` · scope `conversations:read`

The conversation (with its `status`, who has it, custom `attributes`, `data`: what the site's tools returned or saved, by tool name, and `user`: the signed-in visitor, verified, or null), its lead, callback requests, labels, the team's notes and every message both ways (a person's replies carry `author`).

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/conversations/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as GetConversationResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "conversation": {
    "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
    "site_id": "acme",
    "started_at": 1760000000000,
    "last_at": 1760000120000,
    "page_url": "https://acme.example/pricing",
    "page_title": "Pricing",
    "referrer": null,
    "utm": null,
    "locale": "en-AU",
    "country": "AU",
    "first_message": "How much is a blocked drain?",
    "message_count": 2,
    "lead_id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
    "summary": null,
    "intent": null,
    "summarized_at": null,
    "completed_at": null,
    "ended_at": null,
    "channel": "widget",
    "status": "bot",
    "assigned_to": null,
    "assigned_name": null,
    "handover_at": null,
    "waiting_since": null,
    "closed_at": null,
    "attributes": {
      "orderId": "A-1042"
    },
    "data": {
      "order_status": {
        "status": "shipped",
        "delivery": {
          "date": "2026-10-12"
        }
      }
    },
    "user": {
      "id": "u_8812",
      "email": "ada@example.com",
      "plan": "pro"
    }
  },
  "lead": {
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
    "company": "Analytical Engines",
    "address": null,
    "attributes": {
      "plan": "pro"
    }
  },
  "callbacks": [
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
  "labels": [
    {
      "id": "lbl_3f2a1b0c9d8e",
      "name": "Urgent",
      "color": "#ef4444",
      "addedBy": "ai",
      "addedAt": 1760000000000
    }
  ],
  "notes": [
    {
      "id": "note_mfx2k1a9b3c4",
      "author": "sam@acme.example",
      "authorName": "Sam",
      "text": "Called her back, booked for Tuesday.",
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000
    }
  ],
  "messages": [
    {
      "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10:u1",
      "role": "user",
      "type": "text",
      "text": "How much is a blocked drain?",
      "payload": null,
      "ts": 1760000000000,
      "feedback": null,
      "author": null
    },
    {
      "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10:m_mfx2k1",
      "role": "agent",
      "type": "text",
      "text": "Usually $180–$250.",
      "payload": {},
      "ts": 1760000000001,
      "feedback": 1,
      "author": null
    }
  ]
}
```
```ts [Type]
type GetConversationResponse = {
  conversation: {
    id: string;
    site_id: string;
    started_at: number;
    last_at: number;
    page_url: string;
    page_title: string;
    referrer: string | null;
    utm: string | null;
    locale: string;
    country: string;
    first_message: string;
    message_count: number;
    lead_id: string;
    summary: string | null;
    intent: string | null;
    summarized_at: number | null;
    completed_at: number | null;
    ended_at: number | null;
    channel: string;
    status: string;
    assigned_to: string | null;
    assigned_name: string | null;
    handover_at: number | null;
    waiting_since: string | null;
    closed_at: number | null;
    attributes: {
      orderId: string;
    };
    data: {
      order_status: {
        status: string;
        delivery: {
          date: string;
        };
      };
    };
    user: {
      id: string;
      email: string;
      plan: string;
    } | null;
  };
  lead: {
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
    company: string;
    address: string | null;
    attributes: {
      plan: string;
    };
  };
  callbacks: Array<{
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
  labels: Array<{
    id: string;
    name: string;
    color: string;
    addedBy: string;
    addedAt: number;
  }>;
  notes: Array<{
    id: string;
    author: string;
    authorName: string;
    text: string;
    createdAt: number;
    updatedAt: number;
  }>;
  messages: Message[];
};
```
<!-- /tabs -->

## Label a conversation, or set its attributes

`PATCH /conversations/:id` · scope `conversations:write`

Custom `attributes` are key-value strings for your own data (an order number, a plan): sent keys are set, `null` removes one, others stay; up to 50. Labels come from the site's list (`GET /labels`), by id or name: `labels` replaces them, `addLabels` and `removeLabels` change them.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `attributes` | no | An object of strings; `null` removes a key. Keys: up to 64 letters, digits, spaces, `_ - .`; values up to 1000 characters. |
| `labels` | no | The labels it should have (ids or names), replacing the ones it has. |
| `addLabels` | no | Labels to add. |
| `removeLabels` | no | Labels to remove. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/conversations/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "attributes": {
    "orderId": "A-1042",
    "coupon": null
  },
  "addLabels": [
    "Urgent"
  ]
}'
```
```ts [TypeScript]
type LabelConversationSetItsAttributesRequest = {
  /**
   * An object of strings; `null` removes a key. Keys: up to 64 letters,
   * digits, spaces, `_ - .`; values up to 1000 characters.
   */
  attributes?: {
    orderId?: string;
    coupon?: string | null;
  };
  /** The labels it should have (ids or names), replacing the ones it has. */
  labels?: string;
  /** Labels to add. */
  addLabels?: string[];
  /** Labels to remove. */
  removeLabels?: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    attributes: {
      orderId: 'A-1042',
      coupon: null
    },
    addLabels: [
      'Urgent'
    ]
  } satisfies LabelConversationSetItsAttributesRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as LabelConversationSetItsAttributesResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "labels": [
    {
      "id": "lbl_3f2a1b0c9d8e",
      "name": "Urgent",
      "color": "#ef4444",
      "addedBy": "key:k7m3p9q2r4s8",
      "addedAt": 1760000000000
    }
  ],
  "attributes": {
    "orderId": "A-1042"
  },
  "data": {},
  "notes": []
}
```
```ts [Type]
type LabelConversationSetItsAttributesResponse = {
  id: string;
  labels: Array<{
    id: string;
    name: string;
    color: string;
    addedBy: string;
    addedAt: number;
  }>;
  attributes: {
    orderId: string;
  };
  data: Record<string, unknown>;
  notes: string[];
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | An unknown label, a bad attribute key or value, or more than 50 attributes. |

## Summarise a conversation

`POST /conversations/:id/summary` · scope `conversations:write`

Writes (or rewrites) its AI summary and labels, and sends `conversation.summarized`. Uses Workers AI (a few neurons). Conversations are also summarised automatically 5 minutes after they go quiet.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/conversations/ID/summary" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}/summary`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SummariseConversationResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "summary": "Ada asked about a blocked drain and booked a callback for tomorrow morning.",
  "intent": "Blocked drain",
  "sentiment": "positive",
  "leadQuality": "hot",
  "outcome": "callback_requested",
  "topics": [
    "drains",
    "pricing"
  ],
  "unanswered": [],
  "followUp": "Call Ada tomorrow before 10am.",
  "lead": {
    "name": "Ada Lovelace",
    "phone": "0400 111 222"
  }
}
```
```ts [Type]
type SummariseConversationResponse = {
  summary: string;
  intent: string;
  sentiment: string;
  leadQuality: string;
  outcome: string;
  topics: string[];
  unanswered: string[];
  followUp: string;
  lead: {
    name: string;
    phone: string;
  };
};
```
<!-- /tabs -->

## Delete a conversation

`DELETE /conversations/:id` · scope `conversations:write`

Deletes it with its messages and callback requests. The lead it produced stays (delete it with `DELETE /leads/:id`).

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/conversations/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as DeleteConversationResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "deleted": true
}
```
```ts [Type]
type DeleteConversationResponse = {
  id: string;
  deleted: boolean;
};
```
<!-- /tabs -->
