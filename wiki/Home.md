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

For the agent path, copy the prompt from [[Using with AI agents|AI-Agents]], or
give your agent the shared [instructions.md](https://raw.githubusercontent.com/knowtific/helppuff/main/instructions.md).

## Start here

- **[[Getting started|Getting-Started]]**: install, the setup page, adding it to your site.
- **[[Using with AI agents|AI-Agents]]**: let Claude Code or another agent set it up and look after it.
- **[[The dashboard|Dashboard]]**: test chat, conversations, jobs, calendar, contacts, callbacks, analytics, settings.
- **[[Tutorials]]**: complete setups to copy, from order tracking to hot leads in Slack.

## Set it up your way

- **[[Configuration]]**: `helppuff.json`, `prompt.md` and `.env`, and how they relate to the dashboard.
- **[[Configuration reference|Configuration-Reference]]**: every option, generated from the schema.
- **[[CLI reference|CLI-Reference]]**: every command and flag.
- **[[Models and providers|Models-and-Providers]]**: the AI model and the knowledge base, chosen separately: Workers AI and your own site by default, or OpenAI, Gemini, Claude, any OpenAI-compatible API, AI Search, a vector store or your own code. See also [[AI models|AI-Models]] and [[Providers]].
- **[[Knowledge base|Knowledge-Base]]**: how it learns your site and your files, and how it finds answers.
- **[[Prompt and instructions|Prompts-and-Instructions]]**: how the assistant talks, and the prompt's version history.
- **[[Tools]]**: your own APIs, called before, during or after a chat.
- **[[Agent files|Agent-Files]]**: the whole setup as one file, to import, export or share.
- **[[The widget|Widget]]**: embedding, customising, and its JavaScript API.
- **[[Leads and callbacks|Leads]]** and **[[Webhooks]]**: where conversations and contact details go.
- **[[Email notifications|Email-Notifications]]**: an email for new leads, callbacks or live chats, through the email service you already use.
- **[[Jobs]]**: requests, quotes and work from the chat, on a board with your own stages.
- **[[Bookings and the calendar|Bookings]]** and **[[Integrations]]**: visitors book a time in the chat, synced with your calendar.
- **[[Signed-in visitors|Signed-In-Visitors]]**: tell the assistant who a signed-in customer is.
- **[[Live chat|Live-Chat]]** and **[[Telegram]]**: let visitors talk to a person on your team.

## Run it

- **[[Deployment]]**: what deploy creates on your account, and how changes go live.
- **[[Upgrading]]**: moving to a new release safely, and rolling back.
- **[[Costs and limits|Costs-and-Limits]]**: the free allowance, the daily budget, rate limits.
- **[[Cloudflare Free plan limits|Cloudflare-Free-Plan]]**: every Cloudflare limit that matters, and what happens when one runs out.
- **[[Security]]**: the threat model and what each layer protects. **[[Turn on Turnstile|Turnstile]]** before going live.
- **[[Testing and monitoring|Testing-And-Monitoring]]**: checking answers, and watching it once it is live.
- **[[Troubleshooting]]**: `helppuff doctor`, common errors and their fixes.

## Build on it

- **[[The API|API]]**: use HelpPuff from your own servers with API keys (chat, contacts, jobs, knowledge, settings).
- **[[Extending HelpPuff|Extending]]**: your own backend, webhooks, custom tools, connectors and lead destinations.
- **[[Protocol]]**: the widget ↔ server contract, for building your own server or client.
- **[[Contributing]]**: working on HelpPuff itself.

HelpPuff is MIT licensed.
