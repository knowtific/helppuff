# Troubleshooting

Start with these, from the folder that holds `helppuff.json`:

```bash
npx @knowtific/helppuff doctor     # checks every piece and prints a fix for each failure
helppuff status                     # what is deployed, where, and today's usage
helppuff ask "a real question" --timing   # the answer, its sources, and each step's time
```

`doctor` checks the config, secrets, Cloudflare access, AI Search or the
vector index, the Worker and its secrets, the knowledge base, live chat,
Telegram, photos and files, and whether the Worker answers. It exits with
code 1 when a check fails, and `doctor --json` is safe to paste into an
issue (it contains no secrets).

Jump to: [[Where to look|Troubleshooting#where-to-look]] ·
[[Logs|Troubleshooting#logs]] ·
[[The widget does not appear|Troubleshooting#the-widget-does-not-appear-on-my-site]] ·
[[Messages visitors see|Troubleshooting#messages-visitors-see]] ·
[[Wrong or missing answers|Troubleshooting#the-assistant-says-it-is-not-sure-or-answers-wrongly]] ·
[[Deploy and CLI errors|Troubleshooting#deploy-and-cli-errors]] ·
[[Cloudflare errors|Troubleshooting#cloudflare-errors]] ·
[[Dashboard|Troubleshooting#the-dashboard]] ·
[[API errors|Troubleshooting#api-errors]] ·
[[Features|Troubleshooting#live-chat-telegram-webhooks-email-tools-bookings-files]]

## Where to look

| Where | What it tells you | How |
| --- | --- | --- |
| `helppuff doctor` | Which piece is broken, and the command that fixes it | Run it first, every time |
| `helppuff model test ["question"]` | Whether the model answers, and if not, why: a refused key, an unknown model, a missing secret, a timeout | HelpPuff's assistant only (not Retell, OpenAI with `promptId`, and so on) |
| `helppuff rag test ["question"]` | The passages the knowledge source returns, with scores | Same |
| `helppuff ask "…" --json` | The reply, the passages it used and their scores | `--timing` adds each step's time |
| The browser console | Why the widget hid itself | Add `?hpdebug=1` to the page address, reload, look for `[helppuff]` lines |
| The browser's Network tab | Each request to the Worker, its status and the JSON error | Filter by your Worker's address |
| `helppuff logs` | New requests to the Worker, live | See [[Logs|Troubleshooting#logs]] |
| Cloudflare dashboard | Stored request logs, errors, CPU time | Workers & Pages → `knowtific-helppuff-<site>` → **Observability** |
| Dashboard → Knowledge | Each page's and file's status, with the reason when it failed | Website pages, Files, **Test a question** |
| Dashboard → Settings → Webhooks | Each delivery's status and error | **Recent deliveries**, **Send test** |
| Dashboard → Settings → Notifications | When the last email went, and why it failed | **Send me a test** |
| Dashboard → Prompt → Tools | What a tool's API answered | **Test** on the tool |
| Dashboard → Settings → Integrations | Whether a calendar key works | **Test** on the integration |
| Any CLI command with `--json` | A stable `code` and a `hint` with the next command | Scripts and coding agents branch on `code` |
| `DEBUG=helppuff helppuff …` | The CLI's stack trace | Only for an `unexpected` error (a bug: please report it) |

## Logs

```bash
helppuff logs                         # live, until Ctrl-C
helppuff logs --method POST           # only POSTs (chat messages, sign-ins…)
helppuff logs --search sessions       # only requests whose log mentions "sessions"
helppuff logs --json --seconds 15     # one JSON result: what arrived in 15 seconds
```

Start it, then repeat the failing request (send the chat message, reload the
page). It uses your `wrangler login` session, or `CLOUDFLARE_API_TOKEN` from
`.env`; a token used only for logs needs **Workers Tail Read** on the Worker.
`npx wrangler tail knowtific-helppuff-<site>` does the same.

Older requests are in the Cloudflare dashboard: **Workers & Pages** →
`knowtific-helppuff-<site>` → **Observability** (stored logs, searchable) or
**Logs → Live**. Workers observability is turned on by `helppuff deploy`.

**What the logs contain.** Cloudflare logs each request's method, path, HTTP
status, outcome and CPU time. HelpPuff adds a JSON line for every failure,
on every deployment, with the reason:

```json
{"level":"error","event":"request.error","code":"connector_error","status":502,"detail":"openai_compatible_401:{\"error\":\"invalid api key\"}","method":"POST","path":"/v1/sessions/messages"}
{"level":"error","event":"webhook.emit_failed","type":"lead.created","reason":"TypeError: fetch failed"}
```

`detail` and `reason` are the machine-readable cause. Background work logs
the same way: `cron.*_failed`, `live.*_failed`, `telegram.*_failed`,
`bookings.*_failed`, `jobs.setup_failed`, `record.failed`. Search
Observability for `level:error`, or `helppuff logs --search error`. Never
message text, contact details or IP addresses. The status and code:

| Status | `error.code` | Most likely cause | Next step |
| --- | --- | --- | --- |
| 400 | `bad_request` | A message too long or empty, an expired form, a bad field | The `message` says which |
| 401 | `unauthorized` | A broken or old session token, a missing API key, signed out | Reload the page; for the API, check the key |
| 401 | `session_expired` | The chat is older than `security.sessionTtlHours` (24 h) | The visitor starts a new chat |
| 403 | `forbidden_origin` | The page's address is not in `origins`, or the visitor's IP is blocked | [[Fix origins|Troubleshooting#the-widget-does-not-appear-on-my-site]] |
| 403 | `captcha_failed` | Turnstile could not verify the browser | [[Turnstile|Turnstile#if-something-goes-wrong]] |
| 403 | `forbidden` | An API key without the scope, a member doing an admin's job | The `message` names the scope or role |
| 404 | `not_found` | A wrong site id in the embed, a deleted item | Compare `data-site` with `site` in `helppuff.json` |
| 409 | `conflict` | It already exists (a user, a label, a tool name) | Use another name, or change the existing one |
| 429 | `rate_limited` | A per-visitor limit; `Retry-After` says when to retry | [[Limits|Troubleshooting#too-many-messages-try-again-shortly]] |
| 429 | `quota_exceeded` | The daily or per-chat cap | [[Caps|Troubleshooting#chat-is-unavailable-right-now]] |
| 500 | `internal` | A missing Worker secret, a deployment missing a part | `helppuff doctor`, then `helppuff deploy` |
| 502 | `connector_error` | The AI model or backend failed | `helppuff model test` |

Every error leaves the Worker as the same JSON:
`{"error": {"code": "…", "message": "…", "retryAfter": 30}}`. The public API
also sends an `X-Request-Id` header.

**For you, it also says why.** When the request is yours (signed in to the
dashboard, the admin key the CLI uses, an API key, or `helppuff chat` and
`helppuff ask`), the error adds `reason` (what went wrong) and `hint` (what to
do):

```json
{"error": {"code": "connector_error", "message": "The assistant is unavailable right now.",
  "reason": "The model API refused the key (HTTP 401). It said: {\"error\":\"invalid api key\"}",
  "hint": "Store a working key: helppuff secret set <NAME>, then helppuff deploy; helppuff model test checks it"}}
```

The CLI prints them as the error and its hint, and the dashboard shows them
in the error note. Visitors never see them: they get only the `message`.

## The widget does not appear on my site

The widget never shows a broken state: when something is wrong it does not
appear at all. Add `?hpdebug=1` to the page's address and open the browser
console:

| Console line | Meaning | Fix |
| --- | --- | --- |
| *(no `[helppuff]` line at all)* | The script is not on the page, or the browser blocked it | View the page source and look for `loader.js`; check the Content Security Policy (below) and ad blockers |
| `fatal:no_site_id` | The script tag has no `data-site` | Paste the snippet again: `helppuff embed` |
| `fatal:no_api_base` | The loader could not tell which Worker to talk to | Use the snippet exactly as `helppuff embed` prints it |
| `fatal:unsupported_browser` | A very old browser | Nothing to fix; other visitors see it |
| `config_failed` | The Worker's `/config` did not answer, or the browser blocked the answer | Usually `origins` (below). Open the Worker's address: does `helppuff status` show it deployed? |
| `app_load_failed` | The main script could not load: offline, blocked by a Content Security Policy, or a deploy in progress | Check the CSP; reload |
| `fatal:config_invalid` | The Worker sent a config this widget cannot read | `helppuff upgrade` (the Worker and the widget are from different releases) |
| `already loaded` | The script is on the page twice | Remove one (the first one wins) |
| `fatal:render_error_twice` | The widget crashed twice | A bug: open an issue with the console output |

Then check:

- **Is the page's origin allowed?** `origins` in `helppuff.json` must list the
  exact scheme and host, including `www.` if you use it and the port for
  local testing (`http://localhost:3000`). `helppuff config set` or edit it,
  then `helppuff deploy`. A missing origin shows in the console as a CORS
  error on the `/config` request.
- **Does the site have a Content Security Policy?** Allow the Worker's
  address in `script-src` and `connect-src` (and `img-src` if the assistant
  has an avatar). With Turnstile, also allow `https://challenges.cloudflare.com`
  in `script-src` and `frame-src`.
- **Is it hidden on this page?** Check `widget.launcher.hideOnPaths`.
- **Dashboard → Home → Check my site** looks for the snippet on your page.

## Messages visitors see

The widget shows the Worker's message as it is. Each one, with its cause:

### "Chat is unavailable right now."

The site's daily message cap (`security.limits.messagesPerSitePerDay`,
default 500) is reached. It resets at 00:00 UTC. Visitors still get your
contact details and the callback form. Raise it if the traffic is real
(`helppuff config set security.limits.messagesPerSitePerDay 2000`, then
deploy); see [[Costs and limits|Costs-and-Limits]].

### "Our assistant is resting for today. Call us on …, or leave your details"

The daily AI budget (`model.budget.dailyNeurons`, default 9,000 of the
10,000 free neurons) is spent, or Workers AI said the account's daily
allowance is used. It resets at 00:00 UTC. From 80%, answers get shorter
first. On Workers Paid you can raise the budget; on the Free plan the limit
is Cloudflare's. `helppuff status` shows today's use.

### "Too many messages. Try again shortly."

A per-visitor limit: 10 messages a minute, 100 a day, 5 new chats an hour or
20 a day from one IP address (the `security.limits.*` settings). The widget
waits for `Retry-After`. You testing a lot from one address hits these: test
with `helppuff chat`, which is exempt from the per-IP limits, or add your
office's address to `security.allowIps`.

### "This conversation has reached its limit. Start a new one to keep going."

`security.limits.messagesPerSession` (60) messages in one chat.

### "This conversation has expired." / "This conversation is no longer available."

The chat is older than `security.sessionTtlHours` (24), or its token no
longer verifies. The second one also happens to every open chat after
`HELPPUFF_SECRET` is rotated. The visitor starts a new chat.

### "This chat is not available on this site." / "This chat is not available."

The first: the page's origin is not in `origins` (above). The second: the
`data-site` in the snippet names no site on this Worker. A visitor whose IP
is in `security.blockIps` does not see the widget at all.

### "We could not verify that you are human. Please try again."

Turnstile refused the browser. Usually the page's hostname is not on the
Turnstile widget in Cloudflare. See [[Turnstile|Turnstile#if-something-goes-wrong]].

### "The assistant is busy right now. Please try again." / "The assistant is unavailable right now."

The model or backend failed. *Busy* is a failure a retry can fix: the
provider was overloaded, rate limited (429) or down (5xx), or timed out.
*Unavailable* is one it cannot: the key was refused, the model name is
wrong, a secret is missing. Find out which:

```bash
helppuff model test          # HelpPuff's assistant: says what the provider answered
helppuff doctor              # whole backends (OpenAI, Gemini, Retell, your API): keys and instances
```

| `model test` says | Fix |
| --- | --- |
| `NAME is not set on the Worker` | `helppuff secret set NAME`, then `helppuff deploy` |
| `The provider refused the key` | A new key: `helppuff secret set NAME` |
| `The provider does not know that model or address` | Check `model` and the base URL: `helppuff model`, then `helppuff model set …` |
| `The provider took too long to answer` | Try a faster model, or the provider is having a bad day |
| `The custom module is not in the deployed Worker` | `helppuff deploy` |

Setting `model.fallbackModel` tries a second model once when the first one
fails.

### "That message is a little too long." / "That message is empty."

`security.limits.maxMessageLength` (1,000 characters).

### "This form has expired. Please refresh the page and try again."

The visitor sent a form the chat no longer offers (the page was open for a
long time, or the settings changed). Refreshing fixes it.

### Booking and file messages

| Message | Cause |
| --- | --- |
| "Booking in the chat is not on for this site." | `bookings.mode` is not the date picker. See [[Bookings]] |
| "That time is no longer offered" / "has passed" / "was just taken" | The slot changed between showing and booking; the visitor picks another |
| "The calendar could not …" | The synced calendar refused. Dashboard → Settings → Integrations → **Test** |
| "Sending files is not on for this chat." | `files.chat` is `off`. See [[Photos and files|Files]] |
| "You can send photos and files once someone from the team has joined the chat." | `files.chat` is `live`: files open only in a live chat |
| "This chat cannot take more files." | `files.perConversation` reached |
| "This link has expired." | Signed file links expire; open the file again |

## The assistant says it is not sure, or answers wrongly

The assistant only answers from what it found. When nothing scores above the
threshold it says it is not sure and offers a person: that is on purpose.
How the search works: [[Knowledge base|Knowledge-Base]], section 4.

1. **See what it found.** Dashboard → Knowledge → **Test a question**, or
   `helppuff ask "…" --json` (the `sources` and their scores).
2. **No passage at all?** The page may not be learned:
   `helppuff knowledge pages --status error`, or Website pages in the
   dashboard. A page shows **Blocked** (robots.txt), **Skipped** (no readable
   text: often a page drawn by JavaScript; it is rendered in a browser
   automatically when possible, see `knowledge.website.renderJs`) or **Failed** with
   the reason on the row. Not on the list at all? `helppuff discover` shows
   what was found and what is selected; `helppuff crawl --urls <url>` learns
   one page.
3. **The right passage, but scored low?** It may be dropped by the reranker.
   Lower `knowledge.retrieval.minScore` a little (0.2 by default), or write the answer
   yourself (below).
4. **Old information?** The site is re-crawled on `knowledge.website.schedule`;
   `helppuff crawl --wait` re-learns now. Unchanged pages are skipped by their hash.
5. **Add the answer yourself.** Dashboard → Knowledge → **Your own answers**,
   `helppuff knowledge add --title … --text …`, a file upload, or a business
   detail (`helppuff knowledge facts set phone="…"`). Questions visitors asked
   that nothing answered collect under **Questions to answer**
   (`helppuff knowledge gaps`).
6. **It says something the prompt forbids, or ignores an instruction?** The
   dashboard's Prompt page flags lines that repeat a setting or rule; see
   [[Prompt and instructions|Prompts-and-Instructions]]. Keep a set of real
   questions and run `helppuff eval` after every change:
   [[Testing and monitoring|Testing-And-Monitoring]].

**A file failed to learn.** The reason is next to it. "No readable text"
usually means a scanned PDF (pictures of text); upload a text version. "The
upload went missing" means it was not read within a few minutes; upload it
again. "This deployment cannot process files yet": `helppuff deploy`.

**The crawl does not start or never finishes.** "This deployment has no crawl
workflow": `helppuff deploy`. "The crawl could not start. Try again in a
minute": Cloudflare refused to start the background job; try again.
`helppuff crawl --wait` that stops with `crawl_timeout` has not failed: the
crawl continues, follow it with `helppuff knowledge status`. The Free plan's
daily Browser Rendering and neuron limits can slow a large first crawl to the
next day.

**Replies are slow.** `helppuff ask "…" --timing` prints each step. On
Workers AI the model and the reranker take most of it; turning the reranker
off (Settings → Advanced → "Double-check answers") saves about half a second,
at some cost in accuracy. See [[AI models: speed, quality, cost|AI-Models]].

## Deploy and CLI errors

Every CLI error has a stable `code` (in `--json` output) and a `hint` with
the command to run next. Exit codes: `0` ok, `1` error, `2` usage (a wrong
flag or a missing `--yes`), `3` Cloudflare or the admin API refused the
credentials, `4` a Cloudflare quota or plan limit, `10` answers needed
(`needs_input`: the JSON lists the questions and the flag for each).

### Project and config

| Code | Meaning | Fix |
| --- | --- | --- |
| `no_project` | No `helppuff.json` here or in a parent folder | `cd` into the project, or `helppuff init` |
| `project_exists` | `init` in a folder that already has one | Edit it and deploy, or `init --force` to start over |
| `invalid_project` | `helppuff.json` is not valid JSON, or a field is wrong | The message lists each field; `helppuff schema` shows every allowed one; `helppuff validate` checks without deploying |
| `project_too_new` | `helppuff.json` was written by a newer CLI | `npx @knowtific/helppuff@latest …` |
| `missing_prompt` | The `prompt` file does not exist | Create it, or fix `prompt` in `helppuff.json` |
| `prompt_too_long` | `prompt.md` is over 16,000 characters | Move reference material into the knowledge base (`knowledge.files`) |
| `missing_secret` | A key the config needs is not in `.env` | `helppuff secret set <NAME>` |
| `invalid_api_key` | `init` checked the key with the provider and it was refused | Check the key and run again |
| `invalid_url` | Not a website address | Use `acme.com` or `https://acme.com` |
| `custom_module_missing` | `model.module` or `retrieval.module` points at a missing file | `helppuff scaffold model` / `scaffold rag`, or fix the path |
| `unknown_embedding_model` | An embedding model HelpPuff does not know the size of | Use one the hint lists |

### Dashboard and prompt changes

| Code | Meaning | Fix |
| --- | --- | --- |
| `settings_changed` | Settings changed in the dashboard since this folder pulled them | `helppuff config pull`, check the diff, deploy |
| `prompt_behind`, `prompt_diverged` | The prompt was changed in the dashboard | `helppuff prompt pull` (your unpublished edits are kept in `prompt.mine.md`), then deploy |
| `prompt_not_versioned` | This backend keeps its prompt elsewhere (Retell, OpenAI `promptId`, `http`) | Change it there |
| `no_history`, `no_such_version` | Prompt history needs the dashboard database; or no such version | Turn the dashboard on; `helppuff prompt history` |

### Versions

| Code | Meaning | Fix |
| --- | --- | --- |
| `downgrade` | The Worker runs a newer release than this CLI | `npx @knowtific/helppuff@latest …`, or `--allow-downgrade` to roll back on purpose |
| `cli_outdated`, `outdated` | `upgrade` run with an older CLI | `npx @knowtific/helppuff@latest upgrade` |
| `outdated_worker` | The Worker is older than the feature you asked for (files, live chat, bookings) | `helppuff upgrade` |
| `needs_confirmation` | A delete (or `upgrade`, `destroy`) run without a terminal or with `--json`: every delete asks first, and says it cannot be undone | Add `--yes` once you are sure |

See [[Upgrading#if-an-upgrade-fails|Upgrading]] for a failed upgrade and the
D1 restore point.

### Reaching the Worker

| Code | Meaning | Fix |
| --- | --- | --- |
| `not_deployed` | Nothing deployed yet for this folder | `helppuff deploy` |
| `unreachable`, `network` | The Worker or Cloudflare's API did not answer | Check the connection and the address; `helppuff status` |
| `no_admin_key`, `admin_unauthorized` | `ADMIN_API_KEY` is missing in `.env` or does not match the Worker's | `helppuff deploy` sets it again |
| `admin_error`, `not_found` | The Worker refused a request; the message says why | Follow the message |
| `rate_limited` | Too many admin requests at once | Wait a minute |
| `dashboard_disabled` | The command needs the dashboard database | `helppuff config set dashboard.adminEmail you@example.com`, then deploy |
| `not_workers_ai`, `backend_whole` | The command is for HelpPuff's assistant or knowledge base; this backend has its own | Use the backend's own tools, or `helppuff model set …` |
| `chat_<code>` | `helppuff chat` / `ask` got an error from the Worker | The part after `chat_` is the [[status table's code|Troubleshooting#logs]] |
| `unexpected` | A bug in the CLI | Run again with `DEBUG=helppuff` and open an issue with the output |

## Cloudflare errors

| Code / message | Meaning | Fix |
| --- | --- | --- |
| `needs_cloudflare_token` | Not logged in to Cloudflare | `npx wrangler login`, or `helppuff secret set CLOUDFLARE_API_TOKEN` |
| `cloudflare_permission` (exit 3) | The token lacks a permission; the message names it | Edit the token at dash.cloudflare.com/profile/api-tokens; the list is in [[Configuration|Configuration#cloudflare-access]] |
| `cloudflare_no_account` | The token sees no account | Give it Account Settings › Read and your account under Account Resources, or set `CLOUDFLARE_ACCOUNT_ID` |
| `needs_cloudflare_account` | The token reaches several accounts | `--cf-account <id>` or `CLOUDFLARE_ACCOUNT_ID` |
| `cloudflare_account_mismatch` | The token cannot reach the account in `helppuff.json` | Use a token for that account; the hint lists the ones it can reach |
| `cloudflare_limit` (exit 4) | A plan limit (Workers, KV namespaces, D1 databases, Vectorize indexes) | Remove unused resources, or upgrade the plan; see [[Cloudflare Free plan limits|Cloudflare-Free-Plan]] |
| `cloudflare_error` with 429 | Cloudflare is rate limiting the API | Wait a minute and retry |
| `no_subdomain` | The account has no workers.dev subdomain | Open **Workers & Pages** in the Cloudflare dashboard once, then deploy again |
| `vectorize_dimensions` | The vector index was made for another embedding model | Go back to that model, or `npx wrangler vectorize delete <index>`, deploy and `helppuff crawl` |
| `wrangler_failed` | `wrangler deploy` failed; the last lines are in the message | Follow the hint; `helppuff doctor` |
| `wrangler_missing` | The bundled Wrangler is missing | Reinstall `@knowtific/helppuff` |
| `cloudflare_tail_failed` | `helppuff logs` could not attach | The token needs **Workers Tail Read** for the Worker |
| `invalid_domain` | `helppuff domain add` was given something that is not a hostname | Use a hostname on your own domain, like `chat.acme.com` |
| `domain_dns_conflict` | The hostname already has a DNS record | Delete it under your domain → **DNS → Records**, then `helppuff domain add` again |
| `domain_not_on_cloudflare` | The domain is not a zone on this Cloudflare account | Add the domain to Cloudflare (nameservers at your registrar), wait until it is Active. See [[Your own domain|Deployment#your-own-domain]] |
| "does not answer" (doctor, `helppuff domain`) | A new domain's certificate is still being issued, or it was detached | Wait a few minutes; `helppuff domain` says whether it is attached |
| "no R2 bucket" (doctor) | Photos and files are on, but R2 is not enabled on the account | Enable R2 once in the Cloudflare dashboard (Cloudflare may ask for a card), then deploy. See [[Photos and files|Files]] |
| "AI Search instance does not exist" | The `cloudflare` or `anthropic` backend's instance is missing | `helppuff knowledge sync`, or check `backend.instance` |

## The dashboard

**I cannot sign in.**

```bash
npx @knowtific/helppuff dashboard        # a one-time sign-in link (15 minutes)
helppuff users reset you@example.com     # a new password
```

Before anyone has an account, `helppuff dashboard` prints the setup link
again. "Too many sign-in attempts. Wait a few minutes and try again" is the
sign-in limit, per address and per account. "That email and password do not
match" never says which one is wrong, on purpose.

**"Please sign in" out of nowhere.** The session ended: seven days passed,
the password changed, someone signed out everywhere, you were removed from the
team, or `HELPPUFF_SECRET` was rotated.

**"Only an admin can do this."** You are a **member**; members reach
conversations, jobs, contacts, callbacks and live chat. An admin changes your
role under Settings → **Team & security** (`helppuff users role
you@example.com admin`).

**"This deployment has no KV namespace."** The deployment is missing a part:
`helppuff deploy`.

More: [[Locked out, or changing the admin key|Dashboard#locked-out-or-changing-the-admin-key]].

## API errors

The public API (`/api/v1`) answers with the same JSON error and an
`X-Request-Id` header.

| Message | Fix |
| --- | --- |
| "Send an API key: Authorization: Bearer hp_live_…" | Add the header |
| "This API key is not valid (unknown, revoked or expired)." | `helppuff keys list`; create a new one |
| "This key does not have the `<scope>` scope." | Create a key with that scope (`helppuff keys create … --scopes …`) |
| "This key cannot be used from this address." | The key has `--allow-ips`; call from one of them |
| "This key is for site …" | Keys work for one site each |
| 429 `rate_limited` | The key's `--rate` per minute; wait `Retry-After` seconds |

See [[The API|API]].

## Live chat, Telegram, webhooks, email, tools, bookings, files

Each has its own page with the details; the common ones:

| Problem | Fix |
| --- | --- |
| Visitors always get the callback form instead of a person | Nobody is available: a dashboard tab open with **Available** on, or [[Telegram]] linked. `helppuff live status`. [[More|Live-Chat#troubleshooting]] |
| No sound or notification for a new live chat | Click anywhere in the dashboard once (browsers need a click before sound), Settings → Notifications → **Test sound**; allow notifications for the dashboard's site |
| Telegram: nothing arrives, or "Last error" | `helppuff telegram status`; reconnect with a fresh token. [[More|Telegram#troubleshooting]] |
| Webhooks do not arrive | Settings → Webhooks → **Recent deliveries**; endpoints must be `https://` and answer 2xx within 8 seconds. [[More|Webhooks]] |
| Signed webhooks fail your check | Your server's clock is off, or you are hashing a re-serialised body instead of the raw one. [[More|Webhooks]] |
| Team emails do not arrive | Settings → Notifications → **Send me a test** shows what the email service answered; `helppuff email test --to you@…`. [[More|Email-Notifications]] |
| A tool is never called, or the assistant says it "could not check" | Prompt → Tools → **Test**; `helppuff tools test <name> --arg …`. A 4xx/5xx or a timeout is treated as "could not check". [[More|Tools]] |
| Signed-in visitors are treated as anonymous | The token is forged, expired or signed with an old secret, so it is ignored. [[More|Signed-In-Visitors]] |
| The booking picker is empty | No free times in the hours you set, or the synced calendar is full or failing: Settings → Integrations → **Test**. [[More|Bookings]] |
| No paperclip in the widget | `files.chat` is off, or `live` and nobody has joined, or no R2 bucket: `helppuff files status`. [[More|Files#troubleshooting]] |

## Still stuck

Open an issue with the output of `helppuff doctor --json` (it contains no
secrets), the failing request's status and JSON body from the browser's
Network tab or `helppuff logs`, and what you expected to happen.
