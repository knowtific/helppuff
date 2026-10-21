<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Customer emails API

Emails to your customers (Settings → Customer emails): what each switch still needs, the emails sent, copies by hand, unsubscribes, and the reply address customers answer to. The switches are settings (`customerEmails`). Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[What each switch needs|API-Reference-Customer-Emails#what-each-switch-needs]]: `GET /customer-emails/status`
- [[Emails sent to customers|API-Reference-Customer-Emails#emails-sent-to-customers]]: `GET /customer-emails/log`
- [[Preview an email|API-Reference-Customer-Emails#preview-an-email]]: `GET /customer-emails/preview`
- [[Email a copy to the customer|API-Reference-Customer-Emails#email-a-copy-to-the-customer]]: `POST /conversations/:id/email-copy`
- [[Add the reply-to field|API-Reference-Customer-Emails#add-the-reply-to-field]]: `POST /customer-emails/reply-to`
- [[Set the reply address|API-Reference-Customer-Emails#set-the-reply-address]]: `PUT /customer-emails/inbound`
- [[Test the reply address|API-Reference-Customer-Emails#test-the-reply-address]]: `POST /customer-emails/test`
- [[Stop or allow emails to a contact|API-Reference-Customer-Emails#stop-or-allow-emails-to-a-contact]]: `POST /leads/:id/emails`

## What each switch needs

`GET /customer-emails/status` · scope `settings:read`

The switches (`settings`), the email service (whether its request sends `{{email.replyTo}}`, and whether the dashboard can add it), live chat, and the reply address with when a test last arrived (`verifiedAt`). `ready` says which switches can work now: a copy needs a working service; the team's replies also live chat; answers by email also the reply address, a test that arrived and a request that sends `{{email.replyTo}}`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/customer-emails/status" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/customer-emails/status`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as WhatEachSwitchNeedsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "origin": "https://acme.example",
  "settings": {
    "copy": {
      "enabled": false
    },
    "replies": {
      "enabled": true
    },
    "inbound": {
      "enabled": true,
      "domain": "chat.acme.example",
      "ruleId": "8f3a2c1b9d0e4f5a6b7c8d9e0f1a2b3c"
    }
  },
  "delaySeconds": 120,
  "service": {
    "kind": "request",
    "name": "Resend",
    "from": null,
    "enabled": true,
    "sendsReplyTo": true,
    "canAddReplyTo": false,
    "lastStatus": "ok",
    "lastError": null
  },
  "live": true,
  "inbound": {
    "domain": "chat.acme.example",
    "ruleId": "8f3a2c1b9d0e4f5a6b7c8d9e0f1a2b3c",
    "verifiedAt": 1760000000000,
    "address": "reply@chat.acme.example"
  },
  "ready": {
    "copy": true,
    "replies": true,
    "inbound": true
  }
}
```
```ts [Type]
type WhatEachSwitchNeedsResponse = {
  site: string;
  origin: string | null;
  settings: {
    copy: {
      enabled: boolean;
    };
    replies: {
      enabled: boolean;
    };
    inbound: {
      enabled: boolean;
      domain: string | null;
      ruleId: string | null;
    };
  };
  delaySeconds: number;
  service: {
    kind: string;
    name: string | null;
    from: string | null;
    enabled: boolean;
    sendsReplyTo: boolean;
    canAddReplyTo: boolean;
    lastStatus: string | null;
    lastError: string | null;
  };
  live: boolean;
  inbound: {
    domain: string | null;
    ruleId: string | null;
    verifiedAt: number | null;
    address: string | null;
  };
  ready: {
    copy: boolean;
    replies: boolean;
    inbound: boolean;
  };
};
```
<!-- /tabs -->

## Emails sent to customers

`GET /customer-emails/log` · scope `settings:read`

Newest first: `copy`, `reply` and `test` sent; `inbound` (an answer by email) and `inbound-test` received. `status` is `ok`, `failed` (with `error`) or, for an answer from an address that is not the contact's, `other_sender`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |
| `limit` | query | no | How many (1–100, default 20). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/customer-emails/log" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/customer-emails/log`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as EmailsSentToCustomersResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "emails": [
    {
      "id": "ce_3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c",
      "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
      "kind": "reply",
      "to": "ada@example.com",
      "status": "ok",
      "error": null,
      "at": 1760000000000
    }
  ]
}
```
```ts [Type]
type EmailsSentToCustomersResponse = {
  emails: Array<{
    id: string;
    conversationId: string | null;
    kind: string;
    to: string | null;
    status: string;
    error: string | null;
    at: number;
  }>;
};
```
<!-- /tabs -->

## Preview an email

`GET /customer-emails/preview` · scope `settings:read`

What a customer gets, written from the site's names with a sample conversation: `kind` `copy` (the default) or `reply`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |
| `kind` | query | no | `copy` or `reply`. |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/customer-emails/preview" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/customer-emails/preview`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as PreviewEmailResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "subject": "Sam from Acme Plumbing replied",
  "text": "You asked: Can someone come out tomorrow morning?\nSam: Yes, I can be there at 10am. Does that work?",
  "html": "<div>…</div>"
}
```
```ts [Type]
type PreviewEmailResponse = {
  subject: string;
  text: string;
  html: string;
};
```
<!-- /tabs -->

## Email a copy to the customer

`POST /conversations/:id/email-copy` · scope `conversations:write`

Sends the customer a copy of this conversation now, whether or not copies are on. Still refused when they have no email, unsubscribed, or today's limits are used up.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/conversations/ID/email-copy" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}/email-copy`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as EmailCopyToCustomerResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "status": "sent",
  "to": "ada@example.com"
}
```
```ts [Type]
type EmailCopyToCustomerResponse = {
  status: string;
  to: string;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | No email service, no address, unsubscribed, a limit, or the service refused it (`message` says which). |

## Add the reply-to field

`POST /customer-emails/reply-to` · scope `settings:write`

Adds where replies go (`{{email.replyTo}}`) and the extra headers (`{{email.headers}}`) to the email service's request, in its service's own field names. Only for a request made from a preset (Resend, Postmark, SendGrid, Brevo); a field already there is kept.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/customer-emails/reply-to" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/customer-emails/reply-to`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AddReplyToFieldResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "body": "{\n  \"reply_to\": \"{{email.replyTo}}\",\n  \"headers\": \"{{email.headers}}\",\n  \"from\": \"Acme <hello@acme.example>\"\n}"
}
```
```ts [Type]
type AddReplyToFieldResponse = {
  body: string;
};
```
<!-- /tabs -->

## Set the reply address

`PUT /customer-emails/inbound` · scope `settings:write`

The subdomain customers' answers are received at, and the Email Routing rule that hands them to the Worker. `helppuff email replies on` sets it after making the rule; `domain: null` removes it (and turns answers by email off). A new address turns answers by email off until a test arrives.

| Body field | Required | Description |
| --- | --- | --- |
| `domain` | yes | e.g. `chat.acme.example`, or null. |
| `ruleId` | no | The Email Routing rule's id. |
| `enabled` | no | Turn answers by email on or off (on needs a test that arrived). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PUT "$HELPPUFF_URL/api/v1/customer-emails/inbound" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "domain": "chat.acme.example",
  "ruleId": "8f3a2c1b9d0e4f5a6b7c8d9e0f1a2b3c"
}'
```
```ts [TypeScript]
type SetReplyAddressRequest = {
  /** e.g. `chat.acme.example`, or null. */
  domain: string;
  /** The Email Routing rule's id. */
  ruleId?: string;
  /** Turn answers by email on or off (on needs a test that arrived). */
  enabled?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/customer-emails/inbound`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    domain: 'chat.acme.example',
    ruleId: '8f3a2c1b9d0e4f5a6b7c8d9e0f1a2b3c'
  } satisfies SetReplyAddressRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SetReplyAddressResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "customerEmails": {
    "copy": {
      "enabled": false
    },
    "replies": {
      "enabled": true
    },
    "inbound": {
      "enabled": true,
      "domain": "chat.acme.example",
      "ruleId": "8f3a2c1b9d0e4f5a6b7c8d9e0f1a2b3c"
    }
  },
  "settings": {
    "autoSummary": true,
    "live": {
      "enabled": true,
      "waitSeconds": 120,
      "closeAfterMinutes": 60,
      "showAgentName": true,
      "aiWhileWaiting": false
    },
    "botName": "Sam",
    "businessName": "Acme Plumbing",
    "welcomeMessage": "Hi, I'm Sam. How can I help?",
    "starterQuestions": [
      "How much is a blocked drain?"
    ],
    "accent": "#5B5BF7",
    "position": "bottom-right",
    "launcherIcon": "chat",
    "leads": {
      "enabled": true,
      "fields": [
        {
          "name": "name",
          "label": "Name",
          "type": "text",
          "required": true
        }
      ]
    },
    "assistant": {
      "model": "@cf/zai-org/glm-4.7-flash",
      "locale": "en-AU",
      "timezone": "Australia/Sydney",
      "rerank": true,
      "reasoning": "medium"
    },
    "behaviour": {
      "goal": "callbacks",
      "tone": "friendly",
      "length": "short",
      "prices": "share"
    },
    "crawl": {
      "schedule": "weekly",
      "include": [],
      "exclude": [],
      "renderJs": "auto"
    },
    "security": {
      "limits": {
        "messagesPerSitePerDay": 500,
        "messagesPerIpPerMinute": 10
      },
      "signIn": {
        "attemptsPerIp": 10,
        "attemptsPerAccount": 5,
        "windowMinutes": 15,
        "captcha": true
      },
      "allowIps": [],
      "blockIps": [],
      "sessionTtlHours": 24
    },
    "home": {
      "title": "Hi there",
      "subtitle": "Ask anything, or pick a shortcut.",
      "shortcuts": [
        {
          "id": "ask-1",
          "label": "How much is a blocked drain?",
          "icon": "chat",
          "action": {
            "id": "ask-1",
            "kind": "reply",
            "label": "How much is a blocked drain?",
            "value": "How much is a blocked drain?"
          }
        },
        {
          "id": "call",
          "label": "Call us",
          "description": "02 9000 0000",
          "icon": "phone",
          "action": {
            "id": "call",
            "kind": "tel",
            "label": "Call us",
            "phone": "02 9000 0000"
          }
        }
      ],
      "links": {
        "title": "Useful pages",
        "items": [
          {
            "label": "Prices",
            "url": "https://acme.example/prices",
            "description": "Callouts, drains and hot water"
          }
        ]
      }
    },
    "bookings": {
      "mode": "picker",
      "label": "Book a time",
      "sync": "none",
      "title": "Consultation",
      "duration": 30,
      "hours": {
        "mon": [
          "09:00-17:00"
        ],
        "tue": [
          "09:00-17:00"
        ],
        "wed": [
          "09:00-17:00"
        ],
        "thu": [
          "09:00-17:00"
        ],
        "fri": [
          "09:00-12:00"
        ],
        "sat": [],
        "sun": []
      },
      "buffer": 15,
      "notice": 120,
      "daysAhead": 30,
      "timezone": "Australia/Sydney",
      "phone": "optional",
      "location": "Our office, 12 Smith St",
      "syncMinutes": 15
    },
    "files": {
      "chat": "live",
      "jobs": true,
      "maxChatMb": 10,
      "maxJobMb": 25,
      "perConversation": 10,
      "keepChatDays": 90,
      "aiSeesPhotos": false,
      "visionModel": "@cf/meta/llama-4-scout-17b-16e-instruct"
    },
    "customerEmails": {
      "copy": {
        "enabled": false
      },
      "replies": {
        "enabled": true
      },
      "inbound": {
        "enabled": true,
        "domain": "chat.acme.example",
        "ruleId": "8f3a2c1b9d0e4f5a6b7c8d9e0f1a2b3c"
      }
    }
  },
  "hash": "7d2a…"
}
```
```ts [Type]
type SetReplyAddressResponse = {
  site: string;
  customerEmails: {
    copy: {
      enabled: boolean;
    };
    replies: {
      enabled: boolean;
    };
    inbound: {
      enabled: boolean;
      domain: string;
      ruleId: string;
    };
  };
  settings: {
    autoSummary: boolean;
    live: {
      enabled: boolean;
      waitSeconds: number;
      closeAfterMinutes: number;
      showAgentName: boolean;
      aiWhileWaiting: boolean;
    };
    botName: string;
    businessName: string;
    welcomeMessage: string;
    starterQuestions: string[];
    accent: string;
    position: string;
    launcherIcon: string;
    leads: {
      enabled: boolean;
      fields: Array<{
        name: string;
        label: string;
        type: string;
        required: boolean;
      }>;
    };
    assistant: {
      model: string;
      locale: string;
      timezone: string;
      rerank: boolean;
      reasoning: string;
    };
    behaviour: {
      goal: string;
      tone: string;
      length: string;
      prices: string;
    };
    crawl: {
      schedule: string;
      include: string[];
      exclude: string[];
      renderJs: string;
    };
    security: {
      limits: Record<string, number>;
      signIn: {
        attemptsPerIp: number;
        attemptsPerAccount: number;
        windowMinutes: number;
        captcha: boolean;
      };
      allowIps: string[];
      blockIps: string[];
      sessionTtlHours: number;
    };
    home: {
      title: string;
      subtitle: string;
      shortcuts: Array<{
        id: string;
        label: string;
        icon: string;
        action: {
          id: string;
          kind: string;
          label: string;
          value: string;
        };
        description?: string;
      }>;
      links: {
        title: string;
        items: Array<{
          label: string;
          url: string;
          description: string;
        }>;
      };
    };
    bookings: {
      mode: string;
      label: string;
      sync: string;
      title: string;
      duration: number;
      hours: {
        mon: string[];
        tue: string[];
        wed: string[];
        thu: string[];
        fri: string[];
        sat: string[];
        sun: string[];
      };
      buffer: number;
      notice: number;
      daysAhead: number;
      timezone: string;
      phone: string;
      location: string;
      syncMinutes: number;
    };
    files: {
      chat: string;
      jobs: boolean;
      maxChatMb: number;
      maxJobMb: number;
      perConversation: number;
      keepChatDays: number;
      aiSeesPhotos: boolean;
      visionModel: string;
    };
    customerEmails: {
      copy: {
        enabled: boolean;
      };
      replies: {
        enabled: boolean;
      };
      inbound: {
        enabled: boolean;
        domain: string;
        ruleId: string;
      };
    };
  };
  hash: string;
};
```
<!-- /tabs -->

## Test the reply address

`POST /customer-emails/test` · scope `settings:write`

Sends a test email to the reply address through the email service. When it arrives, `GET /customer-emails/status` shows `inbound.verifiedAt`; then answers by email can be turned on.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/customer-emails/test" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/customer-emails/test`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as TestReplyAddressResponse;
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
  "to": "reply+test.k3f9a2qm4x@chat.acme.example"
}
```
```ts [Type]
type TestReplyAddressResponse = {
  ok: boolean;
  status: number;
  error: string | null;
  retryable: boolean;
  to: string;
};
```
<!-- /tabs -->

## Stop or allow emails to a contact

`POST /leads/:id/emails` · scope `leads:write`

`allowed: false` stops copies and replies by email to this contact (as their unsubscribe link does); `allowed: true` allows them again.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `allowed` | yes | true or false. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/leads/ID/emails" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "allowed": true
}'
```
```ts [TypeScript]
type StopAllowEmailsToContactRequest = {
  /** true or false. */
  allowed: boolean;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/leads/${id}/emails`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    allowed: true
  } satisfies StopAllowEmailsToContactRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as StopAllowEmailsToContactResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
  "emailOff": false
}
```
```ts [Type]
type StopAllowEmailsToContactResponse = {
  id: string;
  emailOff: boolean;
};
```
<!-- /tabs -->
