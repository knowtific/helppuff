<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Webhooks API

Endpoints that receive events as signed JSON. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List webhook endpoints|API-Reference-Webhooks#list-webhook-endpoints]]: `GET /webhooks`
- [[Add a webhook endpoint|API-Reference-Webhooks#add-a-webhook-endpoint]]: `POST /webhooks`
- [[Change a webhook endpoint|API-Reference-Webhooks#change-a-webhook-endpoint]]: `PATCH /webhooks/:id`
- [[Remove a webhook endpoint|API-Reference-Webhooks#remove-a-webhook-endpoint]]: `DELETE /webhooks/:id`
- [[Send a test event|API-Reference-Webhooks#send-a-test-event]]: `POST /webhooks/:id/test`
- [[Recent deliveries|API-Reference-Webhooks#recent-deliveries]]: `GET /webhooks/:id/deliveries`

## List webhook endpoints

`GET /webhooks` · scope `webhooks:read`

With every event type there is to subscribe to.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/webhooks" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/webhooks`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListWebhookEndpointsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "webhooks": [
    {
      "id": "wh_3c2b1a",
      "url": "https://hooks.example.com/helppuff",
      "description": "CRM sync",
      "events": [
        "lead.captured",
        "callback.requested"
      ],
      "enabled": true,
      "secret": "whsec_0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4",
      "lastStatus": "ok",
      "lastError": null,
      "lastAt": 1760000000000,
      "createdAt": 1760000000000
    }
  ],
  "events": [
    {
      "type": "lead.captured",
      "description": "Contact details arrived…"
    }
  ]
}
```
```ts [Type]
type ListWebhookEndpointsResponse = {
  webhooks: Array<{
    id: string;
    url: string;
    description: string;
    events: string[];
    enabled: boolean;
    secret: string;
    lastStatus: string;
    lastError: string | null;
    lastAt: number;
    createdAt: number;
  }>;
  events: Array<{
    type: string;
    description: string;
  }>;
};
```
<!-- /tabs -->

## Add a webhook endpoint

`POST /webhooks` · scope `webhooks:write`

An https URL and the events it wants (`["*"]` or absent: all). Deliveries are signed with the returned `secret`. Up to 10 per site.

| Body field | Required | Description |
| --- | --- | --- |
| `url` | yes | An https URL. |
| `events` | no | Event types (`GET /webhooks` lists them), or `["*"]` for all (the default). |
| `description` | no | Up to 200 characters. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/webhooks" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "url": "https://hooks.example.com/helppuff",
  "events": [
    "lead.captured",
    "callback.requested"
  ],
  "description": "CRM sync"
}'
```
```ts [TypeScript]
type AddWebhookEndpointRequest = {
  /** An https URL. */
  url: string;
  /**
   * Event types (`GET /webhooks` lists them), or `["*"]` for all (the
   * default).
   */
  events?: string[];
  /** Up to 200 characters. */
  description?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/webhooks`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://hooks.example.com/helppuff',
    events: [
      'lead.captured',
      'callback.requested'
    ],
    description: 'CRM sync'
  } satisfies AddWebhookEndpointRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AddWebhookEndpointResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "wh_3c2b1a",
  "url": "https://hooks.example.com/helppuff",
  "description": "CRM sync",
  "events": [
    "lead.captured",
    "callback.requested"
  ],
  "enabled": true,
  "secret": "whsec_0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4",
  "lastStatus": "ok",
  "lastError": null,
  "lastAt": 1760000000000,
  "createdAt": 1760000000000
}
```
```ts [Type]
type AddWebhookEndpointResponse = {
  id: string;
  url: string;
  description: string;
  events: string[];
  enabled: boolean;
  secret: string;
  lastStatus: string;
  lastError: string | null;
  lastAt: number;
  createdAt: number;
};
```
<!-- /tabs -->

## Change a webhook endpoint

`PATCH /webhooks/:id` · scope `webhooks:write`

Any of `url`, `events`, `enabled`, `description`; `rotateSecret: true` makes a new signing secret.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/webhooks/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "enabled": false
}'
```
```ts [TypeScript]
type ChangeWebhookEndpointRequest = {
  enabled?: boolean;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/webhooks/${id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    enabled: false
  } satisfies ChangeWebhookEndpointRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ChangeWebhookEndpointResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "wh_3c2b1a",
  "url": "https://hooks.example.com/helppuff",
  "description": "CRM sync",
  "events": [
    "lead.captured",
    "callback.requested"
  ],
  "enabled": false,
  "secret": "whsec_0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4",
  "lastStatus": "ok",
  "lastError": null,
  "lastAt": 1760000000000,
  "createdAt": 1760000000000
}
```
```ts [Type]
type ChangeWebhookEndpointResponse = {
  id: string;
  url: string;
  description: string;
  events: string[];
  enabled: boolean;
  secret: string;
  lastStatus: string;
  lastError: string | null;
  lastAt: number;
  createdAt: number;
};
```
<!-- /tabs -->

## Remove a webhook endpoint

`DELETE /webhooks/:id` · scope `webhooks:write`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/webhooks/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/webhooks/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RemoveWebhookEndpointResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "deleted": true
}
```
```ts [Type]
type RemoveWebhookEndpointResponse = {
  deleted: boolean;
};
```
<!-- /tabs -->

## Send a test event

`POST /webhooks/:id/test` · scope `webhooks:write`

Delivers a signed `test.ping` now and says what came back.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/webhooks/ID/test" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```
```ts [TypeScript]
type SendTestEventRequest = Record<string, never>;

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/webhooks/${id}/test`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({} satisfies SendTestEventRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SendTestEventResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "ok": true,
  "status": 200,
  "error": null,
  "attempts": 1,
  "durationMs": 182,
  "retryable": false,
  "eventId": "evt_4f3e2d1c"
}
```
```ts [Type]
type SendTestEventResponse = {
  ok: boolean;
  status: number;
  error: string | null;
  attempts: number;
  durationMs: number;
  retryable: boolean;
  eventId: string;
};
```
<!-- /tabs -->

## Recent deliveries

`GET /webhooks/:id/deliveries` · scope `webhooks:read`

The last 50 attempts for an endpoint.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/webhooks/ID/deliveries" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/webhooks/${id}/deliveries`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RecentDeliveriesResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "deliveries": [
    {
      "id": "d_1",
      "eventId": "evt_4f3e2d1c",
      "event": "lead.captured",
      "ok": true,
      "status": 200,
      "error": null,
      "attempts": 1,
      "durationMs": 182,
      "at": 1760000000000
    }
  ]
}
```
```ts [Type]
type RecentDeliveriesResponse = {
  deliveries: Array<{
    id: string;
    eventId: string;
    event: string;
    ok: boolean;
    status: number;
    error: string | null;
    attempts: number;
    durationMs: number;
    at: number;
  }>;
};
```
<!-- /tabs -->
