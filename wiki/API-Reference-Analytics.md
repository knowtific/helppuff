<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Analytics API

Totals, usage and the running version. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[Totals over a period|API-Reference-Analytics#totals-over-a-period]]: `GET /overview`
- [[AI usage by day|API-Reference-Analytics#ai-usage-by-day]]: `GET /usage`
- [[Running version|API-Reference-Analytics#running-version]]: `GET /version`
- [[Check the widget is on the website|API-Reference-Analytics#check-the-widget-is-on-the-website]]: `GET /install-check`

## Totals over a period

`GET /overview` · scope `analytics:read`

Conversations, messages, leads and conversion over `days`, against the period before, a day-by-day series, top pages, countries, recent questions and leads.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `days` | query | no | 1–365, default 30. |
| `tz` | query | no | Minutes to add to UTC for day boundaries (e.g. 600 for Sydney). |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/overview" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/overview`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as TotalsOverPeriodResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "range": {
    "days": 30,
    "since": 1757408000000
  },
  "openCallbacks": 1,
  "totals": {
    "conversations": 120,
    "messages": 830,
    "leads": 31,
    "conversion": 0.26,
    "avgMessages": 6.9
  },
  "previous": {
    "conversations": 98,
    "messages": 640,
    "leads": 22,
    "conversion": 0.22,
    "avgMessages": 6.5
  },
  "series": [
    {
      "date": "2025-10-09",
      "conversations": 5,
      "leads": 1
    }
  ],
  "topPages": [
    {
      "url": "https://acme.example/pricing",
      "count": 40
    }
  ],
  "countries": [
    {
      "country": "AU",
      "count": 110
    }
  ],
  "recentQuestions": [
    {
      "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
      "text": "How much is a blocked drain?",
      "at": 1760000000000
    }
  ],
  "recentLeads": [
    {
      "id": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "phone": "0400 111 222",
      "status": "new",
      "at": 1760000000000,
      "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10"
    }
  ]
}
```
```ts [Type]
type TotalsOverPeriodResponse = {
  range: {
    days: number;
    since: number;
  };
  openCallbacks: number;
  totals: {
    conversations: number;
    messages: number;
    leads: number;
    conversion: number;
    avgMessages: number;
  };
  previous: {
    conversations: number;
    messages: number;
    leads: number;
    conversion: number;
    avgMessages: number;
  };
  series: Array<{
    date: string;
    conversations: number;
    leads: number;
  }>;
  topPages: Array<{
    url: string;
    count: number;
  }>;
  countries: Array<{
    country: string;
    count: number;
  }>;
  recentQuestions: Array<{
    id: string;
    text: string;
    at: number;
  }>;
  recentLeads: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    status: string;
    at: number;
    conversationId: string;
  }>;
};
```
<!-- /tabs -->

## AI usage by day

`GET /usage` · scope `analytics:read`

Today's use of the daily budget (Workers AI neurons) and messages, and the last days.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/usage" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/usage`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AIUsageDayResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "today": {
    "day": "2025-10-09",
    "neurons": 1240.5,
    "messages": 64,
    "budget": 9000,
    "freeAllocation": 10000,
    "messagesLeft": 400,
    "state": "ok"
  },
  "days": [
    {
      "day": "2025-10-08",
      "neurons": 3100,
      "messages": 150
    }
  ]
}
```
```ts [Type]
type AIUsageDayResponse = {
  site: string;
  today: {
    day: string;
    neurons: number;
    messages: number;
    budget: number;
    freeAllocation: number;
    messagesLeft: number;
    state: string;
  };
  days: Array<{
    day: string;
    neurons: number;
    messages: number;
  }>;
};
```
<!-- /tabs -->

## Running version

`GET /version` · scope `analytics:read`

The release running, the latest one, and the database schema.

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/version" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/version`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RunningVersionResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "current": "0.2.0",
  "latest": "0.3.0",
  "upgradeAvailable": true,
  "schema": {
    "applied": 9,
    "expected": 9
  },
  "command": "npx @knowtific/helppuff@latest upgrade",
  "releaseNotes": "https://github.com/knowtific/helppuff/releases"
}
```
```ts [Type]
type RunningVersionResponse = {
  current: string;
  latest: string;
  upgradeAvailable: boolean;
  schema: {
    applied: number;
    expected: number;
  };
  command: string;
  releaseNotes: string;
};
```
<!-- /tabs -->

## Check the widget is on the website

`GET /install-check` · scope `settings:read`

Fetches the website and looks for the embed snippet.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `url` | query | no | A page to check (defaults to the website). |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/install-check" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/install-check`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as CheckWidgetWebsiteResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "url": "https://acme.example/",
  "reachable": true,
  "installed": true,
  "reason": null
}
```
```ts [Type]
type CheckWidgetWebsiteResponse = {
  url: string;
  reachable: boolean;
  installed: boolean;
  reason: string | null;
};
```
<!-- /tabs -->
