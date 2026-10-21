<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Settings API

The assistant, widget, lead form, limits and IP lists, as one object. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[Test the model or the knowledge base|API-Reference-Settings#test-the-model-or-the-knowledge-base]]: `POST /assistant/test`
- [[Suggest the home screen|API-Reference-Settings#suggest-the-home-screen]]: `POST /home/suggest`
- [[The settings|API-Reference-Settings#the-settings]]: `GET /settings`
- [[Change settings|API-Reference-Settings#change-settings]]: `PUT /settings`
- [[List custom fields|API-Reference-Settings#list-custom-fields]]: `GET /attribute-definitions`
- [[Add a custom field|API-Reference-Settings#add-a-custom-field]]: `POST /attribute-definitions`
- [[Rename a custom field|API-Reference-Settings#rename-a-custom-field]]: `PATCH /attribute-definitions`
- [[Remove a custom field|API-Reference-Settings#remove-a-custom-field]]: `DELETE /attribute-definitions`

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
      description?: string;
    }>;
  } | null;
  contact: Record<string, string>[];
  source: string;
};
```
<!-- /tabs -->

## The settings

`GET /settings` · scope `settings:read`

The assistant, widget, home screen, lead form, automatic summaries (`autoSummary`), crawl and security settings as one object, with a hash of it. Also: `ai`, who writes the answers and what they come from (changed only with the CLI, `helppuff model` and `helppuff rag`, then a deploy); `suggestedHome`, what the widget shows on its home screen until it is set up (questions and links suggested from the website; null once the home screen was saved), the `forms` and `flows` a shortcut can open; and `storage`, whether the deployment has its R2 bucket for files (`files`: photos in the chat, files on jobs; both off until turned on).

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
  "hash": "5c1e…",
  "meta": null,
  "captcha": false,
  "storage": true,
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
  meta: string | null;
  captcha: boolean;
  storage: boolean;
  suggestedHome: {
    questions: string[];
    links: {
      title: string;
      items: Array<{
        label: string;
        url: string;
        description?: string;
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
| `settings` | yes | Any sections of the object `GET /settings` returns: `botName`, `welcomeMessage`, `leads`, `assistant`, `behaviour`, `autoSummary` (false stops automatic summaries and AI labels for new chats), `crawl`, `security`, `home` … `home.shortcuts` is the whole list of home-screen buttons (up to 8; each `action.kind` is `reply`, `url`, `tel`, `email`, `form` or `flow`); `home.links` the list of pages, or null for none. Saving `home` retires the suggestions from the website. `bookings` is how visitors book: `mode` `none`, `link` or `picker` (null: the website's booking link decides), the picker's calendar (`sync`), hours, duration and the rest (`helppuff.json` → `bookings` in the Configuration reference). |

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
   * `welcomeMessage`, `leads`, `assistant`, `behaviour`, `autoSummary` (false
   * stops automatic summaries and AI labels for new chats), `crawl`,
   * `security`, `home` … `home.shortcuts` is the whole list of home-screen
   * buttons (up to 8; each `action.kind` is `reply`, `url`, `tel`, `email`,
   * `form` or `flow`); `home.links` the list of pages, or null for none.
   * Saving `home` retires the suggestions from the website. `bookings` is how
   * visitors book: `mode` `none`, `link` or `picker` (null: the website's
   * booking link decides), the picker's calendar (`sync`), hours, duration and
   * the rest (`helppuff.json` → `bookings` in the Configuration reference).
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
  "hash": "7d2a…",
  "meta": {
    "at": 1760000000000,
    "by": "key:k7m3p9q2r4s8",
    "hash": "7d2a…"
  },
  "captcha": false,
  "storage": true
}
```
```ts [Type]
type ChangeSettingsResponse = {
  site: string;
  connector: string;
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
  meta: {
    at: number;
    by: string;
    hash: string;
  };
  captcha: boolean;
  storage: boolean;
};
```
<!-- /tabs -->

## List custom fields

`GET /attribute-definitions` · scope `settings:read`

The custom attribute keys on conversations and contacts (Settings → Custom fields): the ones defined there (`defined`) and the ones already in use, with how many records carry each (`used`).

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/attribute-definitions" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/attribute-definitions`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListCustomFieldsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "conversations": [
    {
      "name": "order_number",
      "used": 12,
      "defined": true
    }
  ],
  "contacts": [
    {
      "name": "plan",
      "used": 3,
      "defined": false
    }
  ]
}
```
```ts [Type]
type ListCustomFieldsResponse = {
  conversations: Array<{
    name: string;
    used: number;
    defined: boolean;
  }>;
  contacts: Record<string, string>[];
};
```
<!-- /tabs -->

## Add a custom field

`POST /attribute-definitions` · scope `settings:write`

| Body field | Required | Description |
| --- | --- | --- |
| `scope` | yes | `conversation` or `contact`. |
| `name` | yes | 1 to 64 letters, digits, spaces, `_`, `-` or `.`. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/attribute-definitions" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "scope": "contact",
  "name": "plan"
}'
```
```ts [TypeScript]
type AddCustomFieldRequest = {
  /** `conversation` or `contact`. */
  scope: string;
  /** 1 to 64 letters, digits, spaces, `_`, `-` or `.`. */
  name: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/attribute-definitions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    scope: 'contact',
    name: 'plan'
  } satisfies AddCustomFieldRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AddCustomFieldResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "name": "plan",
  "scope": "contact",
  "defined": true
}
```
```ts [Type]
type AddCustomFieldResponse = {
  name: string;
  scope: string;
  defined: boolean;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 409 | `conflict` | A field with this name exists. |

## Rename a custom field

`PATCH /attribute-definitions` · scope `settings:write`

Renames the key on every conversation or contact that has it.

| Body field | Required | Description |
| --- | --- | --- |
| `scope` | yes | `conversation` or `contact`. |
| `oldName` | yes | The current name. |
| `name` | yes | The new name. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/attribute-definitions" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "scope": "contact",
  "oldName": "plan",
  "name": "tier"
}'
```
```ts [TypeScript]
type RenameCustomFieldRequest = {
  /** `conversation` or `contact`. */
  scope: string;
  /** The current name. */
  oldName: string;
  /** The new name. */
  name: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/attribute-definitions`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    scope: 'contact',
    oldName: 'plan',
    name: 'tier'
  } satisfies RenameCustomFieldRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RenameCustomFieldResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "name": "tier",
  "scope": "contact"
}
```
```ts [Type]
type RenameCustomFieldResponse = {
  name: string;
  scope: string;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 409 | `conflict` | A field with the new name exists. |

## Remove a custom field

`DELETE /attribute-definitions` · scope `settings:write`

Removes the key, and its value, from every conversation or contact that has it.

| Body field | Required | Description |
| --- | --- | --- |
| `scope` | yes | `conversation` or `contact`. |
| `name` | yes | The field to remove. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/attribute-definitions" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "scope": "contact",
  "name": "tier"
}'
```
```ts [TypeScript]
type RemoveCustomFieldRequest = {
  /** `conversation` or `contact`. */
  scope: string;
  /** The field to remove. */
  name: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/attribute-definitions`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    scope: 'contact',
    name: 'tier'
  } satisfies RemoveCustomFieldRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RemoveCustomFieldResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "name": "tier",
  "scope": "contact",
  "deleted": true
}
```
```ts [Type]
type RemoveCustomFieldResponse = {
  name: string;
  scope: string;
  deleted: boolean;
};
```
<!-- /tabs -->
