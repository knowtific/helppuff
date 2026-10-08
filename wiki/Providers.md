# Providers

HelpPuff's assistant has two parts you choose separately:

- **The model** (`model` in `helppuff.json`): who writes the answers.
- **The knowledge** (`knowledge.retrieval`): what the answers come from.

The assistant around them stays the same whichever you pick: the prompt and
its rules, the tools (callbacks, jobs, live chat hand-over, opening hours),
citations, guardrails, history, the widget, dashboard, leads and
[[Webhooks]]. Both are changed with the CLI and a deploy, never in the
dashboard.

| Model (`model.provider`) | What writes the answers | Needs |
| --- | --- | --- |
| `workers-ai` *(default)* | Cloudflare Workers AI (GLM-4.7 Flash by default). See [[Workers AI|Provider-Workers-AI]] | nothing: your Cloudflare account, the Free plan |
| `openai-compatible` | Any OpenAI-compatible API with tools, with presets for DeepInfra, OpenRouter, DeepSeek, Groq, Together, Mistral, Fireworks, the Vercel AI Gateway and the Cloudflare AI Gateway | that provider's key |
| `openai` | OpenAI | `OPENAI_API_KEY` |
| `gemini` | Google Gemini | `GEMINI_API_KEY` |
| `anthropic` | Anthropic Claude | `ANTHROPIC_API_KEY` |
| `custom` | Your own code: a TypeScript file with one `chat` function. See [[Custom model|Custom-Model]] | whatever it calls |

| Knowledge (`knowledge.retrieval.type`) | What answers come from | Filled by |
| --- | --- | --- |
| `helppuff` *(default)* | HelpPuff's own knowledge base: your site and files, in Vectorize + D1 on your account. See [[Knowledge base|Knowledge-Base]] | the Worker's crawl, your files, the dashboard |
| `none` | Nothing but the prompt and the business details | n/a |
| `ai-search` | Cloudflare AI Search | AI Search's crawl, or your files on deploy |
| `openai-vector-store` | An OpenAI vector store | you, in OpenAI |
| `http` | Your own search endpoint | you |
| `custom` | Your own code: a TypeScript file with one `search` function. See [[Custom knowledge base|Custom-Knowledge-Base]] | you |

The full list of models, presets and how to switch: [[Models and providers|Models-and-Providers]].

## Backends that run the whole conversation

A few backends run the conversation themselves, so they take no `model` or
`knowledge.retrieval`; set `backend` instead:

| `backend.type` | What answers | Needs |
| --- | --- | --- |
| [[`retell`|Provider-Retell]] | A Retell chat agent (it can search HelpPuff's knowledge base through a custom function) | `RETELL_API_KEY` |
| [[`http`|Provider-Your-Own-API]] | Your own API, speaking the HelpPuff backend protocol | a URL |
| [[`openai`|Provider-OpenAI]] | OpenAI's Responses API with a stored prompt, a vector store HelpPuff fills for you, or another base URL | `OPENAI_API_KEY` |
| [[`gemini`|Provider-Gemini]] | Gemini with File Search | `GEMINI_API_KEY` |
| `echo` | Nothing: echoes what it is sent and demonstrates every widget feature | nothing (development only) |

## Choosing

- **Start with the defaults**: Workers AI and HelpPuff's knowledge base. Free,
  only a Cloudflare login, and it answers only from your own site and files,
  saying "not sure" (and offering a callback) rather than guessing.
- **Want a particular model?** Change only `model`. Your crawl, files,
  business details and dashboard stay as they are.
- **Your knowledge lives elsewhere?** Change only `knowledge.retrieval`: AI
  Search, an OpenAI vector store, your own search over HTTP, or your own code.
- **Already have a whole agent?** Use `retell`, or your own API (`http`).

## Switching

```bash
helppuff model set openai-compatible --preset deepinfra --model deepseek-ai/DeepSeek-V3.1
helppuff secret set DEEPINFRA_API_KEY
helppuff deploy
helppuff model test "Do you do emergency callouts?"
```

Conversations, leads, settings and the knowledge base are kept. The prompt
(`prompt.md`) carries over to every model; Retell, an OpenAI stored prompt and
your own API in `helppuff` mode keep theirs.

## Costs and limits

Workers AI is counted in neurons against the daily budget
(`model.budget.dailyNeurons`, 9,000 by default, under the free 10,000). Other
providers bill you directly at their own prices: cap them with the daily
message limit, `security.limits.messagesPerSitePerDay`. See
[[Costs and limits|Costs-and-Limits]].

## What every backend gets

- The same widget: rich messages (option chips, cards, link lists, forms),
  streaming where the backend streams, ratings, lead form, flows.
- The same dashboard, leads and [[Webhooks]].
- The same limits and security: origin allowlist, signed sessions, rate
  limits, the daily cap, optional Turnstile.
