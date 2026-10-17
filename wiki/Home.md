<p class="wiki-logo">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/knowtific/helppuff/main/logo/helppuff-lockup-dark.svg">
    <img src="https://raw.githubusercontent.com/knowtific/helppuff/main/logo/helppuff-lockup.svg" alt="HelpPuff" height="56">
  </picture>
</p>

# HelpPuff

HelpPuff is an open-source AI chat assistant for websites that runs entirely on
**your own Cloudflare account**: the chat widget, the server, a knowledge base
learned from your website, and a dashboard for conversations and leads. The
default setup runs on the **Workers Free plan**.

It is **AI-agent first**. You don't configure it by hand (though you can):
make a folder, open your coding agent in it (Claude Code, Codex, Cursor,
OpenCode…) and paste this prompt:

> Follow the HelpPuff instructions at https://raw.githubusercontent.com/knowtific/helppuff/main/instructions.md and set up HelpPuff in this folder. Complete setup automatically with the recommended free defaults. Ask me only for information you cannot determine safely or authorization I must complete. Continue until it is deployed, added to the website when possible, tested with real questions, and you have given me the dashboard, embed and preview links.

The agent deploys it, learns your website, tests it with real questions and
gives you the dashboard link. Later, ask it for any change ("make the button
orange", "turn on live chat"). See [[Getting started|Getting-Started]].

Prefer the terminal? `npx @knowtific/helppuff` asks for your website and
gives you a setup link.

## Start here

- **[[Getting started|Getting-Started]]**: one prompt to your AI agent (or one command), the setup page, adding it to your site.
- **[[Using with AI agents|AI-Agents]]**: what your agent does, and the changes you can ask it for.
- **[[The dashboard|Dashboard]]**: test chat, conversations, jobs, calendar, contacts, callbacks, analytics, settings.
- **[[Tutorials]]**: complete setups to copy, from order tracking to hot leads in Slack.
- **[[FAQ]]**: short answers to the common questions (cost, data, models, your own domain), each with its page.

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
- **[[Email notifications|Email-Notifications]]**: an email for new leads, callbacks, live chats, jobs and bookings, through the email service you already use; everyone picks their own.
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
