# Deployment

`helppuff deploy` (or a bare `npx @knowtific/helppuff` in a project folder)
creates or updates everything on your Cloudflare account. It is safe to run
at any time: it finds what exists before creating anything, and never creates
anything twice.

## What it creates

Everything is named **`knowtific-helppuff-<site>`**, so it is easy to find on
your account and never mistaken for anything else.

| Resource | Holds | For |
| --- | --- | --- |
| **Worker** `knowtific-helppuff-<site>` | the widget files, the chat API, the dashboard | everything |
| **KV namespace** | the live config (settings, prompt), new-conversation counters | everything |
| **Rate limiter** (binding, no resource) | messages per visitor a minute, counted where the visitor is | everything |
| **D1 database** | conversations (also the source of the chat limits and the model's history), leads, dashboard accounts, webhooks, the knowledge base's text and full-text index | the dashboard and `workers-ai` |
| **Vectorize index** (1024 dimensions, cosine) | one vector per knowledge passage | `workers-ai` and `"retrieval": "helppuff"` |
| **Workflow** `knowtific-helppuff-<site>-crawl` | background jobs: crawls, file processing, each conversation's summary and `conversation.completed`, webhook retries | every assistant with a dashboard |
| **Workers AI**, **Browser Rendering** | bindings, no resource | answers, embeddings; pages drawn by JavaScript |
| **AI Search instance** | the provider's index | the `cloudflare` and `anthropic` backends |

plus a daily cron that re-learns sites whose schedule is due, and two
generated secrets: `HELPPUFF_SECRET` and `ADMIN_API_KEY` (in your `.env` and set
on the Worker).

The Worker's address is `https://knowtific-helppuff-<site>.<your subdomain>.workers.dev`;
`deploy` prints it, with the dashboard, the demo page and the script.

## What a deploy does

1. Connects to Cloudflare and finds your `workers.dev` subdomain.
2. Checks the secrets the config needs are present.
3. Finds or creates KV, D1 (and applies pending database migrations), Vectorize and AI Search.
4. Refuses to overwrite a prompt or settings changed in the dashboard since
   this folder last pulled them (see [[Configuration|Configuration#the-dashboard-and-helppuffjson]]).
5. Uploads the Worker, **only when its code or bindings changed**. A new
   release always uploads it.
6. Sets secrets that are missing or changed.
7. Publishes the live config to KV. This is why content changes are live in seconds.
8. Checks the Worker answers, then (for `workers-ai`) syncs `knowledge.files`,
   and starts learning when asked to (`--crawl`) or when no person is there to
   onboard (see [[Using with AI agents|AI-Agents]]).

## Live config

The site's settings, widget and prompt are kept in KV under `config:<site>`,
so a dashboard save or a content-only deploy is live within a minute without
uploading code. Two things deliberately need a real deploy:

- **`origins`**, the sites the widget may be embedded on. KV cannot widen it,
  so write access to KV cannot let another site embed your assistant.
- **The backend's bindings**: which Vectorize index, AI Search instance and so on.

A stored config that fails validation is ignored (and logged); the site keeps
running on the last good one.

## One Worker serves everything

```
https://knowtific-helppuff-acme.you.workers.dev
├── /loader.js, /app-<hash>.js   the widget: static files, served from Cloudflare's edge
├── /v1/*                        the chat API
├── /admin/                      the dashboard (and /admin/api/*)
├── /chat.html                   the test chat
└── /                            the demo page
```

Static files are served without running the Worker. `loader.js` is cached for
five minutes and the app file (`app-<hash>.js`, content-hashed) for a year,
both with `Access-Control-Allow-Origin: *`, which the widget needs to load on
your site.

**Serving the widget from your own CDN** works too: host `loader.js` and the
app file anywhere, and point the script at the Worker with `data-api`:

```html
<script src="https://cdn.acme.com/helppuff/loader.js" data-site="acme" data-api="https://knowtific-helppuff-acme.you.workers.dev" async></script>
```

## Your own domain

By default the assistant answers on `knowtific-helppuff-<site>.<you>.workers.dev`.
To use an address on your own domain, like `chat.acme.com`:

```bash
helppuff domain add chat.acme.com
```

It attaches the hostname to the Worker with Cloudflare's Workers Custom
Domains: Cloudflare creates the DNS record and the certificate itself. Then:

- `cloudflare.domain` in `helppuff.json` is set, and the embed snippet, the
  demo page and the dashboard links use the new address (`helppuff embed`
  prints the snippet). Put the new script on your site when it suits you.
- **workers.dev keeps working**, so pages with the old script keep their
  widget, and the CLI keeps using it. Nothing breaks while the certificate is
  issued (usually a minute or two; `add` waits up to 60 seconds, and
  `helppuff domain` checks again).
- `helppuff deploy` attaches the domain again if it went missing (a new
  account, after `destroy`), and `helppuff doctor` checks that it answers.

**What it needs:**

- The domain is on **the same Cloudflare account** as the assistant, and
  Active (its nameservers point at Cloudflare). A domain whose DNS is
  elsewhere must be added to Cloudflare first (**Add a domain** in the
  Cloudflare dashboard, then change the nameservers at your registrar).
- The hostname has **no DNS record of its own**. If `chat.acme.com` already
  has one, delete it under your domain → **DNS → Records**, then run
  `helppuff domain add` again (`domain_dns_conflict` says so).
- With an API token: **Workers Scripts › Edit**, plus **Zone › Read** to find
  the zone. `wrangler login` has both.

```bash
helppuff domain                          # attached? answering?
helppuff domain remove chat.acme.com     # asks first; --yes for scripts and agents
```

Removing it leaves the certificate in Cloudflare (SSL/TLS → Edge
Certificates) until you delete it there. A domain is only set from the CLI
(or an AI agent using it): the dashboard has no Cloudflare login to do it
with. One domain per assistant is tracked in `helppuff.json`; the dashboard
signs you in separately on each address.

## Before going live

1. `origins` lists every host the widget is on, including `www` and any staging site.
2. `security.limits.messagesPerSitePerDay` is a number you are happy to pay
   for (or, on Workers AI, the daily neuron budget). It is the backstop when
   everything else fails.
3. Turnstile is on. It is the only layer that tells a person from a script,
   and it protects the dashboard's sign-in too. See [[Turn on Turnstile|Turnstile]];
   the dashboard's Home page shows **Before you go live** until it is.
4. Business details are right (Settings → Business details), so visitors can
   still reach you when the assistant cannot help.
5. `helppuff doctor` passes.

## Logs

Failures are always logged, on every deployment: a refused or failed
request, a background job that failed (a crawl, a webhook, a calendar sync,
a live chat relay) and the reason, as a JSON line at `error` (or `warn` for a
refused request, such as a rate limit). Never message text, contact details
or IP addresses. Everything else (timings, a chat starting) is logged only
with `HELPPUFF_LOG=1`, which `helppuff dev` sets.

From the folder containing `helppuff.json`, run `helppuff logs` to tail new
requests in the terminal; press Ctrl-C to stop. `helppuff logs --json
--seconds 15` returns one JSON object with events collected during those 15
seconds. The command uses your `wrangler login` session or
`CLOUDFLARE_API_TOKEN` from `.env`; a logging-only token needs **Workers Tail
Read** for the Worker. Workers observability is turned on, so in the
Cloudflare dashboard the Worker → **Observability** has stored logs
(searchable, e.g. `request.error`) and **Logs → Live** new ones.

A failed request logs `request.error` with its `code`, `status`, `detail`
(the machine-readable reason, such as `missing_secret:OPENAI_API_KEY` or
`origin_not_allowed`), method and path. The same reason, said plainly with
what to do, is in the error response for the owner: the CLI, the dashboard,
API keys and `helppuff chat`/`ask` show it. Visitors only get the safe
message. See [[Troubleshooting|Troubleshooting#logs]].

## Removing it

`helppuff destroy --yes` deletes every resource above, including the R2
bucket and its photos and files. Irreversible: the database's
conversations, leads and knowledge go with it. Without `--yes` you type the
site name, and it asks before deleting the files; `--keep-data` keeps the
database, the vector index and the files.
