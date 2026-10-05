# Contributing

Thanks for helping. This page is for working **on** Murmur. For building on
top of it without changing it, see [[Extending]].

## Setup

Node 20+ and [pnpm](https://pnpm.io) 10.

```bash
pnpm install
pnpm dev            # the Worker on :8787 and the widget's dev server on :5173, with the echo backend
```

Then open:

| URL | |
| --- | --- |
| http://localhost:5173 | **Playground**: the real widget on a page, buttons for every `window.Murmur` call, an event log, one-click fail-safe checks |
| http://localhost:5173/gallery.html | **Gallery**: every surface of the widget rendered with the real components, with a live theme and colour picker |
| http://localhost:5173/fixtures/ | **Hostile host pages**: aggressive CSS, patched prototypes, double include, SPA routing |

The dashboard needs a database, which `pnpm dev` does not have: run
`murmur dev` in a test assistant's folder (a local Worker with D1), then
`pnpm --filter @murmur/dashboard dev`, which serves the dashboard with hot
reload on :5174 and sends its API calls to :8787 (`MURMUR_DEV_URL` to change).

The `echo` backend needs no key and answers `/options`, `/multi`, `/card`,
`/carousel`, `/links`, `/form`, `/notice`, `/slow`, `/long`, `/multipart` and
`/error`, one for each widget feature. The dev server's config is
`murmur.config.ts` (gitignored; created from `murmur.config.demo.ts` on first
run). Secrets for local development go in `packages/server/.dev.vars` (copy
`.dev.vars.example`).

## Commands

```bash
pnpm lint           # ESLint, type-aware
pnpm typecheck      # every package
pnpm test           # Vitest: *.test.ts in Node, *.test.tsx in happy-dom
pnpm vitest run packages/server/test/stream.test.ts    # one file
pnpm build          # the widget bundles, checked against their size budgets
pnpm e2e            # Playwright: the whole stack in a browser (run `npx playwright install chromium` once)
pnpm check          # all of the above: what CI runs
pnpm build:cli      # the publishable CLI: widget + dashboard + server runtime
pnpm pack:cli       # …as an installable tarball, to test like a user would
pnpm sync:plugin    # regenerate the agent skill, packages/cli/AGENTS.md and the wiki's reference pages
```

## The repository

A pnpm monorepo, TypeScript strict, ESM.

| Path | |
| --- | --- |
| `packages/protocol` | The wire contract as Zod schemas: messages, actions, API, widget config, webhooks. **The single source of truth**; never redeclare these types elsewhere |
| `packages/server` | The Worker (Hono): chat API, admin API, recording, webhooks, the crawl Workflow, D1 migrations |
| `packages/rag` | The knowledge base, free of Workers APIs: discovery, crawling, extraction, chunking, retrieval, files |
| `packages/connectors/*` | One package per backend; `_types` holds the interface and shared helpers |
| `packages/sinks/*` | Lead destinations |
| `packages/widget` | The Preact widget, in a shadow root: a tiny loader plus a lazily loaded app |
| `packages/dashboard` | The React + Tailwind dashboard served at `/admin/` |
| `packages/cli` | `@knowtific/murmur`, the published CLI: commands, deploy engine, MCP server, help text |
| `plugin/`, `.claude-plugin/` | The Claude Code plugin; its `SKILL.md` is generated from `packages/cli/src/skill.ts` |
| `e2e/` | Playwright suites |
| `wiki/` | This wiki, published to GitHub's wiki by CI. `CLI-Reference.md` and `Configuration-Reference.md` are generated |

`AGENTS.md` at the root is the orientation for coding agents working on the
repository, with recipes for common changes.

## Rules

- **The widget never breaks the host page.** Every path ends in a working
  widget or a silent hide, never an exception on the page. Prefer a missing
  feature over throwing.
- **Accessibility wins** over visual design.
- **Size budgets:** `loader.js` ≤ 8 KB gzipped, the app ≤ 35 KB. The loader
  never imports Preact or Zod. `pnpm build` fails over budget.
- **Dependencies:** the widget depends on `preact` only; the server on `hono`
  and `zod` (plus provider SDKs already present). Ask before adding one.
- **No `console`** in shipped code. The server logs through the injected
  `log`, and never logs message text or lead data.
- **Server errors** leave as the JSON error envelope (throw `MurmurError`), never HTML.
- **Secrets** are referenced by environment variable name (`{ env }`), never written into config.
- **Provider APIs:** check the provider's current documentation; do not
  write against a remembered shape.
- **Docs:** a user-visible change updates the wiki in the same pull request.
  Field descriptions live in the schemas (`.describe()`), so
  `pnpm sync:plugin` regenerates the reference.

## Changes that need care

**Database schema.** Add a migration at the end of
`packages/server/src/db/migrations.ts`; never edit one that has shipped.
Migrations only add (tables, nullable columns, indexes, backfills), so the
previous release keeps working on an upgraded database: that is what makes a
rollback safe. Renaming or removing takes two releases. Every statement must
be safe to run twice. The rules are at the top of the file; see also [[Upgrading]].

**`murmur.json`'s format.** A field that moves or changes meaning bumps
`PROJECT_FORMAT` and adds a step to `PROJECT_UPGRADES` in
`packages/cli/src/engine/project.ts`, with a test.

**Live config.** The server must keep reading config an older release wrote:
accept retired options (and ignore them) rather than rejecting the config.

**A new message or action type.** Add it to `packages/protocol` first, then
the server's sanitiser (`core/sanitize.ts`), the widget's validator
(`widget/src/app/validate.ts`, which tests cross-check against Zod), and a
component.

**CLI commands** go in `COMMANDS` (`packages/cli/src/cli.ts`) with help in
`help.ts`, must work with `--json` and without a terminal (missing answers
come back as `needs_input`), and do what the dashboard does through the admin
API, never around it.

## Releasing

1. Bump `version` in `packages/cli/package.json` (semver: a major release
   only for changes that need users to act).
2. Add the release notes to `CHANGELOG.md`, including anything an upgrade
   does (migrations, re-learning) and, for a major release, what users must change.
3. `pnpm sync:plugin`, then `pnpm check`.
4. Try it like a user: `pnpm pack:cli`, install the tarball in a test project,
   `npx murmur upgrade` against a deployed test assistant.
5. Publish: `pnpm --filter @knowtific/murmur publish --access public`, and tag
   the release.

Deployed assistants learn of the release within 12 hours (Settings → Updates).

## The wiki

The wiki is the `wiki/` folder, published to GitHub's wiki by
`.github/workflows/wiki.yml` on every push to `main` that touches it. Edit the
files here, never on GitHub (the next sync would overwrite it). Links between
pages use the wiki's own link syntax: the text and the page name, separated by
a `|`, inside double square brackets. The first time, enable the
wiki in the repository settings and create any page there, so GitHub creates
its repository.

## Pull requests

Keep them focused, with tests for what changed. `pnpm check` must pass (CI
runs it). Describe what a user would notice.
