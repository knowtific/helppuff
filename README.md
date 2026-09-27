# Murmur

An open-source, serverless AI chat widget for websites.

The widget speaks one small REST protocol. A thin server on Cloudflare Workers
translates that protocol to any AI backend through **connectors**. No session
store, free to run on the Workers free tier.

## Set one up in two minutes

```bash
npx @knowtific/murmur init
```

Give it your website and pick a backend. It works out the name, brand colour,
contact details and key pages from the site. It then deploys the widget, the
server, the knowledge base and a leads dashboard to **your own Cloudflare
account**, and prints the embed snippet. The default backend, Cloudflare AI
Search, needs nothing but a Cloudflare login.

Or ask your coding agent. With the Claude Code plugin (or `npx -y
@knowtific/murmur skill install`), "add an AI chatbot to my website" is
enough: it sets up, deploys, tests and embeds the assistant itself, and asks
you only for what it cannot know.

It is built to be driven by AI agents as well as people: `murmur --help` is
written for them, every command speaks `--json`, missing answers come back as
a `needs_input` list of questions, and `murmur mcp` serves the same engine as
MCP tools. See **[docs/cli.md](docs/cli.md)**.

| Backend | Knowledge | Needs |
| --- | --- | --- |
| Cloudflare AI Search *(default)* | your site and files, or an existing AI Search instance | a Cloudflare login |
| OpenAI | vector store + file search | `OPENAI_API_KEY` |
| Gemini | File Search | `GEMINI_API_KEY` |
| Anthropic Claude | via Cloudflare AI Search | `ANTHROPIC_API_KEY` |
| Your own API | yours: Murmur protocol or OpenAI-compatible, JSON or streaming | a URL |
| Retell | yours, in Retell | `RETELL_API_KEY` |

Every deploy includes a CRM dashboard at `/admin`: conversations with
transcripts, a leads pipeline, analytics and AI summaries, stored in D1 on
your account.

The rest of this README is about working **on** Murmur itself.

---

> **Status: milestones 1 to 4 done, plus M7 (agent-native setup).** The protocol, the reference server, the
> widget core, the full rich-interaction layer (option chips, cards,
> carousels, link lists, inline forms, shortcuts and client-side flows), the
> security layer (origin allowlist, signed tokens, rate limits, Turnstile,
> lead sinks) and the Retell, OpenAI and Gemini connectors are built, tested
> and green in CI.
>
> The connectors are written against each provider's documented wire shapes
> and the tests assert those shapes, but they have not yet been run against
> the live APIs — that needs keys. Still to come: `scripts/setup.sh`, M5
> polish and M6 open-source readiness. See
> [`murmur-build-plan.md`](murmur-build-plan.md) for the full plan, and
> [`docs/security.md`](docs/security.md) for the current threat model.

---

## Try it

```bash
pnpm install
pnpm dev          # Worker on :8787 and the widget dev server on :5173
```

Then open:

| URL | What it is |
| --- | --- |
| http://localhost:5173 | **Live playground** — the real widget on a real page, with buttons for every `window.Murmur` call, an event log, and one-click fail-safe checks |
| http://localhost:5173/gallery.html | **Component gallery** — every surface (launcher, home, lead form, thread, markdown, notices, composer states, error states, icons, mobile) rendered with the real components, with a live theme and accent picker |
| http://localhost:5173/fixtures/ | **Hostile host pages** — aggressive CSS, prototype patching, double include, SPA routing |

Each specimen in the gallery renders inside its own shadow root with the
shipped stylesheet, so what you see is exactly what a visitor gets.

### Talking to it directly

```bash
# Start a session
curl -s localhost:8787/v1/sites/demo/sessions \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"lead":{"name":"Ada","phone":"0400 000 000"},
       "context":{"pageUrl":"http://localhost:5173/"},
       "firstMessage":"/card"}'

# Send a message with the sessionToken it returned
curl -s localhost:8787/v1/sessions/messages \
  -H 'Origin: http://localhost:5173' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"text","text":"hello","clientId":"c1"}'
```

The `echo` connector answers `/options`, `/multi`, `/card`, `/carousel`,
`/links`, `/form`, `/notice`, `/slow`, `/long`, `/multipart` and `/error` — one
for every widget feature, with no paid backend and no API key.

---

## How it fits together

```
Widget (browser)  ──── Murmur protocol ────▶  Server (CF Worker)
                                               ├── connectors/echo
                                               ├── connectors/retell
                                               ├── connectors/openai
                                               ├── connectors/gemini
                                               └── connectors/http        (M6)
```

Both halves are the **same Worker**: Cloudflare serves `/loader.js` and the
app chunk as static assets straight from the edge, and everything else falls
through to the API. One deployment, one hostname, one thing to keep in step —
see [`docs/deployment.md`](docs/deployment.md) if you want them split.

Three separable pieces:

| Package | What it is |
| --- | --- |
| [`@murmur/protocol`](packages/protocol) | Types and Zod schemas. The public contract, and the single source of truth. |
| [`@murmur/server`](packages/server) | Reference server: routes, origin allowlist, signed session tokens, connector registry. |
| [`@murmur/connector-types`](packages/connectors/_types) | The `Connector` interface and shared helpers. |
| [`@murmur/connector-echo`](packages/connectors/echo) | A deterministic connector for development and tests. |
| [`@murmur/connector-retell`](packages/connectors/retell) | Retell chat agents. |
| [`@murmur/connector-openai`](packages/connectors/openai) | OpenAI Responses API, or any compatible endpoint. |
| [`@murmur/connector-gemini`](packages/connectors/gemini) | Gemini + File Search, for RAG. |
| [`@murmur/sink-webhook`](packages/sinks/webhook) | Forwards leads to any URL. |

**Sessions are stateless.** The server stores nothing. On session start it
returns an HMAC-signed token carrying the site id, session id and a small opaque
connector state. That is what makes it free and zero-maintenance: a conversation
needs no database.

---

## Configuration

One file, `murmur.config.ts`, typed and validated when the Worker is built.

**It is gitignored.** The committed files are
[`murmur.config.demo.ts`](murmur.config.demo.ts), which a fresh clone is
started from automatically, and
[`murmur.config.example.ts`](murmur.config.example.ts), which documents a
production site. Your origins, agent ids and copy never enter the repository,
which matters once this is published.

Secrets are never written in it either — they are referenced by environment
variable name and set with `wrangler secret put`.

```ts
export default defineConfig({
  sites: {
    demo: {
      origins: ['https://example.com'],
      connector: { type: 'echo' },
      security: { limits: { messagesPerSitePerDay: 500 } },
      widget: { brand: { name: 'Murmur', accent: '#5B5BF7' } },
    },
  },
});
```

See [`murmur.config.example.ts`](murmur.config.example.ts) for a production site
with Retell, a lead webhook, Turnstile and a multi-step quote flow.

### Changing config without a deploy

The file above is compiled into the Worker, so editing it is a deploy. For
anything that changes more often than that, store it in KV instead:

```bash
wrangler kv key put --binding=MURMUR_KV "config:knowtific" --path ./site.json
```

A `config:<siteId>` key overrides the deployed config for that site on the
next request — brand, copy, shortcuts, flows, limits, lead destinations and
connector options, including which connector. Whole sections replace their
deployed counterpart; anything left out keeps its deployed value. A stored
config that will not parse is ignored and the site keeps running on what
shipped.

Two things stay in the deploy on purpose: **`origins`**, because the CORS
allowlist is built once at startup and write access to KV should not widen
who may embed your widget, and **adding a new site**, because that is where
its origins come from. [`docs/deployment.md`](docs/deployment.md) has the
details.

---

## Connecting a real backend

### Where the keys go

There are exactly two places, and neither is a file you commit:

```bash
# Local — packages/server/.dev.vars, which is gitignored.
cp packages/server/.dev.vars.example packages/server/.dev.vars

# Production — a Worker secret, never on disk.
wrangler secret put GEMINI_API_KEY
```

[`.dev.vars.example`](packages/server/.dev.vars.example) lists every name the
project knows about. The config refers to each **by name**, so the same
`murmur.config.ts` is safe to publish:

```ts
connector: { type: 'gemini', options: { apiKey: { env: 'GEMINI_API_KEY' } } }
```

| Variable | Needed for | Where to get it |
| --- | --- | --- |
| `MURMUR_SECRET` | Always — it signs session tokens | `openssl rand -base64 32` |
| `GEMINI_API_KEY` | `gemini` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `OPENAI_API_KEY` | `openai` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `RETELL_API_KEY` | `retell` | [dashboard.retellai.com](https://dashboard.retellai.com) |
| `TURNSTILE_SECRET` | Bot protection | Cloudflare dashboard — the *secret*, not the site key |
| `LEAD_WEBHOOK_URL` / `_SECRET` | Forwarding leads | Your CRM or automation tool |

A name is only a convention: an OpenAI-compatible provider like DeepSeek
reuses the `openai` connector with its own `baseUrl`, so call its key
whatever you reference in the config.

### Setting up Gemini with File Search

File Search is Google's hosted RAG — you upload documents once, Google chunks
and embeds them, and the connector queries them on every message. Nothing
about your knowledge base lives in this repository.

**1. Create a store.** Once, outside the app:

```bash
export GEMINI_API_KEY=AIza...

curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/fileSearchStores" \
  -H "x-goog-api-key: $GEMINI_API_KEY" -H 'Content-Type: application/json' \
  -d '{"displayName":"knowtific-kb","embeddingModel":"models/gemini-embedding-2"}'
```

The response carries a `name` like `fileSearchStores/knowtific-kb-a1b2c3`.

**2. Upload your documents** to that store — pricing sheets, FAQs, service
areas, whatever the assistant should be able to answer from:

```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/upload/v1beta/fileSearchStores/knowtific-kb-a1b2c3:uploadToFileSearchStore" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H 'X-Goog-Upload-Protocol: resumable' -H 'X-Goog-Upload-Command: start' \
  -H 'Content-Type: application/json' \
  -d '{"displayName":"pricing-2026.pdf"}'
```

Name files the way you would want them cited — `displayName` is what a
visitor sees under an answer. Embeddings persist; the raw files are deleted
after 48 hours, and retrieval keeps working.

**3. Point the connector at the store**, in `murmur.config.ts`:

```ts
connector: {
  type: 'gemini',
  options: {
    apiKey: { env: 'GEMINI_API_KEY' },
    model: 'gemini-3-flash',
    fileSearchStores: ['fileSearchStores/knowtific-kb-a1b2c3'],
    systemInstruction: { kv: 'prompt:knowtific' },
  },
},
```

**4. Set the prompt.** Gemini has no stored-prompt object, so `{ kv }` keeps
it out of git and editable without a deploy:

```bash
wrangler kv key put --binding=MURMUR_KV "prompt:knowtific" --path ./prompt.txt
```

Full options, citation behaviour and the trade behind `store: true` are in
[`packages/connectors/gemini/README.md`](packages/connectors/gemini/README.md).

### The other two, briefly

```ts
// Retell — the prompt is the agent, edited in Retell's dashboard.
connector: { type: 'retell', options: { apiKey: { env: 'RETELL_API_KEY' }, agentId: 'agent_xxx' } }

// OpenAI — a stored, versioned prompt referenced by id.
connector: {
  type: 'openai',
  options: {
    apiKey: { env: 'OPENAI_API_KEY' },
    model: 'gpt-5',
    promptRef: { id: 'pmpt_abc123', version: '4' },
  },
}
```

Whichever you pick, [`docs/prompts.md`](docs/prompts.md) covers where the
prompt itself belongs — the short version is *as far from this repository as
the provider allows*.

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm bootstrap` | First deployment: KV namespace, first deploy, then secrets |
| `pnpm dev` | Worker + widget dev server, with the `echo` connector |
| `pnpm prod:preview` | A page that loads the **deployed** Worker, to check a release |
| `pnpm lint` | ESLint, type-aware |
| `pnpm test` | Unit and functional tests (Vitest) |
| `pnpm e2e` | UI, isolation and fail-safe tests (Playwright) |
| `pnpm build` | Build the widget bundles and check the size budgets |
| `pnpm typecheck` | Typecheck every package |
| `pnpm check` | All of the above |
| `pnpm deploy:worker` | Deploy the Worker |

> **Script names avoid pnpm's own commands.** `pnpm deploy` and `pnpm setup`
> are built into pnpm and shadow a script of the same name — `deploy` fails
> with `ERR_PNPM_NOTHING_TO_DEPLOY`, and `setup` is worse, reporting success
> while configuring pnpm's home directory instead. Hence `deploy:worker` and
> `bootstrap`. Check any new script name against `pnpm help -a`, and note
> that `setup` is not even listed there.

Local development needs `packages/server/.dev.vars` — copy
`.dev.vars.example` and keep the default secret, which is for local use only.
`pnpm e2e` needs a browser once: `npx playwright install chromium`.

## Testing

| Layer | Tool | What it covers |
| --- | --- | --- |
| Protocol | Vitest | Every message and action type, valid and invalid |
| Widget store | Vitest | Every state transition, persistence, expiry, restore |
| Markdown | Vitest | The supported subset, plus ~25 XSS fixtures |
| Validation | Vitest | The widget's hand-rolled validator cross-checked against the Zod schemas |
| Server | Vitest | Origin rejection, token tamper/expiry, limits, sanitizing, error envelopes |
| Components | Vitest + happy-dom | Each component's rendering, states and accessibility wiring |
| App flows | Vitest + happy-dom | Home → form → chat → send → reply → reload, error recovery, the error boundary |
| UI | Playwright | The whole stack in a browser, desktop and mobile |
| Isolation | Playwright | Hostile host pages; the widget and the page must both be unaffected |
| Fail-safe | Playwright | Every fatal condition in §8.3, forced individually |
| Budgets | Playwright | Bundle sizes against §11's limits |
| Demo pages | Playwright | The playground, gallery and fixtures load with no 404s or errors |

All of it runs on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

### Bundle sizes

| Bundle | gzipped | Guard |
| --- | --- | --- |
| `loader.js` | 6.1 kb | 8.0 kb |
| `app-*.js` | 29.4 kb | 35.0 kb |

The plan sets the loader at 4 kb. Holding that line started costing real
things — first the orb's gradient and runtime contrast correction for the
accent, then which icons a site could put on its launcher — so the guard was
moved instead.

A kilobyte gzipped is about 20ms on Chrome's Slow 3G throttle and under a
millisecond on broadband, on a script that loads `async` and sits off the
critical path: it cannot affect LCP, and being `position: fixed` it cannot
affect CLS either (there is a test asserting CLS < 0.01). The TLS handshake
that fetches the loader costs an order of magnitude more than its whole body.

The guards exist to catch the mistakes that do matter — pulling Preact into
the loader, or Zod, or reaching the app's module graph by accident. The app's
35 kb is the number that tracks real payload.

---

## Docs

- [`docs/cli.md`](docs/cli.md) — `npx @knowtific/murmur`: setup, backends, the
  dashboard, and the contract for driving it from an AI agent.
- [`docs/protocol.md`](docs/protocol.md) — the full wire contract, and what it
  takes to implement your own server.
- [`docs/connectors.md`](docs/connectors.md) — the connector interface, and
  verified API references for Retell, OpenAI, Gemini, Cloudflare AI Search,
  Anthropic and the `http` connector.
- [`docs/prompts.md`](docs/prompts.md) — where system prompts and content
  belong, and how to keep them out of this repository.
- [`docs/security.md`](docs/security.md) — the threat model, what each layer
  actually buys, and the holes that are still open.
- [`docs/deployment.md`](docs/deployment.md) — one Worker or two, caching,
  secrets, KV, and the checklist before a real site.

---

## Licence

MIT.
