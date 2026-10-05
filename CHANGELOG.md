# Changelog

All notable changes to `@knowtific/murmur`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): upgrading within a major version
never needs you to change anything. Upgrade with
`npx @knowtific/murmur@latest upgrade` (see the wiki's Upgrading page).

## [0.1.0] - Unreleased

The first public release.

- One-command setup (`npx @knowtific/murmur`) to your own Cloudflare account:
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
- `murmur upgrade`, with version reporting, a D1 restore point and guarded rollbacks.
