# Changelog

All notable changes to `@knowtific/helppuff`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): upgrading within a major version
never needs you to change anything. Upgrade with
`npx @knowtific/helppuff@latest upgrade` (see the wiki's Upgrading page).

## [Unreleased]

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
