# Providers

The **backend** is what answers your visitors. HelpPuff talks to each one
through a connector, so the widget, dashboard, leads and webhooks work the
same whichever you choose. Pick one at setup (`helppuff init --backend <type>`,
or `--no-defaults` to choose interactively), or change `backend` in
`helppuff.json` and deploy.

| Backend | What answers | Knowledge comes from | Needs | Cost |
| --- | --- | --- | --- | --- |
| [[`workers-ai`|Provider-Workers-AI]] *(default)* | Cloudflare Workers AI (GLM-4.7 Flash by default) | HelpPuff's own knowledge base: your site and files in Vectorize + D1 on your account | a Cloudflare account | Workers Free plan |
| [[`cloudflare`|Provider-Cloudflare-AI-Search]] | Cloudflare AI Search with a Workers AI model | AI Search: your site and files, or an existing instance | a Cloudflare account | AI Search's free beta limits, plus Workers AI |
| [[`openai`|Provider-OpenAI]] | OpenAI (Responses API), or a compatible endpoint | an OpenAI vector store, or HelpPuff's knowledge base | `OPENAI_API_KEY` | OpenAI's pricing |
| [[`gemini`|Provider-Gemini]] | Google Gemini | Gemini File Search, or HelpPuff's knowledge base | `GEMINI_API_KEY` | Google's pricing |
| [[`anthropic`|Provider-Anthropic]] | Anthropic Claude | Cloudflare AI Search, or HelpPuff's knowledge base | `ANTHROPIC_API_KEY` | Anthropic's pricing |
| [[`retell`|Provider-Retell]] | A Retell chat agent | yours, in Retell; or HelpPuff's knowledge base as a custom function | `RETELL_API_KEY` | Retell's pricing |
| [[`http`|Provider-Your-Own-API]] | Your own API: the HelpPuff backend protocol, or any OpenAI-compatible `/chat/completions` | yours | a URL | yours |
| `echo` | Nothing: echoes what it is sent and demonstrates every widget feature | — | nothing | free (development only) |

## Choosing

- **Start with `workers-ai`.** It is free, needs only a Cloudflare login, and
  answers only from your own site and files, saying "not sure" (and offering a
  callback) rather than guessing.
- **Want a particular model?** `openai`, `gemini` and `anthropic` can keep
  HelpPuff's knowledge base (`"retrieval": "helppuff"`) and move only the writing
  of answers to that model. You keep the same crawling, files, facts and
  dashboard.
- **Already have an agent?** Use `retell` for a Retell agent, or `http` for
  anything you have built yourself.

## Switching

```bash
helppuff config set backend '{"type":"openai","model":"gpt-5-mini","retrieval":"helppuff"}'
helppuff secret set OPENAI_API_KEY
helppuff deploy
```

Conversations, leads, settings and the knowledge base are kept. The prompt
(`prompt.md`) carries over to every backend that takes one; Retell, an OpenAI
stored prompt and your own API in `helppuff` mode keep theirs.

## What every backend gets

- The same widget: rich messages (option chips, cards, link lists, forms),
  streaming where the backend streams, ratings, lead form, flows.
- The same dashboard, leads and [[Webhooks]].
- The same limits and security: origin allowlist, signed sessions, rate
  limits, the daily cap, optional Turnstile.

Rich messages come from three tools the model can call (`show_options`,
`show_card`, `show_links`); backends that cannot take tools end a reply with an
options marker instead, which becomes the same chips. See
[[Extending|Extending#rich-messages]].
