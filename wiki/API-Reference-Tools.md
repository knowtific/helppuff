<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Tools API

Your own APIs, called before, during and after a chat (`{{name}}` in the prompt), and extract tools that save what the assistant learns. What they return is kept on the conversation (`data`) and sent to webhooks. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List tools|API-Reference-Tools#list-tools]]: `GET /tools`
- [[Add a tool|API-Reference-Tools#add-a-tool]]: `POST /tools`
- [[Change a tool|API-Reference-Tools#change-a-tool]]: `PATCH /tools/:id`
- [[Remove a tool|API-Reference-Tools#remove-a-tool]]: `DELETE /tools/:id`
- [[Test a tool|API-Reference-Tools#test-a-tool]]: `POST /tools/test`

## List tools

`GET /tools` · scope `prompt:read`

Every tool the site has. Secret header values are never returned: `set` says whether one is stored. `keys` are what the tool returns (from its last test), for `{{name.key}}` in the prompt. `prechat` is the pre-chat form's fields (`{{prechat.<name>}}`); `assistant` whether the site's backend is HelpPuff's assistant, which uses tools in the chat.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/tools" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/tools`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListToolsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "tools": [
    {
      "id": "tool_8d7c6b5a",
      "name": "order_status",
      "kind": "http",
      "description": "Look up an order by its number: status, items and delivery date.",
      "method": "GET",
      "url": "https://api.acme.example/orders/{{args.order_number}}",
      "headers": [
        {
          "name": "Accept",
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
      "body": "",
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
      "timeoutMs": 5000,
      "keys": [
        "status",
        "delivery",
        "delivery.date"
      ],
      "before": false,
      "after": false,
      "when": null,
      "enabled": true,
      "lastStatus": 200,
      "lastError": null,
      "lastAt": 1760000000000,
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000
    }
  ],
  "assistant": true,
  "prechat": [
    {
      "name": "email",
      "label": "Email"
    }
  ],
  "limits": {
    "tools": 30,
    "timeoutMs": {
      "default": 5000,
      "min": 1000,
      "max": 10000
    }
  }
}
```
```ts [Type]
type ListToolsResponse = {
  tools: Array<{
    id: string;
    name: string;
    kind: string;
    description: string;
    method: string;
    url: string;
    headers: Array<{
      name: string;
      value: string;
      secret: boolean;
      set: boolean;
    }>;
    body: string;
    parameters: Array<{
      name: string;
      description: string;
      required: boolean;
    }>;
    pick: string[];
    timeoutMs: number;
    keys: string[];
    before: boolean;
    after: boolean;
    when: string | null;
    enabled: boolean;
    lastStatus: number;
    lastError: string | null;
    lastAt: number;
    createdAt: number;
    updatedAt: number;
  }>;
  assistant: boolean;
  prechat: Array<{
    name: string;
    label: string;
  }>;
  limits: Record<string, number>;
};
```
<!-- /tabs -->

## Add a tool

`POST /tools` · scope `prompt:write`

An `http` tool calls your API: `{{args.x}}` in its URL, headers or body is filled in by the assistant, `{{prechat.email}}` from the pre-chat form, `{{data.other_tool.key}}` from what another tool returned. An `extract` tool calls nothing: the assistant saves its `fields` (as conversation attributes too). Name it in the prompt as `{{name}}` to let the assistant use it; `before` runs it when the chat starts, `after` when the conversation ends. Up to 30 per site.

| Body field | Required | Description |
| --- | --- | --- |
| `name` | yes | Lowercase letters, digits and `_`, starting with a letter: how the prompt and the data refer to it. |
| `kind` | no | `http` (the default) or `extract`. |
| `description` | yes | What it does and when to use it: the assistant reads it. |
| `method` | no | `GET`, `POST`, `PUT`, `PATCH` or `DELETE`. |
| `url` | no | An https URL; only its path and query may use `{{…}}`. |
| `headers` | no | A list of `{ name, value, secret }`; secret values are stored encrypted and never returned. |
| `body` | no | The request body; in JSON, `"{{data}}"` as a whole value sends the object itself. |
| `parameters` | no | Descriptions of the `{{args.*}}` the request uses: `{ name, description, required }`. |
| `fields` | no | An extract tool's fields: `{ name, description, required }`. |
| `pick` | no | Response paths to keep (`delivery.date`); empty keeps it all (cut to about 4 KB). |
| `timeoutMs` | no | 1000 to 10000 (default 5000). |
| `before` | no | Run it when the chat starts, with the pre-chat form's answers. |
| `after` | no | Run it when the conversation ends, with the transcript, the summary, the lead and all the data. |
| `when` | no | An after-chat tool runs only when this holds: `{ "path": "labels.leadQuality", "in": ["hot"] }` (a path in the conversation.completed data and the values it may have), or `{ "path": "lead.email" }` (has a value). `null` removes it. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/tools" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "order_status",
  "description": "Look up an order by its number: status, items and delivery date.",
  "method": "GET",
  "url": "https://api.acme.example/orders/{{args.order_number}}",
  "headers": [
    {
      "name": "Authorization",
      "value": "Bearer sk_live_4f3e2d1c",
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
  ]
}'
```
```ts [TypeScript]
type AddToolRequest = {
  /**
   * Lowercase letters, digits and `_`, starting with a letter: how the prompt
   * and the data refer to it.
   */
  name: string;
  /** `http` (the default) or `extract`. */
  kind?: string;
  /** What it does and when to use it: the assistant reads it. */
  description: string;
  /** `GET`, `POST`, `PUT`, `PATCH` or `DELETE`. */
  method?: string;
  /** An https URL; only its path and query may use `{{…}}`. */
  url?: string;
  /**
   * A list of `{ name, value, secret }`; secret values are stored encrypted
   * and never returned.
   */
  headers?: Array<{
    name?: string;
    value?: string;
    secret?: boolean;
  }>;
  /**
   * The request body; in JSON, `"{{data}}"` as a whole value sends the object
   * itself.
   */
  body?: string;
  /**
   * Descriptions of the `{{args.*}}` the request uses: `{ name, description,
   * required }`.
   */
  parameters?: Array<{
    name?: string;
    description?: string;
    required?: boolean;
  }>;
  /** An extract tool's fields: `{ name, description, required }`. */
  fields?: string;
  /**
   * Response paths to keep (`delivery.date`); empty keeps it all (cut to about
   * 4 KB).
   */
  pick?: string[];
  /** 1000 to 10000 (default 5000). */
  timeoutMs?: string;
  /** Run it when the chat starts, with the pre-chat form's answers. */
  before?: string;
  /**
   * Run it when the conversation ends, with the transcript, the summary, the
   * lead and all the data.
   */
  after?: string;
  /**
   * An after-chat tool runs only when this holds: `{ "path":
   * "labels.leadQuality", "in": ["hot"] }` (a path in the
   * conversation.completed data and the values it may have), or `{ "path":
   * "lead.email" }` (has a value). `null` removes it.
   */
  when?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/tools`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'order_status',
    description: 'Look up an order by its number: status, items and delivery date.',
    method: 'GET',
    url: 'https://api.acme.example/orders/{{args.order_number}}',
    headers: [
      {
        name: 'Authorization',
        value: 'Bearer sk_live_4f3e2d1c',
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
    ]
  } satisfies AddToolRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AddToolResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "tool_8d7c6b5a",
  "name": "order_status",
  "kind": "http",
  "description": "Look up an order by its number: status, items and delivery date.",
  "method": "GET",
  "url": "https://api.acme.example/orders/{{args.order_number}}",
  "headers": [
    {
      "name": "Accept",
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
  "body": "",
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
  "timeoutMs": 5000,
  "keys": [
    "status",
    "delivery",
    "delivery.date"
  ],
  "before": false,
  "after": false,
  "when": null,
  "enabled": true,
  "lastStatus": 200,
  "lastError": null,
  "lastAt": 1760000000000,
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type AddToolResponse = {
  id: string;
  name: string;
  kind: string;
  description: string;
  method: string;
  url: string;
  headers: Array<{
    name: string;
    value: string;
    secret: boolean;
    set: boolean;
  }>;
  body: string;
  parameters: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
  pick: string[];
  timeoutMs: number;
  keys: string[];
  before: boolean;
  after: boolean;
  when: string | null;
  enabled: boolean;
  lastStatus: number | null;
  lastError: string | null;
  lastAt: number | null;
  createdAt: number;
  updatedAt: number;
};
```
<!-- /tabs -->

## Change a tool

`PATCH /tools/:id` · scope `prompt:write`

Any of the fields `POST /tools` takes. A secret header sent with an empty value keeps the stored one.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/tools/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "before": true
}'
```
```ts [TypeScript]
type ChangeToolRequest = {
  before?: boolean;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/tools/${id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    before: true
  } satisfies ChangeToolRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ChangeToolResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "tool_8d7c6b5a",
  "name": "order_status",
  "kind": "http",
  "description": "Look up an order by its number: status, items and delivery date.",
  "method": "GET",
  "url": "https://api.acme.example/orders/{{args.order_number}}",
  "headers": [
    {
      "name": "Accept",
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
  "body": "",
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
  "timeoutMs": 5000,
  "keys": [
    "status",
    "delivery",
    "delivery.date"
  ],
  "before": true,
  "after": false,
  "when": null,
  "enabled": true,
  "lastStatus": 200,
  "lastError": null,
  "lastAt": 1760000000000,
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type ChangeToolResponse = {
  id: string;
  name: string;
  kind: string;
  description: string;
  method: string;
  url: string;
  headers: Array<{
    name: string;
    value: string;
    secret: boolean;
    set: boolean;
  }>;
  body: string;
  parameters: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
  pick: string[];
  timeoutMs: number;
  keys: string[];
  before: boolean;
  after: boolean;
  when: string | null;
  enabled: boolean;
  lastStatus: number | null;
  lastError: string | null;
  lastAt: number | null;
  createdAt: number;
  updatedAt: number;
};
```
<!-- /tabs -->

## Remove a tool

`DELETE /tools/:id` · scope `prompt:write`

Conversations keep what it returned. Take `{{name}}` out of the prompt too.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/tools/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/tools/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RemoveToolResponse;
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
type RemoveToolResponse = {
  deleted: boolean;
};
```
<!-- /tabs -->

## Test a tool

`POST /tools/test` · scope `prompt:write`

Calls it now with sample values and shows what came back: a saved tool (`id`), a draft (`tool`), or both (unsaved changes; empty secret headers keep the stored ones). `response` is the whole answer, `value` what a chat keeps (after `pick`), `keys` its key paths; testing a saved tool remembers them.

| Body field | Required | Description |
| --- | --- | --- |
| `id` | no | A saved tool. |
| `tool` | no | A draft, as `POST /tools` takes it. |
| `sample` | no | Values for the templates: `{ args, prechat, data, page, conversation, transcript, summary, lead, attributes }`. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/tools/test" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "id": "tool_8d7c6b5a",
  "sample": {
    "args": {
      "order_number": "A-1042"
    }
  }
}'
```
```ts [TypeScript]
type TestToolRequest = {
  /** A saved tool. */
  id?: string;
  /** A draft, as `POST /tools` takes it. */
  tool?: string;
  /**
   * Values for the templates: `{ args, prechat, data, page, conversation,
   * transcript, summary, lead, attributes }`.
   */
  sample?: {
    args?: {
      order_number?: string;
    };
  };
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/tools/test`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    id: 'tool_8d7c6b5a',
    sample: {
      args: {
        order_number: 'A-1042'
      }
    }
  } satisfies TestToolRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as TestToolResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "ok": true,
  "status": 200,
  "ms": 182,
  "error": null,
  "response": {
    "status": "shipped",
    "delivery": {
      "date": "2026-10-12",
      "carrier": "AusPost"
    }
  },
  "value": {
    "status": "shipped",
    "delivery": {
      "date": "2026-10-12"
    }
  },
  "keys": [
    "status",
    "delivery",
    "delivery.date",
    "delivery.carrier"
  ]
}
```
```ts [Type]
type TestToolResponse = {
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
  response: {
    status: string | null;
    delivery: {
      date: string;
      carrier: string;
    };
  };
  value: {
    status: string | null;
    delivery: {
      date: string;
    };
  };
  keys: string[];
};
```
<!-- /tabs -->
