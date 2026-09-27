# Connectors

A connector translates the Murmur protocol into one AI backend. Each lives in
its own directory under `packages/connectors/`, is registered explicitly in
[`registry.ts`](../packages/server/src/core/registry.ts), and never imports
another connector.

## The interface

```ts
export interface Connector<Opts = unknown, State = unknown> {
  type: string;
  optionsSchema: z.ZodType<Opts, z.ZodTypeDef, unknown>;
  capabilities: { poll: boolean; end: boolean };
  /** Whether these options turn streaming on. Omit if the connector cannot stream. */
  streams?(options: Opts): boolean;

  start(ctx: ConnectorContext<Opts>, input: StartSessionRequest):
    Promise<{ state: State; messages: Message[] }>;

  send(ctx: ConnectorContext<Opts>, state: State, input: SendRequest):
    Promise<{ state?: State; messages: Message[] }>;

  poll?(ctx: ConnectorContext<Opts>, state: State, afterId?: string):
    Promise<{ messages: Message[] }>;

  end?(ctx: ConnectorContext<Opts>, state: State): Promise<void>;
}
```

Export it wrapped in `defineConnector()`, which erases the option and state
types so the registry can hold connectors of differing shapes.

### Rules

- **State must be small.** It is embedded in the signed session token — keep it
  under 1 kb serialized. `issueToken` refuses anything larger.
- **Throw `ConnectorError` with a visitor-safe message.** The core turns it into
  the error envelope. Put diagnostic text in `detail`, which is logged and never
  sent to the browser. Anything that is *not* a `ConnectorError` is treated as a
  bug and becomes a generic `connector_error`.
- **Time out outbound calls at 25s.** `fetchWithTimeout` does this for you.
- **Never log lead data or message text.** `ctx.log(event, data)` takes event
  names, ids, counts and latencies only.
- Use `ctx.fetch`, not the global — tests inject a mock through it.

### Streaming

A connector that can stream implements `streams(options)`, usually by
returning a `stream` option. When the server is streaming a request,
`ctx.onText` is set: call it with each piece of reply text as the backend
produces it, and still return the complete messages at the end — those are
what the visitor is left with. `readJsonEvents` reads a backend's SSE stream
with an idle timeout.

Only forward text meant for the visitor. Reasoning, thought summaries and
tool-call arguments must never reach `onText`; rich messages are returned at
the end like any other. See [protocol.md](protocol.md#streamed-replies).

## `echo`

Built first, for development and tests. Needs no API key and drives every
widget feature:

| Send | Get back |
| --- | --- |
| anything | `text` echoing it with markdown |
| `/options` | an `options` message |
| `/multi` | a multi-select `options` message |
| `/card` | a `card` with an image and three action kinds |
| `/carousel` | three cards |
| `/links` | a `links` message |
| `/form` | an inline `form` message |
| `/notice` | a `warn` notice |
| `/multipart` | two messages in one batch |
| `/slow` | a reply after 3s, for the typing indicator |
| `/long` | a 12-paragraph markdown reply, for scrolling |
| `/error` | throws a `ConnectorError` |

With `stream: true`, echo streams its text replies a word at a time, so the
whole streaming path can be exercised with no API key. The demo site has it on.

---

## Registered connectors

| Type | Backend | State | Prompt lives in |
| --- | --- | --- | --- |
| `echo` | none — development and tests | `{ turn }` | — |
| `retell` | Retell chat agents | `{ chatId }` | The Retell agent |
| `openai` | OpenAI Responses API, or any compatible endpoint | `{ responseId }` | A stored prompt, or a `PromptSource` |
| `gemini` | Gemini Interactions API + File Search (RAG) | `{ interactionId }` | A `PromptSource` |
| `cloudflare` | Cloudflare AI Search chat completions (retrieval + Workers AI) | `{ turns }`, history in KV | A `PromptSource` |
| `anthropic` | Claude via the Messages API (official SDK), optional AI Search retrieval | `{ turns }`, history in KV | A `PromptSource` |
| `http` | Your own API: Murmur backend protocol, or any OpenAI-compatible `/chat/completions` | your backend's, or history in KV | Yours, or a `PromptSource` |

Retell, OpenAI and Gemini keep the conversation on their own side and hand
back an id, so connector state stays far under the 1 kb token budget. The
stateless APIs (`cloudflare`, `anthropic`, `http` in `openai` mode) keep the
transcript in KV under `hist:<site>:<session>` instead, trimmed to the last 24
turns and expiring with the session — see `history.ts` in
`@murmur/connector-types`. See [`prompts.md`](prompts.md) for where the prompt
itself belongs.

### Rich messages

All three map the same three tool calls to protocol messages, so one agent
configuration works across providers (§6.3):

| Tool | Produces |
| --- | --- |
| `show_options` | option chips, `multi` for a multi-select |
| `show_card` | a card with title, body, image and up to three actions |
| `show_links` | a link list |

The exact JSON schemas are exported as `RICH_TOOL_SCHEMAS` from
`@murmur/connector-types`, so what you paste into an agent and what the
parser accepts cannot drift apart. `arguments` arrives as a JSON string from
Retell and OpenAI and as an object from Gemini; the parser takes either, and
a malformed call produces no rich message rather than a broken thread.

Retell agents that cannot be given tools can use the inline-marker fallback
instead — set `inlineMarkers: true` and have the agent end a reply with
`[[options: Today | Tomorrow]]` or `[[link: Pricing | https://…]]`.

### Cloudflare AI Search, Anthropic and `http`

- **`cloudflare`** calls `chatCompletions` on an `[[ai_search]]` binding, or on
  a public endpoint when `endpoint` is set; both are covered by
  `aiSearchClient` in `@murmur/connector-types`. Chat completions take no tool
  definitions, so rich messages use inline markers, which the connector
  teaches the model in the system prompt and hides from the streamed preview.
- **`anthropic`** uses `@anthropic-ai/sdk` with the connector's `fetch`. The
  three rich tools are declared as Claude tools and are rendered, never
  executed, so no `tool_result` is ever sent; the next turn replays a
  plain-text summary instead. Opus 5 and Fable 5.1 run with server-side
  refusal fallbacks. The Worker needs the `nodejs_compat` flag for the SDK.
- **`http`** is documented from the backend's side in [cli.md](cli.md#your-own-backend-http).

---

## Appendix: verified API references

What follows was read from each provider's own documentation on 2026-09-22,
rather than recalled. The connectors are built against these shapes and the
tests assert them, so a drift shows up as a test failure.

### Retell — [docs.retellai.com](https://docs.retellai.com/api-references/overview)

Base `https://api.retellai.com`, auth `Authorization: Bearer <key>`.

| Operation | Method and path | Body | Success |
| --- | --- | --- | --- |
| Start | `POST /create-chat` | `{ agent_id, retell_llm_dynamic_variables?, metadata?, agent_version? }` | 201, `{ chat_id, chat_status, … }` |
| Send | `POST /create-chat-completion` | `{ chat_id, content }` | 201, `{ messages: [...] }` |
| End | `PATCH /end-chat/{chat_id}` | none | 204 |

Note `end-chat` takes the id in the **path** and is a `PATCH`.

A completion returns *"New messages generated by the agent during this
completion… Does not include the original input messages"*, so Retell holds
the history. `messages` is a union of seven shapes discriminated by `role`:

| `role` | Connector does |
| --- | --- |
| `agent`, `injected` | maps to a `text` message |
| `tool_call_invocation` | `{ tool_call_id, name, arguments }`, where `arguments` is *"a stringified JSON object"* → a rich message |
| `user`, `tool_call_result`, `node_transition`, `state_transition`, `sms` | ignored |

### OpenAI — the official [openai-openapi](https://github.com/openai/openai-openapi) spec

`POST https://api.openai.com/v1/responses`, auth `Authorization: Bearer <key>`.

Request: `{ model, input, instructions?, prompt?, tools?, tool_choice?,
previous_response_id?, store?, max_output_tokens?, temperature? }`

Response: `{ id, status, output: OutputItem[], error?, usage }`

Two details that shape the connector:

- **`output_text` is SDK-only** and is not in the HTTP response, so the text
  is aggregated from the `output_text` parts of each `message` item.
- **`prompt: { id, version?, variables? }`** references a stored prompt
  template — the cleanest place for a prompt to live.

`output` items are a union: `message` (`content: [{ type: 'output_text',
text, annotations? }]`), `function_call` (`{ call_id, name, arguments }` with
`arguments` a JSON string), plus `reasoning`, `file_search_call`,
`web_search_call` and others the connector ignores.

Multi-turn rides on `previous_response_id`, which needs `store: true`.

### Gemini — [ai.google.dev](https://ai.google.dev/gemini-api/docs/file-search)

`POST https://generativelanguage.googleapis.com/v1beta/interactions`, auth
`x-goog-api-key: <key>`.

Request: `{ model, input, system_instruction?, tools?,
previous_interaction_id?, store?, generation_config? }`

Response: `{ id, object: 'interaction', status, steps: [...], usage }`

File Search is a **tool**, not a separate call:

```json
{ "type": "file_search",
  "file_search_store_names": ["fileSearchStores/kb-123"],
  "metadata_filter": "author=\"Ada\"" }
```

`steps` items: `model_output` (`content: [{ type: 'text', text, annotations? }]`),
`function_call` (`{ name, id, arguments }` — an **object**, unlike the other
two), and `user_input`, which is the echo of the input.

Citations arrive as `file_citation` annotations carrying `file_name` and
`page_number`. The connector collapses them by document and renders them as
a `links` message when the name is a URL, or a `notice` when it is a filename.

Multi-turn rides on `previous_interaction_id`.

#### Building the File Search store

The store is built once, outside the connector, which only queries it:

```bash
# 1. Create the store
curl -X POST "https://generativelanguage.googleapis.com/v1beta/fileSearchStores" \
  -H "x-goog-api-key: $GEMINI_API_KEY" -H 'Content-Type: application/json' \
  -d '{"displayName":"knowtific-kb","embeddingModel":"models/gemini-embedding-2"}'

# 2. Upload a document to it (resumable upload)
curl -X POST \
  "https://generativelanguage.googleapis.com/upload/v1beta/fileSearchStores/<STORE>:uploadToFileSearchStore" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H 'X-Goog-Upload-Protocol: resumable' -H 'X-Goog-Upload-Command: start' \
  -d '{"displayName":"pricing-2026.pdf"}'
```

Put the returned store name in `fileSearchStores`. Google chunks, embeds and
retrieves; embeddings persist, and the raw files are deleted after 48 hours.

### Cloudflare AI Search — [developers.cloudflare.com/ai-search](https://developers.cloudflare.com/ai-search/)

Read on 2026-09-24, and exercised against a live instance the same day.

| Operation | Shape |
| --- | --- |
| Binding | `[[ai_search]] binding = "AI_SEARCH", instance_name = "…"` (instance must exist at deploy) |
| Chat | `env.AI_SEARCH.chatCompletions({ messages, model?, stream?, ai_search_options: { retrieval: { max_num_results }, query_rewrite: { enabled } } })` |
| Stream | SSE: one `event: chunks` frame, then `data: {choices:[{delta:{content}}]}`, then `data: [DONE]` |
| Public endpoint | `POST {endpoint}/chat/completions` (same body, plain JSON) and `POST {endpoint}/search` (wrapped in `{ success, result }`) |
| REST (setup) | `/accounts/{id}/ai-search/namespaces/default/instances[/{id}[/items\|/stats]]`; items upload is multipart `file` |

Behaviour observed on live instances on 2026-09-25, and handled by the CLI:

- Item listing caps `per_page` at 50 (100 is rejected).
- A new `web-crawler` instance's **first** sync drops files uploaded to
  built-in storage while it runs; later scheduled or manual syncs keep them.
  `murmur` waits for the first job to end, then uploads and verifies.
- A 43-page site (sitemap mode) indexed in about 15 minutes; a single-page
  site (discover mode) in about 2.
- `web-crawler` sources must be a zone on the same account; `discover` needs
  a verified zone.

Instances are free during the beta within their limits (100 instances and
500 crawled pages a day on Workers Free); Workers AI generation is billed
separately.
