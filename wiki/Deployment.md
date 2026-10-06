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

## Before going live

1. `origins` lists every host the widget is on, including `www` and any staging site.
2. `security.limits.messagesPerSitePerDay` is a number you are happy to pay
   for (or, on Workers AI, the daily neuron budget). It is the backstop when
   everything else fails.
3. Turnstile (`security.captcha`) is on for a busy public site. It is the
   only layer that tells a person from a script; see [[Security]].
4. Business details are right (Settings → Business details), so visitors can
   still reach you when the assistant cannot help.
5. `helppuff doctor` passes.

## Logs

Workers observability is turned on. In the Cloudflare dashboard, open the
Worker → **Logs** to see requests, errors and the events HelpPuff logs (event
names, ids, counts and timings; never message text or contact details).

## Removing it

`helppuff destroy --yes` deletes every resource above. Irreversible: the
database's conversations, leads and knowledge go with it.
