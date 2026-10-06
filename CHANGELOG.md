# Changelog

All notable changes to `@knowtific/helppuff`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): upgrading within a major version
never needs you to change anything. Upgrade with
`npx @knowtific/helppuff@latest upgrade` (see the wiki's Upgrading page).

## [Unreleased]

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
