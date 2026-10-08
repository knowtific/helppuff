<!-- Generated from the helppuff.json schema by `pnpm sync:docs`. Change a field's `.describe()`, not this page. -->

# Configuration reference

Every field of `helppuff.json`. Generated from the schema `helppuff` validates against, so it is
always exact; `helppuff schema` prints the same as JSON Schema. For what these files are and how
they relate to the dashboard, see [[Configuration]].

Secrets are never values here: a field marked `{ env }` takes the name of an environment
variable, e.g. `{ "env": "OPENAI_API_KEY" }`, whose value lives in `.env` and on the Worker.

## Top level

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `$schema` | string |  | The JSON Schema for editors and agents. Written by helppuff. |
| `format` | integer |  | The helppuff.json format version. Absent means 1; `helppuff upgrade` updates it when a release changes the format. · ≥ 1 |
| `site` **(required)** | string |  | Site id: lowercase letters, digits and dashes. Appears in the embed snippet. |
| `name` **(required)** | string |  | The business name, as visitors see it. · 1–60 chars |
| `website` | string |  | The website the assistant is for, and learns from. · URL |
| `origins` **(required)** | string[] |  | Every origin the widget may be embedded on. The preview page is added automatically. · ≥ 1 items |
| `model` | object |  | Who writes the answers. Leave it out for Workers AI. Changed only here (or with `helppuff model set`), then `helppuff deploy`. |
| `model.provider` **(required)** | `"workers-ai"` \| `"openai-compatible"` \| `"openai"` \| `"gemini"` \| `"anthropic"` \| `"custom"` |  | `"workers-ai"` Workers AI, on your Cloudflare account. The default: no key, on the Free plan. · `"openai-compatible"` Any OpenAI-compatible `/chat/completions` API with tools. · `"openai"` OpenAI. · `"gemini"` Google Gemini (its OpenAI-compatible API). · `"anthropic"` Anthropic Claude (the Messages API). · `"custom"` Your own model: a TypeScript file whose default export is `defineModel({ id, chat })`. See the wiki's Custom model page. |
| `model.model` | string |  | A Workers AI model id. Default: GLM-4.7 Flash. · 1–200 chars |
| `model.budget` | object |  | Spend guards. Other providers bill you directly; cap them with `security.limits.messagesPerSitePerDay`. |
| `model.budget.dailyNeurons` | integer |  | Workers AI only: neurons per UTC day before answers stop (default 9,000; the free allocation is 10,000). Raise it on Workers Paid. · 0–10000000 |
| `model.budget.maxInputTokens` | integer |  | The most tokens sent to the model per answer: prompt, passages and history, trimmed to fit. · 1000–100000 |
| `model.reasoning` | `"low"` \| `"medium"` \| `"high"` | `"medium"` | How long the model thinks before answering: `low`, `medium` or `high`. Deeper is better on multi-step questions, slower to start, and the thinking is billed. Models that only switch thinking on or off treat every level as on. |
| `model.fallbackModel` | string |  | Tried once when the main model fails for any reason other than the budget. · 1–200 chars |
| `model.locale` | string |  | BCP 47, e.g. `en-AU`: spelling and date style of answers. · ≤ 35 chars |
| `model.timezone` | string |  | IANA, e.g. `Australia/Melbourne`: "are you open now?". · ≤ 64 chars |
| `model.maxAnswerSentences` | integer | `4` | The longest answer, in sentences. Short answers cost less and read better in a chat. · 1–20 |
| `model.maxOutputTokens` | integer | `600` | A hard cap on tokens per answer. · 64–4096 |
| `model.historyMessages` | integer | `6` | Earlier messages sent with each question. The main cost lever after retrieval. · 0–24 |
| `model.richMessages` | boolean | `true` | Let the model offer next-step chips (option buttons) after an answer. |
| `model.tools` | object | `{}` | What the assistant can do besides answering. |
| `model.tools.callback` | boolean | `true` | Offer to have the team call or email back — the default way to a person. |
| `model.tools.businessHours` | boolean | `true` | Answer "are you open now?" from the business hours and time zone. |
| `model.tools.captureLead` | boolean |  | Retired. Accepted from older configs and ignored. |
| `model.tools.handoff` | boolean |  | Retired. Accepted from older configs and ignored. |
| `model.tools.booking` | boolean |  | Retired. Accepted from older configs and ignored. |
| `model.business` | object | `{}` | Details the owner confirmed. Usually left empty: the details learned from the site, and edited in the dashboard, are used. |
| `model.business.name` | string |  | The business name. · ≤ 200 chars |
| `model.business.phone` | string |  | The main phone number. · ≤ 100 chars |
| `model.business.email` | string |  | The contact email. · ≤ 200 chars |
| `model.business.address` | string |  | The street address. · ≤ 400 chars |
| `model.business.hours` | string[] | `[]` | Opening hours, one line per day or range, e.g. "Mon-Fri 7am-5pm". · ≤ 14 items |
| `model.business.serviceAreas` | string[] | `[]` | Suburbs or regions served. · ≤ 100 items |
| `model.gateway` | string |  | With `provider: "workers-ai"`. An AI Gateway id: caching, logs and rate limits in front of every Workers AI call. · 1–64 chars |
| `model.preset` | `"deepinfra"` \| `"openrouter"` \| `"deepseek"` \| `"groq"` \| `"together"` \| `"mistral"` \| `"fireworks"` \| `"vercel-ai-gateway"` \| `"cloudflare-ai-gateway"` |  | With `provider: "openai-compatible"`. Fills `baseUrl` and the key's variable name: deepinfra, openrouter, deepseek, groq, together, mistral, fireworks, vercel-ai-gateway, cloudflare-ai-gateway. |
| `model.baseUrl` | string |  | With `provider: "openai-compatible"`. The API base, before `/chat/completions`. Needed without a preset. · URL |
| `model.apiKey` | `{ env }` |  | With `provider: "openai-compatible"`. The key, by environment variable name. Default: the preset's (e.g. `DEEPINFRA_API_KEY`). |
| `model.headers` | map of string \| `{ env }` |  | With `provider: "openai-compatible"`. Extra headers; a value may be a secret (`{ env }`). |
| `model.nativeTools` | boolean |  | With `provider: "openai-compatible"`. The model calls tools natively (default true). Off: tool calls it writes in its text are still read. |
| `model.accountId` | string |  | With `provider: "openai-compatible"`. cloudflare-ai-gateway: the account (default: the one deployed to). |
| `model.gatewayId` | string |  | With `provider: "openai-compatible"`. cloudflare-ai-gateway: the gateway (default: `default`). · 1–64 chars |
| `model.gatewayToken` | `{ env }` |  | With `provider: "openai-compatible"`. cloudflare-ai-gateway: an authenticated gateway's token, sent as `cf-aig-authorization`. |
| `model.apiKey` | `{ env }` | `{"env":"OPENAI_API_KEY"}` | With `provider: "openai"`. Your OpenAI API key, by environment variable name. |
| `model.apiKey` | `{ env }` | `{"env":"GEMINI_API_KEY"}` | With `provider: "gemini"`. Your Gemini API key, by environment variable name. |
| `model.apiKey` | `{ env }` | `{"env":"ANTHROPIC_API_KEY"}` | With `provider: "anthropic"`. Your Anthropic API key, by environment variable name. |
| `model.module` **(required)** | string |  | With `provider: "custom"`. The file, relative to helppuff.json, e.g. `./llm.ts`. Bundled into the Worker at deploy. |
| `model.secrets` | string[] |  | With `provider: "custom"`. The environment variables your file reads (`env.NAME`): uploaded as Worker secrets at deploy. · ≤ 20 items |
| `prompt` | string | `"prompt.md"` | Path to the system prompt, relative to helppuff.json. |
| `assistant` | object | `{}` | How the assistant behaves: goal, tone, answer length. HelpPuff writes these around prompt.md on every answer, so prompt.md holds only what is specific to the business. |
| `assistant.goal` | `"callbacks"` \| `"answers"` \| `"bookings"` | `"callbacks"` | What the assistant is for: `callbacks` (help, then get the team in touch), `answers`, or `bookings`. |
| `assistant.tone` | `"friendly"` \| `"professional"` \| `"casual"` | `"friendly"` | How it sounds. |
| `assistant.length` | `"short"` \| `"detailed"` | `"short"` | `short`: a few sentences; `detailed`: complete answers with short lists. |
| `assistant.prices` | `"share"` \| `"quote"` | `"share"` | `share`: give prices exactly as the site and documents state them; `quote`: never give a price or estimate, offer a quote from the team instead. |
| `assistant.bookingUrl` | string |  | Where visitors book, for the `bookings` goal. · ≤ 2000 chars, URL |
| `live` | object | `{}` | Live chat: visitors can talk to a person on your team, who answers from the dashboard or Telegram. Off by default. `helppuff live on` turns it on. |
| `live.enabled` | boolean | `false` | Let visitors talk to a person on the team. When nobody is available they get the callback form instead. |
| `live.waitSeconds` | integer | `120` | How long a visitor waits for someone to take the chat before they are offered the callback form (they can keep waiting). · 15–3600 |
| `live.closeAfterMinutes` | integer | `60` | A conversation with no message for this long is closed. A visitor who writes again is answered by the assistant. · 5–1440 |
| `live.showAgentName` | boolean | `true` | Show visitors the first name of the person answering ("Sam joined"); off: "Someone from the team". |
| `live.aiWhileWaiting` | boolean | `false` | Let the assistant keep answering until someone takes the chat. |

## `backend`

Only for a backend that runs the whole conversation itself: `retell`, `http` (your own API), `echo`, or `openai` / `gemini` with their own file stores. Otherwise leave it out and use `model` and `knowledge.retrieval`.

### `"type": "assistant"`

HelpPuff's own assistant, set up by `model` and `knowledge.retrieval`. Implied when `backend` is left out; never written by hand.

| Field | Type | Default | Description |
| --- | --- | --- | --- |

### `"type": "workers-ai"`

Workers AI with HelpPuff's own knowledge base. The default; runs on the Workers Free plan.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `backend.model` | string | `"@cf/zai-org/glm-4.7-flash"` | The Workers AI model that writes answers. GLM-4.7 Flash is the best all-round on the Free plan; the wiki's AI models page compares the others for speed, quality and answers a day. · 1–200 chars |
| `backend.reasoning` | `"low"` \| `"medium"` \| `"high"` | `"medium"` | How long the model thinks before answering: `low`, `medium` or `high`. Deeper is better on multi-step questions, slower to start, and the thinking is billed. Models that only switch thinking on or off treat every level as on. |
| `backend.fallbackModel` | string |  | Tried once when the main model fails for any reason other than the budget. · 1–200 chars |
| `backend.gateway` | string |  | An AI Gateway id: caching, logs and rate limits in front of every model call. · 1–64 chars |
| `backend.locale` | string |  | BCP 47, e.g. `en-AU`: spelling and date style of answers. · ≤ 35 chars |
| `backend.timezone` | string |  | IANA, e.g. `Australia/Melbourne`: "are you open now?". · ≤ 64 chars |
| `backend.maxAnswerSentences` | integer | `4` | The longest answer, in sentences. Short answers cost less and read better in a chat. · 1–20 |
| `backend.maxOutputTokens` | integer | `600` | A hard cap on tokens per answer. · 64–4096 |
| `backend.historyMessages` | integer | `6` | Earlier messages sent with each question. The main cost lever after retrieval. · 0–24 |
| `backend.richMessages` | boolean | `true` | Let the model offer next-step chips (option buttons) after an answer. |
| `backend.retrieval` | object | `{}` | How answers find passages in the knowledge base. |
| `backend.tools` | object | `{}` | What the assistant can do besides answering. |
| `backend.tools.callback` | boolean | `true` | Offer to have the team call or email back — the default way to a person. |
| `backend.tools.businessHours` | boolean | `true` | Answer "are you open now?" from the business hours and time zone. |
| `backend.tools.captureLead` | boolean |  | Retired. Accepted from older configs and ignored. |
| `backend.tools.handoff` | boolean |  | Retired. Accepted from older configs and ignored. |
| `backend.tools.booking` | boolean |  | Retired. Accepted from older configs and ignored. |
| `backend.handoff` | map of any |  | Retired (callbacks replaced handoff). Accepted from older configs and ignored. |
| `backend.business` | object | `{}` | Details the owner confirmed. Usually left empty: the details learned from the site, and edited in the dashboard, are used. |
| `backend.business.name` | string |  | The business name. · ≤ 200 chars |
| `backend.business.phone` | string |  | The main phone number. · ≤ 100 chars |
| `backend.business.email` | string |  | The contact email. · ≤ 200 chars |
| `backend.business.address` | string |  | The street address. · ≤ 400 chars |
| `backend.business.hours` | string[] | `[]` | Opening hours, one line per day or range, e.g. "Mon-Fri 7am-5pm". · ≤ 14 items |
| `backend.business.serviceAreas` | string[] | `[]` | Suburbs or regions served. · ≤ 100 items |
| `backend.budget` | object | `{}` | The daily Workers AI spend guard. Past it, visitors get your contact details and a callback form instead of answers. |
| `backend.budget.dailyNeurons` | integer | `9000` | Neurons per UTC day before answers stop; the free allocation is 10,000. · 0–10000000 |
| `backend.budget.maxInputTokens` | integer | `6000` | The most tokens sent to the model per answer — prompt, passages and history — trimmed to fit. · 1000–100000 |

#### `backend.retrieval`

How answers find passages in the knowledge base.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `backend.retrieval.embeddingModel` | string | `"@cf/baai/bge-m3"` | Turns pages and questions into vectors. Changing it re-learns the site (and uploaded files) on the next deploy. · 1–200 chars |
| `backend.retrieval.rerankerModel` | string \| null | `"@cf/baai/bge-reranker-base"` | Re-reads the passages search found and keeps only those that answer the question. `null` turns it off: about half a second faster, but more likely to answer from the wrong page. |
| `backend.retrieval.topKVector` | integer | `20` | Passages taken from meaning (vector) search before re-scoring. · 1–50 |
| `backend.retrieval.topKKeyword` | integer | `20` | Passages taken from keyword (full-text) search before re-scoring. · 1–50 |
| `backend.retrieval.finalK` | integer | `4` | Passages the model reads for each answer. · 1–10 |
| `backend.retrieval.minScore` | number | `0.2` | Passages scored below this are dropped. With none left, the assistant says it is not sure and offers a callback instead of guessing. · 0–1 |
| `backend.retrieval.queryRewrite` | `"heuristic"` \| `"llm"` \| `"off"` | `"heuristic"` | `heuristic`: follow-ups borrow the previous question. `llm`: one extra small call rewrites it. |
| `backend.retrieval.intentModel` | string \| null | `null` | e.g. `@cf/cloudflare/clef-flash`: classify each question to steer retrieval. Off by default. |

### `"type": "cloudflare"`

Cloudflare AI Search: retrieval and generation managed by Cloudflare.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `backend.instance` | string |  | Instance name on your account. Created by `helppuff deploy` if it does not exist. |
| `backend.endpoint` | string |  | Use an existing public endpoint instead of a binding, e.g. https://search.example.com · URL |
| `backend.model` | string |  | Workers AI model id, or an AI Gateway alias. Empty uses the instance's own model. |
| `backend.maxResults` | integer |  | Passages AI Search retrieves per question. · 1–50 |

### `"type": "openai"`

OpenAI (Responses API), or any compatible endpoint with `baseUrl`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `backend.model` | string | `"gpt-5-mini"` | The OpenAI model. |
| `backend.apiKey` | `{ env }` | `{"env":"OPENAI_API_KEY"}` | Your OpenAI API key, by environment variable name. |
| `backend.vectorStoreId` | string |  | Filled in by `helppuff knowledge sync`. |
| `backend.retrieval` | `"helppuff"` |  | `helppuff`: answer from HelpPuff's own knowledge base (crawled by the Worker) instead of a vector store. |
| `backend.promptId` | string |  | A stored prompt in the OpenAI dashboard; overrides prompt.md. |
| `backend.baseUrl` | string |  | Another OpenAI-compatible Responses endpoint, e.g. Azure OpenAI. · URL |

### `"type": "gemini"`

Google Gemini, with File Search.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `backend.model` | string | `"gemini-3-flash"` | The Gemini model. |
| `backend.apiKey` | `{ env }` | `{"env":"GEMINI_API_KEY"}` | Your Gemini API key, by environment variable name. |
| `backend.fileSearchStore` | string |  | Filled in by `helppuff knowledge sync`. |
| `backend.retrieval` | `"helppuff"` |  | `helppuff`: answer from HelpPuff's own knowledge base instead of File Search. |

### `"type": "anthropic"`

Anthropic Claude, grounded in AI Search or HelpPuff's own knowledge base.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `backend.model` | string | `"claude-opus-5"` | The Claude model. |
| `backend.apiKey` | `{ env }` | `{"env":"ANTHROPIC_API_KEY"}` | Your Anthropic API key, by environment variable name. |
| `backend.effort` | `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` \| `"max"` |  | How hard Claude thinks before answering. Lower is faster and cheaper. |
| `backend.knowledge` | boolean |  | Ground answers in a Cloudflare AI Search instance. On by default when there is knowledge. |
| `backend.retrieval` | `"helppuff"` |  | `helppuff`: ground answers in HelpPuff's own knowledge base instead of AI Search. |
| `backend.instance` | string |  | Instance name on your account. Created by `helppuff deploy` if it does not exist. |
| `backend.endpoint` | string |  | Use an existing public endpoint instead of a binding, e.g. https://search.example.com · URL |

### `"type": "http"`

Your own API.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `backend.url` **(required)** | string |  | Your API's base URL. · URL |
| `backend.mode` | `"helppuff"` \| `"openai"` | `"helppuff"` | `helppuff`: your API speaks the HelpPuff backend protocol. `openai`: any /chat/completions endpoint. |
| `backend.model` | string |  | `openai` mode: the model name your endpoint expects. |
| `backend.token` | `{ env }` |  | Sent as `Authorization: Bearer …`. |
| `backend.signingSecret` | `{ env }` |  | Signs every request with HMAC-SHA256 so your API can verify it. |
| `backend.stream` | boolean | `true` | Stream replies as they are written. |

### `"type": "retell"`

A Retell chat agent.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `backend.agentId` **(required)** | string |  | The Retell chat agent id. |
| `backend.apiKey` | `{ env }` | `{"env":"RETELL_API_KEY"}` | Your Retell API key, by environment variable name. |
| `backend.retrieval` | `"helppuff"` |  | `helppuff`: crawl the site into HelpPuff's knowledge base; the agent searches it via a custom function (see `helppuff status`). |

### `"type": "echo"`

Echoes what it is sent, with a demo of every widget feature. For development; needs no key.

| Field | Type | Default | Description |
| --- | --- | --- | --- |

## `knowledge`

What the assistant learns from: the website, and your own files.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `knowledge.website` | boolean \| object | `true` | Learn from the website: `true` (the defaults), `false`, or which pages and how often. |
| `knowledge.website.maxPages` | integer |  | Default: 300 for workers-ai (crawled by the Worker), 50 for the others (crawled here). · 1–1000 |
| `knowledge.website.include` | string[] |  | Only crawl URLs matching one of these: a substring, or a glob like `**/services/**`. |
| `knowledge.website.exclude` | string[] |  | Never crawl URLs matching one of these. Defaults leave out privacy, terms, tags, carts and accounts. |
| `knowledge.website.renderJs` | `"auto"` \| `"always"` \| `"never"` |  | workers-ai: render pages drawn by JavaScript with Browser Rendering (`auto` = only when needed). |
| `knowledge.website.schedule` | `"off"` \| `"daily"` \| `"weekly"` \| `"monthly"` |  | workers-ai: re-crawl the selected pages on this schedule. |
| `knowledge.files` | string[] | `[]` | Files and folders to index, relative to helppuff.json. PDF, Markdown, text, HTML, DOCX. |
| `knowledge.retrieval` | object |  | What answers come from. Left out: HelpPuff's own knowledge base. `none` for none. Changed only here (or with `helppuff rag set`), then `helppuff deploy`. |
| `knowledge.retrieval.type` **(required)** | `"helppuff"` \| `"none"` \| `"ai-search"` \| `"openai-vector-store"` \| `"http"` \| `"custom"` |  | `"helppuff"` HelpPuff's own knowledge base: your site and files, learned by the Worker (Vectorize + D1). · `"none"` No knowledge base: the prompt and the business details only. · `"ai-search"` Cloudflare AI Search, searched for passages; your model writes the answer. · `"openai-vector-store"` An OpenAI vector store you fill in OpenAI, searched for passages. · `"http"` Your own search over HTTP: `POST url { query, question, siteId, limit }` → `{ passages: [{ title, content, url? }] }`. · `"custom"` Your own knowledge base: a TypeScript file whose default export is `defineRetriever({ id, search })`. See the wiki's Custom knowledge base page. |
| `knowledge.retrieval.embeddingModel` | string | `"@cf/baai/bge-m3"` | With `type: "helppuff"`. Turns pages and questions into vectors. Changing it re-learns the site (and uploaded files) on the next deploy. · 1–200 chars |
| `knowledge.retrieval.rerankerModel` | string \| null | `"@cf/baai/bge-reranker-base"` | With `type: "helppuff"`. Re-reads the passages search found and keeps only those that answer the question. `null` turns it off: about half a second faster, but more likely to answer from the wrong page. |
| `knowledge.retrieval.topKVector` | integer | `20` | With `type: "helppuff"`. Passages taken from meaning (vector) search before re-scoring. · 1–50 |
| `knowledge.retrieval.topKKeyword` | integer | `20` | With `type: "helppuff"`. Passages taken from keyword (full-text) search before re-scoring. · 1–50 |
| `knowledge.retrieval.finalK` | integer | `4` | With `type: "helppuff"`. Passages the model reads for each answer. · 1–10 |
| `knowledge.retrieval.minScore` | number | `0.2` | With `type: "helppuff"`. Passages scored below this are dropped. With none left, the assistant says it is not sure and offers a callback instead of guessing. · 0–1 |
| `knowledge.retrieval.queryRewrite` | `"heuristic"` \| `"llm"` \| `"off"` | `"heuristic"` | With `type: "helppuff"`. `heuristic`: follow-ups borrow the previous question. `llm`: one extra small call rewrites it. |
| `knowledge.retrieval.intentModel` | string \| null | `null` | With `type: "helppuff"`. e.g. `@cf/cloudflare/clef-flash`: classify each question to steer retrieval. Off by default. |
| `knowledge.retrieval.instance` | string |  | With `type: "ai-search"`. Instance name on your account. Created by `helppuff deploy` if it does not exist. |
| `knowledge.retrieval.endpoint` | string |  | With `type: "ai-search"`. Use an existing public endpoint instead of a binding, e.g. https://search.example.com · URL |
| `knowledge.retrieval.maxResults` | integer |  | With `type: "ai-search"`. Passages per question. · 1–50 |
| `knowledge.retrieval.vectorStoreId` **(required)** | string |  | With `type: "openai-vector-store"`. The vector store id, e.g. `vs_…`. |
| `knowledge.retrieval.apiKey` | `{ env }` | `{"env":"OPENAI_API_KEY"}` | With `type: "openai-vector-store"`. An OpenAI API key that can read it. |
| `knowledge.retrieval.url` **(required)** | string |  | With `type: "http"`. Your endpoint. · URL |
| `knowledge.retrieval.token` | `{ env }` |  | With `type: "http"`. Sent as `Authorization: Bearer …`. |
| `knowledge.retrieval.module` **(required)** | string |  | With `type: "custom"`. The file, relative to helppuff.json, e.g. `./rag.ts`. |
| `knowledge.retrieval.secrets` | string[] |  | With `type: "custom"`. The environment variables your file reads: uploaded as Worker secrets at deploy. · ≤ 20 items |

## `security`

Rate limits, daily cap, Turnstile. The defaults are safe for a public site.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `security.captcha` | object |  | Check new chats (and dashboard sign-ins) with Cloudflare Turnstile (invisible for most visitors). Strongly recommended: without it, a script can start chats. |
| `security.captcha.provider` **(required)** | `"turnstile"` |  | Cloudflare Turnstile. |
| `security.captcha.siteKey` **(required)** | string |  | The Turnstile site key (public). · 1–200 chars |
| `security.captcha.secret` **(required)** | `{ env }` |  | The Turnstile secret key, by environment variable name. |
| `security.limits` | object | `{}` | Per-visitor and per-site limits. The daily cap is the cost backstop. |
| `security.signIn` | object | `{}` | Dashboard sign-in limits. |
| `security.signIn.attemptsPerIp` | integer | `10` | Sign-in attempts (and one-time link checks) one IP may make per window. · 1–1000 |
| `security.signIn.attemptsPerAccount` | integer | `5` | Failed sign-ins one email may have per window, from anywhere. Counts failures only. · 1–1000 |
| `security.signIn.windowMinutes` | integer | `15` | The window both sign-in limits count over, in minutes. · 1–1440 |
| `security.signIn.captcha` | boolean | `true` | Ask for Turnstile on the sign-in form when `security.captcha` is set. Add the dashboard's hostname to the Turnstile widget. |
| `security.allowIps` | string[] | `[]` | IP addresses or CIDR ranges exempt from the per-visitor limits (your office, a monitor). The per-chat and daily caps still apply. · ≤ 500 items |
| `security.blockIps` | string[] | `[]` | IP addresses or CIDR ranges refused by the chat. The dashboard is not affected. · ≤ 500 items |
| `security.sessionTtlHours` | number | `24` | How long a chat can be continued (the widget keeps it across pages and reloads). · 0.25–720 |

### `security.limits`

Per-visitor and per-site limits. The daily cap is the cost backstop.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `security.limits.messagesPerIpPerMinute` | integer | `10` | Messages one visitor (IP) may send a minute. · 1–600 |
| `security.limits.messagesPerIpPerDay` | integer | `100` | Messages one visitor (IP) may send a day (UTC), so one visitor cannot use up the daily cap. · 1–100000 |
| `security.limits.sessionsPerIpPerHour` | integer | `5` | New chats one visitor (IP) may start an hour. · 1–1000 |
| `security.limits.sessionsPerIpPerDay` | integer | `20` | New chats one visitor (IP) may start a day (UTC). · 1–10000 |
| `security.limits.messagesPerSession` | integer | `60` | Messages in one chat before the visitor must start another. · 1–1000 |
| `security.limits.messagesPerSitePerDay` | integer | `500` | The cost backstop. Always set this. · 1–1000000 |
| `security.limits.maxMessageLength` | integer | `1000` | The longest message a visitor may send, in characters. · 1–4000 |
| `security.limits.maxLeadFieldLength` | integer | `200` | The longest answer to one form field, in characters (a message box gets `maxLeadMessageLength`). · 20–2000 |
| `security.limits.maxLeadMessageLength` | integer | `2000` | The longest answer to a message box in a form, in characters. · 20–4000 |
| `security.limits.feedbackPerIpPerMinute` | integer | `30` | Thumbs up or down one visitor (IP) may give a minute. · 1–600 |
| `security.limits.pollsPerIpPerMinute` | integer | `120` | Checks for new messages one visitor (IP) may make a minute (backends that reply later, like Retell). · 1–600 |
| `security.limits.endsPerIpPerMinute` | integer | `10` | Chats one visitor (IP) may close a minute. · 1–600 |
| `security.limits.retellLookupsPerMinute` | integer | `120` | Knowledge-base lookups a Retell agent may make a minute, for the whole site. · 1–6000 |
| `security.limits.apiRequestsPerKeyPerMinute` | integer | `120` | Requests a new API key may make a minute (each key can have its own). Chat requests also count against the daily cap. · 1–6000 |
| `security.limits.apiKeysPerSite` | integer | `50` | Active API keys a site may have. · 1–500 |
| `security.limits.handoversPerIpPerDay` | integer | `3` | Times one visitor (IP) may ask for a person a day (live chat). · 1–1000 |
| `security.limits.waitingPerSite` | integer | `20` | Live chats that may wait for a person at once; past it, visitors get the callback form. · 1–1000 |
| `security.limits.liveSocketsPerIp` | integer | `3` | Live chat connections one visitor (IP) may hold open at once. · 1–100 |

## `leads`

Where leads go besides the dashboard.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `leads.webhook` | string \| `{ env }` |  | POST each lead to this URL (or to the URL in this environment variable). For every event, add webhooks in the dashboard instead. |

## `dashboard`

The dashboard at <worker>/admin: conversations, leads, knowledge, analytics and settings, stored in D1 on your account.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `dashboard.enabled` | boolean | `true` | Serve the dashboard at <worker>/admin. |
| `dashboard.adminEmail` | string |  | The owner's email, for backends without a setup link. workers-ai: set on the setup page instead. · email |
| `dashboard.summaryModel` | string |  | Workers AI model used for conversation summaries. |

## `cloudflare`

Written by `helppuff deploy`. Safe to commit; holds no secrets.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `cloudflare.accountId` | string |  | The Cloudflare account deployed to. |
| `cloudflare.workerName` | string |  | The Worker's name. Default: knowtific-helppuff-<site>. |
| `cloudflare.url` | string |  | Where the Worker answers. · URL |
| `cloudflare.kvNamespaceId` | string |  | The KV namespace (live config, new-conversation counters). |
| `cloudflare.d1DatabaseId` | string |  | The D1 database (conversations, leads, knowledge). |
| `cloudflare.vectorizeIndex` | string |  | The Vectorize index (knowledge vectors). |

## `widget`

Brand, launcher, home screen, lead form, flows — see `helppuff schema`.

### `widget.brand`

Names, colour and theme.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `widget.brand.name` | string | `"Chat"` | The business name in the widget. · 1–60 chars |
| `widget.brand.agentName` | string | `"Assistant"` | The assistant's name, in its header and messages. · 1–60 chars |
| `widget.brand.avatar` | string |  | The assistant's picture: a square image URL. · 1–2048 chars |
| `widget.brand.accent` | string | `"#5B5BF7"` | The main colour (hex). Text on it is made readable automatically. |
| `widget.brand.theme` | `"light"` \| `"dark"` \| `"auto"` | `"auto"` | `auto` follows the visitor's system setting. |
| `widget.brand.tokens` | map of string |  | Fine-grained styling: CSS custom properties without the `--hp-` prefix, e.g. `{ "radius-panel": "12px", "font": "Inter, sans-serif" }`. |

### `widget.launcher`

The button that opens the chat.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `widget.launcher.position` | `"bottom-right"` \| `"bottom-left"` | `"bottom-right"` | Which corner the button sits in. |
| `widget.launcher.offset` | object |  | Move the button away from the corner, e.g. above a cookie banner. |
| `widget.launcher.offset.x` **(required)** | number |  | Pixels from the side. · 0–200 |
| `widget.launcher.offset.y` **(required)** | number |  | Pixels from the bottom. · 0–200 |
| `widget.launcher.label` | string |  | Text beside the orb, or inside it when `shape` is `pill`. For example "Chat with us". · ≤ 40 chars |
| `widget.launcher.icon` | `"chat"` \| `"phone"` \| `"mail"` \| `"calendar"` \| `"quote"` \| `"pin"` \| `"clock"` \| `"wrench"` \| `"heart"` \| `"info"` \| `"book"` \| `"arrow-right"` \| `"arrow-left"` \| `"close"` \| `"send"` \| `"menu"` \| `"sound"` \| `"sound-off"` \| `"check"` \| `"external"` \| `"person"` | `"chat"` | Which of the built-in icons the launcher shows. |
| `widget.launcher.shape` | `"orb"` \| `"pill"` | `"orb"` | `orb` is the signature circle. `pill` widens it to sit the label inside the button, which reads as a clearer invitation on a busy page. |
| `widget.launcher.hideOnPaths` | string[] |  | Pages where the widget does not appear, e.g. `/checkout/**`. · ≤ 50 items |

### `widget.home`

The first screen visitors see.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `widget.home.title` | string | `"Hi there"` | The heading of the first screen. · ≤ 120 chars |
| `widget.home.subtitle` | string | `"Ask anything, or pick a shortcut."` | The line under it. · ≤ 240 chars |
| `widget.home.shortcuts` | object[] |  | Buttons on the first screen: suggested questions, a call button, a form… · ≤ 8 items |
| `widget.home.shortcuts[].id` **(required)** | string |  | Unique among the shortcuts. · 1–64 chars |
| `widget.home.shortcuts[].label` **(required)** | string |  | What the shortcut says. · 1–80 chars |
| `widget.home.shortcuts[].description` | string |  | A line under the label. · ≤ 160 chars |
| `widget.home.shortcuts[].icon` | `"chat"` \| `"phone"` \| `"mail"` \| `"calendar"` \| `"quote"` \| `"pin"` \| `"clock"` \| `"wrench"` \| `"heart"` \| `"info"` \| `"book"` \| `"arrow-right"` \| `"arrow-left"` \| `"close"` \| `"send"` \| `"menu"` \| `"sound"` \| `"sound-off"` \| `"check"` \| `"external"` \| `"person"` |  | A built-in icon. |
| `widget.home.shortcuts[].action` **(required)** | object |  | What happens when the button is pressed. `kind` picks it. |
| `widget.home.shortcuts[].action.kind` **(required)** | `"reply"` \| `"url"` \| `"tel"` \| `"email"` \| `"flow"` \| `"form"` |  | `"reply"` Send a message as the visitor. · `"url"` Open a page. · `"tel"` Call a number. · `"email"` Write an email. · `"flow"` Start one of `widget.flows`. · `"form"` Open one of `widget.forms`. |
| `widget.home.shortcuts[].action.id` **(required)** | string |  | An id, unique within its list. · 1–64 chars |
| `widget.home.shortcuts[].action.label` **(required)** | string |  | What the button says. · 1–120 chars |
| `widget.home.shortcuts[].action.value` **(required)** | string |  | With `kind: "reply"`. The message sent. · 1–500 chars |
| `widget.home.shortcuts[].action.url` **(required)** | string |  | With `kind: "url"`. The page to open. · 1–2048 chars |
| `widget.home.shortcuts[].action.newTab` | boolean |  | With `kind: "url"`. Open in a new tab. |
| `widget.home.shortcuts[].action.phone` **(required)** | string |  | With `kind: "tel"`. The number to call. · 1–40 chars |
| `widget.home.shortcuts[].action.email` **(required)** | string |  | With `kind: "email"`. The address to write to. · 3–200 chars |
| `widget.home.shortcuts[].action.flowId` **(required)** | string |  | With `kind: "flow"`. The flow's id. · 1–64 chars |
| `widget.home.shortcuts[].action.formId` **(required)** | string |  | With `kind: "form"`. The form's id. · 1–64 chars |
| `widget.home.shortcuts[].paths` | string[] |  | Show it only on these pages. · ≤ 20 items |
| `widget.home.links` | object |  | A list of useful pages on the first screen. |
| `widget.home.links.title` **(required)** | string |  | The list's heading. · ≤ 120 chars |
| `widget.home.links.items` **(required)** | object[] |  | The links. · 1–10 items |
| `widget.home.links.items[].label` **(required)** | string |  | The link text. · 1–160 chars |
| `widget.home.links.items[].url` **(required)** | string |  | Where it goes (https). · 1–2048 chars |
| `widget.home.links.items[].description` | string |  | A line under the link. · ≤ 300 chars |

### `widget.leadForm`

The short form before the chat.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `widget.leadForm.enabled` | boolean | `true` | Ask for details before the chat starts. |
| `widget.leadForm.title` | string |  | The form's heading. · ≤ 120 chars |
| `widget.leadForm.fields` | object[] | `[{"name":"name","label":"Name","type":"text","required":true,"autocomplete":"name"},{"name":"phone","label":"Phone","type":"tel","required":true,"autocomplete":"tel"}]` | The questions, in order. Add your own; each answer is kept on the lead and shown to the assistant. · 1–12 items |
| `widget.leadForm.fields[].name` **(required)** | string |  | The key the answer is stored under. `name`, `email`, `phone` and `message` mean something to the assistant (a `message` opens the chat). · 1–64 chars |
| `widget.leadForm.fields[].label` **(required)** | string |  | What the visitor sees. · 1–160 chars |
| `widget.leadForm.fields[].type` **(required)** | `"text"` \| `"email"` \| `"tel"` \| `"textarea"` \| `"select"` |  | The kind of input. `select` needs `options`. |
| `widget.leadForm.fields[].required` | boolean |  | Must be filled in. |
| `widget.leadForm.fields[].placeholder` | string |  | Hint text inside the empty field. · ≤ 160 chars |
| `widget.leadForm.fields[].options` | string[] |  | The choices of a `select`. · ≤ 50 items |
| `widget.leadForm.fields[].pattern` | string |  | A regular expression the answer must match. · ≤ 200 chars |
| `widget.leadForm.fields[].autocomplete` | string |  | The HTML autocomplete hint, e.g. `email`, `tel`. · ≤ 64 chars |
| `widget.leadForm.submitLabel` | string |  | The button's text. · ≤ 60 chars |
| `widget.leadForm.privacy` | object |  | A privacy note under the form. |
| `widget.leadForm.privacy.text` **(required)** | string |  | The notice, e.g. "We only use this to reply to you." · 1–300 chars |
| `widget.leadForm.privacy.url` **(required)** | string |  | Your privacy policy. · 1–2048 chars |
| `widget.leadForm.askFirstMessage` | boolean |  | Add a box for the visitor's first message to the form. A field named `message` does the same and can be labelled. |

### `widget.chat`

The conversation screen.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `widget.chat.placeholder` | string |  | Hint text in the message box. · ≤ 120 chars |
| `widget.chat.initialMessages` | string[] |  | The assistant's greeting, before the visitor writes. · ≤ 3 items |
| `widget.chat.shortcuts` | object[] |  | Buttons above the message box during the chat. · ≤ 8 items |
| `widget.chat.shortcuts[].id` **(required)** | string |  | Unique among the shortcuts. · 1–64 chars |
| `widget.chat.shortcuts[].label` **(required)** | string |  | What the shortcut says. · 1–80 chars |
| `widget.chat.shortcuts[].description` | string |  | A line under the label. · ≤ 160 chars |
| `widget.chat.shortcuts[].icon` | `"chat"` \| `"phone"` \| `"mail"` \| `"calendar"` \| `"quote"` \| `"pin"` \| `"clock"` \| `"wrench"` \| `"heart"` \| `"info"` \| `"book"` \| `"arrow-right"` \| `"arrow-left"` \| `"close"` \| `"send"` \| `"menu"` \| `"sound"` \| `"sound-off"` \| `"check"` \| `"external"` \| `"person"` |  | A built-in icon. |
| `widget.chat.shortcuts[].action` **(required)** | object |  | What happens when the button is pressed. `kind` picks it. |
| `widget.chat.shortcuts[].action.kind` **(required)** | `"reply"` \| `"url"` \| `"tel"` \| `"email"` \| `"flow"` \| `"form"` |  | `"reply"` Send a message as the visitor. · `"url"` Open a page. · `"tel"` Call a number. · `"email"` Write an email. · `"flow"` Start one of `widget.flows`. · `"form"` Open one of `widget.forms`. |
| `widget.chat.shortcuts[].action.id` **(required)** | string |  | An id, unique within its list. · 1–64 chars |
| `widget.chat.shortcuts[].action.label` **(required)** | string |  | What the button says. · 1–120 chars |
| `widget.chat.shortcuts[].action.value` **(required)** | string |  | With `kind: "reply"`. The message sent. · 1–500 chars |
| `widget.chat.shortcuts[].action.url` **(required)** | string |  | With `kind: "url"`. The page to open. · 1–2048 chars |
| `widget.chat.shortcuts[].action.newTab` | boolean |  | With `kind: "url"`. Open in a new tab. |
| `widget.chat.shortcuts[].action.phone` **(required)** | string |  | With `kind: "tel"`. The number to call. · 1–40 chars |
| `widget.chat.shortcuts[].action.email` **(required)** | string |  | With `kind: "email"`. The address to write to. · 3–200 chars |
| `widget.chat.shortcuts[].action.flowId` **(required)** | string |  | With `kind: "flow"`. The flow's id. · 1–64 chars |
| `widget.chat.shortcuts[].action.formId` **(required)** | string |  | With `kind: "form"`. The form's id. · 1–64 chars |
| `widget.chat.shortcuts[].paths` | string[] |  | Show it only on these pages. · ≤ 20 items |
| `widget.chat.fallbackContact` | object |  | How to reach a person when the assistant is unavailable (an outage, or the daily budget is spent). |
| `widget.chat.fallbackContact.phone` | string |  | Shown when the assistant cannot answer. · ≤ 40 chars |
| `widget.chat.fallbackContact.email` | string |  | Shown when the assistant cannot answer. · ≤ 200 chars |

### `widget.teaser`

A message that pops up beside the button to invite a chat.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `widget.teaser.text` **(required)** | string |  | The message, e.g. "Need a quote? Ask me." · 1–200 chars |
| `widget.teaser.delayMs` | integer |  | Time on the page. Omit to rely on `afterScroll` alone. · 2000–120000 |
| `widget.teaser.afterScroll` | integer |  | Percentage of the page scrolled, 1–100. Whichever trigger fires first shows the teaser; a visitor who reads rather than waits still sees it. · 1–100 |
| `widget.teaser.paths` | string[] |  | Show it only on these pages. · ≤ 50 items |
| `widget.teaser.oncePerSession` | boolean | `true` | Show it once per visit, not on every page. |

### `widget.flows`

Guided questions asked in the widget (no AI), sent as one message at the end. Type: object[].

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `widget.flows[].id` **(required)** | string |  | What a `flow` action or shortcut starts it by. · 1–64 chars |
| `widget.flows[].steps` **(required)** | object[] |  | Questions asked one at a time, in the widget, before anything is sent. · 1–10 items |
| `widget.flows[].steps[].field` **(required)** | string |  | The name the answer is kept under, for the template. · 1–64 chars |
| `widget.flows[].steps[].ask` **(required)** | string |  | The question, shown as the assistant's message. · 1–400 chars |
| `widget.flows[].steps[].input` **(required)** | `"text"` \| `"choice"` \| `"phone"` \| `"email"` |  | How the visitor answers. |
| `widget.flows[].steps[].choices` | string[] |  | The buttons of a `choice` step. · ≤ 12 items |
| `widget.flows[].steps[].required` | boolean |  | The step cannot be skipped. |
| `widget.flows[].submit` **(required)** | object |  | What happens with the answers: `message` sends them as one message, `job` saves them as a job. |
| `widget.flows[].submit.as` **(required)** | `"message"` \| `"job"` |  | `"message"` Sent as one visitor message. · `"job"` Saved as a job (the site's Jobs pipeline), with the answers as its fields; the visitor gets its number. |
| `widget.flows[].submit.template` **(required)** | string |  | The message, with `{{field}}` for each answer, e.g. "Quote for {{service}} in {{suburb}}". · 1–1000 chars |

### `widget.forms`

Inline forms by id, opened by a `form` action or shortcut. Submitting one sends its answers to the assistant. Type: map of object.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `widget.forms.<id>.title` | string |  | The form's heading. · ≤ 120 chars |
| `widget.forms.<id>.fields` **(required)** | object[] |  | The questions. · 1–12 items |
| `widget.forms.<id>.fields[].name` **(required)** | string |  | The key the answer is stored under. `name`, `email`, `phone` and `message` mean something to the assistant (a `message` opens the chat). · 1–64 chars |
| `widget.forms.<id>.fields[].label` **(required)** | string |  | What the visitor sees. · 1–160 chars |
| `widget.forms.<id>.fields[].type` **(required)** | `"text"` \| `"email"` \| `"tel"` \| `"textarea"` \| `"select"` |  | The kind of input. `select` needs `options`. |
| `widget.forms.<id>.fields[].required` | boolean |  | Must be filled in. |
| `widget.forms.<id>.fields[].placeholder` | string |  | Hint text inside the empty field. · ≤ 160 chars |
| `widget.forms.<id>.fields[].options` | string[] |  | The choices of a `select`. · ≤ 50 items |
| `widget.forms.<id>.fields[].pattern` | string |  | A regular expression the answer must match. · ≤ 200 chars |
| `widget.forms.<id>.fields[].autocomplete` | string |  | The HTML autocomplete hint, e.g. `email`, `tel`. · ≤ 64 chars |
| `widget.forms.<id>.submitLabel` | string |  | The button's text. · ≤ 60 chars |

### `widget.sound`

A soft sound when a reply arrives.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `widget.sound.enabled` **(required)** | boolean |  | Play it. |

### `widget.captcha`

Set by `security.captcha`; you do not need to set it here.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `widget.captcha.provider` **(required)** | `"turnstile"` |  | Cloudflare Turnstile. |
| `widget.captcha.siteKey` **(required)** | string |  | The Turnstile site key. · 1–200 chars |

### `widget.poweredBy`

The footer credit: `true`, `false`, or `{ text, url }` for your own. Type: boolean \| object, default `true`.

### `widget.strings`

UI string overrides. Keys are validated by the widget, not here. Type: map of string.
