# Cloudflare Free plan limits

HelpPuff's default setup runs on Cloudflare's **Workers Free plan**. These are
the limits that matter for it, and what each one means in practice. Checked
against Cloudflare's documentation in October 2026. Cloudflare changes them
from time to time, so the links go to the current numbers.

Daily limits reset at 00:00 UTC. [Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/)
($5 a month) lifts almost all of them; the right-hand column says what happens
when one runs out.

## What one assistant uses

Each assistant (one `site`) uses **1 Worker, 1 KV namespace, 1 D1 database,
1 Vectorize index, 1 Workflow, 1 Cron Trigger and 1 Durable Object class**
(live chat's hub, SQLite-backed, the kind the Free plan has; idle, it costs
nothing) on your account.

## Per account: how many assistants fit

| Limit | Free | For HelpPuff |
| --- | --- | --- |
| [Cron Triggers](https://developers.cloudflare.com/workers/platform/limits/) | **5 per account** | One per assistant (the daily re-learning). **At most 5 assistants on one free account**, fewer if your other Workers use crons |
| [D1 databases](https://developers.cloudflare.com/d1/platform/limits/) | 10 per account, 5 GB in total | One per assistant |
| [Workers](https://developers.cloudflare.com/workers/platform/limits/) | 100 per account | One per assistant |
| [Vectorize indexes](https://developers.cloudflare.com/vectorize/platform/limits/) | 100 per account | One per assistant |
| [Workflows](https://developers.cloudflare.com/workflows/reference/limits/) | 100 instances running at once, per account | Crawls and file uploads queue beyond that; nothing is lost |

## Per day: how much traffic fits

| Limit | Free | For HelpPuff | When it runs out |
| --- | --- | --- | --- |
| [Workers requests](https://developers.cloudflare.com/workers/platform/limits/#daily-requests) | 100,000 a day, per account | Every widget request (a chat is a handful), dashboard call and webhook delivery. Static widget files do not count | The Worker answers with Cloudflare's error 1027 until midnight UTC |
| [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) | 10,000 neurons a day, per account | About 30 per answer: **roughly 300 answers a day**. Crawling costs a few per page, once | HelpPuff stops at its own budget first (9,000 by default): visitors get your contact details and a callback form |
| [KV writes](https://developers.cloudflare.com/kv/platform/limits/) | 1,000 a day | **None per message** with a database (the default): one per new conversation (the sessions-per-visitor limit), plus settings saves. Without a database, about 4 per message | Chats keep working; the sessions-per-visitor limit stops counting until midnight UTC |
| [KV reads](https://developers.cloudflare.com/kv/platform/limits/) | 100,000 a day | One or two per message (the live config, the conversation's page and form details) | Reads fail softly; settings fall back to the deployed ones |
| [D1 rows written](https://developers.cloudflare.com/d1/platform/pricing/) | 100,000 a day | Recording conversations (which the limits and the history read back), leads, learning pages | Recording stops for the day; chats continue |
| [D1 rows read](https://developers.cloudflare.com/d1/platform/pricing/) | 5 million a day | Searches, the dashboard | Searches fail and the assistant offers a callback |
| [Browser Rendering](https://developers.cloudflare.com/browser-run/limits/) | 10 minutes a day | Only pages drawn by JavaScript, while learning the site | Those pages are skipped, with the reason shown; the next crawl retries |
| [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) | 100,000 requests and 13,000 GB-s a day | [[Live chat|Live-Chat]] only: a few requests per live chat (each socket, and one per 20 messages it carries). Hibernating sockets cost no duration. 50 live chats of 40 messages ≈ 250 a day | Live chats stop connecting; the widget polls, and new hand-overs get the callback form |
| [Vectorize queries](https://developers.cloudflare.com/vectorize/platform/pricing/) | 30 million queried dimensions a month | About 900 searches a day for a 70-page site | Meaning search fails; keyword search still answers |

## Size

| Limit | Free | For HelpPuff |
| --- | --- | --- |
| [D1 database size](https://developers.cloudflare.com/d1/platform/limits/) | **500 MB** per database | Conversations, leads and the knowledge base's text. Plenty for a small business: a 70-page site is a few MB, and a conversation a few KB |
| [Vectorize storage](https://developers.cloudflare.com/vectorize/platform/pricing/) | 5 million stored dimensions | About 4,800 passages at 1024 dimensions (a 70-page site is ~600) |
| [KV storage](https://developers.cloudflare.com/kv/platform/limits/) | 1 GB | Small: settings, a few counters |
| [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) | 7 days | How far back `helppuff upgrade`'s database restore point reaches |
| Uploaded files | 10 MB each (HelpPuff's limit) | Up to ~300,000 characters of text are learned per file |

## Per request: why HelpPuff is built the way it is

| Limit | Free | How HelpPuff stays inside it |
| --- | --- | --- |
| [CPU time](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) | 10 ms per request, per Workflow step and per cron run | Waiting on AI, the database or the network does not count. Heavy work (crawling, reading files) runs in small Workflow steps |
| [Subrequests](https://developers.cloudflare.com/workers/platform/limits/#subrequests) | 50 to the internet, 1,000 to Cloudflare services, per request | The crawl runs in batches of 15 pages per Workflow instance |
| [D1 queries](https://developers.cloudflare.com/d1/platform/limits/) | 50 per invocation | Writes are batched |
| [Workers AI text generation](https://developers.cloudflare.com/workers-ai/platform/limits/) | 300 requests a minute (20 for models that need Workers Paid) | Far above a small site's peak |
| [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | as often as every minute, in UTC | HelpPuff's runs once a day (03:23 UTC) |
| [Workflows](https://developers.cloudflare.com/workflows/reference/limits/) | 1,024 steps per instance, 1 MiB per step result | One step per page; long crawls chain several instances |

## Signs you have outgrown the Free plan

- More than a few hundred answers a day (the dashboard's Knowledge page shows
  today's AI use, and visitors start getting the callback form in the evening).
- More than 5 assistants on one account.
- Many pages that need JavaScript rendering.

Workers Paid ($5 a month) removes the daily caps on requests, KV, D1 and
Browser Rendering, and bills Workers AI past the free 10,000 neurons at
$0.011 per 1,000. Raise `backend.budget.dailyNeurons` to match what you are
happy to spend. See [[Costs and limits|Costs-and-Limits]].
