# HelpPuff

### Your website's AI assistant — deployed by your AI agent, owned by you.

HelpPuff is an open-source AI chat assistant for websites. It learns your
content, answers visitors, captures leads and gives your team a practical CRM
dashboard. The entire default stack runs inside **your Cloudflare account** and
fits the **Workers Free plan**.

> No HelpPuff subscription. No VPS to patch. No chatbot vendor holding your
> customer database.

## Install it

You can either run the CLI yourself:

```bash
npx @knowtific/helppuff
```

Or copy this prompt into Claude Code, Codex, Cursor, OpenCode or another
AI coding agent:

> Follow the HelpPuff instructions at https://raw.githubusercontent.com/knowtific/helppuff/main/instructions.md and install it in this project. Complete setup automatically with the recommended free defaults. Ask me only for information you cannot determine safely or authorization I must complete. Continue until it is deployed, added to the website when possible, tested with real questions, and you have given me the dashboard, embed and preview links.

The agent can complete the setup, configure the assistant, add the embed code,
deploy it and test the result. You only step in when authorization or a real
business decision is required.

## Try it in your browser

**[Open the playground →](https://knowtific.github.io/helppuff/)**

The real widget on a sample page, beside a panel of every option it has:
brand, colours and theme, the launcher, the teaser bubble, the home screen
and its shortcuts, the lead form, the chat screen, styling and the footer.
Change anything and the preview updates. Chat with it, try rich replies
(`/card`, `/carousel`, `/form`…) and copy the finished `widget` config into
your `helppuff.json`. Nothing to install, and no server or account needed.

## Why HelpPuff?

Most hosted chatbots start with a monthly subscription, put important features
behind higher plans, and keep your conversations and customer details in their
platform. Building your own usually means wiring together a model, retrieval,
storage, a widget, a dashboard and deployment infrastructure by hand.

HelpPuff gives you the convenience of a hosted product without another chatbot
platform to rent:

- **Start free.** The default deployment fits Cloudflare's free allowances and
  handles roughly **300 typical AI answers per day**—enough for many new sites,
  startups and small businesses. Crawling and summaries use the same allowance,
  so this is a practical estimate rather than a hard message count.
- **Own the data.** Conversations, leads, customer details and knowledge stay in
  D1, KV and Vectorize resources controlled by your Cloudflare account. There is
  no HelpPuff-operated service between you and your visitors.
- **Let your AI agent operate it.** HelpPuff's CLI supports structured JSON and
  explicit `needs_input` responses. Any coding agent can follow the shared
  [`instructions.md`](instructions.md) to build, deploy, customize, test,
  diagnose and upgrade the assistant.
- **Run at the edge.** The widget and API enter Cloudflare's global network close
  to the visitor, while managed services handle compute, storage and background
  work. There is no server fleet, operating system or VPS for you to maintain.
- **Scale when the website does.** Stay on the free plan while traffic is small,
  then move to Cloudflare's usage-based paid services instead of migrating to a
  different architecture.
- **Keep your options open.** Workers AI is the zero-key default, but the same
  widget, dashboard and CRM can use OpenAI, Gemini, Claude, Cloudflare AI Search,
  Retell or your own API.

Cloudflare's current free allocation includes 100,000 Worker requests and
10,000 Workers AI neurons per day. HelpPuff keeps its own AI budget below that
limit and degrades to contact details and callback capture instead of producing
an unexpected bill. See [Costs and limits](wiki/Costs-and-Limits.md) and the
[Cloudflare Free plan guide](wiki/Cloudflare-Free-Plan.md) for the exact
limits and failure behaviour.

## One complete stack on Cloudflare

One assistant uses one Worker and a small set of managed Cloudflare services.
The CLI provisions and connects them; you do not need to assemble this
architecture manually.

| Cloudflare service | Where HelpPuff uses it | Default |
| --- | --- | --- |
| **Workers + Static Assets** | Serves the chat API, widget, dashboard, demo page and static bundles from one deployment | Yes |
| **Workers AI** | Writes answers and summaries, reads business details, converts uploaded documents to Markdown, creates embeddings and reranks search results | Yes |
| **GLM-4.7 Flash** (`@cf/zai-org/glm-4.7-flash`) | Default model for visitor answers and conversation summaries | Yes |
| **BGE-M3** (`@cf/baai/bge-m3`) | Embeds website passages, files and visitor questions for semantic search | Yes |
| **BGE Reranker Base** (`@cf/baai/bge-reranker-base`) | Rechecks search candidates before the answer model sees them | Yes |
| **D1** | Stores conversations, leads, callback tasks, ratings, analytics, knowledge text, keyword search, prompt history and usage | Yes |
| **Vectorize** | Stores knowledge vectors and finds passages by meaning | Yes |
| **Workers KV** | Holds live configuration, prompt updates, lightweight counters and temporary file uploads | Yes |
| **Workflows** | Runs durable background jobs for crawling, file learning, conversation summaries and webhook retries | Yes |
| **Cron Triggers** | Schedules automatic website re-learning | Yes |
| **Rate Limiting** | Protects the public chat endpoint from per-IP message bursts | Yes |
| **Browser Rendering** | Reads pages that require JavaScript while learning a website | Automatic when needed |
| **Turnstile** | Adds human verification to new chats for public-site abuse protection | Optional |
| **AI Gateway** | Adds model observability, caching and centralized AI controls | Optional |

Learn how the models divide the work in [AI models](wiki/AI-Models.md), or
see every allowance in [Cloudflare Free plan limits](wiki/Cloudflare-Free-Plan.md).

## Features

HelpPuff is more than a chat bubble. Every deployment includes the visitor
experience, the operational tools and the customer follow-up workflow.

| Feature | What it gives you | Learn more |
| --- | --- | --- |
| **Website and file knowledge** | Crawls selected pages and learns PDF, Word, Markdown and text files using hybrid semantic + keyword search | [Knowledge base](wiki/Knowledge-Base.md) |
| **Fast, isolated widget** | An accessible, mobile-first widget in a shadow root; one script tag and about 6 KB gzipped before lazy loading | [Widget](wiki/Widget.md) |
| **Rich conversations** | Streaming replies, shortcut buttons, suggested questions, option chips, cards, links and forms directly inside chat | [Widget](wiki/Widget.md) |
| **Pre-chat forms** | Capture name, email, phone and custom fields before a conversation, with configurable required fields | [Leads](wiki/Leads.md) |
| **Built-in CRM** | One lead per person, repeat conversations, pipeline stages, notes, custom answers and CSV export | [Dashboard](wiki/Dashboard.md#leads) |
| **Conversation intelligence** | Automatic summaries, intent, sentiment, lead quality, outcome, topics, next steps and unanswered questions | [Dashboard](wiki/Dashboard.md#conversations) |
| **Callback requests** | Turns “please call me” into a tracked task your team can complete, dismiss or reopen | [Callbacks](wiki/Leads.md#callbacks) |
| **Analytics and ratings** | Conversation and lead trends, conversion, top pages, countries and visitor feedback | [Dashboard](wiki/Dashboard.md#analytics) |
| **Signed webhooks** | Sends leads, callbacks, messages, summaries, ratings and knowledge events to Zapier, Make, n8n, a CRM or your API, with retries | [Webhooks](wiki/Webhooks.md) |
| **Agent-native operations** | Shared instructions for any coding agent, a JSON CLI, structured questions and non-interactive setup, testing and upgrades | [Using with AI agents](wiki/AI-Agents.md) |
| **Safety and cost controls** | Origin allowlists, signed sessions, daily budgets, rate limits, optional Turnstile and graceful fallbacks | [Security](wiki/Security.md) |
| **Pluggable AI backends** | Switch the answer model without replacing the widget, dashboard, leads or webhooks | [Providers](wiki/Providers.md) |
| **Safe upgrades** | Additive database migrations, compatibility checks, restore points and downgrade protection | [Upgrading](wiki/Upgrading.md) |

## Your data stays yours

With the default Workers AI backend:

- transcripts, leads and customer details live in your **D1 database**;
- website text and facts live in **D1**, with vectors in **Vectorize**;
- configuration and prompts live in your **KV namespace**;
- the Worker, widget and dashboard are deployed to your Cloudflare account;
- HelpPuff has no hosted control plane and receives none of that data.

If you choose OpenAI, Gemini, Claude, Retell or your own API, the information
needed to answer a visitor is sent to that provider under its terms. Likewise,
webhooks send the events you select to endpoints you control. The default
Cloudflare-only path does neither.

## Built for AI agents

HelpPuff is designed so a coding agent can take the project from an empty
folder to a tested production assistant. Every operation available in the
dashboard is also available through the CLI or admin API.

Use the agent prompt in the [Install it](#install-it) section above. The
instructions are plain Markdown and do not require a plugin, skill or MCP
server.

Agent-facing commands never open an interactive prompt. Missing decisions are
returned as structured questions, secrets are never echoed, and test commands
can verify real answers without consuming visitor rate limits. See
[Using HelpPuff with AI agents](wiki/AI-Agents.md).

## How it works

```text
your website ── <script src=".../loader.js"> ──┐
                                               ▼
                         Cloudflare Worker (your account)
                         ├─ widget, chat API and dashboard
                         ├─ Workers AI ── answers, embeddings and reranking
                         ├─ Vectorize + D1 ── knowledge, chats, leads and CRM
                         ├─ Workflows ── crawls, files, summaries and retries
                         └─ KV ── live configuration and prompt
```

The widget speaks one small REST protocol to the Worker, and connectors adapt
that protocol to different AI backends. Sessions are stateless and carry their
connector state in signed tokens, so there is no chat-session server to run.

## Get started

You need Node.js 20 or later, a Cloudflare account and a website. The website
can be hosted anywhere—it does not need to be on Cloudflare.

```bash
npx @knowtific/helppuff
```

HelpPuff asks for the website address, connects to Cloudflare, discovers the
site's identity and useful pages, deploys the stack and gives you a one-time
dashboard setup link. The dashboard then provides the exact script tag to add
to your website.

Follow the [Getting started guide](wiki/Getting-Started.md), or let your coding
agent follow [the agent workflow](wiki/AI-Agents.md).

## Documentation

Everything is in the **[wiki](wiki/)**:

- [Getting started](wiki/Getting-Started.md) · [Using with AI agents](wiki/AI-Agents.md) · [Dashboard](wiki/Dashboard.md)
- [Configuration](wiki/Configuration.md) · [Configuration reference](wiki/Configuration-Reference.md) · [CLI reference](wiki/CLI-Reference.md)
- [Providers](wiki/Providers.md) · [Knowledge base](wiki/Knowledge-Base.md) · [Widget](wiki/Widget.md) · [Leads](wiki/Leads.md) · [Webhooks](wiki/Webhooks.md)
- [Deployment](wiki/Deployment.md) · [Upgrading](wiki/Upgrading.md) · [Costs and limits](wiki/Costs-and-Limits.md) · [Security](wiki/Security.md) · [Troubleshooting](wiki/Troubleshooting.md)
- [Extending HelpPuff](wiki/Extending.md) · [Protocol](wiki/Protocol.md) · [Contributing](wiki/Contributing.md)

The wiki's source is the [`wiki/`](wiki) folder in this repository.

## Working on HelpPuff

```bash
pnpm install
pnpm dev        # Worker :8787 + widget playground :5173; no API key needed
                # options playground: http://localhost:5173/playground.html
pnpm check      # lint, typecheck, tests, build and end-to-end tests
```

See [Contributing](wiki/Contributing.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).
Coding agents working on this repository start from [`AGENTS.md`](AGENTS.md).

## License

[MIT](LICENSE)
