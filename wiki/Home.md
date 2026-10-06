# HelpPuff

HelpPuff is an open-source AI chat assistant for websites that runs entirely on
**your own Cloudflare account**. One command sets up the chat widget, the
server, a knowledge base learned from your website, and a dashboard for
conversations and leads. The default setup runs on the **Workers Free plan**.

```bash
npx @knowtific/helppuff
```

It asks for your website, deploys, and gives you one link: a setup page where
you create your sign-in and check what it learned. Coding agents (Claude Code,
Codex, Cursor…) can do the whole thing for you; see [[Using with AI agents|AI-Agents]].

## Start here

- **[[Getting started|Getting-Started]]**: install, the setup page, adding it to your site.
- **[[Using with AI agents|AI-Agents]]**: let Claude Code or another agent set it up and look after it.
- **[[The dashboard|Dashboard]]**: test chat, conversations, leads, knowledge, analytics, settings.

## Set it up your way

- **[[Configuration]]**: `helppuff.json`, `prompt.md` and `.env`, and how they relate to the dashboard.
- **[[Configuration reference|Configuration-Reference]]**: every option, generated from the schema.
- **[[CLI reference|CLI-Reference]]**: every command and flag.
- **[[Providers]]**: Workers AI (default), Cloudflare AI Search, OpenAI, Gemini, Claude, Retell, or your own API.
- **[[Knowledge base|Knowledge-Base]]**: how it learns your site and your files, and how it finds answers.
- **[[Prompt and instructions|Prompts-and-Instructions]]**: how the assistant talks, and the prompt's version history.
- **[[The widget|Widget]]**: embedding, customising, and its JavaScript API.
- **[[Leads and callbacks|Leads]]** and **[[Webhooks]]**: where conversations and contact details go.

## Run it

- **[[Deployment]]**: what deploy creates on your account, and how changes go live.
- **[[Upgrading]]**: moving to a new release safely, and rolling back.
- **[[Costs and limits|Costs-and-Limits]]**: the free allowance, the daily budget, rate limits.
- **[[Cloudflare Free plan limits|Cloudflare-Free-Plan]]**: every Cloudflare limit that matters, and what happens when one runs out.
- **[[Security]]**: the threat model and what each layer protects.
- **[[Troubleshooting]]**: `helppuff doctor`, common errors and their fixes.

## Build on it

- **[[Extending HelpPuff|Extending]]**: your own backend, webhooks, custom tools, connectors and lead destinations.
- **[[Protocol]]**: the widget ↔ server contract, for building your own server or client.
- **[[Contributing]]**: working on HelpPuff itself.

HelpPuff is MIT licensed.
