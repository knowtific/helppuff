# Changelog

All notable changes to `@knowtific/helppuff`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): upgrading within a major version
never needs you to change anything. Upgrade with
`npx @knowtific/helppuff@latest upgrade` (see the wiki's Upgrading page).

## [Unreleased]

## [0.9.1] - 2026-10-14

### Fixed

- Settings → Integrations now opens from the booking calendar sync link before
  the date picker has been saved.

## [0.9.0] - 2026-10-14

### Added

- **Photos and files**, kept in your own Cloudflare R2 bucket (private; every
  link is signed and expires). Both are off by default and turned on
  separately, in Settings → Advanced → *Photos and files* or with the new
  `helppuff files` command:
  - **In the chat** (`files.chat`): visitors send photos and PDFs with a
    paperclip next to the message box, only while a person has the chat
    (`live`, the usual choice) or any time (`always`). Photos are made smaller
    in the browser and lose their location data. The team sees them in the
    conversation and the live chat, and as links on Telegram. The assistant
    is told a file arrived but never opens it, unless **the assistant sees
    photos** is on: then a Workers AI vision model (Llama 4 Scout by default)
    describes each photo once and the assistant reads that.
  - **On jobs** (`files.jobs`): a Files section on every job (drop or attach
    photos, PDFs, Office documents, text, CSV, MP4/MOV), with the photos the
    visitor sent in the job's conversation. Members attach and remove their
    own. `helppuff jobs attach|files|detach`, and `GET/POST /jobs/:id/files`,
    `DELETE /jobs/:id/files/:fileId` in the API.
  - Limits on Settings → Advanced and in `helppuff.json`: the largest file
    from visitors and on jobs, files per chat, how long chat files are kept
    (90 days; job files stay until removed), and
    `security.limits.uploadsPerIpPerHour`.
- `helppuff deploy` makes the R2 bucket (`knowtific-helppuff-<site>`) whenever
  the Cloudflare account has R2 on, so turning files on needs no redeploy.
  Without R2 the deploy goes on, and says how to turn it on only when files
  are on. `helppuff doctor` checks it.

### Upgrading

- Run `helppuff upgrade`: it adds the `files` table to the database and makes
  the bucket. To use files, R2 must be turned on once for the Cloudflare
  account (the dashboard asks a person to accept the plan, free up to 10 GB).
  An API token (instead of `wrangler login`) needs **Workers R2 Storage ›
  Edit** too.

## [0.8.0] - 2026-10-14

### Changed

- The prompt editor says how to use a tool (`{{ tool_name }}`), with a link to
  the Tools page in the docs.
- On Prompt & tools, the Summary & labels step is now **AI post-processing**:
  one switch, with what it does listed under it (summary, labels, contact
  details typed in the chat, questions to answer) and a Learn more link.
- The Settings group that held Live chat, Labels, Contact tags, Custom fields,
  Jobs and Notifications is now called **Inbox & CRM** (it was "Team", easy to
  mix up with Team & security).

- **"Powered by HelpPuff" is always shown** in the widget. `widget.poweredBy`
  no longer hides or replaces it: older configs with it still load, and the
  value is ignored. `strings.poweredBy` can still translate it, as long as the
  translation says HelpPuff. The credit now links to the HelpPuff website.
- The README, the docs and the website lead with setting HelpPuff up through
  your AI agent: make a folder, open your agent in it, paste one prompt, then
  ask it for any change. The shared instructions handle a new, empty folder
  (they work in it and ask for the website address). The CLI is still there
  if you'd rather run it yourself.

### Fixed

- "You're back with the assistant" no longer appears twice in a conversation.
  Reopening a chat the assistant already had (one that only went quiet) adds
  no notice, and two hand-backs at once (two clicks, or the dashboard and
  Telegram) write one.

## [0.7.0] - 2026-10-13

### Changed

- Added `helppuff logs` to tail a deployed Worker's Cloudflare logs using the
  existing Wrangler login or Cloudflare API token; `--json` captures a short,
  bounded set of events for scripts.
- Team invites open from an Add team member button. After an invite, the form
  closes and the one-time sign-in link appears in a separate copyable box.
- Contacts now use multiple site-defined tags, editable in Settings → Contact
  tags and on each contact, with tag and untagged filters on the Contacts list.
  Existing non-default statuses become clearly named legacy tags; the old
  status API and CSV column remain for integrations. Job outcomes no longer
  change a person's old status field.
- Prompt & tools now has a Summary switch. It turns automatic summaries, AI
  labels and questions to answer off or on for new chats; after-chat tools and
  webhooks continue, and manual summaries remain available.
- New **Save what the visitor says** tools are created under After the chat.
  They read the finished visitor transcript, save stated values as conversation
  attributes, then pass them to after-chat requests and webhooks. Existing
  extract tools keep their current timing until moved.
- Knowledge groups Website pages directly beneath the site-learning status in
  one card.
- Dashboard password and secret fields have an eye button to show or hide what
  you typed, including sign-in, account setup, and settings. Account setup also
  shows an approximate password strength indicator as you type.
- Settings → Custom fields lists conversation and contact attribute keys and
  the job field editor. Admins can add, rename and remove keys; changes to
  conversation and contact keys update their saved records.
- Dashboard pages are quieter. How-tos moved to the wiki behind a link (API
  keys' examples, Team & security's commands, why upgrades run in the
  terminal, creating jobs from other tools, webhook signatures), and
  secondary details fold away (the quote questions' preview, Turnstile's
  hostnames, an integration's key). Integrations you have not connected are a
  row with **Connect**. **Questions to answer** shows only when there is one,
  highlighted like **Before you go live**.
- Jobs board: while you drag, every column shows where the job can go, and
  the column under the pointer opens a space exactly where it will land,
  including between jobs in the same column. Cards slide out of the way and
  into place (no motion with reduced motion turned on).
- The public API (`/api/v1`) can create, rename and delete contact tags
  (`/contact-tags`) and custom fields (`/attribute-definitions`), with the
  `settings:write` scope; `PATCH /leads/:id` takes `tags`.

### Fixed

- Settings → Webhooks: the signing note is one line with a link. The wiki's
  Webhooks page now has a worked signature example to test against, and
  Node.js, Python and PHP receivers.
- The new tool dialog puts **Paste a curl** and **Fill it in** below the tool
  type choices, so the two decisions appear on separate rows.
- Bookings shows a discovered external booking URL as the Booking page field's
  value instead of placeholder text; keeping or editing it saves an explicit
  link.
- The dashboard tab keeps the yellow HelpPuff favicon after loading and while
  showing a live notification count.
- Home screen: **Suggest from my site** skips buttons already present by label
  or action, including duplicates within a batch of suggestions, and avoids
  repeating useful pages.

## [0.6.1] - 2026-10-12

### Changed

- The playground shows the booking date picker: a **Book a time** shortcut
  on the home screen and a **Booking** message button, booked in the page.
  The `echo` test backend answers `/booking` with the picker too.
- New wiki page, **The playground**: its panel, and how a link to a setup
  works (the whole setup is in the link; nothing is stored).
- The widget's CSS variables and base styles are minified in the bundle
  like the rest of its CSS: about 0.5 KB less to download.

### Fixed

- Widget: a chat opened by the page itself (`data-open`, such as the
  dashboard's test chat) no longer moves focus into the chat. Focus stays
  where the visitor has it; opening the chat yourself still moves it in.
- Dashboard: Escape closes the account menu even before focus has moved
  into it.

## [0.6.0] - 2026-10-12

### Added: email notifications and webhooks in your own format

- **Email notifications.** An admin connects the email service you already
  use, once, in **Settings → Notifications** (or `helppuff email set`):
  Resend, Postmark, SendGrid and Brevo are filled in from the address to
  send from and the key; any other service works with its own request.
  HelpPuff writes each email (a plain-text body, and an HTML one with
  everything a visitor wrote escaped) and sends it with `{{email.to}}`,
  `{{email.subject}}`, `{{email.text}}` and `{{email.html}}`. The key is
  stored encrypted. **Send me a test**, pause and remove.
- **Everyone chooses their own emails**, members too: new contact, hot lead
  (with the AI's summary), callback request, a visitor wants a person, a live
  chat nobody took, a chat given to me (only to that person), new job, new or
  cancelled booking, and the AI budget used up (admins). Nothing is sent
  until a person ticks it; someone removed from the team gets nothing more.
  Settings → Notifications is there for everyone now, with live chat off too.
- **Webhooks in your own format.** A webhook can send your own request
  instead of the signed JSON, for a service that wants its own format
  (Slack, a CRM, an SMS API): the method, headers (credentials stored
  encrypted) and a body with `{{event.type}}` and `{{data.…}}`. Retries,
  the delivery log and the X-HelpPuff-* signature work the same. In the
  dashboard (**Your own request**), `helppuff webhooks add … --header …
  --body …`, `helppuff webhooks set`, and the API (`format: "custom"`).
- The API: `GET`, `PUT` and `DELETE /notifications/email` and
  `POST /notifications/email/test` (scopes `webhooks:read`/`write`).
- One D1 migration (15), additive: four columns on `webhooks` and the
  `email_service` table. `helppuff upgrade` applies it.

### Added: questions to answer

- After each conversation, the questions about the business the assistant
  could not answer are checked against the knowledge base; the ones it does
  not cover join **Questions to answer** (Knowledge, and Analytics), most
  asked first. Off-topic questions, and ones the instructions say not to
  answer (the summary now sees your settings and prompt), are left out.
- **Answer** opens a dialog; the answer becomes one of **Your own answers**,
  live at once. **Dismiss** takes a question off the list.
- A new question sends `knowledge.gap` to webhooks and an email to whoever
  chose **A question to answer**. `helppuff knowledge gaps`, `answer` and
  `dismiss`; `GET /knowledge/gaps`, `POST /knowledge/gaps/:id/answer`,
  `PATCH /knowledge/gaps/:id`. One more D1 migration (16), additive.
- Summaries tell **booked** (an appointment or a job was made) from other
  outcomes; it counts as solved by the assistant in Analytics.

### Added: analytics that say whether the assistant is helping

- **Analytics** is rebuilt around how much the assistant handles: solved by
  the assistant alone, became a contact, needed a person (live chat or a
  callback), could not answer and rated helpful, each against the period
  before; how conversations ended; engagement (messages, typical length, left
  after one message, came back); the questions it could not answer, most
  asked first; topics, mood and lead quality; live chat (answered, missed,
  typical wait, by person); callbacks (done, waiting, time to call back);
  jobs won and their value; bookings and no-shows; chats by hour.
- **Needs attention** at the top lists what is failing: webhooks, email
  notifications, tools, days the AI budget ran out, pages it could not learn,
  each with where to fix it.
- The latest questions and new leads lists left the page (Conversations and
  Contacts have them). `GET /overview` keeps them for older integrations and
  adds `headline`, `insights` and `health`.

### Changed

- **A new HelpPuff logo**: a "p" whose bowl is a speech bubble and whose
  tail ends in a small puff, in oxblood and electric citron (the website's
  new palette: oxblood on light, citron on dark). It is the favicon of the website, the
  playground and the dashboard (where the unread count sits on it, in your
  site's colour), and is in the README. Sources, a one-colour version,
  lockups and icons are in `logo/`.
- **Dashboard**: the logo sits beside your site's name at the top of the
  sidebar and on the sign-in and setup pages. The person at the bottom of
  the sidebar opens a menu: who is signed in and their role, Notifications,
  the theme, help, and Sign out.
- The website now gives the widget's size as about 35 KB gzipped, loaded
  after the page. It used to say 6 KB (that is only the loader) and that
  the rest loaded only when a visitor opened the chat, but it loads once
  the page is idle.
- New wiki page, **Email notifications**: an email for new or hot leads
  through your own email service (Resend, Postmark or any send API), or for
  any event through a webhook and n8n, Make or Zapier.

### Fixed

- Dashboard: **Export CSV** downloads the file without leaving the page; a
  failed export shows an error instead of replacing the dashboard (the
  website's demo exports its sample contacts too).
- Dashboard: the **New job** and appointment dialogs close with Escape, take
  focus when they open and give it back when they close.
- Dashboard: copy buttons no longer fail silently where the browser refuses
  the clipboard: the text is selected to copy by hand.
- Dashboard: the two **Learn more** links in Settings → Bookings opened a
  broken page; they open the wiki.
- Dashboard: the two-way toggles (like **List**/**Board**) no longer submit
  the form they sit in.
- The audit log lists changes made in the same millisecond newest first, not
  in any order.

## [0.5.0] - 2026-10-12

### Added: booking in the chat

- **Settings → Bookings** chooses how visitors book: **No appointments**,
  **External booking link** (a *Book a time* button that opens your booking
  page) or **Date picker in the chat**. Until you choose, a booking link found
  on your website (Calendly, Cal.com, Acuity, SavvyCal, HubSpot meetings and
  others, or a "Book a call" page) is offered for you.
- **The date picker:** the visitor picks a free time in a calendar in the
  chat, in their own time zone, adds their name and email and presses
  **Book**. HelpPuff checks the time is one it offered and still free, holds
  it (no double bookings, even on a double click), books it and shows a card
  with **Change time** and **Cancel booking**. **The AI never books:** the
  assistant opens the calendar (`show_booking`), narrowed to what the visitor
  asked for, and is told what was booked. Why: the wiki's *Why the AI never
  books* page, with the tests behind it.
- **Calendar sync**, both ways: none (HelpPuff keeps the appointments, with
  your hours, gaps, notice and days ahead), Cal.com (cloud or self-hosted,
  with an instant webhook), Calendly (on a free plan the visitor finishes on
  Calendly's page and the booking is read back), and Google Calendar or
  Outlook through Composio. Events made in the calendar show in HelpPuff:
  on a job when an attendee is a contact, else as busy time.
- **Appointments are part of jobs**: a booking joins the contact's open job or
  makes one, and goes into its history. A **Calendar** page (list, month,
  week, day; **+ New**; **Sync**) and an **Appointments** section on jobs,
  contacts and conversations appear with the date picker on.
- **Settings → Integrations**: keys for Composio, Cal.com and Calendly,
  sealed and live at once, each with a check; Composio calendar accounts
  are connected through its sign-in page and picked from a list.
- The API: `/appointments` (list, get, book, change, delete, sync; `jobs:*`
  scopes), `/bookings` (what is in force, free times, the calendar check) and
  `/integrations`. The CLI: `helppuff bookings`, `helppuff appointments` and
  `helppuff integrations`. `bookings` in helppuff.json and the settings.
- Webhooks `appointment.created`, `appointment.updated`,
  `appointment.cancelled` and `appointment.reminder` (a day before, for your
  own emails or texts).
- The assistant is told today's date and time, in the business's time zone.
- Two limits in Settings → Advanced: `slotLookupsPerIpPerMinute` (30) and
  `bookingsPerIpPerHour` (5). The widget's booking calendar is its own small
  file (`booking-*.js`), downloaded only when one is shown.

### Changed

- The Worker's cron runs every 15 minutes (it was daily): re-crawls still
  start only when due, and synced calendars are read on their schedule.
  `helppuff upgrade` (a deploy) updates the trigger.

## [0.4.1] - 2026-10-09

### Changed

- The setup page has three steps: your website, business details, and an
  optional assistant step (**Skip** keeps "offer a callback"). Its choices
  are worded by what the assistant does: **Offer a callback**, **Just
  answer**, **Send them to book** (which now asks for the booking page).
- Home no longer shows the daily cap (it stays in Settings → Advanced), and
  "Before you go live" disappears once Turnstile is on.
- The setup page's last step also asks when to collect the visitor's name and
  phone: before the chat (the lead form) or only when needed.
- The Jobs board ends with the won and lost stages as its last columns, and
  the Basic template is *New → Quote sent → In progress → Done / Cancelled*.
- The Prompt page, with the tools, is in the Settings menu as **Prompt &
  tools**, the one place to write your prompt: Settings → Instructions keeps
  only the choices and links to it (its text box edited the same prompt).
- **Your prompt wins over your website.** The assistant was told to answer
  only from the business details and the website, so a correction in your
  prompt ("the free audit is no longer a video") could lose to an
  out-of-date page. The rules now say the business's instructions win.
- The **Send them to a page** goal (was "bookings") is for any next step:
  booking, sign-up or a quote form, offered when the visitor wants to go
  ahead, not after every message.
- New rules: asked whether the chat is saved, the assistant says so and
  links your privacy policy (the lead form's); it never asks for ID numbers
  or health details either.
- A job's **Value** explains itself with a (?), and empty states link to the
  setting that fills them (no labels yet → **Add labels**).
- The Basic template applies to new sites; a site that already has a
  pipeline keeps it.

- **A calmer dashboard.** What a page, card or field is for is behind a
  (?) beside its title (it opens on hover, focus or a tap, with a Learn more
  link) instead of a grey sentence under each one; empty states are a word
  and their button.
- **Prompt & tools is a diagram** of what happens around a chat: tools
  before it, the prompt (Knowledge above, Webhooks below), then the summary
  and labels and tools after it. The prompt opens in a window with its
  tools and history; **+ Add** on a step offers your tools or a new one.
  No more tools sidebar.
- **Dark mode is a soft dark grey** instead of near-black, and the Settings
  menu indents each group's pages under its label.
- **Signed-in visitors.** A site with accounts signs who is logged in (a
  JWT with the site's identity secret: Settings → Lead form, or
  `helppuff identity`) and passes it with `HelpPuff.identify({ token })`. The
  claims become verified `{{user.*}}` for tools and the prompt, win over what
  was typed in the form, and show as **Signed in as …** on the conversation
  (`user` in the API and `conversation.completed`). A tool that uses
  `{{user.*}}` runs only for a verified visitor. The API takes `user`
  directly on `POST /conversations`. A bad or expired token is ignored.
- **Only when, for after-chat tools**: run one only for hot leads, chats with
  an email, signed-in visitors, or any path in the `conversation.completed`
  data (`--when labels.leadQuality=hot`).
- Three more tutorials with templates (logged-in customer support, product
  and stock, hot leads to Slack), and two guides: knowledge base or tool, and
  testing and monitoring. The docs now say plainly that what a visitor types
  is a claim.
- **Agent files: import and export the whole setup.** The prompt, the tools
  and the behaviour and lead form settings in one JSON file: Settings →
  **Import & export**, `helppuff agent export|import`, or
  `GET /api/v1/agent/export` and `POST /api/v1/agent/import`. Importing checks
  everything first (a dry run shows what changes), matches tools by name and
  publishes the prompt as a new version. Secrets are never in the file: they
  are `${NAME}` placeholders, asked for on import (the CLI reads `.env`).
- **Four tutorials with templates**: order tracking (your shop, then
  Shippo), sending chats to HubSpot through n8n or Zapier, the nearest store
  from the pre-chat postcode (Google Places), and account changes after an
  SMS code (Twilio Verify). Import any of them from the dashboard or with
  `helppuff agent import <id>`.
- `helppuff tools test` takes `--data tool.key=value`, for a tool that reads
  what another returned.
- **Knowledge moved into Settings**, and the Settings menu has four groups:
  Assistant, Widget, Team and System.
- **Ask your AI agent** on every settings page: a request to copy into
  Claude Code, Codex or Cursor, which goes through that page with you and
  changes it from the CLI. The agent instructions and `helppuff --help` now
  describe that walkthrough, and how to write a prompt.

### Fixed

- **A crawl could stop for good on Workers Free.** Workers AI and Vectorize
  count towards the 50 outside calls an instance may make, so a 15-page batch
  ran out: its last pages failed with "Too many subrequests", and starting
  the next batch failed too, leaving the crawl "running" for ever. Each
  instance now counts its calls and hands over before it runs out, the
  finishing steps get an instance of their own, and a part that fails marks
  the crawl failed with the reason.
- **Pages that fail for a passing reason are retried by themselves**
  (unreachable, timed out, 5xx, 429): 15 minutes after the crawl, then 2
  hours, as a Workflow sleep.
- The assistant no longer draws buttons in text, like
  "[Request a callback from the team]": such a line is taken out, and a
  drawn callback offer becomes a real **Request a callback** button (never
  right after the callback form was sent).
- The crawl's cleanup removes the pages you unticked in batches, so a large
  untick fits the same limit.
- **Failed pages can be tried again by hand**: **Try again** on a failed
  page, or **Try N failed pages again**, on the Knowledge page
  (`POST /api/v1/knowledge/crawl/retry`). It crawls only those and keeps the
  selection; crawling a list of pages made that list the whole selection.

## [0.4.0] - 2026-10-09

### Added: tools, your own APIs in the chat

- **Tools** on the dashboard's Prompt page (and `helppuff tools`): HTTP
  requests to your own APIs, set up by pasting a curl or filling in the
  method, URL, headers and body, and tested with sample values. The page now
  reads top to bottom as a chat runs:
  - **Before the chat**: tools called when a chat starts, with the pre-chat
    form's answers (`{{prechat.email}}`); the first answer has what they
    returned.
  - **The prompt**: `{{order_status}}` lets the assistant call that tool (it
    fills in `{{args.*}}`, asking the visitor first if needed), and
    `{{crm_lookup.tier}}` puts in what a tool returned. Typing `{{` lists
    every tool, key and placeholder; a name that is not one is flagged.
  - **After the chat**: tools called when the conversation ends, with the
    transcript, summary, contact, attributes and every tool's data (a POST
    with no body sends all of it as JSON), retried on a 5xx or a timeout.
- **Extract tools** save what the visitor says (an order number) on the
  conversation and as a custom attribute.
- What tools return or save is kept on the conversation (`data`, by tool
  name). It shows in the conversation's **Data from tools**, is given to the
  assistant on every answer (as quoted data, never instructions), goes to
  after-chat tools, and goes to webhooks: `conversation.started` and
  `conversation.completed` carry `data`. The conversation API returns it too.
- Credential headers are stored encrypted and never shown or returned again.
  In the CLI, `${NAME}` in a header is read from `.env`, so a key is never
  typed on the command line (a missing one answers `needs_input`).
- API: `GET/POST /tools`, `PATCH/DELETE /tools/:id`, `POST /tools/test`,
  under the `prompt:read` and `prompt:write` scopes.
- Tools work with HelpPuff's assistant, whatever the model. With a backend
  that runs the whole conversation (Retell, your own API), only after-chat
  tools run.

### Changed

- D1 migration 12 adds the `tools` table and `conversations.data` (additive).
- D1 migration 13 adds `conversations.user` and `tools.run_when` (additive).

## [0.3.0] - 2026-10-08

### Added: live chat, roles and a fuller CRM

- **Live chat** (off by default; `helppuff live on` or Settings → Live chat):
  a visitor who asks for a person is handed to the team, who answer from the
  dashboard (browser notifications and a sound, per person) or from Telegram
  (`helppuff telegram connect`; a thread per chat). Nobody available, or
  nobody in `live.waitSeconds`: the callback form, as before. workers-ai hands
  over itself (`request_person`); every backend gets a "Talk to a person"
  button. Runs on a Durable Object per site, on the Free plan; the widget's
  live code is a separate 1 kB file loaded only when a chat is handed over.
- **Conversation status**: AI bot, Live agent or Closed (by the team, or after
  `live.closeAfterMinutes` without a message; a visitor who writes again is
  answered by the assistant). Filter by status, label and "waiting for a
  reply"; filters are remembered.
- **Roles**: admin or member. Members see conversations, jobs, contacts,
  callbacks and live chat only. Invite and change roles in Settings → Team, or
  `helppuff users add --role member` / `helppuff users role`.
- **Labels** (Settings → Labels), put on by the team or by the AI when a
  conversation goes quiet; **custom attributes** and **private notes** on
  conversations and contacts; a **page per contact** with their details,
  attributes, notes, conversations and history.
- API: `PATCH /conversations/:id`, notes, labels, live chat (reply, assign,
  close, hand back, status, Telegram), `PATCH /admins/:email`; contacts gain
  `company`, `address`, `attributes`. Webhooks: `handover.requested`,
  `handover.missed`, `handover.ended`, `conversation.assigned`,
  `conversation.closed`; `message.sent` carries `author` for a person.
- D1 migration 10 (`inbox and live chat`), and the `LiveHub` Durable Object,
  added by `helppuff upgrade`.

### Added: jobs

- **Jobs**: requests, quotes and work from conversations, on a board with
  the site's own stages (drag, or a menu on each card), a list, and a page
  per job with its fields, updates, private notes and history. Rename them
  (Quotes, Tickets…) in Settings → Jobs.
- **Set up from the website**: the AI picks a template (service quote,
  projects, support, sales demo, bookings, custom orders; basic when unsure)
  and fills in the services; Home says what it chose. Stages, fields and
  names are editable; "Let the AI choose again" or `helppuff jobs setup`.
- **From the chat**: workers-ai creates a job when a visitor asks for a quote
  or work (`create_job`), then asks in a short form for required details it
  lacks. The widget's **Get a quote** button asks the quote questions (chosen
  in Settings → Jobs) and saves the answers as a job; its contact questions
  stand in for the lead form.
- **From elsewhere**: `POST /api/v1/jobs` (scopes `jobs:read`, `jobs:write`),
  "New job" from a contact, a conversation or a callback request, and
  `helppuff jobs list|show|create|move|update|pipeline|template|setup`.
- Webhooks: `job.created`, `job.updated`, `job.stage_changed`, `job.won`,
  `job.lost`. A new job alerts the team like a message (with live chat on).
- Set up after every deploy (`deploy.jobs` in `--json`): the pipeline at
  once, so the assistant records requests from the first visitor, and the
  AI's choice from the website then (other backends) or when learning
  finishes (workers-ai). Never over a pipeline already set up.
- D1 migration 11 (`jobs`), applied by `helppuff upgrade`.

### Added: the home screen

- **Settings → Home screen**: the widget's first screen in the dashboard,
  with a preview: its heading, up to 8 buttons of every kind (a question, a
  page, call, email, a form, a few questions) and a list of useful pages.
  Before, only the suggested questions were in the dashboard.
- **Suggested from the website**: when the site is first learned, the AI
  picks the pages worth a link and writes the questions visitors ask; the
  widget shows them until the owner saves their own (which always win).
  **Suggest from my site** adds more, with call and email buttons from the
  business details.
- API: `home` in `GET/PUT /settings`, `POST /home/suggest`; `config pull`
  brings `widget.home` (title, subtitle, links) into helppuff.json.

### Added: choose the model and the knowledge base separately

- **`model`** in helppuff.json: who writes the answers. Workers AI (the
  default), any OpenAI-compatible API with tools (presets: DeepInfra,
  OpenRouter, DeepSeek, Groq, Together, Mistral, Fireworks, Vercel AI
  Gateway, Cloudflare AI Gateway), OpenAI, Gemini, Claude (its Messages
  API), or your own TypeScript file (`custom`).
- **`knowledge.retrieval`**: what the answers come from. HelpPuff's own
  knowledge base (the default), none, Cloudflare AI Search, an OpenAI vector
  store, your own search over HTTP, or your own TypeScript file.
- HelpPuff's assistant (prompt, tools, citations, guardrails, budget) is now
  the same whichever model writes: other models get callbacks, jobs, live
  chat hand-over and HelpPuff's knowledge base, which before were Workers AI
  only.
- `helppuff model set|test`, `helppuff rag set|test` (through the deployed
  Worker), `helppuff scaffold model|rag`; `@knowtific/helppuff/sdk` for the
  types (`LanguageModel`, `Retriever`). A missing key answers `needs_input`
  with the `secret set` command. `doctor` checks the keys and files.
- API: `POST /assistant/test`; `GET /settings` shows `ai` (provider, model,
  knowledge).
- helppuff.json format 2, applied by `helppuff upgrade`: `backend` becomes
  `model` + `knowledge.retrieval`. Kept as whole backends: Retell, your own
  API in `helppuff` mode, echo, OpenAI with a stored prompt or a vector store
  HelpPuff fills, Gemini with File Search.

### Changed

- The model, the reranker and thinking are shown in Settings → Advanced but
  changed only with the CLI (and a deploy), so helppuff.json stays the one
  place they are set.
- The agent instructions (`instructions.md`) list the command for every
  change a user may ask for: settings in `helppuff.json`, and what lives on
  the Worker (jobs, labels, live chat, team, webhooks, keys).
- Too many sign-in attempts now says so, instead of "Too many messages".
- Suggested questions moved from Settings → Chat to Settings → Home screen,
  and are made by the server when the site is learned rather than by the
  dashboard (which marked the settings as changed and made the next deploy
  ask for `config pull`).

### Added: the public API

- Everything HelpPuff does, over HTTPS at `<worker>/api/v1`, so it can be used
  as a backend only: chat with the assistant from your own server (JSON or
  streamed), leads (now also create, get one, delete and erase), callbacks,
  conversations (now also delete), knowledge, prompt, settings, webhooks,
  analytics, team (add and remove accounts, sign-in links), API keys and an
  audit log. The same handlers as the dashboard's own API: one implementation.
- API keys: scoped, one site each, optional expiry and IP allowlist, a rate
  per key, stored only as a keyed hash and shown once. Settings → API keys in
  the dashboard, `helppuff keys create|list|revoke`, and `helppuff api` to
  call any endpoint.
- Docs: the wiki's API page (quickstart in curl, JavaScript and Python), and
  the API reference with a curl command, request, response and errors for
  every endpoint, generated from the same registry that guards the routes;
  OpenAPI 3.1 at `/api/v1/openapi.json`.
- D1 migration 9 (`public api`).

Security hardening. Adds D1 migration 8 (`abuse limits`), applied by
`helppuff upgrade`.

### Added

- Per-visitor daily limits (`messagesPerIpPerDay`, `sessionsPerIpPerDay`), so
  one visitor cannot use up the site's daily cap; counted from what D1 records,
  with no KV write per message.
- IP allow and block lists (`security.allowIps`, `security.blockIps`), single
  addresses or CIDR ranges, IPv4 or IPv6.
- Every limit is a setting (`security.limits`, `security.signIn`) and on the
  dashboard's Settings → Advanced page; `config pull` brings them back. The
  wiki's Security page lists them all.
- Dashboard sign-in: a per-account limit on wrong passwords, and Turnstile on
  the form when `security.captcha` is set.
- A "Before you go live" checklist on the dashboard's Home page, and a warning on
  Settings → Advanced, while Turnstile is off (it stays off by default, so trying
  HelpPuff needs no setup); `helppuff doctor` warns too. New wiki page: Turn on
  Turnstile.

### Changed

- A submitted form is honoured only when the chat was shown that form, so a
  script cannot post leads or callback requests into any chat.
- A second chat with a contact's email no longer overwrites that contact's form
  answers.
- Signing out of the dashboard ends that session everywhere; changing a
  password ends all of the account's sessions. Everyone signs in once after
  upgrading.
- `conversation.ended` fires once per conversation; ratings, polls and closing
  a chat are rate limited.
- Text is cleaned both ways: no control, bidi-override, zero-width or hidden
  tag characters, and no chat-template tokens in visitors' messages.
- Prompt-injection guardrails: the visitor's values are quoted in prompts,
  website passages are fenced and neutralised, the rules say all of it is
  information rather than instructions, and every backend's replies are
  checked for leaked rules. Owner prompts that use `{{lead.*}}` or
  `{{context.*}}` now receive the value in quotes.
- The dashboard is served with a strict Content Security Policy and is never
  framed; CSV export also guards cells starting with a tab or carriage return.

## [0.2.0] - 2026-10-07

AI agents now set HelpPuff up from one shared instruction file instead of a
plugin, so it works the same in Claude Code, Codex, Cursor, OpenCode and others.

### Removed

- `helppuff mcp` and `helppuff skill`, the Claude Code plugin and its skill.
  Agents follow [instructions.md](instructions.md) and use the CLI with
  `--json` instead; nothing needs installing. If you added the HelpPuff MCP
  server or skill to an agent, remove it.
- `helppuff init` no longer writes agent instruction files into your project.

### Added

- `--onboarding defaults | dashboard` on `init` and `deploy`: an agent either
  finishes onboarding itself (learns the suggested pages, reads your business
  details) or hands page selection to you on the setup page. The choice is
  remembered, so a later `helppuff deploy` keeps it.
- Help links throughout the dashboard, and a "How to upgrade" link in
  Settings → Updates. "What's new" now opens this changelog.

### Fixed

- `--crawl none` really learns nothing; it used to crawl the suggested pages.
- With dashboard onboarding, an agent is told to hand over the dashboard even
  when the one-time setup link is gone, and not to test answers before you
  have chosen pages.
- `helppuff secret set` before `init` says which folder it saved `.env` in,
  so `init` run from another folder no longer misses the token.
- The dashboard checks for updates once per page load.

## [0.1.0] - 2026-10-06

The first public release.

- One-command setup (`npx @knowtific/helppuff`) to your own Cloudflare account:
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
- `helppuff upgrade`, with version reporting, a D1 restore point and guarded rollbacks.
