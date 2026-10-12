<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Webhooks API

Endpoints that receive events as signed JSON, or as a request in their own format; and the email service that sends the team's email notifications. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List webhook endpoints|API-Reference-Webhooks#list-webhook-endpoints]]: `GET /webhooks`
- [[Add a webhook endpoint|API-Reference-Webhooks#add-a-webhook-endpoint]]: `POST /webhooks`
- [[Change a webhook endpoint|API-Reference-Webhooks#change-a-webhook-endpoint]]: `PATCH /webhooks/:id`
- [[Remove a webhook endpoint|API-Reference-Webhooks#remove-a-webhook-endpoint]]: `DELETE /webhooks/:id`
- [[Send a test event|API-Reference-Webhooks#send-a-test-event]]: `POST /webhooks/:id/test`
- [[Recent deliveries|API-Reference-Webhooks#recent-deliveries]]: `GET /webhooks/:id/deliveries`
- [[The email service|API-Reference-Webhooks#the-email-service]]: `GET /notifications/email`
- [[Set up the email service|API-Reference-Webhooks#set-up-the-email-service]]: `PUT /notifications/email`
- [[Remove the email service|API-Reference-Webhooks#remove-the-email-service]]: `DELETE /notifications/email`
- [[Send a test email|API-Reference-Webhooks#send-a-test-email]]: `POST /notifications/email/test`

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
      "createdAt": 1760000000000,
      "format": "helppuff"
    },
    {
      "id": "wh_7f6e5d",
      "url": "https://slack.com/api/chat.postMessage",
      "description": "Callbacks to #sales",
      "events": [
        "callback.requested"
      ],
      "enabled": true,
      "secret": "whsec_0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4",
      "lastStatus": "ok",
      "lastError": null,
      "lastAt": 1760000000000,
      "createdAt": 1760000000000,
      "format": "custom",
      "method": "POST",
      "headers": [
        {
          "name": "Content-Type",
          "value": "application/json; charset=utf-8",
          "secret": false,
          "set": true
        },
        {
          "name": "Authorization",
          "value": "",
          "secret": true,
          "set": true
        }
      ],
      "body": "{\"channel\": \"#sales\", \"text\": \"Call back {{data.name}} on {{data.phone}}: {{data.message}}\"}"
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
    format: string;
    method?: string;
    headers?: Array<{
      name: string;
      value: string;
      secret: boolean;
      set: boolean;
    }>;
    body?: string;
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

An https URL and the events it wants (`["*"]` or absent: all). Deliveries are signed with the returned `secret`. Up to 10 per site. `format: "custom"` sends your own request instead of the envelope, for a service that wants its own format (Slack, a CRM, an SMS API): a method, headers (secret values are stored encrypted and never returned) and a body template with `{{event.type}}`, `{{data.name}}`…; an empty body sends the envelope. The X-HelpPuff-* headers come with it, the signature over the body sent.

| Body field | Required | Description |
| --- | --- | --- |
| `url` | yes | An https URL. With `format: "custom"`, its path and query may use `{{data.…}}`. |
| `events` | no | Event types (`GET /webhooks` lists them), or `["*"]` for all (the default). |
| `description` | no | Up to 200 characters. |
| `format` | no | `helppuff` (the signed envelope, the default) or `custom`. |
| `method` | no | Custom: `POST` (the default), `PUT`, `PATCH`, `GET` or `DELETE`. |
| `headers` | no | Custom: a list of `{ name, value, secret }`; `${…}` is not expanded here, send the value. An empty secret value keeps the stored one. |
| `body` | no | Custom: the body template. `{{event.id}}`, `{{event.type}}`, `{{event.createdAt}}`, `{{data.…}}` (the event's data), `{{site.id}}`; a whole `"{{data}}"` is the object itself. Values are escaped for JSON. |

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
  /**
   * An https URL. With `format: "custom"`, its path and query may use
   * `{{data.…}}`.
   */
  url: string;
  /**
   * Event types (`GET /webhooks` lists them), or `["*"]` for all (the
   * default).
   */
  events?: string[];
  /** Up to 200 characters. */
  description?: string;
  /** `helppuff` (the signed envelope, the default) or `custom`. */
  format?: string;
  /** Custom: `POST` (the default), `PUT`, `PATCH`, `GET` or `DELETE`. */
  method?: string;
  /**
   * Custom: a list of `{ name, value, secret }`; `${…}` is not expanded here,
   * send the value. An empty secret value keeps the stored one.
   */
  headers?: string;
  /**
   * Custom: the body template. `{{event.id}}`, `{{event.type}}`,
   * `{{event.createdAt}}`, `{{data.…}}` (the event's data), `{{site.id}}`; a
   * whole `"{{data}}"` is the object itself. Values are escaped for JSON.
   */
  body?: string;
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
  "createdAt": 1760000000000,
  "format": "helppuff"
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
  format: string;
};
```
<!-- /tabs -->

## Change a webhook endpoint

`PATCH /webhooks/:id` · scope `webhooks:write`

Any of `url`, `events`, `enabled`, `description`, `format`, `method`, `headers`, `body`; `rotateSecret: true` makes a new signing secret.

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
  "createdAt": 1760000000000,
  "format": "helppuff"
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
  format: string;
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

## The email service

`GET /notifications/email` · scope `webhooks:read`

The request that sends the team's email notifications (null until one is set up), and starting points for well-known services (`presets`, with an empty key). Secret header values never come back.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/notifications/email" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/notifications/email`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as EmailServiceResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "service": {
    "method": "POST",
    "url": "https://api.resend.com/emails",
    "headers": [
      {
        "name": "Content-Type",
        "value": "application/json",
        "secret": false,
        "set": true
      },
      {
        "name": "Authorization",
        "value": "",
        "secret": true,
        "set": true
      }
    ],
    "body": "{\"from\": \"HelpPuff <assistant@acme.example>\", \"to\": [\"{{email.to}}\"], \"subject\": \"{{email.subject}}\", \"text\": \"{{email.text}}\", \"html\": \"{{email.html}}\"}",
    "enabled": true,
    "dashboardUrl": "https://knowtific-helppuff-acme.acme.workers.dev",
    "lastStatus": "ok",
    "lastError": null,
    "lastAt": 1760000000000,
    "updatedBy": "owner@acme.example",
    "updatedAt": 1760000000000
  },
  "presets": [
    {
      "id": "resend",
      "name": "Resend",
      "docs": "https://resend.com/docs/api-reference/emails/send-email",
      "key": {
        "header": "Authorization",
        "prefix": "Bearer ",
        "label": "API key"
      },
      "request": {
        "method": "POST",
        "url": "https://api.resend.com/emails",
        "headers": [
          {
            "name": "Content-Type",
            "value": "application/json",
            "secret": false
          },
          {
            "name": "Authorization",
            "value": "",
            "secret": true
          }
        ],
        "body": "{\"from\": \"HelpPuff <assistant@acme.example>\", \"to\": [\"{{email.to}}\"], \"subject\": \"{{email.subject}}\", \"text\": \"{{email.text}}\", \"html\": \"{{email.html}}\"}"
      }
    }
  ]
}
```
```ts [Type]
type EmailServiceResponse = {
  service: {
    method: string;
    url: string;
    headers: Array<{
      name: string;
      value: string;
      secret: boolean;
      set: boolean;
    }>;
    body: string;
    enabled: boolean;
    dashboardUrl: string;
    lastStatus: string;
    lastError: string | null;
    lastAt: number;
    updatedBy: string;
    updatedAt: number;
  };
  presets: Array<{
    id: string;
    name: string;
    docs: string;
    key: {
      header: string;
      prefix: string;
      label: string;
    };
    request: {
      method: string;
      url: string;
      headers: Array<{
        name: string;
        value: string;
        secret: boolean;
      }>;
      body: string;
    };
  }>;
};
```
<!-- /tabs -->

## Set up the email service

`PUT /notifications/email` · scope `webhooks:write`

One request that sends one email, for any service with a send API: HelpPuff writes each email and fills `{{email.to}}` (one person per request), `{{email.subject}}`, `{{email.text}}` and `{{email.html}}` (the text, escaped). Who gets which email is each person's choice in the dashboard (Settings → Notifications). Links in emails go to the address this was saved from.

| Body field | Required | Description |
| --- | --- | --- |
| `url` | yes | An https URL; its path and query may use `{{email.…}}`. |
| `method` | no | `POST` (the default), `PUT`, `PATCH`, `GET` or `DELETE`. |
| `headers` | no | A list of `{ name, value, secret }`; secret values are stored encrypted. An empty secret value keeps the stored one. |
| `body` | no | The body template. It must use `{{email.to}}` and `{{email.text}}` (or `{{email.html}}`) somewhere in the request. |
| `enabled` | no | false pauses every email. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PUT "$HELPPUFF_URL/api/v1/notifications/email" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "url": "https://api.resend.com/emails",
  "headers": [
    {
      "name": "Content-Type",
      "value": "application/json",
      "secret": false
    },
    {
      "name": "Authorization",
      "value": "Bearer re_123456789",
      "secret": true
    }
  ],
  "body": "{\"from\": \"HelpPuff <assistant@acme.example>\", \"to\": [\"{{email.to}}\"], \"subject\": \"{{email.subject}}\", \"text\": \"{{email.text}}\", \"html\": \"{{email.html}}\"}"
}'
```
```ts [TypeScript]
type SetUpEmailServiceRequest = {
  /** An https URL; its path and query may use `{{email.…}}`. */
  url: string;
  /** `POST` (the default), `PUT`, `PATCH`, `GET` or `DELETE`. */
  method?: string;
  /**
   * A list of `{ name, value, secret }`; secret values are stored encrypted.
   * An empty secret value keeps the stored one.
   */
  headers?: Array<{
    name?: string;
    value?: string;
    secret?: boolean;
  }>;
  /**
   * The body template. It must use `{{email.to}}` and `{{email.text}}` (or
   * `{{email.html}}`) somewhere in the request.
   */
  body?: string;
  /** false pauses every email. */
  enabled?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/notifications/email`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://api.resend.com/emails',
    headers: [
      {
        name: 'Content-Type',
        value: 'application/json',
        secret: false
      },
      {
        name: 'Authorization',
        value: 'Bearer re_123456789',
        secret: true
      }
    ],
    body: '{"from": "HelpPuff <assistant@acme.example>", "to": ["{{email.to}}"], "subject": "{{email.subject}}", "text": "{{email.text}}", "html": "{{email.html}}"}'
  } satisfies SetUpEmailServiceRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SetUpEmailServiceResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "method": "POST",
  "url": "https://api.resend.com/emails",
  "headers": [
    {
      "name": "Content-Type",
      "value": "application/json",
      "secret": false,
      "set": true
    },
    {
      "name": "Authorization",
      "value": "",
      "secret": true,
      "set": true
    }
  ],
  "body": "{\"from\": \"HelpPuff <assistant@acme.example>\", \"to\": [\"{{email.to}}\"], \"subject\": \"{{email.subject}}\", \"text\": \"{{email.text}}\", \"html\": \"{{email.html}}\"}",
  "enabled": true,
  "dashboardUrl": "https://knowtific-helppuff-acme.acme.workers.dev",
  "lastStatus": "ok",
  "lastError": null,
  "lastAt": 1760000000000,
  "updatedBy": "owner@acme.example",
  "updatedAt": 1760000000000
}
```
```ts [Type]
type SetUpEmailServiceResponse = {
  method: string;
  url: string;
  headers: Array<{
    name: string;
    value: string;
    secret: boolean;
    set: boolean;
  }>;
  body: string;
  enabled: boolean;
  dashboardUrl: string;
  lastStatus: string;
  lastError: string | null;
  lastAt: number;
  updatedBy: string;
  updatedAt: number;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | The request has no `{{email.to}}` or no `{{email.text}}`/`{{email.html}}`. |

## Remove the email service

`DELETE /notifications/email` · scope `webhooks:write`

No email is sent until one is set up again; everyone's choices are kept.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/notifications/email" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/notifications/email`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RemoveEmailServiceResponse;
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
type RemoveEmailServiceResponse = {
  deleted: boolean;
};
```
<!-- /tabs -->

## Send a test email

`POST /notifications/email/test` · scope `webhooks:write`

Sends a test email now to `to` (a dashboard user: their own address) and says what the service answered. With `url`, `headers`, `body` or `method`, it tests those unsaved changes instead.

| Body field | Required | Description |
| --- | --- | --- |
| `to` | no | The address to send the test to. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/notifications/email/test" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "to": "owner@acme.example"
}'
```
```ts [TypeScript]
type SendTestEmailRequest = {
  /** The address to send the test to. */
  to?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/notifications/email/test`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to: 'owner@acme.example'
  } satisfies SendTestEmailRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SendTestEmailResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "ok": true,
  "status": 200,
  "error": null,
  "retryable": false,
  "to": "owner@acme.example"
}
```
```ts [Type]
type SendTestEmailResponse = {
  ok: boolean;
  status: number;
  error: string | null;
  retryable: boolean;
  to: string;
};
```
<!-- /tabs -->
