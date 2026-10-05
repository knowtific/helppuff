# Murmur

**An open-source AI chat assistant for your website, running on your own
Cloudflare account.** One command sets up the chat widget, a knowledge base
learned from your site, and a dashboard for conversations and leads. The
default setup runs on the **Workers Free plan**
([what fits in it](../../wiki/Cloudflare-Free-Plan)).

```bash
npx @knowtific/murmur
```

It asks for your website, deploys everything to your Cloudflare account, and
gives you one link: a setup page where you create your sign-in, choose the
pages to learn from, and check the details it found. Then paste one script
tag on your site.

Or ask your coding agent: with the Claude Code plugin (or
`npx -y @knowtific/murmur skill install`), "add an AI chatbot to my website"
is enough.

## What you get

- **A chat widget** that answers from your own website and files, offers a
  callback when it cannot help, and never breaks your page. One script tag,
  about 6 KB to start, accessible, mobile-first.
- **A knowledge base** on your account: your site crawled in the background
  (Workflows), plus PDF, Word, Markdown and text files, searched by meaning and
  by keyword (Vectorize + D1), with answers checked for relevance before they
  are used.
- **A dashboard** at `/admin`: a live test chat, conversations, leads (one per
  person, with a pipeline), knowledge, analytics, settings, and webhooks.
- **Leads and webhooks**: a pre-chat form, callback requests, and every event
  sent as signed JSON to Zapier, Make, n8n, your CRM or your own server.
- **Your choice of AI**: Workers AI by default, or Cloudflare AI Search,
  OpenAI, Gemini, Claude, Retell, or your own API.
- **Built for agents**: every command speaks `--json`, missing answers come
  back as questions, and `murmur mcp` serves the same engine as MCP tools.
- **Safe upgrades**: `npx @knowtific/murmur@latest upgrade` keeps your data,
  notes a database restore point, and can be rolled back.

## Documentation

Everything is in the **[wiki](../../wiki)**:

- [Getting started](../../wiki/Getting-Started) · [Using with AI agents](../../wiki/AI-Agents) · [The dashboard](../../wiki/Dashboard)
- [Configuration](../../wiki/Configuration) · [Configuration reference](../../wiki/Configuration-Reference) · [CLI reference](../../wiki/CLI-Reference)
- [Providers](../../wiki/Providers) · [Knowledge base](../../wiki/Knowledge-Base) · [The widget](../../wiki/Widget) · [Leads](../../wiki/Leads) · [Webhooks](../../wiki/Webhooks)
- [Deployment](../../wiki/Deployment) · [Upgrading](../../wiki/Upgrading) · [Costs and limits](../../wiki/Costs-and-Limits) · [Cloudflare Free plan limits](../../wiki/Cloudflare-Free-Plan) · [Security](../../wiki/Security) · [Troubleshooting](../../wiki/Troubleshooting)
- [Extending Murmur](../../wiki/Extending) · [Protocol](../../wiki/Protocol) · [Contributing](../../wiki/Contributing)

The wiki's source is the [`wiki/`](wiki) folder of this repository.

## How it works

```
your website ── <script src=".../loader.js"> ──┐
                                               ▼
                      Cloudflare Worker (your account)
                      ├─ widget files, chat API, dashboard
                      ├─ Workers AI ── answers, embeddings, reranking
                      ├─ Vectorize + D1 ── knowledge, conversations, leads
                      ├─ Workflow ── background jobs: crawls, files, summaries, webhook retries
                      └─ KV ── live config
```

The widget speaks one small REST protocol to the Worker; the Worker talks to
the AI backend through a connector. Sessions are stateless (signed tokens),
so there is no session store to run. Nothing leaves your Cloudflare account
except calls to an AI provider you chose.

## Working on Murmur

```bash
pnpm install
pnpm dev        # the Worker on :8787 and the widget playground on :5173, no API key needed
pnpm check      # lint, typecheck, tests, build, end-to-end
```

See [Contributing](../../wiki/Contributing) and [`CONTRIBUTING.md`](CONTRIBUTING.md).
Coding agents working on the repository start from [`AGENTS.md`](AGENTS.md).

## License

[MIT](LICENSE)
