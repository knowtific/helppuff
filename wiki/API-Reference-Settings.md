<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Settings API

The assistant, widget, lead form, limits and IP lists, as one object. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[The settings|API-Reference-Settings#the-settings]]: `GET /settings`
- [[Change settings|API-Reference-Settings#change-settings]]: `PUT /settings`

## The settings

`GET /settings` · scope `settings:read`

The assistant, widget, lead form, crawl and security settings as one object, with a hash of it.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/settings" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/settings`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SettingsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "connector": "workers-ai",
  "settings": {
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
    }
  },
  "hash": "5c1e…",
  "meta": null,
  "captcha": false
}
```
```ts [Type]
type SettingsResponse = {
  site: string;
  connector: string;
  settings: {
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
  };
  hash: string;
  meta: string | null;
  captcha: boolean;
};
```
<!-- /tabs -->

## Change settings

`PUT /settings` · scope `settings:write`

A partial update: send only the sections to change (nested objects merge one level deep). Live within a minute. Run `helppuff config pull` afterwards if you keep helppuff.json in git.

| Body field | Required | Description |
| --- | --- | --- |
| `settings` | yes | Any sections of the object `GET /settings` returns: `botName`, `welcomeMessage`, `leads`, `assistant`, `behaviour`, `crawl`, `security` … |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PUT "$HELPPUFF_URL/api/v1/settings" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "settings": {
    "welcomeMessage": "Hi! Ask me anything about our plumbing services.",
    "security": {
      "limits": {
        "messagesPerSitePerDay": 800
      }
    }
  }
}'
```
```ts [TypeScript]
type ChangeSettingsRequest = {
  /**
   * Any sections of the object `GET /settings` returns: `botName`,
   * `welcomeMessage`, `leads`, `assistant`, `behaviour`, `crawl`, `security` …
   */
  settings: {
    welcomeMessage?: string;
    security?: {
      limits?: Record<string, number>;
    };
  };
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/settings`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    settings: {
      welcomeMessage: 'Hi! Ask me anything about our plumbing services.',
      security: {
        limits: {
          messagesPerSitePerDay: 800
        }
      }
    }
  } satisfies ChangeSettingsRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ChangeSettingsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "connector": "workers-ai",
  "settings": {
    "live": {
      "enabled": true,
      "waitSeconds": 120,
      "closeAfterMinutes": 60,
      "showAgentName": true,
      "aiWhileWaiting": false
    },
    "botName": "Sam",
    "businessName": "Acme Plumbing",
    "welcomeMessage": "Hi! Ask me anything about our plumbing services.",
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
    }
  },
  "hash": "7d2a…",
  "meta": {
    "at": 1760000000000,
    "by": "key:k7m3p9q2r4s8",
    "hash": "7d2a…"
  },
  "captcha": false
}
```
```ts [Type]
type ChangeSettingsResponse = {
  site: string;
  connector: string;
  settings: {
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
  };
  hash: string;
  meta: {
    at: number;
    by: string;
    hash: string;
  };
  captcha: boolean;
};
```
<!-- /tabs -->
