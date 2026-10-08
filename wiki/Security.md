# Security model

The widget is public, unauthenticated code running in a browser you do not
control, talking to an endpoint that costs you money per request. That shapes
everything below.

## The uncomfortable part, first

**You cannot make the API usable "only by the widget, only on your domain."**
Not with origin checks, not with a signed request, not with anything shipped to
a browser. Two reasons:

1. **`Origin` and `Referer` are set by the browser, not by the caller.** That
   is exactly why they work *against other websites* — a page on
   `evil.example` genuinely cannot forge them in a real browser. But `curl`,
   a script or a server sets them to whatever it likes. Origin checking stops
   one real threat completely and another not at all.

2. **Any secret in the widget is a public secret.** Signing requests with HMAC
   from the browser needs a key in the bundle. An attacker reads it out of
   `app-*.js` in about a minute and signs their own requests. It raises the
   effort from "trivial" to "mildly annoying" and costs real complexity — it
   does not create a trust boundary.

So the goal is not "prove the caller is our widget." It is **bound cost and
bound damage**, in layers, so that every remaining path to abuse is either
expensive for the attacker or cheap for you.

## What each layer actually buys

| Layer | Stops | Does not stop | Status |
| --- | --- | --- | --- |
| Origin allowlist | Another site embedding your widget and spending your budget through real visitors' browsers | A script setting its own `Origin` | **Built** |
| CORS reflection | A browser on another origin reading your responses | Anything non-browser | **Built** |
| Signed session tokens | Forging or editing a session, reading connector state, cross-site token reuse | Replay by whoever holds the token | **Built** |
| Per-session message cap | A single conversation running away | Opening many sessions | **Built** |
| Lead field validation | Junk and oversized lead data reaching a sink | — | **Built** |
| Turnstile | Scripted abuse. **This is the only layer that meaningfully separates "a human in a browser" from "a script"** | A determined attacker paying a solver service | **Built** |
| Per-IP rate limits, a minute, an hour and a day | Casual scripted abuse, accidental loops, one visitor using up the day | A distributed attacker | **Built** |
| IP allow and block lists | A known bad address or range; your own office tripping limits | An attacker who changes address | **Built** |
| Forms bound to the chat | Fake leads and callback requests posted into a chat that never showed a form | A script that first gets the assistant to show one | **Built** |
| Daily per-site quota | **Everything, eventually.** The cost backstop that holds when every other layer fails | Denying service to real visitors once tripped | **Built** |

The honest summary: **Turnstile plus the daily quota are the real defences.**
Origin checking handles a different (and common) threat. Everything else
limits blast radius. Turnstile is off by default, so HelpPuff can be tried
(and set up by an AI agent) without it. Without it, a script can start chats
(bounded by the per-visitor limits below) from as many addresses as it has;
the dashboard's **Before you go live** checklist and `helppuff doctor` warn
until it is on. HelpPuff cannot create the Turnstile widget for you:
`wrangler login` does not grant access to Turnstile. [[Turn on Turnstile|Turnstile]]
walks through the five minutes it takes.

## Every limit

Every bound the Worker enforces. The ones in `security` are settings: in
`helppuff.json` (see the [[Configuration reference|Configuration-Reference#security]])
and on the dashboard's **Settings → Advanced** page, which is live within a
minute; `helppuff config pull` brings dashboard changes back into
`helppuff.json` (only what differs from the defaults). Per-visitor limits are
per site and keyed by a salted hash of the IP; the owner testing from the CLI
and addresses on `security.allowIps` skip them, never the per-chat or daily
caps.

### Chat (per site)

| Setting | Default | What it bounds | Counted | When it trips |
| --- | --- | --- | --- | --- |
| `limits.messagesPerIpPerMinute` | 10 | Messages from one visitor a minute | Cloudflare's Rate Limiting binding; KV without one, or after the value is changed in the dashboard until the next deploy | 429, `Retry-After` |
| `limits.messagesPerIpPerDay` | 100 | Messages from one visitor a day (UTC), across their chats | D1: the conversations they started; KV without a database | 429 until midnight UTC |
| `limits.sessionsPerIpPerHour` | 5 | New chats from one visitor an hour | D1; KV without a database | 429 |
| `limits.sessionsPerIpPerDay` | 20 | New chats from one visitor a day (UTC) | D1; KV without a database | 429 |
| `limits.messagesPerSession` | 60 | Messages in one chat | D1 (the recorded turns); KV without a database | "Start a new one" |
| `limits.messagesPerSitePerDay` | 500 | Every visitor's messages a day: **the cost backstop** | D1 `usage_daily`; KV without a database | Visitors see your contact details until midnight UTC |
| `limits.maxMessageLength` | 1000 | Characters in one message (and a chat's first message) | Each request | 400 |
| `limits.maxLeadFieldLength` | 200 | Characters in one form answer | Each request | 400 (pre-chat form); cut to length (inline forms) |
| `limits.maxLeadMessageLength` | 2000 | Characters in a form's message box | Each request | As above |
| `limits.feedbackPerIpPerMinute` | 30 | Thumbs up or down from one visitor a minute | In the Worker's memory, per isolate (best effort, no KV write) | 429 |
| `limits.pollsPerIpPerMinute` | 120 | Checks for new messages from one visitor a minute (Retell) | In memory | 429 |
| `limits.endsPerIpPerMinute` | 10 | Chats one visitor closes a minute. A chat's `conversation.ended` webhook fires once, whatever is replayed | In memory; once-only in D1 | 429 |
| `limits.retellLookupsPerMinute` | 120 | Knowledge-base lookups by a Retell agent a minute, whole site | KV | 429 |
| `limits.apiRequestsPerKeyPerMinute` | 120 | Requests a minute for a new API key (each key can have its own) | In memory, per key | 429 |
| `limits.apiKeysPerSite` | 50 | Active API keys per site | D1 | 400 on create |
| `limits.handoversPerIpPerDay` | 3 | Times one visitor asks for a person a day ([[Live chat|Live-Chat]]) | D1: the conversations they handed over | The callback form |
| `limits.waitingPerSite` | 20 | Live chats waiting for someone to take them, at once | D1 | The callback form |
| `limits.liveSocketsPerIp` | 3 | Live chat connections one visitor holds open (tabs) | The live chat hub | The connection is refused; the widget polls |
| `sessionTtlHours` | 24 | How long a chat can be continued | The signed token's expiry | A new chat |
| `allowIps` | none | Addresses or CIDR ranges exempt from the per-visitor limits | — | — |
| `blockIps` | none | Addresses or CIDR ranges refused by the chat (not the dashboard) | — | 403, the widget hides |
| `captcha` | off | Turnstile on every new chat | Siteverify | 403 `captcha_failed` |

On Workers AI the daily neuron budget (`budget.dailyNeurons`, see
[[Costs and limits|Costs-and-Limits]]) also applies.

### Dashboard sign-in

`security.signIn`. Sign-in is not per site: with several sites the strictest
values apply.

| Setting | Default | What it bounds |
| --- | --- | --- |
| `attemptsPerIp` | 10 | Sign-in attempts, and one-time link checks, from one IP per window |
| `attemptsPerAccount` | 5 | Wrong passwords for one email per window, from any IP. Counts failures only; a one-time link from `helppuff dashboard` still works while an account is locked |
| `windowMinutes` | 15 | The window both count over |
| `captcha` | true | Turnstile on the sign-in form when `security.captcha` is set (add the dashboard's hostname to the Turnstile widget) |

### Fixed by the protocol

These are part of the wire contract (`@helppuff/protocol`), checked by both
the server and the widget, so they are not settings: a message is at most
4000 characters and an action's value 2000; a reply carries at most 20
messages; a form has at most 12 fields; a session token's connector state is
at most 1 KB and remembers the last 5 forms shown; prompts are at most 16,000
characters; an upload at most 10 MB; a crawled page at most 3 MB. Setup links
last 24 hours, sign-in links 15 minutes, dashboard sessions 7 days. Webhooks
time out after 8 s and are retried at 1 min, 5 min, 30 min, 2 h and 6 h; each
endpoint keeps its last 50 deliveries.

---

## Holes

### Closed

**The per-session cap is no longer bypassable.** It used to be counted from
`count` inside the session token, and the client chooses which token it
sends — so replaying the original reset the count on every request and the
cap never tripped. It is now counted server-side by session id (from the
recorded conversation, or a KV counter without a database), which the client
cannot rewind. There is a test that replays the first token forever
and asserts the cap still trips.

**Rate limits are enforced.** `messagesPerIpPerMinute`, `sessionsPerIpPerHour`
and `messagesPerSitePerDay` were configured, validated and read by no code
path. All three now run, before anything that costs money, scoped per site so
one site's traffic cannot consume another's budget. IPs are hashed with the
server secret before they enter a key.

**Turnstile is verified.** `captchaToken` is checked against siteverify when a
site configures a captcha. An unreachable Cloudflare counts as a failure, not
a pass — otherwise taking siteverify offline would take the captcha offline
with it.

**One visitor cannot use up the day.** Before the per-visitor daily limits, a
single address could send five chats an hour of 60 messages each and reach
the site's daily cap in under two hours, taking the chat offline for everyone.
`messagesPerIpPerDay` and `sessionsPerIpPerDay` bound that, counted from the
conversations D1 already records (each keeps the salted IP hash that started
it), so they cost a read and no KV write.

**Forms are bound to the chat.** A submitted form becomes a lead (and the
callback form a callback request, with a `callback.requested` webhook) only
when this chat was shown that form: the ids of the forms the server sent ride
in the signed session token, and the site's own `widget.forms` open under an
id the server recognises. Before, any session token could post a "callback
request" with someone else's phone number.

**A typed email cannot rewrite a contact.** Leads are keyed by email, so a
second chat that gives the same address joins that contact. Nothing it
brings overwrites what the contact already has: name, phone and form answers
keep their first values (the new ones stay in that conversation's
transcript).

KV is eventually consistent, so a determined attacker racing requests can slip
a few past a limit. That is accepted: these bound cost, they do not bill. A
few messages past 500 is fine; a few thousand is not, and the daily quota
catches that.

### Config stored in KV

A `config:<siteId>` key overrides the deployed config for that site
(see [[Deployment|Deployment#live-config]]). That makes KV write access a privileged
position: it can change the connector, the lead destination and the limits.
Two deliberate bounds keep it from being a complete one:

- **`origins` cannot be set from KV**, so it cannot widen who may embed the
  widget. The allowlist is fixed at deploy. A stored config carrying
  `origins` is rejected whole rather than partly applied.
- **A site must exist in the deployed config**, so KV cannot invent one.

It can still point a real site at a different connector, which is worth
knowing when deciding who gets a KV-writing API token. Stored config is
validated against the same schema as the bundled config, so it cannot be used
to smuggle a shape the server would not otherwise accept, and a config that
fails validation falls back to the deployed one.

### Still open

**Session tokens are bearer tokens.** Anyone holding one can continue that
conversation from anywhere. Mitigated by a short TTL and by the token carrying
nothing but ids and small connector state — no lead data, no keys. Binding to
the hashed IP was considered and rejected: mobile networks change IP
mid-conversation, so it would break real visitors to inconvenience an attacker
who can simply start a new session.

**No request-size cap before parsing.** Bodies are bounded by the schemas, but
the whole body is read and parsed first. A `Content-Length` check at the edge
would be cheap. Not done.

**`/config` is public and not rate limited.** By design — it is public data,
and edge-cached for 5 minutes. It reveals the site's shortcuts, form fields
and captcha site key, none of which are secret.

**Origin can be forged by a non-browser.** Inherent, and why Turnstile and the
daily quota are the layers that carry the weight.

**In-memory limits are per isolate.** Ratings, polls and closing a chat are
limited in the Worker's memory, so a visitor whose requests reach several
isolates gets each one's allowance. They are cheap endpoints; a KV write per
request would cost more than what it protects.

**Locking an account is a denial of service on it.** Five wrong passwords for
an email lock it for the window, from anywhere. Turnstile on the sign-in form
makes that expensive; a one-time link from `helppuff dashboard` always works.

## What is deliberately safe

- **The connector's API key never reaches the browser.** Secrets are `{ env }`
  references resolved inside the Worker.
- **No PII in logs** — event names, site ids, session ids, counts, latencies
  and error codes only.
- **IPs are hashed** (SHA-256 with the server secret) before they enter any
  rate-limit key or log. The raw IP is used in exactly one place — the
  `remoteip` field Turnstile's siteverify expects — and never stored.
- **Backend errors never reach the visitor.** A connector throwing produces a
  generic, safe message; the diagnostic text stays in the structured log.
- **Connector output is validated** against the protocol before it is sent, so
  a compromised or confused backend cannot inject markup or unsafe URLs.
- **Text is cleaned both ways** (`cleanText` in `@helppuff/protocol`): what a
  visitor sends (by the widget, then the server, before anything is stored or
  reaches a model) and every reply. Control characters, bidi overrides and
  isolates ("Trojan Source"), zero-width spaces, the Unicode tag and
  supplementary variation-selector blocks (used to hide instructions to a model
  in text a person cannot see) are removed; runs of combining marks are capped
  and blank lines collapsed. Zero-width joiners and left/right marks stay:
  Persian, Arabic, Indic scripts and emoji need them. A message that is only
  invisible characters is refused. Chat-template tokens (`<|im_start|>`,
  `[INST]`, `<<SYS>>` …) are removed from visitors' messages.
- **The markdown renderer escapes everything** and emits an allowlisted tag
  set; `javascript:`, `data:` and friends are rejected at both ends.
- **Tokens use HMAC-SHA256 with a constant-time comparison** and a secret of
  at least 32 bytes, which `helppuff deploy` generates.

---

## The dashboard: what is stored, and who can read it

With the dashboard on (the default for projects created by `helppuff init`),
the Worker **does** store data: every conversation, every message both ways,
and leads — names, emails, phone numbers — in a D1 database on the site
owner's own Cloudflare account. Without a `HELPPUFF_DB` binding nothing is
written and everything above about "no lead data at rest" still holds.

- **Writes never touch the reply path.** Recording runs in `waitUntil` and
  swallows its own errors; a failing database cannot delay or break a visitor's
  chat.
- **No raw IPs.** A conversation keeps the page, referrer, UTM tags, locale,
  Cloudflare's two-letter country and the salted hash of the address that
  started it (`visitor`, the key the per-visitor limits count by) — never the
  address.
- **Sign-in** is email and password. Passwords are PBKDF2-SHA256 (100k
  iterations, the Workers maximum) hashed on the owner's machine by the CLI;
  the owner's hash is a Worker secret, teammates' hashes are in D1. A miss on
  an unknown email still runs a hash, so timing does not reveal which emails
  exist. Limited per IP and per account, with Turnstile on the form when the
  site has it (see [[Dashboard sign-in|Security#dashboard-sign-in]] above).
- **Sessions** are an HMAC-signed cookie (keyed from HELPPUFF_SECRET),
  `HttpOnly; Secure; SameSite=Strict; Path=/admin`, seven days, carrying a
  random id and a keyed fingerprint of the account's password hash. Signing
  out records the id (D1 `admin_signed_out`, until it would have expired), so
  a copied cookie stops working at once; changing a password ends every
  session it had; a removed teammate is refused on their next request.
- **Mutations** (sign-in, summaries, lead edits, searches and model checks)
  must come from the dashboard's own origin; every API response is
  `no-store`, `nosniff` and `X-Frame-Options: DENY`.
- **The dashboard's pages** (`/admin/*`) are served with a strict Content
  Security Policy (scripts only from the Worker and Turnstile, no inline
  script, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, a
  same-origin referrer policy and no camera, microphone or location access,
  so they cannot be framed for clickjacking or run injected script.
- **CSV export** prefixes cells that start with `= + - @`, a tab or a carriage
  return, so a lead who types a formula cannot run it in the owner's
  spreadsheet.
- **AI summaries** only attach contact details that literally appear in the
  transcript — a model inventing an email cannot create a lead.

Rotating HELPPUFF_SECRET signs everyone out of the dashboard as well as ending
live chats.

## The admin API key and one-time links

`/admin/api/*` also accepts `Authorization: Bearer <ADMIN_API_KEY>` — how the
CLI and agents do everything the dashboard does. The key is 32 random bytes
generated by `helppuff deploy` into the project's `.env` and set as a Worker
secret; it is compared in constant time, refused when shorter than 32
characters, and acts as the owner. Rotate it by deleting it from `.env` and
deploying.

One-time links (`POST /admin/api/links`, key only):

- **Setup** (24 hours): creates the first dashboard account. It works only
  while the deployment has no account at all, so an unclaimed instance cannot
  be claimed twice, and a spent, expired or wrong token answers exactly like a
  missing page (404).
- **Sign-in** (15 minutes): signs one existing account in without a password —
  the recovery path when it is lost.

Only the token's SHA-256 is stored (`admin_tokens`); the token itself lives in
the URL **fragment** (`/admin/#/setup/<token>`), which browsers never send to a
server, so it never lands in a log or a `Referer`. Spending a token is a
conditional update, so two racing uses resolve to one. Link checks share the
sign-in limit per IP (`security.signIn.attemptsPerIp`).

## The knowledge base: crawling and what it stores

- **Politeness.** The crawler identifies itself (`helppuff-crawler/…`, with the
  Worker's `/bot` URL), honours robots.txt for its own name or `*`, honours
  `Crawl-delay` (up to 10 s), fetches one page at a time and reads at most 3 MB.
- **Only the site.** Discovery and crawls stay on the configured site (`www.`
  and the apex count as one); addresses on any other host are refused.
- **Crawled text is data, not instructions.** See [[Prompt injection|Security#prompt-injection]];
  tool arguments are validated with zod before anything runs; no tool can read
  a secret or another site's data.
- **Stored**: page text, chunks and vectors (site content that is public
  anyway), business facts, crawl history, daily usage counts — no visitor data.
- **Ratings** (`/v1/sessions/feedback`) need the conversation's own session
  token, can only touch that conversation's assistant messages, and are
  rate-limited per IP.

## Live chat

[[Live chat|Live-Chat]] adds three doors, each authenticated before the
connection reaches the site's hub (a Durable Object with no route of its own):

- **The visitor's socket** (`/v1/live/socket`): the signed session token, sent
  as a WebSocket subprotocol (never in the URL, which lands in logs); the
  Origin must be one of the site's; only a chat that was handed over may
  connect. The socket only receives: the visitor's messages still go through
  `POST /v1/sessions/messages` and every limit there. Frames over 4 KB are
  ignored.
- **The team's socket** (`/admin/api/live/socket`): the dashboard session
  cookie (`SameSite=Strict`), and the Origin must be the dashboard's own
  (against cross-site WebSocket hijacking). Signing out or a password change
  ends access at the next connection.
- **Telegram's webhook** (`/v1/integrations/telegram/:site`): checked with
  the secret Telegram echoes back (`X-Telegram-Bot-Api-Secret-Token`,
  compared in constant time); only the linked chat is read. The bot token is
  stored in D1 encrypted (AES-GCM, key derived from `HELPPUFF_SECRET` by
  HKDF): rotating the secret means connecting Telegram again.

A person's replies pass the same cleaning as everything else and render
through the widget's one Markdown renderer. In the assistant's history they
are labelled as the team's, never placed in the system prompt. Roles: a
**member** reaches only the routes the inbox needs (a fixed allowlist; any
other route, including ones added later, is refused).

## The public API

`/api/v1` serves the same handlers as the dashboard's API, behind its own door
(`api/auth.ts`); see [[The API|API]] for using it.

- **Only registered routes.** A route is public only when it is in the route
  registry (`api/registry.ts`), with the scope it needs; anything else answers
  404, so a new dashboard route is never public by accident. Sign-in, setup
  and sign-in links are dashboard-only.
- **Keys, not cookies.** A dashboard session cookie is never accepted there,
  and the API sends no CORS headers, so a browser cannot call it with a
  visitor's or an admin's credentials.
- **Keys are hashed.** `hp_live_<id>_<secret>`: only HMAC-SHA-256 of the
  secret is stored, keyed from HELPPUFF_SECRET (not in D1), compared in
  constant time. A copy of D1 opens nothing. Shown once.
- **Least privilege.** One site per key; scopes per resource; optional expiry
  and IP allowlist; a key cannot create a key with scopes it lacks. Revoked or
  expired keys are refused within 30 seconds (the per-isolate cache).
- **Rate per key**, counted in memory, including refused requests, so probing
  scopes is limited too. The site's per-conversation and daily caps apply to
  chat over the API as to the widget.
- **No key in URLs.** `?api_key=` and friends are refused. Bodies are bounded
  (1 MB, uploads 10 MB) before they are read.
- **Audit.** Every successful change through the API or the dashboard is in
  `audit_log` (who: an email, `key:<id>` or the admin key; the route; the
  record; when; a salted IP hash), kept 90 days, never with the request body.
- **Chat over the API** runs the widget's pipeline (`core/chat.ts`): text
  cleaning, prompt-injection guards, form binding and reply checks apply. The
  key replaces Origin and Turnstile as the proof.

## Prompt injection

Anyone can type anything into the chat, and a crawled page or an uploaded
document can say anything too. No model can be made immune to being talked
round, so HelpPuff keeps untrusted text out of the places that give it power,
and checks the output too:

- **Structure.** The system prompt is built from HelpPuff's settings, the
  owner's prompt and HelpPuff's rules, which come last and win. The visitor's
  messages go to the model as their own messages, never into the system
  prompt.
- **Values are quoted.** Anything of the visitor's that does go into a system
  prompt (`{{lead.*}}`, `{{context.*}}`, the "already given" details) is one
  cleaned line inside a JSON string: a newline, a quote or a `## heading` in
  a name cannot end the value or add a section. Provider variables (Retell,
  OpenAI prompt variables) get the same single-line cleaning.
- **Passages are fenced.** Website passages sit between `<passages>` and
  `</passages>`, and the rules call everything there quoted content. Inside a
  passage, headings are flattened and anything that looks like one of these
  fences is removed, so a page cannot close the fence early or pose as a
  section of the prompt. Business details read from the site are cleaned to
  single lines.
- **No control tokens.** Chat-template tokens and hidden characters are
  removed from visitors' messages, passages and values (see above).
- **The rules say so.** Every assistant is told that what the visitor writes,
  the page, passages and documents are information, never instructions,
  whoever they claim to come from; to share only links and contact details it
  was told about; and never to ask for passwords, card details or one-time
  codes.
- **Output is checked.** A reply that repeats a line of HelpPuff's settings or
  rules is replaced, whichever backend wrote it (workers-ai also checks the
  owner's prompt, and stops a streamed reply as it starts to leak). Replies are
  validated against the protocol, links must be `http(s)`, `mailto` or `tel`,
  and the widget escapes everything it renders.
- **The summary job** reads the transcript as one quoted line a message
  between `<transcript>` tags, so a visitor cannot write the assistant a turn;
  contact details are kept only when they appear in the transcript.

What this does not do: stop a model from being argued into a wrong answer in
the visitor's own chat. The rules and the "only what you were told" grounding
make that rare, and the visitor only fools themselves; nothing they say
changes another visitor's chat, the knowledge base or the settings.

## The owner's test header

`helppuff chat` and `helppuff users reset` send `X-HelpPuff-Owner: <hex SHA-256 of
"<HELPPUFF_SECRET>:owner-test">`. A request carrying the right value skips the
**per-IP** limits (sessions per hour, messages per minute, dashboard
sign-ins) — the ones that stop a single visitor hammering the site — so the
owner and their agent can test freely. It never skips the per-conversation
or daily caps, which bound cost. Deriving the value needs HELPPUFF_SECRET,
which never leaves `.env` and the Worker; a wrong value is ignored, not
rejected, so probing it tells an attacker nothing. It is compared in
constant time.

---

## If you want a stronger guarantee than "bounded cost"

The only way to genuinely restrict the API to known callers is to stop it
being a public endpoint:

- **Proxy through the site's own backend.** The site exposes its own
  endpoint (e.g. `/api/chat`) that holds a server-side secret and calls the
  Worker; the widget talks to the same origin it is embedded on (`data-api`),
  and the Worker can require the secret. This defeats scripted abuse properly,
  at the cost of the site owner running a proxy, which works against the "drop
  in one script tag" goal. Not built in.
- **Signed embeds for logged-in users.** Where the host page already knows who
  the visitor is, it can pass a short-lived token minted by its own backend
  (the pattern Intercom calls identity verification). Strong, but only
  available for authenticated visitors.

For an anonymous public chat widget, Turnstile plus a hard daily quota is the
industry-standard answer, and it is what the server now implements.
