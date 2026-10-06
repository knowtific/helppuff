# Provider: Anthropic Claude

`"backend": { "type": "anthropic" }`

Answers with Claude (the Messages API, through Anthropic's official SDK).
Claude has no hosted retrieval, so knowledge comes from **Cloudflare AI
Search** or from **HelpPuff's own knowledge base**.

## Set up

Get a key at [console.anthropic.com](https://console.anthropic.com/), then:

```bash
npx @knowtific/helppuff init --url acme.com --backend anthropic --api-key "$ANTHROPIC_API_KEY"
```

```json
"backend": {
  "type": "anthropic",
  "model": "claude-opus-5",
  "apiKey": { "env": "ANTHROPIC_API_KEY" },
  "retrieval": "helppuff"
}
```

| Option | Default | |
| --- | --- | --- |
| `model` | `claude-opus-5` | Any Claude model. A smaller, faster model (e.g. Sonnet or Haiku) suits most chat |
| `apiKey` | `{ "env": "ANTHROPIC_API_KEY" }` | By environment variable name |
| `effort` | — | `low` … `max`: how hard Claude thinks before answering. Lower is faster and cheaper |
| `retrieval` | — | `"helppuff"`: ground answers in HelpPuff's knowledge base (recommended) |
| `knowledge` | on when there is knowledge | Ground answers in Cloudflare AI Search |
| `instance`, `endpoint` | — | Which AI Search instance, as for the [[Cloudflare AI Search|Provider-Cloudflare-AI-Search]] backend |

## Knowledge

**HelpPuff's knowledge base** (`"retrieval": "helppuff"`, recommended): your site
and files are learned into Vectorize and D1 on your Cloudflare account, with
the dashboard's knowledge tools; the passages are added to Claude's system
prompt and the sources come back as links.

**Cloudflare AI Search** (without `retrieval`): an AI Search instance is
created or reused as for the `cloudflare` backend, and its results ground
Claude's answers.

## Notes

- `prompt.md` is the system prompt, versioned as usual.
- The conversation is kept in KV per session (the last 24 turns) and sent
  with each message, since the Messages API is stateless.
- The rich-message tools are declared as Claude tools and rendered, never
  executed.
- The Worker runs with the `nodejs_compat` flag, which the SDK needs; deploy
  sets it.
