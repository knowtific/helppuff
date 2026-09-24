# `@murmur/connector-gemini`

Gemini, with **File Search** as the retrieval layer — the RAG option. Google
does the chunking, embedding and retrieval; you upload documents once and the
connector queries them on every message.

Verified against [ai.google.dev](https://ai.google.dev/gemini-api/docs/file-search)
on 2026-09-22. The wire shapes are in
[`docs/connectors.md`](../../../docs/connectors.md).

---

## 1. Get an API key

From [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Then:

```bash
# Local development
echo 'GEMINI_API_KEY=AIza...' >> packages/server/.dev.vars

# Production — never in a file
wrangler secret put GEMINI_API_KEY
```

Refer to it by name in `murmur.config.ts`, never by value:

```ts
connector: { type: 'gemini', options: { apiKey: { env: 'GEMINI_API_KEY' } } }
```

## 2. Create a File Search store

A store is created once and reused. It is **not** created by the connector —
the connector only queries it, so building your knowledge base is not
coupled to serving traffic.

```bash
export GEMINI_API_KEY=AIza...

curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/fileSearchStores" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
        "displayName": "knowtific-kb",
        "embeddingModel": "models/gemini-embedding-2"
      }'
```

The response carries a `name` like `fileSearchStores/knowtific-kb-a1b2c3`.
That string is what goes in the config.

## 3. Upload your documents

```bash
STORE="fileSearchStores/knowtific-kb-a1b2c3"

curl -s -X POST \
  "https://generativelanguage.googleapis.com/upload/v1beta/${STORE}:uploadToFileSearchStore" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H 'X-Goog-Upload-Protocol: resumable' \
  -H 'X-Goog-Upload-Command: start' \
  -H 'Content-Type: application/json' \
  -d '{
        "displayName": "pricing-2026.pdf",
        "chunkingConfig": {
          "whiteSpaceConfig": { "maxTokensPerChunk": 200, "maxOverlapTokens": 20 }
        }
      }'
```

Worth knowing:

- **Embeddings persist; the raw files are deleted after 48 hours.** Retrieval
  keeps working — you are not expected to keep re-uploading.
- Storage and query-time embedding are free; you pay for the model call.
- `displayName` is what the visitor sees in a citation, so name files the way
  you would want them cited. `pricing-2026.pdf` reads well; `doc1.pdf` does
  not.
- Attach custom metadata at upload time if you want to filter at query time
  (`metadataFilter` below).

## 4. Point the connector at it

```ts
connector: {
  type: 'gemini',
  options: {
    apiKey: { env: 'GEMINI_API_KEY' },
    model: 'gemini-3-flash',

    // Where retrieval happens. Omit for a plain assistant with no RAG.
    fileSearchStores: ['fileSearchStores/knowtific-kb-a1b2c3'],

    // Optional: narrow retrieval by the metadata attached at upload.
    // metadataFilter: 'category="pricing"',

    // The system prompt. Gemini has no stored-prompt object, so `{ kv }`
    // lets you edit it live — see docs/prompts.md.
    systemInstruction: { kv: 'prompt:knowtific' },
  },
},
```

Set the prompt without redeploying:

```bash
wrangler kv key put --binding=MURMUR_KV "prompt:knowtific" --path ./prompt.txt
```

---

## Options

| Option | Default | |
| --- | --- | --- |
| `apiKey` | — | String or `{ env }` |
| `model` | `gemini-3-flash` | |
| `fileSearchStores` | `[]` | Store names, up to 10; empty means no retrieval |
| `metadataFilter` | — | Filters retrieval by custom metadata |
| `systemInstruction` | — | A `PromptSource`: string, `{ env }`, `{ kv }` or `{ url }` |
| `richMessages` | `true` | Offers `show_options` / `show_card` / `show_links` |
| `showCitations` | `true` | Renders the documents an answer came from |
| `maxOutputTokens` | `800` | |
| `store` | `true` | Required for multi-turn; off means each turn is independent |
| `stream` | `false` | Show replies as they are written. Thinking is never shown; the typing indicator stays up until the answer starts |
| `baseUrl` | Google's | |

## Citations

Gemini returns `file_citation` annotations naming the documents behind an
answer. The connector collapses repeats by document and appends:

- a **links** message when the name is a URL, so the visitor can open it;
- a **notice** — "Based on: pricing-2026.pdf" — when it is a filename, since
  a filename is worth naming but is not somewhere to send anyone.

Set `showCitations: false` to keep answers bare.

A stream does not carry citations, so with `stream: true` the connector reads
them from the stored interaction once the answer is complete — one extra
request, and only when File Search is configured. If that request fails, the
answer is still shown, without its sources.

## Conversation state

Multi-turn rides on `previous_interaction_id`, so the connector's state is
one id: no transcript in KV, and nothing near the 1 kb token budget.

This requires `store: true`. With `store: false` Google retains nothing — and
the model forgets the conversation between messages, so each turn stands
alone. That is a real trade, not a toggle to flip idly.

## Rich messages

With `richMessages: true` the model is offered three tools, and whatever it
calls them with becomes chips, a card or a link list. The JSON schemas are
exported as `RICH_TOOL_SCHEMAS` from `@murmur/connector-types`. A malformed
call produces no rich message rather than a broken thread.
