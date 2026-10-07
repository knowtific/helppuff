# The dashboard

Every deploy includes a dashboard at `https://<your worker>/admin/`. Its data
(conversations, leads, knowledge) lives in a D1 database on your Cloudflare
account. Everything it does is also available from the terminal through the
same admin API, so an agent can do it too.

**See it first:** the [dashboard demo](https://knowtific.github.io/helppuff/dashboard-demo/)
is the real dashboard with sample data, and the [tour](https://knowtific.github.io/helppuff/dashboard)
walks through each page.

**Signing in.** The first account is created from the one-time setup link
that `deploy` prints. After that, sign in with email and password, or run
`npx @knowtific/helppuff dashboard` in the project folder for a one-time sign-in
link (the way back in if you lose your password). Teammates:
`helppuff users add <email>`.

## Home

- **Try your assistant**: the real widget, full height, exactly as visitors get it.
- **Knows N pages**: how much it has learned, with a link to Knowledge.
- **Go live**: the script for your site (with **Check my site**) and a demo
  page to share with your team.

## Conversations

Every chat, with the full transcript, the page it started on, country,
ratings on replies, and the lead it produced. Five minutes after a chat goes
quiet, it is **summarised and labelled automatically**: what the visitor
wanted, intent, sentiment, lead quality (hot, warm, cold), outcome, topics,
the next step, and any questions the assistant could not answer (with a link
to add the answer). **Summarise** does it on demand. Filter by leads,
unsummarised, or search.

## Leads

One row per **person**, keyed by email: a visitor who comes back gets their
new chat added to the lead they already have. Each lead has a status (new →
contacted → qualified → won / lost), notes, the form's answers and how many
chats they have had. **Export CSV** for a spreadsheet or CRM. A person waiting
for a callback is labelled **Callback requested**. See [[Leads]].

## Callbacks

Visitors who asked to be called back, as a to-do list: name, tap-to-call
phone, email, what they want and a link to the conversation. Waiting ones
come oldest first, and the menu shows how many. **Done** (with a note) or
**Dismiss** closes one. See [[Leads|Leads#callbacks]].

## Knowledge

What the assistant has learned and where from:

- **Website pages** (collapsible): every page with its status and passages.
  **Choose pages** to change the selection; **Re-learn site** to crawl again.
- **Files**: upload PDF, Word, Markdown or text files (up to 10 MB). They
  are read and learned in the background.
- **Your own answers**: things that are not on the site, live as soon as you add them.
- **Test a question**: the passages it would answer from, best first, with scores.
- Today's use of the free AI allowance.

See [[Knowledge base|Knowledge-Base]].

## Analytics

Conversations and leads over time, conversion, top pages, countries, recent
questions. Choose 7, 30 or 90 days. **Became a lead** is the share of
conversations linked to a person who provided contact details; **messages per
conversation** counts visitor and assistant messages together. Countries come
from Cloudflare's request metadata; HelpPuff does not store visitor IP addresses
(only a salted hash of each, which the per-visitor limits count by).

## Settings

Opens as a menu in the sidebar:

| Page | What it changes |
| --- | --- |
| **Chat** | The assistant's name, the business name, the welcome message, suggested questions (**Suggest from my site** writes them) |
| **Appearance** | Colour (taken from your site), position, the button's icon |
| **Lead form** | The form before the chat: on/off, its fields, which are required, your own extra fields |
| **Instructions** | What it is mainly for, tone and answer length (settings HelpPuff adds around the prompt), and a box for anything specific to your business (the prompt itself). The full prompt, its version history and everything HelpPuff adds are one click away. See [[Prompt and instructions|Prompts-and-Instructions]] |
| **Business details** | Phone, email, address, hours, service areas: read from your site, yours to correct (a crawl never overwrites your changes) |
| **Advanced** | The AI model (see [[AI models|AI-Models]]), thinking (low, medium, high), "double-check answers before replying" (the reranker), how often the site is re-learned, time zone and language. **Limits and access**: every rate limit and cap, how long a chat lasts, IP addresses (or ranges) that are never limited or are blocked, and the sign-in limits and Turnstile on the sign-in form. See [[Security|Security#every-limit]] |
| **Webhooks** | Endpoints that receive every event as signed JSON; see [[Webhooks]] |
| **API keys** | Keys for the public API, to use HelpPuff from your own servers: name, what it may do (scopes or a preset), expiry, IP addresses. The key is shown once. The base URL and a curl example; see [[The API|API]] |
| **Team & security** | Who can sign in, and what to do when locked out |
| **Updates** | Checks the version running against the latest npm release, shows an update notice and command, and links to the [[upgrade instructions|Upgrading]] |

Changes are live within a minute. If you also keep the project in git, run
`helppuff config pull` (settings) and `helppuff prompt pull` (the prompt) to bring
dashboard changes into `helppuff.json` and `prompt.md`; `deploy` refuses to
overwrite them until you do.

## Team & security

The first person who claims the setup link is the owner. Add or remove
teammates from the project folder with `helppuff users add <email>` and
`helppuff users remove <email>`; reset a password with
`helppuff users reset <email>`. `helppuff dashboard` creates a one-time sign-in
link when someone is locked out. Password hashes and the admin API key remain
Worker secrets; the dashboard never shows them.

Signing out ends that session everywhere, even if the cookie was copied, and
changing a password (`helppuff users reset`) signs that account out of every
device. Wrong passwords are limited per address and per account; after five
for one email in 15 minutes (Settings → Advanced changes both) that account
waits, and a one-time link from `helppuff dashboard` still works. With
Turnstile set up (`security.captcha`), the sign-in form shows its check too:
add the dashboard's hostname to the Turnstile widget. Until Turnstile is on,
the Home page shows a **Before you go live** checklist with the hostnames to
add; see [[Turn on Turnstile|Turnstile]] and [[Security]].

## Turning it off

`helppuff config set dashboard.enabled false` and deploy. With the default
backend the D1 database stays, because it holds the knowledge base. With other
backends there is then no database at all, so nothing is stored; leads can
still go to a webhook (`leads.webhook`).
