# @knowtific/helppuff

### Your website's AI assistant — deployed by your AI agent, owned by you.

HelpPuff is an open-source website chatbot with a knowledge base, lead capture,
CRM dashboard and analytics. The complete default stack runs in **your
Cloudflare account** and fits the **Workers Free plan**.

> No HelpPuff subscription. No VPS to patch. No chatbot vendor holding your
> customer database.

```bash
npx @knowtific/helppuff
```

Give it your website address. HelpPuff discovers your content, deploys the
widget and backend, starts building the knowledge base, and gives you a setup
link and the script tag for your site.

## Why HelpPuff?

- **Start free:** roughly 300 typical AI answers per day fit the current free
  AI allowance; crawling and summaries share that allowance.
- **Own the data:** conversations, leads and knowledge stay in D1, KV and
  Vectorize resources controlled by your Cloudflare account.
- **Skip server maintenance:** Cloudflare runs the compute, storage, background
  work and edge network. There is no VPS or server fleet to manage.
- **Let an AI agent do the work:** Claude Code, Codex, Cursor and other agents
  can configure, deploy, test, diagnose and upgrade HelpPuff through its JSON
  CLI, installable skill and MCP server.
- **Choose your AI:** use Workers AI by default, or switch to OpenAI, Gemini,
  Claude, Cloudflare AI Search, Retell or your own API.

## The Cloudflare stack

| Service | What HelpPuff uses it for | Default |
| --- | --- | --- |
| Workers + Static Assets | Chat API, widget, dashboard, demo and static bundles | Yes |
| Workers AI | Answers, summaries, document conversion, embeddings and reranking | Yes |
| GLM-4.7 Flash | Default answer and conversation-summary model | Yes |
| BGE-M3 | Semantic embeddings for website pages, files and questions | Yes |
| BGE Reranker Base | Rechecks retrieved passages before answering | Yes |
| D1 | Conversations, leads, callbacks, analytics, knowledge text and keyword search | Yes |
| Vectorize | Semantic knowledge search | Yes |
| Workers KV | Live configuration, prompts, counters and temporary uploads | Yes |
| Workflows | Crawls, file learning, summaries and webhook retries | Yes |
| Cron Triggers | Scheduled website re-learning | Yes |
| Rate Limiting | Per-IP protection for the public chat API | Yes |
| Browser Rendering | Learning pages that require JavaScript | When needed |
| Turnstile | Human verification for abuse protection | Optional |
| AI Gateway | Model observability, caching and centralized controls | Optional |

## Included features

- Website crawling and PDF, Word, Markdown and text knowledge
- Hybrid semantic + keyword retrieval with relevance checking
- Accessible, mobile-first widget with streaming responses
- Shortcut buttons, suggestions, cards, links and forms inside conversations
- Configurable pre-chat forms and custom lead fields
- Built-in CRM with pipeline stages, notes and CSV export
- Automatic chat summaries, intent, sentiment, lead quality and next steps
- Callback requests managed as team tasks
- Analytics, visitor ratings and unanswered-question tracking
- Signed webhooks with retries for Zapier, Make, n8n, CRMs and custom APIs
- Origin restrictions, signed sessions, rate limits, daily budgets and optional Turnstile
- Safe upgrades with additive migrations and restore points

## Built for AI agents

Ask your coding agent:

> Add HelpPuff to this website, learn our content, deploy it to Cloudflare and
> test it with real customer questions.

Install the agent skill:

```bash
npx -y @knowtific/helppuff skill install          # Claude Code
npx -y @knowtific/helppuff skill install --codex  # Codex
```

Or expose the same engine to an MCP client:

```bash
npx -y @knowtific/helppuff mcp
```

Commands support structured `--json` output, return missing decisions as
`needs_input`, never echo secrets, and work non-interactively.

## Useful commands

```bash
npx @knowtific/helppuff deploy
npx @knowtific/helppuff dashboard
npx @knowtific/helppuff ask "Do you service Lilydale?" --timing
npx @knowtific/helppuff@latest upgrade
npx @knowtific/helppuff --help
```

Cloudflare currently includes 100,000 Worker requests and 10,000 Workers AI
neurons per day on the free plan. HelpPuff applies its own lower daily AI
budget and falls back to contact details and callback capture when it is spent.

Full documentation: **[HelpPuff wiki](https://github.com/knowtific/helppuff/wiki)**

Source: **[github.com/knowtific/helppuff](https://github.com/knowtific/helppuff)**

MIT licensed.
