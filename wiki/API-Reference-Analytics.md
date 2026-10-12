<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Analytics API

Totals, usage and the running version. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[Analytics over a period|API-Reference-Analytics#analytics-over-a-period]]: `GET /overview`
- [[AI usage by day|API-Reference-Analytics#ai-usage-by-day]]: `GET /usage`
- [[Running version|API-Reference-Analytics#running-version]]: `GET /version`
- [[Check the widget is on the website|API-Reference-Analytics#check-the-widget-is-on-the-website]]: `GET /install-check`

## Analytics over a period

`GET /overview` · scope `analytics:read`

Conversations, messages, leads and conversion over `days`, against the period before, a day-by-day series, top pages and countries. `headline` (both periods): conversations summarised, resolved by the assistant alone (answered, booked or a lead, no person), handed to a person in live chat (`escalated`), needed a person at all (a live chat or a callback: `needsPerson`), with a question it could not answer (`unanswered`), ratings and callbacks. `insights`: how conversations ended, sentiment, lead quality, engagement (messages, median length, left after one message, returning visitors), the questions it could not answer (most asked first), topics, chats by hour, live chat (asked, answered, missed, median wait, by person), callbacks, jobs and appointments. `health`: what is failing now (webhooks, email, tools, the AI budget, pages it could not learn), each with the dashboard page that fixes it. `recentQuestions` and `recentLeads` are kept for older integrations.

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
const data = (await response.json()) as AnalyticsOverPeriodResponse;
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
  ],
  "headline": {
    "current": {
      "summarized": 112,
      "resolved": 81,
      "escalated": 9,
      "needsPerson": 14,
      "unanswered": 7,
      "ratedUp": 40,
      "ratedDown": 3,
      "callbacks": 6
    },
    "previous": {
      "summarized": 90,
      "resolved": 60,
      "escalated": 11,
      "needsPerson": 15,
      "unanswered": 10,
      "ratedUp": 28,
      "ratedDown": 4,
      "callbacks": 5
    }
  },
  "insights": {
    "outcomes": {
      "answered": 62,
      "booked": 8,
      "lead_captured": 22,
      "callback_requested": 6,
      "unanswered": 7,
      "abandoned": 7,
      "pending": 8
    },
    "sentiment": {
      "positive": 61,
      "neutral": 44,
      "negative": 7
    },
    "leadQuality": {
      "hot": 12,
      "warm": 25,
      "cold": 50,
      "none": 25
    },
    "engagement": {
      "avgMessages": 6.9,
      "medianSeconds": 140,
      "oneMessage": 30,
      "returningVisitors": 14
    },
    "unansweredQuestions": [
      {
        "text": "Do you service Penrith?",
        "count": 3,
        "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10"
      }
    ],
    "topics": [
      {
        "topic": "Pricing",
        "count": 34
      }
    ],
    "hours": [
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      3,
      9,
      12,
      11,
      10,
      9,
      10,
      11,
      9,
      8,
      7,
      6,
      5,
      4,
      3,
      1,
      0
    ],
    "live": {
      "requested": 9,
      "answered": 8,
      "missed": 1,
      "medianWaitSeconds": 65,
      "byPerson": [
        {
          "name": "Sam",
          "count": 6
        }
      ]
    },
    "callbacks": {
      "requested": 6,
      "done": 4,
      "dismissed": 1,
      "open": 1,
      "medianHoursToDone": 2.5
    },
    "jobs": {
      "created": 14,
      "fromChat": 11,
      "won": 5,
      "lost": 2,
      "wonValue": 3200,
      "currency": "AUD"
    },
    "appointments": {
      "booked": 9,
      "fromChat": 7,
      "completed": 6,
      "noShow": 1,
      "cancelled": 1
    }
  },
  "health": [
    {
      "kind": "webhook",
      "title": "A webhook is failing: CRM sync",
      "detail": "HTTP 500",
      "page": "#/settings/webhooks"
    }
  ]
}
```
```ts [Type]
type AnalyticsOverPeriodResponse = {
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
  headline: {
    current: {
      summarized: number;
      resolved: number;
      escalated: number;
      needsPerson: number;
      unanswered: number;
      ratedUp: number;
      ratedDown: number;
      callbacks: number;
    };
    previous: {
      summarized: number;
      resolved: number;
      escalated: number;
      needsPerson: number;
      unanswered: number;
      ratedUp: number;
      ratedDown: number;
      callbacks: number;
    };
  };
  insights: {
    outcomes: {
      answered: number;
      booked: number;
      lead_captured: number;
      callback_requested: number;
      unanswered: number;
      abandoned: number;
      pending: number;
    };
    sentiment: {
      positive: number;
      neutral: number;
      negative: number;
    };
    leadQuality: {
      hot: number;
      warm: number;
      cold: number;
      none: number;
    };
    engagement: {
      avgMessages: number;
      medianSeconds: number | null;
      oneMessage: number;
      returningVisitors: number;
    };
    unansweredQuestions: Array<{
      text: string;
      count: number;
      conversationId: string;
    }>;
    topics: Array<{
      topic: string;
      count: number;
    }>;
    hours: number[];
    live: {
      requested: number;
      answered: number;
      missed: number;
      medianWaitSeconds: number | null;
      byPerson: Array<{
        name: string;
        count: number;
      }>;
    };
    callbacks: {
      requested: number;
      done: number;
      dismissed: number;
      open: number;
      medianHoursToDone: number | null;
    };
    jobs: {
      created: number;
      fromChat: number;
      won: number;
      lost: number;
      wonValue: number;
      currency: string | null;
    };
    appointments: {
      booked: number;
      fromChat: number;
      completed: number;
      noShow: number;
      cancelled: number;
    };
  };
  health: Array<{
    kind: string;
    title: string;
    detail: string;
    page: string;
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
