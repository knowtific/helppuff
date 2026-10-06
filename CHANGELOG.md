# Changelog

All notable changes to `@knowtific/helppuff`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): upgrading within a major version
never needs you to change anything. Upgrade with
`npx @knowtific/helppuff@latest upgrade` (see the wiki's Upgrading page).

## [Unreleased]

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
- An agent-native CLI with `--json`, structured `needs_input` responses and one
  shared instruction file for Claude Code, Codex, Cursor, OpenCode and others.
- `helppuff upgrade`, with version reporting, a D1 restore point and guarded rollbacks.
