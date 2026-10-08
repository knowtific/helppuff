# Changelog

All notable changes to `@knowtific/helppuff`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): upgrading within a major version
never needs you to change anything. Upgrade with
`npx @knowtific/helppuff@latest upgrade` (see the wiki's Upgrading page).

## [Unreleased]

## [0.3.0] - 2026-10-08

### Added: live chat, roles and a fuller CRM

- **Live chat** (off by default; `helppuff live on` or Settings → Live chat):
  a visitor who asks for a person is handed to the team, who answer from the
  dashboard (browser notifications and a sound, per person) or from Telegram
  (`helppuff telegram connect`; a thread per chat). Nobody available, or
  nobody in `live.waitSeconds`: the callback form, as before. workers-ai hands
  over itself (`request_person`); every backend gets a "Talk to a person"
  button. Runs on a Durable Object per site, on the Free plan; the widget's
  live code is a separate 1 kB file loaded only when a chat is handed over.
- **Conversation status**: AI bot, Live agent or Closed (by the team, or after
  `live.closeAfterMinutes` without a message; a visitor who writes again is
  answered by the assistant). Filter by status, label and "waiting for a
  reply"; filters are remembered.
- **Roles**: admin or member. Members see conversations, jobs, contacts,
  callbacks and live chat only. Invite and change roles in Settings → Team, or
  `helppuff users add --role member` / `helppuff users role`.
- **Labels** (Settings → Labels), put on by the team or by the AI when a
  conversation goes quiet; **custom attributes** and **private notes** on
  conversations and contacts; a **page per contact** with their details,
  attributes, notes, conversations and history.
- API: `PATCH /conversations/:id`, notes, labels, live chat (reply, assign,
  close, hand back, status, Telegram), `PATCH /admins/:email`; contacts gain
  `company`, `address`, `attributes`. Webhooks: `handover.requested`,
  `handover.missed`, `handover.ended`, `conversation.assigned`,
  `conversation.closed`; `message.sent` carries `author` for a person.
- D1 migration 10 (`inbox and live chat`), and the `LiveHub` Durable Object,
  added by `helppuff upgrade`.

### Added: jobs

- **Jobs**: requests, quotes and work from conversations, on a board with
  the site's own stages (drag, or a menu on each card), a list, and a page
  per job with its fields, updates, private notes and history. Rename them
  (Quotes, Tickets…) in Settings → Jobs.
- **Set up from the website**: the AI picks a template (service quote,
  projects, support, sales demo, bookings, custom orders; basic when unsure)
  and fills in the services; Home says what it chose. Stages, fields and
  names are editable; "Let the AI choose again" or `helppuff jobs setup`.
- **From the chat**: workers-ai creates a job when a visitor asks for a quote
  or work (`create_job`), then asks in a short form for required details it
  lacks. The widget's **Get a quote** button asks the quote questions (chosen
  in Settings → Jobs) and saves the answers as a job; its contact questions
  stand in for the lead form.
- **From elsewhere**: `POST /api/v1/jobs` (scopes `jobs:read`, `jobs:write`),
  "New job" from a contact, a conversation or a callback request, and
  `helppuff jobs list|show|create|move|update|pipeline|template|setup`.
- Webhooks: `job.created`, `job.updated`, `job.stage_changed`, `job.won`,
  `job.lost`. A new job alerts the team like a message (with live chat on).
- Set up after every deploy (`deploy.jobs` in `--json`): the pipeline at
  once, so the assistant records requests from the first visitor, and the
  AI's choice from the website then (other backends) or when learning
  finishes (workers-ai). Never over a pipeline already set up.
- D1 migration 11 (`jobs`), applied by `helppuff upgrade`.

### Added: the home screen

- **Settings → Home screen**: the widget's first screen in the dashboard,
  with a preview: its heading, up to 8 buttons of every kind (a question, a
  page, call, email, a form, a few questions) and a list of useful pages.
  Before, only the suggested questions were in the dashboard.
- **Suggested from the website**: when the site is first learned, the AI
  picks the pages worth a link and writes the questions visitors ask; the
  widget shows them until the owner saves their own (which always win).
  **Suggest from my site** adds more, with call and email buttons from the
  business details.
- API: `home` in `GET/PUT /settings`, `POST /home/suggest`; `config pull`
  brings `widget.home` (title, subtitle, links) into helppuff.json.

### Added: choose the model and the knowledge base separately

- **`model`** in helppuff.json: who writes the answers. Workers AI (the
  default), any OpenAI-compatible API with tools (presets: DeepInfra,
  OpenRouter, DeepSeek, Groq, Together, Mistral, Fireworks, Vercel AI
  Gateway, Cloudflare AI Gateway), OpenAI, Gemini, Claude (its Messages
  API), or your own TypeScript file (`custom`).
- **`knowledge.retrieval`**: what the answers come from. HelpPuff's own
  knowledge base (the default), none, Cloudflare AI Search, an OpenAI vector
  store, your own search over HTTP, or your own TypeScript file.
- HelpPuff's assistant (prompt, tools, citations, guardrails, budget) is now
  the same whichever model writes: other models get callbacks, jobs, live
  chat hand-over and HelpPuff's knowledge base, which before were Workers AI
  only.
- `helppuff model set|test`, `helppuff rag set|test` (through the deployed
  Worker), `helppuff scaffold model|rag`; `@knowtific/helppuff/sdk` for the
  types (`LanguageModel`, `Retriever`). A missing key answers `needs_input`
  with the `secret set` command. `doctor` checks the keys and files.
- API: `POST /assistant/test`; `GET /settings` shows `ai` (provider, model,
  knowledge).
- helppuff.json format 2, applied by `helppuff upgrade`: `backend` becomes
  `model` + `knowledge.retrieval`. Kept as whole backends: Retell, your own
  API in `helppuff` mode, echo, OpenAI with a stored prompt or a vector store
  HelpPuff fills, Gemini with File Search.

### Changed

- The model, the reranker and thinking are shown in Settings → Advanced but
  changed only with the CLI (and a deploy), so helppuff.json stays the one
  place they are set.
- The agent instructions (`instructions.md`) list the command for every
  change a user may ask for: settings in `helppuff.json`, and what lives on
  the Worker (jobs, labels, live chat, team, webhooks, keys).
- Too many sign-in attempts now says so, instead of "Too many messages".
- Suggested questions moved from Settings → Chat to Settings → Home screen,
  and are made by the server when the site is learned rather than by the
  dashboard (which marked the settings as changed and made the next deploy
  ask for `config pull`).

### Added: the public API

- Everything HelpPuff does, over HTTPS at `<worker>/api/v1`, so it can be used
  as a backend only: chat with the assistant from your own server (JSON or
  streamed), leads (now also create, get one, delete and erase), callbacks,
  conversations (now also delete), knowledge, prompt, settings, webhooks,
  analytics, team (add and remove accounts, sign-in links), API keys and an
  audit log. The same handlers as the dashboard's own API: one implementation.
- API keys: scoped, one site each, optional expiry and IP allowlist, a rate
  per key, stored only as a keyed hash and shown once. Settings → API keys in
  the dashboard, `helppuff keys create|list|revoke`, and `helppuff api` to
  call any endpoint.
- Docs: the wiki's API page (quickstart in curl, JavaScript and Python), and
  the API reference with a curl command, request, response and errors for
  every endpoint, generated from the same registry that guards the routes;
  OpenAPI 3.1 at `/api/v1/openapi.json`.
- D1 migration 9 (`public api`).

Security hardening. Adds D1 migration 8 (`abuse limits`), applied by
`helppuff upgrade`.

### Added

- Per-visitor daily limits (`messagesPerIpPerDay`, `sessionsPerIpPerDay`), so
  one visitor cannot use up the site's daily cap; counted from what D1 records,
  with no KV write per message.
- IP allow and block lists (`security.allowIps`, `security.blockIps`), single
  addresses or CIDR ranges, IPv4 or IPv6.
- Every limit is a setting (`security.limits`, `security.signIn`) and on the
  dashboard's Settings → Advanced page; `config pull` brings them back. The
  wiki's Security page lists them all.
- Dashboard sign-in: a per-account limit on wrong passwords, and Turnstile on
  the form when `security.captcha` is set.
- A "Before you go live" checklist on the dashboard's Home page, and a warning on
  Settings → Advanced, while Turnstile is off (it stays off by default, so trying
  HelpPuff needs no setup); `helppuff doctor` warns too. New wiki page: Turn on
  Turnstile.

### Changed

- A submitted form is honoured only when the chat was shown that form, so a
  script cannot post leads or callback requests into any chat.
- A second chat with a contact's email no longer overwrites that contact's form
  answers.
- Signing out of the dashboard ends that session everywhere; changing a
  password ends all of the account's sessions. Everyone signs in once after
  upgrading.
- `conversation.ended` fires once per conversation; ratings, polls and closing
  a chat are rate limited.
- Text is cleaned both ways: no control, bidi-override, zero-width or hidden
  tag characters, and no chat-template tokens in visitors' messages.
- Prompt-injection guardrails: the visitor's values are quoted in prompts,
  website passages are fenced and neutralised, the rules say all of it is
  information rather than instructions, and every backend's replies are
  checked for leaked rules. Owner prompts that use `{{lead.*}}` or
  `{{context.*}}` now receive the value in quotes.
- The dashboard is served with a strict Content Security Policy and is never
  framed; CSV export also guards cells starting with a tab or carriage return.

## [0.2.0] - 2026-10-07

AI agents now set HelpPuff up from one shared instruction file instead of a
plugin, so it works the same in Claude Code, Codex, Cursor, OpenCode and others.

### Removed

- `helppuff mcp` and `helppuff skill`, the Claude Code plugin and its skill.
  Agents follow [instructions.md](instructions.md) and use the CLI with
  `--json` instead; nothing needs installing. If you added the HelpPuff MCP
  server or skill to an agent, remove it.
- `helppuff init` no longer writes agent instruction files into your project.

### Added

- `--onboarding defaults | dashboard` on `init` and `deploy`: an agent either
  finishes onboarding itself (learns the suggested pages, reads your business
  details) or hands page selection to you on the setup page. The choice is
  remembered, so a later `helppuff deploy` keeps it.
- Help links throughout the dashboard, and a "How to upgrade" link in
  Settings → Updates. "What's new" now opens this changelog.

### Fixed

- `--crawl none` really learns nothing; it used to crawl the suggested pages.
- With dashboard onboarding, an agent is told to hand over the dashboard even
  when the one-time setup link is gone, and not to test answers before you
  have chosen pages.
- `helppuff secret set` before `init` says which folder it saved `.env` in,
  so `init` run from another folder no longer misses the token.
- The dashboard checks for updates once per page load.

## [0.1.0] - 2026-10-06

The first public release.

- One-command setup (`npx @knowtific/helppuff`) to your own Cloudflare account:
  the widget, the chat API, a dashboard and a knowledge base.
- The default `workers-ai` backend: answers from your website and files with
  Workers AI, on the Workers Free plan. Hybrid search (Vectorize + D1
  full-text), reranking, and "not sure" plus a callback offer instead of guessing.
- Background learning in a Cloudflare Workflow: website crawling, and PDF,
  Word, Markdown and text uploads.
- The dashboard: test chat, conversations, leads (one per person, by email),
  knowledge, analytics, settings, webhooks and updates.
- Other backends: Cloudflare AI Search, OpenAI, Gemini, Anthropic Claude,
  Retell, and your own API.
- Webhooks for every event, signed.
- An agent-native CLI: `--json`, `needs_input`, MCP, a Claude Code plugin and skill.
- `helppuff upgrade`, with version reporting, a D1 restore point and guarded rollbacks.
