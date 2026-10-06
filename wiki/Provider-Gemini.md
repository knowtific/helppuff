# Provider: Google Gemini

`"backend": { "type": "gemini" }`

Answers with Google Gemini (the Interactions API). Knowledge comes from Gemini
**File Search** (Google chunks, embeds and retrieves), or from HelpPuff's own
knowledge base.

## Set up

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey), then:

```bash
npx @knowtific/helppuff init --url acme.com --backend gemini --api-key "$GEMINI_API_KEY"
```

```json
"backend": {
  "type": "gemini",
  "model": "gemini-3-flash",
  "apiKey": { "env": "GEMINI_API_KEY" }
}
```

| Option | Default | |
| --- | --- | --- |
| `model` | `gemini-3-flash` | Any Gemini model |
| `apiKey` | `{ "env": "GEMINI_API_KEY" }` | By environment variable name |
| `retrieval` | — | `"helppuff"`: HelpPuff's knowledge base instead of File Search |
| `fileSearchStore` | — | Filled in by `helppuff knowledge sync` |

## Knowledge: two ways

**Gemini File Search.** `helppuff knowledge sync` crawls your site (up to
`knowledge.website.maxPages`, default 50), creates a File Search store, and
uploads the pages and `knowledge.files` to it; the store name is written to
`fileSearchStore`. Google keeps the embeddings; the raw files are deleted after
48 hours. Run `sync` again to refresh. Citations come back as links (for web
pages) or a note naming the document.

**HelpPuff's knowledge base** (`"retrieval": "helppuff"`): the site is learned on
your Cloudflare account as with the default backend, and Gemini only writes
the answer from the passages it is given.

## Notes

- `prompt.md` is sent as the system instruction, versioned as usual.
- Conversations continue with `previous_interaction_id`; the session holds only the id.
- Rich messages are function calls, rendered and never executed. Replies stream.
