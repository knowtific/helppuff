# Frequently asked questions

Short answers, each with the page that explains it fully.

## Getting started

**What is HelpPuff?**
An open-source (MIT) AI chat assistant for your website: the chat widget, the
server, a knowledge base learned from your site and a dashboard for
conversations and leads. It runs on **your own Cloudflare account**; there is
no HelpPuff service in between. See [[Home]].

**Do I need to know how to code?**
No. Paste one prompt into a coding agent (Claude Code, Codex, Cursor…) and it
sets everything up, or run `npx @knowtific/helppuff` and answer a few
questions. You need a Cloudflare account (free) and access to your website's
code or theme settings to paste one script. See
[[Getting started|Getting-Started]].

**Does it work with WordPress, Shopify, Wix, Webflow or Squarespace?**
Yes: anywhere you can add a `<script>` tag. The platform notes are in
[[Getting started|Getting-Started]].

**How long does setup take?**
A few minutes to deploy. Learning a typical site takes a few more minutes in
the background; the assistant answers from what it has learned so far.

**Can I run it for several websites?**
Yes: one project folder per site. Each gets its own Worker, database and
dashboard, named by its site id, so they never collide. See
[[Configuration|Configuration#several-sites]].

## Cost

**Is it free?**
HelpPuff is free and open source. You pay Cloudflare (and your AI provider,
if you choose one). The default setup fits Cloudflare's **Workers Free
plan**: about 300 answers a day. See [[Costs and limits|Costs-and-Limits]].

**What does it cost with more traffic?**
On Workers Paid ($5 a month) with the default model: roughly **$12 a month
at 1,000 messages a day, $55 at 5,000 and $108 at 10,000**. Other models and
providers range from about $8 to $2,400 a month at those volumes. The full
table: [[Costs at higher volume|Costs-and-Limits#costs-at-higher-volume]].

**Can a bot or an attacker run up my bill?**
Not past the caps you set. `security.limits.messagesPerSitePerDay` (500 by
default) and the daily AI budget stop answering when they are reached;
visitors then get your contact details and the callback form. Turnstile
stops scripts. See [[Security]] and [[Turn on Turnstile|Turnstile]].

**What happens when the free daily AI allowance runs out?**
Answers get shorter from 80%, and at 100% visitors get a short note with your
phone number and the callback form until 00:00 UTC. Leads still come in.

## Answers and the AI

**Where do the answers come from?**
From your website (crawled and learned), files you upload, answers you write
yourself and your business details. It only answers from what it found, and
says it is not sure (and offers a person) when nothing matches, rather than
guessing. See [[Knowledge base|Knowledge-Base]].

**How does it read my website?**
It finds your pages (sitemap, links), turns each into clean text, splits it
by headings into passages, and searches them by meaning and by keyword for
every question, then double-checks the best ones. All the details:
[[Knowledge base|Knowledge-Base]].

**Which AI model does it use? Can I use ChatGPT, Claude or Gemini?**
By default Workers AI (GLM-4.7 Flash) on your Cloudflare account, with no API
key. You can switch to OpenAI, Claude, Gemini, DeepSeek or any
OpenAI-compatible API with one command (`helppuff model set …`); the
knowledge base, tools and guardrails stay the same. See
[[Models and providers|Models-and-Providers]] and [[AI models|AI-Models]].

**It gave a wrong answer. How do I fix it?**
Dashboard → Knowledge → **Test a question** shows what it answered from. Add
the right answer under **Your own answers**, fix the page and re-learn it, or
adjust the prompt. **Questions to answer** lists what visitors asked that
nothing covered. See
[[Troubleshooting|Troubleshooting#the-assistant-says-it-is-not-sure-or-answers-wrongly]].

**Does it speak other languages?**
It replies in the visitor's language. The widget's own text (buttons,
labels) can be changed or translated in `widget.strings`. See
[[The widget|Widget]].

**Can it book appointments, take quotes or look up orders?**
Yes. Bookings show a date picker in the chat (the AI never books by itself;
see [[Why the AI never books|AI-Booking-Tests]]). Quotes become [[Jobs]].
Your own APIs (order status, stock, CRM) become [[Tools|Tools]] the assistant
can call.

**Can a person take over the chat?**
Yes, with [[Live chat|Live-Chat]]: the visitor asks for a person, your team
answers in the dashboard or in [[Telegram]], and hands the chat back to the
assistant when done. When nobody is available, the visitor gets the callback
form.

**What are the questions on the chat's home screen?**
The **starter questions**: buttons that send a question for the visitor.
They are written from your website after the first crawl, and you can edit
them in Settings → Home screen or with `helppuff knowledge suggest --apply`.
See [[Starter questions|Widget#starter-questions]].

## Your data and privacy

**Where is my data stored?**
In your Cloudflare account only: conversations and leads in your D1
database, knowledge in D1 and Vectorize, settings in KV. HelpPuff receives
none of it. With another AI provider, the messages of each answer are sent to
that provider. See [[Security]].

**Does it store IP addresses or personal data?**
No IP addresses: the country, and a salted hash used for the per-visitor
limits. Names, emails and phone numbers are stored only when a visitor gives
them (a form, a callback request). Logs never contain message text or
contact details.

**How do I delete someone's data ("forget me")?**
Delete the contact: their conversations, messages, files, callback requests,
notes, jobs and appointments go with it. It asks first, and cannot be undone.
See [[Deleting a contact|Leads#deleting-a-contact-forget-me]].

**How do I remove HelpPuff completely?**
`helppuff destroy --yes` deletes everything it created on Cloudflare,
including the database. Your local files stay.

## The widget and your site

**Will it slow my site down?**
The loader is under 8 KB (gzipped) and loads asynchronously; the chat itself
loads when needed, from Cloudflare's edge. If anything fails, the widget hides
itself instead of breaking your page. See [[The widget|Widget]].

**Can I change how it looks?**
Colours, position, launcher, fonts, the home screen and all wording, in
Settings or `widget` in `helppuff.json`, with a live preview in the
[[playground|Playground]]. "Powered by HelpPuff" always stays.

**Can I use my own domain instead of workers.dev?**
Yes: `helppuff domain add chat.yourdomain.com`. The domain must be on the same
Cloudflare account. See [[Your own domain|Deployment#your-own-domain]].

**Is it accessible?**
Yes, accessibility comes before visual design: keyboard navigation, screen
reader labels, focus handling and reduced motion are built in and tested.

## Running it

**How do I update to a new version?**
`npx @knowtific/helppuff@latest upgrade`. It shows what changes, keeps a
database restore point and then deploys. See [[Upgrading]].

**Where do I see errors and logs?**
`helppuff doctor` checks everything and prints the fix for each problem;
`helppuff logs` shows live requests, with every failure and its reason.
Cloudflare's dashboard keeps stored logs (Worker → Observability). See
[[Troubleshooting]].

**Can my team use the dashboard?**
Yes: invite people as **admins** (everything) or **members** (conversations,
jobs, contacts, callbacks, live chat). See [[The dashboard|Dashboard]].

**Is there an API?**
Yes: a REST API with scoped keys for conversations, leads, jobs, knowledge,
settings and more, plus signed [[Webhooks]] for events. See [[The API|API]].

**Something is not working. Where do I start?**
Run `npx @knowtific/helppuff doctor`, then see [[Troubleshooting]]. Still
stuck? Open an issue on GitHub with the output of `helppuff doctor --json`.
