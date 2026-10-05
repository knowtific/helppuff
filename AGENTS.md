# AGENTS.md

Orientation for coding agents working **on** Murmur. Read this instead of
re-exploring the repo; open the linked files only for the part you are
changing. Keep this file current when you move or add something structural.

## What this is

Murmur: an open-source AI chat widget for websites, plus a Cloudflare Worker
that translates one small REST protocol to AI backends via **connectors**.
Published to npm as the CLI **`@knowtific/murmur`**, which sets up and deploys
widget + Worker + knowledge base + CRM dashboard to the user's own Cloudflare
account. Product direction: agent-native CLI (`--json`, `needs_input`, MCP),
Cloudflare-first defaults, ask as few questions as possible.

- User docs: the GitHub wiki, whose source is [wiki/](wiki/) (published by
  `.github/workflows/wiki.yml`). `wiki/CLI-Reference.md` and
  `wiki/Configuration-Reference.md` are **generated** by `pnpm sync:plugin`
  from `cli/src/help.ts` and the schemas' `.describe()` text: edit those, not
  the pages. A test fails when they are stale.

## Monorepo map (pnpm workspaces, TS strict, ESM)

| Path | Package | Role |
| --- | --- | --- |
| `packages/protocol` | `@murmur/protocol` | Zod schemas + types for the wire contract. **Single source of truth** — never redeclare message types elsewhere. `messages.ts`, `actions.ts`, `api.ts`, `config.ts` (public widget config), `sse.ts` |
| `packages/server` | `@murmur/server` | Hono app on Workers. `src/index.ts` (entry, bundles `murmur.config.ts`) → `app.ts` (`createApp`) → `routes/` + `admin/`. `src/lib.ts` is the public entry the CLI bundles |
| `packages/server/src/core` | | `registry.ts` (explicit connector/sink registration), `token.ts` (HMAC session tokens), `origin.ts` (CORS allowlist), `ratelimit.ts`, `turnstile.ts`, `stream.ts` (SSE), `sanitize.ts`, `run.ts`, `request.ts` (per-request ctx, the only allowed `console`), `errors.ts` (`MurmurError` → JSON envelope) |
| `packages/server/src/config` | | `schema.ts` (server config), `load.ts` (`defineConfig`, secret refs), `site.ts` (KV `config:<siteId>` overrides) |
| `packages/server/src/admin` | | Dashboard API under `/admin/api/*`: `guard.ts` (cookie session or `Bearer ADMIN_API_KEY`), `auth.ts`, `record.ts` (conversations, leads keyed by email, ratings), `routes.ts`, `knowledge.ts` (pages, files, facts, search), `settings.ts` (the flat settings object ↔ site config), `setup.ts` (one-time setup/sign-in links), `prompts.ts`, `webhooks.ts`, `version.ts` (running vs latest release) |
| `packages/server/src/webhooks` | | `deliver.ts` (signed delivery, retry, delivery log, `emit`/`emitTo`), `events.ts` (conversation → events). Endpoints live in D1 `webhooks`, managed by `admin/webhooks.ts`; event names and envelope in `protocol/src/webhooks.ts` |
| `packages/server/src/conversations` | | `summary.ts` (AI summary + labels, shared by the dashboard button and the job), `complete.ts` (`runConversationJob`: sleeps until 5 min after the last message, then summarises and sends `conversation.completed`) |
| `packages/server/src/db` | | `migrations.ts` (numbered, append-only D1 schema; applied by deploy and per isolate), `d1.ts` (binding helpers) |
| `packages/server/src/knowledge`, `src/workflows/crawl.ts` | | Crawl control (`startCrawl`, cron re-crawls) and the `CrawlWorkflow` class: the Worker's one background-job runner (crawl parts, files, conversation ends, webhook retries — dispatched on `payload.kind`). Only `index.ts`/`runtime.ts` import it (`cloudflare:workers`). New background work becomes a new `kind` with a step function testable on a fake `StepLike`, not a new Workflow |
| `packages/rag` | `@murmur/rag` | The knowledge base, Workers-free logic: `discover`, `robots`, `sitemap`, `categorise`, `extract` (HTML→Markdown + facts), `boilerplate`, `chunk` (`chunkPage`), `ai` (embed/rerank), `store` (D1 + Vectorize), `retrieve` (hybrid + RRF + rerank), `crawl` (`runCrawlPart` on a `StepLike`), `files` (uploads: read → distill → learn, `runFileJob`), `pricing` (neurons) |
| `packages/connectors/_types` | `@murmur/connector-types` | `Connector` interface + `defineConnector`, helpers, rich messages, prompt, history, shared `ai-search.ts` |
| `packages/connectors/*` | `@murmur/connector-<name>` | `workers-ai` (default: Workers AI + `@murmur/rag`, tools, budget), `echo` (dev/test, no key), `cloudflare` (AI Search), `openai`, `gemini`, `anthropic` (via AI Search), `http` (own API), `retell` |
| `packages/sinks/*` | `@murmur/sink-*` | Lead destinations (`webhook`) |
| `packages/widget` | `@murmur/widget` | Preact widget in a shadow root. `src/loader.ts` (tiny loader, no Preact, owns fail-safe) → lazy `src/app/` (store, api, persist, strings, validate) + `components/` + `flows/` + `lib/` (markdown, safe, turnstile…) + `styles/` (CSS in TS template literals). `demo/` = playground, gallery, hostile-host fixtures |
| `packages/dashboard` | `@murmur/dashboard` | React + Tailwind v4 dashboard served at `/admin/`: Home (test chat), Conversations, Leads, Knowledge, Analytics, Settings (sub-pages, incl. Webhooks and Updates). Look: shadcn / Notion / Twenty, minimal |
| `packages/cli` | `@knowtific/murmur` | The published CLI. `src/cli.ts` (command table), `commands/` (incl. `upgrade.ts`, `webhooks.ts`), `engine/` (init, deploy, compile, admin-api, knowledge, cloudflare, wrangler, doctor, `version.ts`, `reference.ts` (wiki config page)…), `mcp.ts`, `skill.ts`, `help.ts` (help text for agents; `AGENTS.md` and the wiki's CLI page are generated from it by `pnpm sync:plugin`) |
| `plugin/`, `.claude-plugin/` | | Claude Code plugin; `plugin/skills/website-chatbot/SKILL.md` is **generated** by `pnpm sync:plugin` — edit `packages/cli/src/skill.ts` instead |
| `e2e/` | | Playwright suites against real Worker + widget |
| `wiki/` | | The user docs, published to the GitHub wiki |
| `scripts/` | | `ensure-config.mjs` (creates `murmur.config.ts` for `pnpm dev`) |
| `private/` | | Gitignored maintainers' notes. Never reference it from published files |

### Request flow

Widget → `POST /v1/sites/:siteId/sessions` (returns signed `sessionToken`) →
`POST /v1/sessions/messages` (Bearer token; JSON or SSE stream) /
`GET /v1/sessions/messages` (poll) / `POST /v1/sessions/feedback` (ratings) /
`POST /v1/sessions/end`.
`GET /v1/sites/:siteId/config` serves public widget config. `/healthz`.
Static widget files (`loader.js`, `app-*.js`) are served by the same Worker as
assets. **Sessions are stateless**: no session store; connector state rides in
the HMAC token. KV = prompt/config overrides, the sessions-per-IP counter
(and, without D1, the message counters and chat history). The per-IP message
limit is the `MURMUR_IP_LIMITER` Rate Limiting binding; the per-session and
daily caps and stateless backends' history are read from D1's record of each
turn (`core/ratelimit.ts`, `conversations/history.ts`). D1 = the dashboard and the knowledge base's text (pages, chunks +
FTS5, facts, crawl runs, daily usage). Vectorize = chunk vectors. The crawl is
a Workflow chained in batches of 15 pages (Workers Free subrequest limits);
see `wiki/Knowledge-Base.md`.

### Two config worlds

- **Repo dev**: `murmur.config.ts` (gitignored; auto-created from
  `murmur.config.demo.ts` by `pnpm ensure-config`) is compiled into the Worker
  `pnpm dev` runs. Only for working on Murmur itself.
- **CLI users**: `murmur.json` + `prompt.md` in their project
  (`packages/cli/src/engine/project.ts`), compiled into `.murmur/`. Every
  Cloudflare resource it creates is named `knowtific-murmur-<site>`.

### Where the system prompt lives (CLI projects)

`prompt.md` → `murmur deploy` inlines it into the connector's prompt option
(`instructions`, Gemini `systemInstruction`; each connector declares it via
`promptOption()`) in KV `config:<site>`, plus a `prompt` meta block
(version/hash/by/source). The dashboard's Prompt page edits the same option.
Every publish is a version: history in D1 `prompt_versions`
(`server/src/admin/prompts.ts`, shared SQL + hash). The CLI side is
`cli/src/engine/prompt.ts`: `.murmur/state.json` records the version prompt.md
is based on; deploy refuses `behind`/`diverged` and says to run
`murmur prompt pull` (which keeps unpublished edits as `prompt.mine.md`).
Retell, OpenAI `promptId` and `http` in `murmur` mode own their prompt and
are not versioned.

Secrets are always referenced by env var name (`{ env: 'X' }`), never written
into config. Repo dev: `packages/server/.dev.vars` (gitignored, copy from
`.dev.vars.example`). CLI projects: `.env` and `murmur secret set`.

### Versions and upgrades

The CLI's `package.json` version is stamped into every Worker it deploys
(`MURMUR_VERSION`, reported by `/healthz` and `/admin/api/version`).
`murmur upgrade` compares, shows pending D1 migrations and murmur.json format
changes, notes a D1 Time Travel restore point, then deploys; `deploy` refuses
to go backwards without `--allow-downgrade`. Rules that keep this safe: D1
migrations are additive only (expand, then contract in a later major);
readers of KV config accept older shapes; murmur.json format changes bump
`PROJECT_FORMAT` with a step in `PROJECT_UPGRADES`. See `wiki/Upgrading.md`.

## Commands

```bash
pnpm install
pnpm dev            # Worker :8787 + widget vite :5173 (echo connector)
pnpm test           # vitest: *.test.ts → node, *.test.tsx → happy-dom
pnpm vitest run packages/server/test/stream.test.ts   # single file
pnpm typecheck      # every package
pnpm lint           # eslint, type-aware
pnpm build          # widget bundles + size budgets (fails if over)
pnpm build:cli      # CLI bundle: widget + dashboard + server runtime
pnpm e2e            # playwright (needs `npx playwright install chromium` once)
pnpm check          # lint + typecheck + test + build + e2e (what CI runs)
```

- If `pnpm dev` is already running on :8787, **don't kill it**; Playwright
  reuses it locally.
- Never name a root script `deploy` or `setup`: pnpm built-ins shadow them.
- `echo` connector answers `/options`, `/multi`, `/card`, `/carousel`,
  `/links`, `/form`, `/notice`, `/slow`, `/long`, `/multipart`, `/error` —
  use it to exercise widget features without keys.

## Rules (also enforced by eslint)

- No `any` in protocol/connector interfaces; no floating promises;
  `import { type X }` inline type imports; unused vars prefixed `_`.
- No `console` in shipped code. Server logs through injected `ctx.log` /
  `platform.log` — never log lead data or message text.
- Widget runtime deps: **`preact` only**. Server: `hono`, `zod` (+ connector
  SDKs already present). Ask before adding runtime deps.
- `dangerouslySetInnerHTML` only in the markdown renderer
  (`widget/src/lib/markdown.ts`), which has XSS tests.
- **Fail-safe outranks everything** in the widget: every path ends in a
  working widget or a silent `hide()`, never an exception on the host page.
  Prefer a missing feature (apply the default) over throwing. Empty `catch` is
  intentional there.
- **The visitor waits for no write.** On the chat path every KV/D1 write goes
  through `waitUntil` (recording, usage, history, counters, webhooks); only
  reads are awaited, started early and together. A test in
  `server/test/admin.test.ts` makes every write hang and expects replies.
- Server errors always leave via `app.onError` as the JSON envelope — throw
  `MurmurError`, never return HTML.
- Accessibility wins over visual design.
- Bundle guards: `loader.js` ≤ 8 kb gz, app ≤ 35 kb gz. Don't import Preact or
  Zod into the loader.
- For provider APIs (Retell, OpenAI, Gemini, Cloudflare, Anthropic,
  Turnstile), check the current docs; don't invent endpoints or fields.
  `wiki/Providers.md` has the verified references.
- Update `wiki/` when something user-visible changes. Describe every
  `murmur.json` field with `.describe()` in its schema; `pnpm sync:plugin`
  regenerates the reference pages.

## Recipes

- **Knowledge base change**: pure logic in `packages/rag` (tests run against
  real SQLite with the production migrations, fake AI/Vectorize in
  `rag/test/helpers.ts`); a new D1 table or column is a new entry at the end of
  `server/src/db/migrations.ts`, never an edit.
- **New connector**: create `packages/connectors/<name>` (copy `echo`'s
  shape: `package.json`, `tsconfig.json`, `src/index.ts` exporting
  `defineConnector({...})`, `test/`), register it in
  `packages/server/src/core/registry.ts`, add the dep to
  `packages/server/package.json`, then wire the CLI backend in
  `packages/cli/src/engine/project.ts` (`backendSchema`) + `providers.ts` /
  `compile.ts`, and document it in `wiki/Providers.md`. Streaming: implement
  `streams()` and call `ctx.onText`.
- **New message/action type**: add to `packages/protocol/src/messages.ts` or
  `actions.ts` first, then server sanitizing (`core/sanitize.ts`), widget
  validator (`widget/src/app/validate.ts` is hand-rolled and cross-checked
  against Zod in tests) and a component in `widget/src/components/messages/`.
- **Widget copy**: `widget/src/app/strings.ts`. Styles:
  `widget/src/styles/`.
- **Dashboard API change**: `server/src/admin/routes.ts` (or a sibling module
  mounted there), schema in `server/src/db/migrations.ts`, client in
  `dashboard/src/lib/api.ts`, test in `server/test/admin.test.ts`.
- **New webhook event**: add it to `WEBHOOK_EVENTS` in
  `protocol/src/webhooks.ts`, emit it with `emit()` (`server/src/webhooks/`),
  document it in `wiki/Webhooks.md`.
- **CLI command**: add to `COMMANDS` in `packages/cli/src/cli.ts`, help in
  `help.ts`; must work with `--json` and non-interactively (missing answers →
  `needs_input`). Anything the dashboard does goes through the admin API
  (`engine/admin-api.ts`), never around it. If the skill or help text changes,
  run `pnpm sync:plugin` (regenerates the plugin SKILL.md, `packages/cli/AGENTS.md`
  and the wiki's reference pages).

## Tests live next to each package

`packages/*/test/` (vitest; server tests use `test/helpers.ts` →
`testConfig()`, `memoryKv`), `e2e/*.spec.ts` (Playwright; the widget is inside
the `murmur-widget` shadow root — see `e2e/helpers.ts`; lead-form fills are
driven by what renders, not a fixed field list).
