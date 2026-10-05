# Provider: OpenAI

`"backend": { "type": "openai" }`

Answers with OpenAI's [Responses API](https://platform.openai.com/docs/api-reference/responses).
Knowledge comes from an OpenAI vector store (File Search), or from Murmur's
own knowledge base.

## Set up

```bash
npx @knowtific/murmur init --url acme.com --backend openai --api-key "$OPENAI_API_KEY"
# or later:
murmur secret set OPENAI_API_KEY
```

```json
"backend": {
  "type": "openai",
  "model": "gpt-5-mini",
  "apiKey": { "env": "OPENAI_API_KEY" }
}
```

| Option | Default | |
| --- | --- | --- |
| `model` | `gpt-5-mini` | Any Responses model |
| `apiKey` | `{ "env": "OPENAI_API_KEY" }` | By environment variable name |
| `retrieval` | — | `"murmur"`: answer from Murmur's knowledge base (crawled on your Cloudflare account) instead of a vector store |
| `vectorStoreId` | — | Filled in by `murmur knowledge sync` |
| `promptId` | — | A stored prompt in the OpenAI dashboard; used instead of `prompt.md` |
| `baseUrl` | OpenAI's | Another Responses-compatible endpoint, e.g. Azure OpenAI |

## Knowledge: two ways

**OpenAI File Search** (the default for this backend). `murmur knowledge sync`
crawls your site (up to `knowledge.website.maxPages`, default 50) and uploads
it, with `knowledge.files`, to a vector store it creates; the id is written to
`vectorStoreId`. Run it again to refresh.

**Murmur's knowledge base** (`"retrieval": "murmur"`). Your site is crawled
into Vectorize and D1 on your Cloudflare account, exactly as with the default
backend, with the same dashboard tools (choose pages, files, facts, test a
question). OpenAI only writes the answer: the passages are added to its
instructions, and the sources come back as links. This is usually the better
choice: retrieval stays free and on your account, and switching models later
changes nothing else.

```bash
murmur config set backend.retrieval murmur && murmur deploy
```

## The prompt

`prompt.md` is sent as the instructions, versioned like every other backend.
Or keep the prompt in OpenAI's dashboard as a **stored prompt** and set
`promptId`. It is then edited and versioned there, and `prompt.md` is not used.

## Notes

- Multi-turn conversations use `previous_response_id` (OpenAI keeps the
  history, with `store: true`); the session holds only the id.
- Rich messages (chips, cards, links) are function calls the model makes;
  they are rendered, never executed.
- Replies stream.
