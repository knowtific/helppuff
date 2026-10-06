# Provider: Cloudflare AI Search

`"backend": { "type": "cloudflare" }`

[Cloudflare AI Search](https://developers.cloudflare.com/ai-search/) does the
retrieval and generation: it indexes your site and files, and answers with a
Workers AI model. Only a Cloudflare account is needed.

Choose it when you already use AI Search, or want Cloudflare to manage the
index. Otherwise the default [[Workers AI|Provider-Workers-AI]] backend is
usually the better fit: it runs on the free plan, says "not sure" instead of
guessing, and has the dashboard's knowledge tools (choose pages, files,
facts, a passage tester).

## Set up

```bash
npx @knowtific/helppuff init --url acme.com --backend cloudflare
```

`init` lists the AI Search instances on your account and pre-selects one that
already crawls your site (reusing it costs nothing and it is already indexed).
Otherwise it creates `knowtific-helppuff-<site>`.

```jsonc
"backend": { "type": "cloudflare" }                                        // knowtific-helppuff-<site>, created for you
"backend": { "type": "cloudflare", "instance": "acme-website" }            // an instance you already have
"backend": { "type": "cloudflare", "endpoint": "https://search.acme.com" } // a public endpoint, even on another account
```

| Option | | |
| --- | --- | --- |
| `instance` | — | An instance on your account, by name |
| `endpoint` | — | A public AI Search endpoint instead of an instance |
| `model` | the instance's | A Workers AI model id, or an AI Gateway alias |
| `maxResults` | — | Passages retrieved per question (1–50) |

The API token needs **AI Search › Edit** and **AI Search › Run** as well as
the usual permissions ([[Configuration|Configuration#cloudflare-access]]).

## How your site gets indexed

| Your site | What happens |
| --- | --- |
| A zone on the same Cloudflare account | AI Search crawls it itself (`sitemap` mode if the site has one, link-following if not), with a headless browser for pages drawn by JavaScript. It re-syncs every 6 hours. |
| Anywhere else | HelpPuff crawls up to `knowledge.website.maxPages` pages (default 50) and uploads them as Markdown. `helppuff knowledge sync` refreshes them. |

Files in `knowledge.files` (PDF, Word, Markdown, text, HTML, CSV, up to 4 MB
each) are uploaded either way. Nothing waits for indexing: `deploy` goes live
at once and answers improve as pages finish (`helppuff knowledge status`).

On a newly created crawler instance, HelpPuff waits for Cloudflare's first
crawl before uploading files, because that first sync drops files uploaded
while it runs; then it checks every file is listed.

## Notes

- AI Search's chat completions take no tool definitions, so rich messages
  (option chips, links) use inline markers, which HelpPuff teaches the model and
  turns into real chips.
- Conversation history (the last 24 turns) is read from HelpPuff's record of
  the conversation in D1, or kept in KV per session without a database.
- Limits during the beta: 100 instances and 500 crawled pages a day on Workers
  Free. Workers AI generation is billed as usual.
