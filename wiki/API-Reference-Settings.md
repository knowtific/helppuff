<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Settings API

The assistant, widget, lead form, limits and IP lists, as one object. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[Test the model or the knowledge base|API-Reference-Settings#test-the-model-or-the-knowledge-base]]: `POST /assistant/test`
- [[Suggest the home screen|API-Reference-Settings#suggest-the-home-screen]]: `POST /home/suggest`
- [[The settings|API-Reference-Settings#the-settings]]: `GET /settings`
- [[Change settings|API-Reference-Settings#change-settings]]: `PUT /settings`

## Test the model or the knowledge base

`POST /assistant/test` · scope `settings:write`

One question through the deployed assistant's own model (`part: "model"`) or knowledge base (`part: "knowledge"`), as configured: keys, gateway and custom modules included. Nothing is recorded. A failure answers `ok: false` with what to fix (a missing secret, a refused key). What `helppuff model test` and `helppuff rag test` call. The model and knowledge base are changed only with the CLI, then a deploy.

| Body field | Required | Description |
| --- | --- | --- |
| `part` | no | `model` (default) or `knowledge`. |
| `question` | no | What to ask or search for. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/assistant/test" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "part": "model",
  "question": "Do you do emergency callouts?"
}'
```
```ts [TypeScript]
type TestModelKnowledgeBaseRequest = {
  /** `model` (default) or `knowledge`. */
  part?: string;
  /** What to ask or search for. */
  question?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/assistant/test`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    part: 'model',
    question: 'Do you do emergency callouts?'
  } satisfies TestModelKnowledgeBaseRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as TestModelKnowledgeBaseResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "provider": "openai-compatible",
  "knowledge": "helppuff",
  "part": "model",
  "ok": true,
  "model": "deepseek-ai/DeepSeek-V3.1",
  "reply": "Yes, we answer emergency callouts 24/7.",
  "usage": {
    "input": 42,
    "output": 11
  },
  "ms": 812
}
```
```ts [Type]
type TestModelKnowledgeBaseResponse = {
  provider: string;
  knowledge: string;
  part: string;
  ok: boolean;
  model: string;
  reply: string;
  usage: {
    input: number;
    output: number;
  } | null;
  ms: number;
};
```
<!-- /tabs -->

## Suggest the home screen

`POST /home/suggest` · scope `settings:write`

From what the site taught the assistant: four questions visitors ask, up to five useful pages as links (chosen and worded by the AI, only URLs the site has), and call and email buttons from the business details. Nothing is saved: send what you keep to `PUT /settings` as `home`.

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/home/suggest" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```
```ts [TypeScript]
type SuggestHomeScreenRequest = Record<string, never>;

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/home/suggest`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({} satisfies SuggestHomeScreenRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SuggestHomeScreenResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "questions": [
    "How much is a blocked drain?",
    "Do you do emergency callouts?"
  ],
  "links": {
    "title": "Useful pages",
    "items": [
      {
        "label": "Prices",
        "url": "https://acme.example/prices",
        "description": "Callouts, drains and hot water"
      },
      {
        "label": "Book a plumber",
        "url": "https://acme.example/book"
      }
    ]
  },
  "contact": [
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
  "source": "model"
}
```
```ts [Type]
type SuggestHomeScreenResponse = {
  questions: string[];
  links: {
    title: string;
    items: Array<{
      label: string;
      url: string;
      description: string;
    }>;
  } | null;
  contact: Record<string, string>[];
  source: string;
};
```
<!-- /tabs -->

## The settings

`GET /settings` · scope `settings:read`

The assistant, widget, home screen, lead form, crawl and security settings as one object, with a hash of it. Also: `ai`, who writes the answers and what they come from (changed only with the CLI, `helppuff model` and `helppuff rag`, then a deploy); `suggestedHome`, what the widget shows on its home screen until it is set up (questions and links suggested from the website; null once the home screen was saved), and the `forms` and `flows` a shortcut can open.

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
    }
  },
  "hash": "5c1e…",
  "meta": null,
  "captcha": false,
  "suggestedHome": {
    "questions": [
      "How much is a blocked drain?"
    ],
    "links": {
      "title": "Useful pages",
      "items": [
        {
          "label": "Prices",
          "url": "https://acme.example/prices",
          "description": "Callouts, drains and hot water"
        },
        {
          "label": "Book a plumber",
          "url": "https://acme.example/book"
        }
      ]
    },
    "at": 1760000000000
  },
  "ai": {
    "provider": "workers-ai",
    "model": "@cf/zai-org/glm-4.7-flash",
    "knowledge": "helppuff"
  },
  "forms": [
    {
      "id": "booking",
      "title": "Book a visit"
    }
  ],
  "flows": [
    {
      "id": "quote",
      "title": "Which service do you need?"
    }
  ]
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
  };
  hash: string;
  meta: string | null;
  captcha: boolean;
  suggestedHome: {
    questions: string[];
    links: {
      title: string;
      items: Array<{
        label: string;
        url: string;
        description: string;
      }>;
    };
    at: number;
  } | null;
  ai: {
    provider: string;
    model: string;
    knowledge: string;
  } | null;
  forms: Array<{
    id: string;
    title: string;
  }>;
  flows: Array<{
    id: string;
    title: string;
  }>;
};
```
<!-- /tabs -->

## Change settings

`PUT /settings` · scope `settings:write`

A partial update: send only the sections to change (nested objects merge one level deep). Live within a minute. Run `helppuff config pull` afterwards if you keep helppuff.json in git.

| Body field | Required | Description |
| --- | --- | --- |
| `settings` | yes | Any sections of the object `GET /settings` returns: `botName`, `welcomeMessage`, `leads`, `assistant`, `behaviour`, `crawl`, `security`, `home` … `home.shortcuts` is the whole list of home-screen buttons (up to 8; each `action.kind` is `reply`, `url`, `tel`, `email`, `form` or `flow`); `home.links` the list of pages, or null for none. Saving `home` retires the suggestions from the website. |

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
   * `welcomeMessage`, `leads`, `assistant`, `behaviour`, `crawl`, `security`,
   * `home` … `home.shortcuts` is the whole list of home-screen buttons (up to
   * 8; each `action.kind` is `reply`, `url`, `tel`, `email`, `form` or
   * `flow`); `home.links` the list of pages, or null for none. Saving `home`
   * retires the suggestions from the website.
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
