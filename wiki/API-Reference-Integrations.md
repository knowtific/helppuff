<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Integrations API

Keys for other services (Composio, Cal.com, Calendly), sealed and live at once, and Composio's connected calendar accounts. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List integrations|API-Reference-Integrations#list-integrations]]: `GET /integrations`
- [[Connect an integration|API-Reference-Integrations#connect-an-integration]]: `PUT /integrations/:kind`
- [[Check an integration|API-Reference-Integrations#check-an-integration]]: `POST /integrations/:kind/test`
- [[Remove an integration|API-Reference-Integrations#remove-an-integration]]: `DELETE /integrations/:kind`
- [[Composio's connected accounts|API-Reference-Integrations#composios-connected-accounts]]: `GET /integrations/composio/accounts`
- [[Connect a calendar account|API-Reference-Integrations#connect-a-calendar-account]]: `POST /integrations/composio/connect`
- [[Cal.com webhook details|API-Reference-Integrations#calcom-webhook-details]]: `GET /integrations/calcom/webhook`

## List integrations

`GET /integrations` · scope `settings:read`

Every kind (`composio`, `calcom`, `calendly`), connected or not, with how its last call went. Keys are never returned.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/integrations" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/integrations`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListIntegrationsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "items": [
    {
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
    }
  ],
  "help": {
    "composio": {
      "name": "Composio",
      "key": "API key",
      "help": "Connects Google Calendar and Outlook without your own OAuth app."
    },
    "calcom": {
      "name": "Cal.com",
      "key": "API key (cal_live_…)",
      "help": "Cal.com → Settings → Developer → API keys."
    },
    "calendly": {
      "name": "Calendly",
      "key": "Personal access token",
      "help": "Calendly → Integrations → API and webhooks."
    }
  }
}
```
```ts [Type]
type ListIntegrationsResponse = {
  items: Array<{
    kind: string;
    name: string;
    connected: boolean;
    baseUrl: string | null;
    status: string;
    lastError: string | null;
    lastAt: number | null;
    account: string | null;
    plan: string | null;
    createdAt: number | null;
    updatedAt: number | null;
  }>;
  help: {
    composio: {
      name: string;
      key: string;
      help: string;
    };
    calcom: {
      name: string;
      key: string;
      help: string;
    };
    calendly: {
      name: string;
      key: string;
      help: string;
    };
  };
};
```
<!-- /tabs -->

## Connect an integration

`PUT /integrations/:kind` · scope `settings:write`

Saves the key (sealed; live at once), then checks it with the service: `check` says how that went. An empty `key` keeps the stored one (to change only `baseUrl`). `:kind` is `composio`, `calcom` or `calendly`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `kind` | path | yes | The kind. |

| Body field | Required | Description |
| --- | --- | --- |
| `key` | yes | The service's API key or token. |
| `baseUrl` | no | Cal.com self-hosted: your API v2 base URL, e.g. `https://cal.example.com/api/v2`. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PUT "$HELPPUFF_URL/api/v1/integrations/KIND" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "key": "cal_live_0123456789abcdef"
}'
```
```ts [TypeScript]
type ConnectIntegrationRequest = {
  /** The service's API key or token. */
  key: string;
  /**
   * Cal.com self-hosted: your API v2 base URL, e.g.
   * `https://cal.example.com/api/v2`.
   */
  baseUrl?: string;
};

const kind = '2';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/integrations/KIND`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    key: 'cal_live_0123456789abcdef'
  } satisfies ConnectIntegrationRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ConnectIntegrationResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
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
  "updatedAt": 1760000000000,
  "check": {
    "ok": true,
    "detail": "Connected: 2 event types."
  }
}
```
```ts [Type]
type ConnectIntegrationResponse = {
  kind: string;
  name: string;
  connected: boolean;
  baseUrl: string | null;
  status: string;
  lastError: string | null;
  lastAt: number | null;
  account: string | null;
  plan: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  check: {
    ok: boolean;
    detail: string;
  };
};
```
<!-- /tabs -->

## Check an integration

`POST /integrations/:kind/test` · scope `settings:read`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `kind` | path | yes | The kind. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/integrations/KIND/test" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const kind = '2';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/integrations/KIND/test`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as CheckIntegrationResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "ok": true,
  "detail": "Connected as Ada Lovelace."
}
```
```ts [Type]
type CheckIntegrationResponse = {
  ok: boolean;
  detail: string;
};
```
<!-- /tabs -->

## Remove an integration

`DELETE /integrations/:kind` · scope `settings:write`

Forgets the key. A calendar synced through it stops syncing; appointments stay.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `kind` | path | yes | The kind. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/integrations/KIND" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const kind = '2';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/integrations/KIND`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RemoveIntegrationResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "kind": "calcom",
  "deleted": true
}
```
```ts [Type]
type RemoveIntegrationResponse = {
  kind: string;
  deleted: boolean;
};
```
<!-- /tabs -->

## Composio's connected accounts

`GET /integrations/composio/accounts` · scope `settings:read`

The site's accounts at Composio (its user id is the site id), to pick for the calendar sync.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `toolkit` | query | no | `google` or `outlook`; left out, all. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/integrations/composio/accounts" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/integrations/composio/accounts`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ComposioSConnectedAccountsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "items": [
    {
      "id": "ca_8kq2m5n7p9r1",
      "toolkit": "googlecalendar",
      "label": "ada@acme.example",
      "status": "ACTIVE"
    }
  ]
}
```
```ts [Type]
type ComposioSConnectedAccountsResponse = {
  items: Array<{
    id: string;
    toolkit: string;
    label: string;
    status: string;
  }>;
};
```
<!-- /tabs -->

## Connect a calendar account

`POST /integrations/composio/connect` · scope `settings:write`

A Composio Connect Link: open it to sign in to Google Calendar or Outlook; you come back to `returnUrl` (default the dashboard's Integrations page).

| Body field | Required | Description |
| --- | --- | --- |
| `toolkit` | yes | `google` or `outlook`. |
| `returnUrl` | no | An https page to come back to. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/integrations/composio/connect" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "toolkit": "google"
}'
```
```ts [TypeScript]
type ConnectCalendarAccountRequest = {
  /** `google` or `outlook`. */
  toolkit: string;
  /** An https page to come back to. */
  returnUrl?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/integrations/composio/connect`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    toolkit: 'google'
  } satisfies ConnectCalendarAccountRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ConnectCalendarAccountResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "url": "https://connect.composio.dev/link/lk_3f9a8b7c6d5e"
}
```
```ts [Type]
type ConnectCalendarAccountResponse = {
  url: string;
};
```
<!-- /tabs -->

## Cal.com webhook details

`GET /integrations/calcom/webhook` · scope `settings:read`

The address and secret to add in Cal.com (Settings → Developer → Webhooks), so bookings made or changed there show at once instead of at the next sync.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/integrations/calcom/webhook" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/integrations/calcom/webhook`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as CalComWebhookDetailsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "url": "https://chat.acme.example/v1/integrations/calcom/acme",
  "secret": "whcal_5d41402abc4b2a76b9719d911017c592",
  "triggers": [
    "BOOKING_CREATED",
    "BOOKING_RESCHEDULED",
    "BOOKING_CANCELLED"
  ]
}
```
```ts [Type]
type CalComWebhookDetailsResponse = {
  url: string;
  secret: string;
  triggers: string[];
};
```
<!-- /tabs -->
