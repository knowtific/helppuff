<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Prompt API

The business-specific instructions, versioned, and the agent file: the prompt, tools and behaviour settings as one file to export and import. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[The prompt and its versions|API-Reference-Prompt#the-prompt-and-its-versions]]: `GET /prompt`
- [[One prompt version|API-Reference-Prompt#one-prompt-version]]: `GET /prompt/versions/:version`
- [[Publish a prompt version|API-Reference-Prompt#publish-a-prompt-version]]: `POST /prompt`
- [[Restore a prompt version|API-Reference-Prompt#restore-a-prompt-version]]: `POST /prompt/restore`
- [[Export the agent file|API-Reference-Prompt#export-the-agent-file]]: `GET /agent/export`
- [[Import an agent file|API-Reference-Prompt#import-an-agent-file]]: `POST /agent/import`

## The prompt and its versions

`GET /prompt` · scope `prompt:read`

The business-specific instructions, everything HelpPuff adds around them (`builtIn`), lines that repeat a setting (`overlaps`), and the version history.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/prompt" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/prompt`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as PromptAndItsVersionsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "connector": "workers-ai",
  "builtIn": "You are the website assistant for Acme…",
  "overlaps": [],
  "editable": true,
  "reason": null,
  "text": "We service the Inner West only.",
  "hash": "9f2c…",
  "version": 3,
  "meta": {
    "version": 3,
    "hash": "9f2c…",
    "at": 1760000000000,
    "by": "owner@acme.example",
    "source": "dashboard"
  },
  "limit": 16000,
  "versions": [
    {
      "version": 3,
      "hash": "9f2c…",
      "source": "dashboard",
      "author": "owner@acme.example",
      "note": null,
      "restoredFrom": null,
      "createdAt": 1760000000000,
      "chars": 31
    }
  ]
}
```
```ts [Type]
type PromptAndItsVersionsResponse = {
  site: string;
  connector: string;
  builtIn: string;
  overlaps: string[];
  editable: boolean;
  reason: string | null;
  text: string;
  hash: string;
  version: number;
  meta: {
    version: number;
    hash: string;
    at: number;
    by: string;
    source: string;
  };
  limit: number;
  versions: Array<{
    version: number;
    hash: string;
    source: string;
    author: string;
    note: string | null;
    restoredFrom: string | null;
    createdAt: number;
    chars: number;
  }>;
};
```
<!-- /tabs -->

## One prompt version

`GET /prompt/versions/:version` · scope `prompt:read`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `version` | path | yes | The version. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/prompt/versions/VERSION" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const version = '2';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/prompt/versions/${version}`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as OnePromptVersionResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "version": 2,
  "hash": "1d4e…",
  "source": "cli",
  "author": "cli",
  "note": null,
  "restoredFrom": null,
  "createdAt": 1760000000000,
  "chars": 38,
  "text": "We service the Inner West and the CBD."
}
```
```ts [Type]
type OnePromptVersionResponse = {
  version: number;
  hash: string;
  source: string;
  author: string;
  note: string | null;
  restoredFrom: string | null;
  createdAt: number;
  chars: number;
  text: string;
};
```
<!-- /tabs -->

## Publish a prompt version

`POST /prompt` · scope `prompt:write`

Live within a minute. `baseVersion` is the version you edited: if someone published since, the answer is 409 with theirs.

| Body field | Required | Description |
| --- | --- | --- |
| `text` | yes | The whole prompt (up to 16,000 characters). |
| `baseVersion` | yes | The version you edited (from `GET /prompt`). |
| `note` | no | What changed, for the history. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/prompt" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "text": "We service the Inner West only. Never quote for gas work.",
  "baseVersion": 3,
  "note": "No gas quotes"
}'
```
```ts [TypeScript]
type PublishPromptVersionRequest = {
  /** The whole prompt (up to 16,000 characters). */
  text: string;
  /** The version you edited (from `GET /prompt`). */
  baseVersion: number;
  /** What changed, for the history. */
  note?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/prompt`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'We service the Inner West only. Never quote for gas work.',
    baseVersion: 3,
    note: 'No gas quotes'
  } satisfies PublishPromptVersionRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as PublishPromptVersionResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "status": "published",
  "version": 4,
  "hash": "a1b2…"
}
```
```ts [Type]
type PublishPromptVersionResponse = {
  status: string;
  version: number;
  hash: string;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 409 | `bad_request` | Someone published a newer version (it is in the body). |

## Restore a prompt version

`POST /prompt/restore` · scope `prompt:write`

Publishes an old version's text as a new version.

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/prompt/restore" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "version": 2,
  "baseVersion": 4
}'
```
```ts [TypeScript]
type RestorePromptVersionRequest = {
  version?: number;
  baseVersion?: number;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/prompt/restore`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    version: 2,
    baseVersion: 4
  } satisfies RestorePromptVersionRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RestorePromptVersionResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "status": "published",
  "version": 5,
  "hash": "c3d4…"
}
```
```ts [Type]
type RestorePromptVersionResponse = {
  status: string;
  version: number;
  hash: string;
};
```
<!-- /tabs -->

## Export the agent file

`GET /agent/export` · scope `prompt:read`

The assistant's setup as one file, to keep in a project, share or import elsewhere: the prompt, the tools, and the behaviour and lead form settings. A tool's secret header is a placeholder (`${ORDER_STATUS_AUTHORIZATION}`), listed in `needs`; its value never leaves the Worker.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/agent/export" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/agent/export`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ExportAgentFileResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "helppuff": "agent",
  "version": 1,
  "name": "Acme Plumbing assistant",
  "description": "Exported from acme on 2025-10-09.",
  "prompt": "If they ask about an order, ask for its number, save it with {{order_number}}, then look it up with {{order_status}}.",
  "settings": {
    "behaviour": {
      "goal": "callbacks",
      "tone": "friendly",
      "length": "short",
      "prices": "share"
    },
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
    }
  },
  "tools": [
    {
      "name": "order_number",
      "kind": "extract",
      "description": "Save the order number once the visitor gives it.",
      "enabled": true,
      "fields": [
        {
          "name": "order_number",
          "description": "The order number, like A-1042.",
          "required": true
        }
      ]
    },
    {
      "name": "order_status",
      "kind": "http",
      "description": "Look up an order by its number: status, items and delivery date.",
      "enabled": true,
      "method": "GET",
      "url": "https://api.acme.example/orders/{{args.order_number}}",
      "headers": [
        {
          "name": "Authorization",
          "value": "${ORDER_STATUS_AUTHORIZATION}",
          "secret": true
        }
      ],
      "parameters": [
        {
          "name": "order_number",
          "description": "The order number, like A-1042.",
          "required": true
        }
      ],
      "pick": [
        "status",
        "delivery.date"
      ],
      "keys": [
        "status",
        "delivery.date"
      ],
      "timeoutMs": 5000,
      "before": false,
      "after": false
    }
  ],
  "needs": [
    {
      "name": "ORDER_STATUS_AUTHORIZATION",
      "description": "The whole Authorization header of the order_status tool"
    }
  ]
}
```
```ts [Type]
type ExportAgentFileResponse = {
  helppuff: string;
  version: number;
  name: string;
  description: string;
  prompt: string;
  settings: {
    behaviour: {
      goal: string;
      tone: string;
      length: string;
      prices: string;
    };
    leads: {
      enabled: boolean;
      fields: Array<{
        name: string;
        label: string;
        type: string;
        required: boolean;
      }>;
    };
  };
  tools: Array<{
    name: string;
    kind: string;
    description: string;
    enabled: boolean;
    fields?: Array<{
      name: string;
      description: string;
      required: boolean;
    }>;
    method?: string;
    url?: string;
    headers?: Array<{
      name: string;
      value: string;
      secret: boolean;
    }>;
    parameters?: Array<{
      name: string;
      description: string;
      required: boolean;
    }>;
    pick?: string[];
    keys?: string[];
    timeoutMs?: number;
    before?: boolean;
    after?: boolean;
  }>;
  needs: Array<{
    name: string;
    description: string;
  }>;
};
```
<!-- /tabs -->

## Import an agent file

`POST /agent/import` · scope `prompt:write`

Applies an agent file (from `GET /agent/export`, a template, or written by hand): its settings, its tools (matched by name: created or replaced) and its prompt, as a new version. Everything is checked before anything changes. With `dryRun`, nothing changes: the answer says what would, and which secrets are still needed. Importing a file with `settings` (not a dry run) needs the `settings:write` scope too.

| Body field | Required | Description |
| --- | --- | --- |
| `agent` | yes | The agent file: `{ "helppuff": "agent", "version": 1, name, prompt, settings, tools, needs }`. |
| `secrets` | no | A value for each `${NAME}` in the tools' headers, as `{ "NAME": "value" }`. Stored encrypted, as a tool saved by hand. A tool that already has the header keeps its value when one is left out. |
| `dryRun` | no | `true`: change nothing, answer what would change. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/agent/import" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "agent": {
    "helppuff": "agent",
    "version": 1,
    "name": "Acme Plumbing assistant",
    "description": "Exported from acme on 2025-10-09.",
    "prompt": "If they ask about an order, ask for its number, save it with {{order_number}}, then look it up with {{order_status}}.",
    "settings": {
      "behaviour": {
        "goal": "callbacks",
        "tone": "friendly",
        "length": "short",
        "prices": "share"
      },
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
      }
    },
    "tools": [
      {
        "name": "order_number",
        "kind": "extract",
        "description": "Save the order number once the visitor gives it.",
        "enabled": true,
        "fields": [
          {
            "name": "order_number",
            "description": "The order number, like A-1042.",
            "required": true
          }
        ]
      },
      {
        "name": "order_status",
        "kind": "http",
        "description": "Look up an order by its number: status, items and delivery date.",
        "enabled": true,
        "method": "GET",
        "url": "https://api.acme.example/orders/{{args.order_number}}",
        "headers": [
          {
            "name": "Authorization",
            "value": "${ORDER_STATUS_AUTHORIZATION}",
            "secret": true
          }
        ],
        "parameters": [
          {
            "name": "order_number",
            "description": "The order number, like A-1042.",
            "required": true
          }
        ],
        "pick": [
          "status",
          "delivery.date"
        ],
        "keys": [
          "status",
          "delivery.date"
        ],
        "timeoutMs": 5000,
        "before": false,
        "after": false
      }
    ],
    "needs": [
      {
        "name": "ORDER_STATUS_AUTHORIZATION",
        "description": "The whole Authorization header of the order_status tool"
      }
    ]
  },
  "secrets": {
    "ORDER_STATUS_AUTHORIZATION": "Bearer sk_live_…"
  },
  "dryRun": true
}'
```
```ts [TypeScript]
type ImportAgentFileRequest = {
  /**
   * The agent file: `{ "helppuff": "agent", "version": 1, name, prompt,
   * settings, tools, needs }`.
   */
  agent: {
    helppuff?: string;
    version?: number;
    name?: string;
    description?: string;
    prompt?: string;
    settings?: {
      behaviour?: {
        goal?: string;
        tone?: string;
        length?: string;
        prices?: string;
      };
      leads?: {
        enabled?: boolean;
        fields?: Array<{
          name?: string;
          label?: string;
          type?: string;
          required?: boolean;
        }>;
      };
    };
    tools?: Array<{
      name?: string;
      kind?: string;
      description?: string;
      enabled?: boolean;
      fields?: Array<{
        name?: string;
        description?: string;
        required?: boolean;
      }>;
      method?: string;
      url?: string;
      headers?: Array<{
        name?: string;
        value?: string;
        secret?: boolean;
      }>;
      parameters?: Array<{
        name?: string;
        description?: string;
        required?: boolean;
      }>;
      pick?: string[];
      keys?: string[];
      timeoutMs?: number;
      before?: boolean;
      after?: boolean;
    }>;
    needs?: Array<{
      name?: string;
      description?: string;
    }>;
  };
  /**
   * A value for each `${NAME}` in the tools' headers, as `{ "NAME": "value"
   * }`. Stored encrypted, as a tool saved by hand. A tool that already has the
   * header keeps its value when one is left out.
   */
  secrets?: {
    ORDER_STATUS_AUTHORIZATION?: string;
  };
  /** `true`: change nothing, answer what would change. */
  dryRun?: boolean;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/agent/import`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    agent: {
      helppuff: 'agent',
      version: 1,
      name: 'Acme Plumbing assistant',
      description: 'Exported from acme on 2025-10-09.',
      prompt: 'If they ask about an order, ask for its number, save it with {{order_number}}, then look it up with {{order_status}}.',
      settings: {
        behaviour: {
          goal: 'callbacks',
          tone: 'friendly',
          length: 'short',
          prices: 'share'
        },
        leads: {
          enabled: true,
          fields: [
            {
              name: 'name',
              label: 'Name',
              type: 'text',
              required: true
            }
          ]
        }
      },
      tools: [
        {
          name: 'order_number',
          kind: 'extract',
          description: 'Save the order number once the visitor gives it.',
          enabled: true,
          fields: [
            {
              name: 'order_number',
              description: 'The order number, like A-1042.',
              required: true
            }
          ]
        },
        {
          name: 'order_status',
          kind: 'http',
          description: 'Look up an order by its number: status, items and delivery date.',
          enabled: true,
          method: 'GET',
          url: 'https://api.acme.example/orders/{{args.order_number}}',
          headers: [
            {
              name: 'Authorization',
              value: '${ORDER_STATUS_AUTHORIZATION}',
              secret: true
            }
          ],
          parameters: [
            {
              name: 'order_number',
              description: 'The order number, like A-1042.',
              required: true
            }
          ],
          pick: [
            'status',
            'delivery.date'
          ],
          keys: [
            'status',
            'delivery.date'
          ],
          timeoutMs: 5000,
          before: false,
          after: false
        }
      ],
      needs: [
        {
          name: 'ORDER_STATUS_AUTHORIZATION',
          description: 'The whole Authorization header of the order_status tool'
        }
      ]
    },
    secrets: {
      ORDER_STATUS_AUTHORIZATION: 'Bearer sk_live_…'
    },
    dryRun: true
  } satisfies ImportAgentFileRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ImportAgentFileResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "dryRun": true,
  "ready": true,
  "name": "Acme Plumbing assistant",
  "settings": [
    "behaviour",
    "leads"
  ],
  "tools": [
    {
      "name": "order_number",
      "action": "create"
    },
    {
      "name": "order_status",
      "action": "create"
    }
  ],
  "prompt": {
    "action": "replace",
    "version": 4
  },
  "missingSecrets": []
}
```
```ts [Type]
type ImportAgentFileResponse = {
  site: string;
  dryRun: boolean;
  ready: boolean;
  name: string;
  settings: string[];
  tools: Array<{
    name: string;
    action: string;
  }>;
  prompt: {
    action: string;
    version: number;
  };
  missingSecrets: string[];
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | The file is not valid (`agent_invalid`), or a secret is missing (`agent_secrets_missing`). |
