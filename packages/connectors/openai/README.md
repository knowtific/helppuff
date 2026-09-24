# `@murmur/connector-openai`

The OpenAI **Responses API** — and, with `baseUrl`, anything that speaks its
wire format: Azure, OpenRouter, DeepSeek, a local model.

Verified against the official [openai-openapi](https://github.com/openai/openai-openapi)
spec on 2026-09-22. The wire shapes are in
[`docs/connectors.md`](../../../docs/connectors.md).

## Setup

```bash
echo 'OPENAI_API_KEY=sk-...' >> packages/server/.dev.vars   # local
wrangler secret put OPENAI_API_KEY                          # production
```

```ts
connector: {
  type: 'openai',
  options: {
    apiKey: { env: 'OPENAI_API_KEY' },
    model: 'gpt-5',
    // A stored prompt, versioned in OpenAI's dashboard. The best option:
    // editing it is not a deploy, and no customer content enters this repo.
    promptRef: { id: 'pmpt_abc123', version: '4' },
  },
},
```

Use `instructions` instead when you would rather keep the prompt on your
side — it takes a string, `{ env }`, `{ kv }` or `{ url }`. `promptRef` wins
if both are set. Either way the connector supplies the same variables
(`lead_name`, `page_url`, `utm_source`, …); see
[`docs/prompts.md`](../../../docs/prompts.md).

## Another provider

```ts
options: {
  apiKey: { env: 'DEEPSEEK_API_KEY' },
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  instructions: { kv: 'prompt:knowtific' },
}
```

Stored prompts are OpenAI's own feature, so `promptRef` will not work
elsewhere — use a `PromptSource`.

## Options

| Option | Default | |
| --- | --- | --- |
| `apiKey` | — | String or `{ env }` |
| `model` | `gpt-5` | |
| `promptRef` | — | `{ id, version? }`, a stored prompt; takes precedence |
| `instructions` | — | A `PromptSource`: string, `{ env }`, `{ kv }` or `{ url }` |
| `richMessages` | `true` | Offers `show_options` / `show_card` / `show_links` |
| `tools` | — | Up to 16 extra function tools, forwarded verbatim |
| `maxOutputTokens` | `800` | |
| `temperature` | — | |
| `store` | `true` | Required for multi-turn; off means each turn is independent |
| `stream` | `false` | Show replies as they are written. Reasoning is never shown; the typing indicator stays up until the answer starts |
| `baseUrl` | OpenAI's | Any compatible endpoint |

## Two details worth knowing

**`output_text` is an SDK convenience and is not in the HTTP response.** The
connector aggregates the `output_text` parts of each `message` item itself,
which is the kind of thing that silently returns empty replies if you assume
the SDK shape.

**Multi-turn rides on `previous_response_id`**, so connector state is one id
— no transcript in KV, nothing near the 1 kb token budget. It requires
`store: true`. With `store: false` OpenAI retains nothing and the model
forgets between messages; the connector stops chaining rather than sending
an id that would 404.
