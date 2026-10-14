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
Use the eye button beside a password or secret field to check what you typed
before signing in or saving. Saved secret values remain hidden.
Account setup shows an approximate password strength indicator while you type;
the minimum is 10 characters.

**Your account.** Your name at the bottom of the sidebar opens a menu: who
is signed in and their role, your [Notifications](#settings) (the emails you
get), the light or dark theme, help, and **Sign out**.
The tab uses the yellow HelpPuff icon; a red count appears on it when a live
chat or message needs your attention.

## Home

- **Try your assistant**: the real widget, full height, exactly as visitors get it.
- **Knows N pages**: how much it has learned, with a link to Knowledge.
- **Go live**: the script for your site (with **Check my site**) and a demo
  page to share with your team.

## Conversations

Every chat, with the full transcript, the page it started on, country,
ratings on replies, and the lead it produced. When **Summary** is on in
**Prompt & tools**, five minutes after a chat goes quiet, it is **summarised
and labelled automatically**: what the visitor
wanted, intent, sentiment, lead quality (hot, warm, cold), outcome, topics,
the next step, and any questions the assistant could not answer (with a link
to add the answer). **Summarise** does it on demand.

Each conversation has a **status**: *AI bot* (the assistant answers), *Live
agent* (a person has it; see [[Live chat|Live-Chat]]) or *Closed* (by the
team, or after an hour without a message; it reopens with the assistant when
the visitor writes again). Filter by status (*All*, *AI bot*, *Live agent*),
by what else matters (*Waiting for a reply*, *With contact*, *Callback
waiting*, *Not summarised*) and by label, or search. Your filters are
remembered in your browser. A live chat waiting for your reply has an orange
**Waiting** mark, and the menu shows how many are waiting.

Beside each conversation:

- **Labels**: tag it to find it later (see [Labels](#labels)).
- **Attributes**: your own key-value details, like an order number or a plan;
  also set over the API.
- **Notes**: private notes for the team. The visitor and the assistant never
  see them.

### Labels

Settings → **Labels** defines them: a name, a colour, and what it means.
Anyone on the team can put them on a conversation. When a conversation goes
quiet, the AI labels it too, with the labels it may use (**AI may use**),
guided by what each means; it never invents one, and never removes one a
person added. Labels are in the API (`GET /conversations?label=…`) and in
`conversation.completed` (`tags`).

### Custom fields

Settings → **Custom fields** lists every conversation and contact attribute
key used on saved records, plus keys added there before they have a value.
Admins can add, rename and remove keys. Renaming moves existing values to
the new key on every record; removing a key deletes its values on every
record, after a confirmation. These attributes remain text values that the
team or API can set on each conversation or contact. A removed key can appear
again if a tool or API call writes it later.

The same page shows the **Jobs** field editor: add, edit, reorder or remove
job fields, including their type and whether they are required. Removing a
job field keeps its values on older jobs. The full pipeline editor is also
in Settings → Jobs.

## Jobs

Requests, quotes and work on a board, one column per stage: drag a card (or
use its menu) to move it, drop it on **Done** or **Lost** to close it. A job
has its fields, updates, private notes, the contact and conversation it came
from, and its whole history. **List** shows them all, won and lost too. They
come from the assistant, the widget's quote questions, the API and by hand
(also from a contact, a conversation or a callback request). The first time
the AI sets them up from your website, Home says what it chose. See [[Jobs]].

## Calendar

With the [[date picker|Bookings]] on: every appointment as a list, a month,
a week or a day. **+ New** books one by hand (written to the synced calendar
too); click one to move it, mark it completed or a no-show, or cancel it;
**Sync** reads the synced calendar now. Jobs, contacts and conversations show
their appointments too. See [[Bookings and the calendar|Bookings]].

## Contacts

One row per **person**, keyed by email: a visitor who comes back gets their
new chat added to the contact they already have. Click one for their page:

- **Details**: name, email, phone, company and address, all editable.
- **Attributes**: any other details, as key-value pairs (also over the API).
- **Tags**: several per person, managed in Settings → Contact tags and used to
  filter the Contacts list. They are separate from conversation labels.
- **Notes**: the team's dated notes, with who wrote each.
- **Conversations**: every chat, with its status and labels.
- **History**: chats, callbacks and notes, newest first.

Jobs track the stages of each request or piece of work. Older contact status
values are retained for API compatibility; non-default values become
**Previously marked …** tags. **Export CSV** includes tags for a spreadsheet
or CRM. A person waiting for a callback is
labelled **Callback requested**. See [[Leads]].

## Callbacks

Visitors who asked to be called back, as a to-do list: name, tap-to-call
phone, email, what they want and a link to the conversation. Waiting ones
come oldest first, and the menu shows how many. **Done** (with a note) or
**Dismiss** closes one. See [[Leads|Leads#callbacks]].

## Knowledge

In **Settings → Knowledge** (it is set up once and checked now and then, so
it is not in the main menu). What the assistant has learned and where from:

- **Website pages** (collapsible, directly below the site-learning status in
  the same box): every page with its status and passages.
  **Choose pages** to change the selection; **Re-learn site** to crawl again;
  **Try again** on a failed page (or all of them), without changing the selection.
- **Files**: upload PDF, Word, Markdown or text files (up to 10 MB). They
  are read and learned in the background.
- **Questions to answer** (at the top): what visitors asked that the knowledge base does not cover, most asked first. **Answer** saves your answer as one of your own answers, live at once; **Dismiss** takes one off the list. See [[Questions to answer|Knowledge-Base#5a-questions-to-answer]].
- **Your own answers**: things that are not on the site, live as soon as you add them.
- **Test a question**: the passages it would answer from, best first, with scores.
- Today's use of the free AI allowance.

See [[Knowledge base|Knowledge-Base]].

## Analytics

Is the assistant helping? Choose 7, 30 or 90 days; every headline number is
compared with the period before (and says whether that is better or worse).
Nothing extra is tracked for it: it is read from the conversations, their AI
summaries, ratings, live chat, callbacks, jobs and bookings HelpPuff records
anyway.

- **Needs attention** (only when something is wrong): a failing webhook, email
  notifications or a tool, days the AI budget ran out, pages of your site it
  could not learn; each with a link to fix it.
- **The headline**: conversations; **solved by the assistant** (of the
  summarised ones, answered or a lead, with no person); **became a contact**;
  **needed a person** (a live chat or a callback); **could not answer**
  (conversations with a question it could not answer); **rated helpful**
  (thumbs up of all ratings).
- **Activity**: conversations and leads per day.
- **How conversations ended** (answered, booked a time or a job, left their
  details, asked for a callback, could not answer, left without an answer), and **engagement**:
  messages per conversation, the typical length (first to last message, the
  median), how many left after one message, and visitors who came back. With
  the mood and lead quality the AI gave each one.
- **Questions to answer**: what visitors asked about the business that the
  knowledge base does not cover, most asked first, each with **Answer** (it
  becomes one of your own answers) and **Dismiss**. And **what visitors ask
  about** (the summaries' topics).
- **Live chat** (asked for a person, answered, nobody took it, the typical wait
  for the team's first reply, who took them) and **callbacks** (requested,
  done, still waiting, the typical time to call back).
- **Jobs** (new, from the chat, won and their value, lost) and **bookings**
  (booked, by visitors in the chat, completed, no-shows, cancelled), when you
  use them.
- **When visitors chat** (by hour, in your time zone: when someone should be
  around for live chat), **where chats start** and **countries**.

Summaries are made five minutes after a chat goes quiet, so the last few
minutes show as *not summarised yet*. Countries come from Cloudflare's request
metadata; HelpPuff does not store visitor IP addresses (only a salted hash of
each, which the per-visitor limits count by). The same numbers are in the API:
`GET /overview` ([[Analytics|API-Reference-Analytics]]).

## Settings

Opens as a menu in the sidebar, in four groups: **Assistant** (Instructions,
Prompt & tools, Knowledge, Business details, Bookings, Import & export),
**Widget** (Chat, Home screen, Appearance, Lead form), **Inbox & CRM** (Live
chat, Labels, Contact tags, Custom fields, Jobs, Notifications) and **System**
(Advanced, Webhooks, Integrations, API keys, Team & security, Updates). What each
page is for is behind the (?) beside its title.

**No need to set them by hand:** every page has **Ask your AI agent**, with a
request to copy into Claude Code, Codex or Cursor in your project folder. The
agent goes through that page with you and changes it through the same API
(see [[AI agents|AI-Agents#let-your-agent-set-it-up-with-you]]).

| Page | What it changes |
| --- | --- |
| **Chat** | The assistant's name, the business name, the welcome message |
| **Home screen** | What visitors see when they open the chat: the heading, the buttons (questions, a page, call, email, a form) and useful pages, with a preview. Suggested from your website until you save it; **Suggest from my site** adds more. See [[The widget|Widget#the-home-screen]] |
| **Appearance** | Colour (taken from your site), position, the button's icon |
| **Lead form** | The form before the chat: on/off, its fields, which are required, your own extra fields |
| **Instructions** | What to do when a visitor is interested, tone, answer length and prices: settings HelpPuff adds around the prompt |
| **Prompt & tools** | A chat as a diagram: [[tools|Tools]] before it, the prompt (click it to edit, add tools and see its history and everything HelpPuff adds) with Knowledge above and Webhooks below, then optional AI post-processing (summary, labels, contact details, questions to answer; one switch) and the tools after it. See [[Prompt and instructions|Prompts-and-Instructions]] |
| **Knowledge** | What it has learned; see [Knowledge](#knowledge) above |
| **Bookings** | How visitors book: not at all, through your booking page, or a date picker in the chat that HelpPuff books (the AI never does); the calendar it syncs with, the hours, and a live preview. See [[Bookings]] |
| **Import & export** | The whole setup (prompt, tools, behaviour and lead form) as one [[agent file|Agent-Files]]: start from a [[tutorial's template|Tutorials]], import a file, or download this site's |
| **Business details** | Phone, email, address, hours, service areas: read from your site, yours to correct (a crawl never overwrites your changes) |
| **Live chat** | Let visitors talk to a person; how long they wait before the callback form; when conversations close; [[Telegram]]. See [[Live chat|Live-Chat]] |
| **Labels** | The labels for conversations, and which the AI may use |
| **Contact tags** | Categories for people, editable and filterable in Contacts; a person can have several |
| **Custom fields** | Attribute keys on conversations and contacts, and the job field editor |
| **Jobs** | The template (and **Let the AI choose again**), what a job is called, the stages, the fields, the widget's quote questions, and a `curl` to send jobs from other tools. See [[Jobs]] |
| **Notifications** | Your own: the emails you get (new contacts, hot leads, callbacks, a visitor waiting for a person, jobs, bookings), and with live chat on, browser notifications, sound and whether you are available. Everyone on the team sets their own; admins also connect the **email service** that sends them. See [[Email notifications|Email-Notifications]] |
| **Advanced** | The AI model (see [[AI models|AI-Models]]), thinking (low, medium, high), "double-check answers before replying" (the reranker), how often the site is re-learned, time zone and language. **Limits and access**: every rate limit and cap, how long a chat lasts, IP addresses (or ranges) that are never limited or are blocked, and the sign-in limits and Turnstile on the sign-in form. See [[Security|Security#every-limit]] |
| **Webhooks** | Endpoints that receive every event as signed JSON, or as your own request for a service with its own format (Slack, a CRM); see [[Webhooks]] |
| **Integrations** | Keys for Composio (Google Calendar, Outlook), Cal.com and Calendly, each with a check; shown while the date picker is on. See [[Integrations]] |
| **API keys** | Keys for the public API, to use HelpPuff from your own servers: name, what it may do (scopes or a preset), expiry, IP addresses. The key is shown once. The base URL and a curl example; see [[The API|API]] |
| **Team & security** | Who can sign in and their role, invitations, and what to do when locked out |
| **Updates** | Checks the version running against the latest npm release, shows an update notice and command, and links to the [[upgrade instructions|Upgrading]] |

Changes are live within a minute. If you also keep the project in git, run
`helppuff config pull` (settings) and `helppuff prompt pull` (the prompt) to bring
dashboard changes into `helppuff.json` and `prompt.md`; `deploy` refuses to
overwrite them until you do.

## Team & security

The first person who claims the setup link is the owner. Everyone else has a
**role**:

| Role | Can |
| --- | --- |
| **Admin** | Everything, like the owner (except removing the owner) |
| **Member** | Conversations (read, reply in live chats, take, close, label, notes, attributes), jobs (create, move, edit, updates, notes), contacts, callbacks, and their own notifications (which emails they get). No settings, knowledge, prompt, analytics, webhooks or API keys; cannot delete anything or give a chat to someone else |

In Settings → **Team & security**, choose **Add team member** to open the invite
form (name, email, role). After you invite someone, the form closes and their
one-time sign-in link appears in a separate box to copy and send. Change a
role there, or manage people from the project folder:
`helppuff users add <email> --role member`, `helppuff users role <email>
admin`, `helppuff users remove <email>`; reset a password with
`helppuff users reset <email>`. The name is what visitors see when that
person answers a live chat. `helppuff dashboard` creates a one-time sign-in
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

### Locked out, or changing the admin key

- **Locked out?** In the folder you set up in, run
  `npx @knowtific/helppuff dashboard`. It prints a one-time sign-in link.
- **Change the admin key** (what the CLI and coding agents use): delete
  `ADMIN_API_KEY` from `.env` and run `helppuff deploy`. A new key is made
  and set on the Worker; the old one stops working.

Both keys live only in your project's `.env` and as Worker secrets on your
Cloudflare account.

## Turning it off

`helppuff config set dashboard.enabled false` and deploy. With the default
backend the D1 database stays, because it holds the knowledge base. With other
backends there is then no database at all, so nothing is stored; leads can
still go to a webhook (`leads.webhook`).
