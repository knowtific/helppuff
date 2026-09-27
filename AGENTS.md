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

- Full design spec: [murmur-build-plan.md](murmur-build-plan.md). Code comments
  cite it as `§N` (e.g. `§8.3` = widget fail-safe, `§11` = size budgets).
  §13 is the rulebook for agents; its rules are summarised below.
- User-facing docs: [docs/](docs/) — `cli.md`, `protocol.md`, `connectors.md`,
  `security.md`, `deployment.md`, `prompts.md`.

## Monorepo map (pnpm workspaces, TS strict, ESM)

| Path | Package | Role |
| --- | --- | --- |
| `packages/protocol` | `@murmur/protocol` | Zod schemas + types for the wire contract. **Single source of truth** — never redeclare message types elsewhere. `messages.ts`, `actions.ts`, `api.ts`, `config.ts` (public widget config), `sse.ts` |
| `packages/server` | `@murmur/server` | Hono app on Workers. `src/index.ts` (entry, bundles `murmur.config.ts`) → `app.ts` (`createApp`) → `routes/` + `admin/`. `src/lib.ts` is the public entry the CLI bundles |
| `packages/server/src/core` | | `registry.ts` (explicit connector/sink registration), `token.ts` (HMAC session tokens), `origin.ts` (CORS allowlist), `ratelimit.ts`, `turnstile.ts`, `stream.ts` (SSE), `sanitize.ts`, `run.ts`, `request.ts` (per-request ctx, the only allowed `console`), `errors.ts` (`MurmurError` → JSON envelope) |
| `packages/server/src/config` | | `schema.ts` (server config), `load.ts` (`defineConfig`, secret refs), `site.ts` (KV `config:<siteId>` overrides) |
| `packages/server/src/admin` | | Dashboard API under `/admin/api/*`: `auth.ts` (cookie sessions, password hash), `db.ts` (D1 schema), `record.ts` (conversation/lead recording), `routes.ts` |
| `packages/connectors/_types` | `@murmur/connector-types` | `Connector` interface + `defineConnector`, helpers, rich messages, prompt, history, shared `ai-search.ts` |
| `packages/connectors/*` | `@murmur/connector-<name>` | `echo` (dev/test, no key), `cloudflare` (AI Search, default), `openai`, `gemini`, `anthropic` (via AI Search), `http` (own API), `retell` |
| `packages/sinks/*` | `@murmur/sink-*` | Lead destinations (`webhook`) |
| `packages/widget` | `@murmur/widget` | Preact widget in a shadow root. `src/loader.ts` (tiny loader, no Preact, owns fail-safe) → lazy `src/app/` (store, api, persist, strings, validate) + `components/` + `flows/` + `lib/` (markdown, safe, turnstile…) + `styles/` (CSS in TS template literals). `demo/` = playground, gallery, hostile-host fixtures |
| `packages/dashboard` | `@murmur/dashboard` | React + Tailwind v4 CRM served at `/admin/` (Overview, Conversations, Leads, Settings). Look: shadcn / Notion / Twenty, minimal |
| `packages/cli` | `@knowtific/murmur` | The published CLI. `src/cli.ts` (command table), `commands/`, `engine/` (init, deploy, compile, knowledge, cloudflare, wrangler, doctor…), `mcp.ts`, `skill.ts`, `help.ts` (help text written for agents) |
| `plugin/`, `.claude-plugin/` | | Claude Code plugin; `plugin/skills/website-chatbot/SKILL.md` is **generated** by `pnpm sync:plugin` — edit `packages/cli/src/skill.ts` instead |
| `e2e/` | | Playwright suites against real Worker + widget |
| `scripts/` | | `setup.sh`, `deploy.sh`, `ensure-config.mjs`, `kv-config.mjs`, `kv-push.sh`, `prod-preview.mjs` |

### Request flow

Widget → `POST /v1/sites/:siteId/sessions` (returns signed `sessionToken`) →
`POST /v1/sessions/messages` (Bearer token; JSON or SSE stream) /
`GET /v1/sessions/messages` (poll) / `POST /v1/sessions/end`.
`GET /v1/sites/:siteId/config` serves public widget config. `/healthz`.
Static widget files (`loader.js`, `app-*.js`) are served by the same Worker as
assets. **Sessions are stateless**: no session store; connector state rides in
the HMAC token. KV = rate limits, counters, prompt/config overrides. D1 = the
dashboard only.

### Two config worlds

- **Repo dev**: `murmur.config.ts` (gitignored; auto-created from
  `murmur.config.demo.ts` by `pnpm ensure-config`). `murmur.config.example.ts`
  documents a production site. Compiled into the Worker at build time.
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
into config. Local: `packages/server/.dev.vars` (gitignored, copy from
`.dev.vars.example`). Prod: `wrangler secret put`.

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

- The user often has `pnpm dev` running on :8787. **Don't kill it**; Playwright
  reuses it locally.
- Never name a root script `deploy` or `setup` — pnpm built-ins shadow them
  (hence `deploy:worker`, `bootstrap`).
- `echo` connector answers `/options`, `/multi`, `/card`, `/carousel`,
  `/links`, `/form`, `/notice`, `/slow`, `/long`, `/multipart`, `/error` —
  use it to exercise widget features without keys.

## Rules (from §13 and eslint)

- No `any` in protocol/connector interfaces; no floating promises;
  `import { type X }` inline type imports; unused vars prefixed `_`.
- No `console` in shipped code. Server logs through injected `ctx.log` /
  `platform.log` — never log lead data or message text.
- Widget runtime deps: **`preact` only**. Server: `hono`, `zod` (+ connector
  SDKs already present). Ask before adding runtime deps.
- `dangerouslySetInnerHTML` only in the markdown renderer
  (`widget/src/lib/markdown.ts`), which has XSS tests.
- **Fail-safe (§8.3) outranks everything** in the widget: every path ends in a
  working widget or a silent `hide()`, never an exception on the host page.
  Prefer a missing feature (apply the default) over throwing. Empty `catch` is
  intentional there.
- Server errors always leave via `app.onError` as the JSON envelope — throw
  `MurmurError`, never return HTML.
- Accessibility wins over visual design.
- Bundle guards: `loader.js` ≤ 8 kb gz, app ≤ 35 kb gz. Don't import Preact or
  Zod into the loader.
- For provider APIs (Retell, OpenAI, Gemini, Cloudflare, Anthropic,
  Turnstile), check the current docs; don't invent endpoints or fields.
  `docs/connectors.md` has the verified references.
- Update `docs/` when something user-visible changes.

## Recipes

- **New connector**: create `packages/connectors/<name>` (copy `echo`'s
  shape: `package.json`, `tsconfig.json`, `src/index.ts` exporting
  `defineConnector({...})`, `test/`), register it in
  `packages/server/src/core/registry.ts`, add the dep to
  `packages/server/package.json`, then wire the CLI backend in
  `packages/cli/src/engine/project.ts` (`backendSchema`) + `providers.ts` /
  `compile.ts`, and document it in `docs/connectors.md`. Streaming: implement
  `streams()` and call `ctx.onText`.
- **New message/action type**: add to `packages/protocol/src/messages.ts` or
  `actions.ts` first, then server sanitizing (`core/sanitize.ts`), widget
  validator (`widget/src/app/validate.ts` is hand-rolled and cross-checked
  against Zod in tests) and a component in `widget/src/components/messages/`.
- **Widget copy**: `widget/src/app/strings.ts`. Styles:
  `widget/src/styles/`.
- **Dashboard API change**: `server/src/admin/routes.ts` + `db.ts` schema,
  client in `dashboard/src/lib/api.ts`, test in `server/test/admin.test.ts`.
- **CLI command**: add to `COMMANDS` in `packages/cli/src/cli.ts`, help in
  `help.ts`; must work with `--json` and non-interactively (missing answers →
  `needs_input`). If the skill text changes, run `pnpm sync:plugin`.

## Tests live next to each package

`packages/*/test/` (vitest; server tests use `test/helpers.ts` →
`testConfig()`, `memoryKv`), `e2e/*.spec.ts` (Playwright; the widget is inside
the `murmur-widget` shadow root — see `e2e/helpers.ts`; lead-form fills are
driven by what renders, not a fixed field list).
