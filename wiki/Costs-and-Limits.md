# Costs and limits

HelpPuff runs on your Cloudflare account, so you pay Cloudflare (and your AI
provider, if you choose one), never HelpPuff. The default setup fits the
**Workers Free plan**.

## What the Free plan gives you

Every Cloudflare limit that matters, and what happens when one runs out, is on
**[[Cloudflare Free plan limits|Cloudflare-Free-Plan]]**. The short version:

**In practice**, a free account handles a few hundred conversations' worth of
answers a day:

- **Workers AI** is usually the first to run out. With the default model a
  typical answer is about 30 neurons, so about 300 answers a day fit; about
  500 with thinking off. Other models range from about 20 to 180 neurons an
  answer: see [[AI models|AI-Models]].
- **KV writes** are not a limit: a message writes nothing to KV. The
  per-visitor limit is counted by Cloudflare's Rate Limiting binding, and the
  per-conversation and daily limits and the conversation's history are read
  from the database, which records every turn anyway.

Nothing a visitor waits for is a write: everything HelpPuff records about a
message (the dashboard, usage, webhooks) happens after the reply.

[Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/)
($5 a month) removes the daily caps on everything except Workers AI, which
is then billed per neuron past the free allocation. Other AI providers bill
you directly at their own prices.

## Costs at higher volume

Past a few hundred answers a day you need **Workers Paid** ($5 a month), and
you raise two settings that otherwise stop you, on purpose:

```bash
helppuff config set security.limits.messagesPerSitePerDay 12000   # the daily cap (default 500)
helppuff model set workers-ai                                     # only if helppuff.json has no "model" yet
helppuff config set model.budget.dailyNeurons 400000              # Workers AI only (default 9,000)
helppuff deploy
```

(An older `helppuff.json` with `backend` has the budget at
`backend.budget.dailyNeurons`; `helppuff upgrade` moves it.)

Estimated **monthly** cost, in US dollars, for visitor messages a day (one
message = one answer). Prices checked on 2026-10-17 from each provider's
pricing page; they change, so check before you commit.

### Answers by Workers AI (on your Cloudflare bill)

| Model | 1,000 a day | 5,000 a day | 10,000 a day |
| --- | --- | --- | --- |
| GLM-4.7 Flash, thinking off | **$8** | **$37** | **$72** |
| GLM-4.7 Flash (default) | **$12** | **$55** | **$108** |
| Qwen3 30B | **$11** | **$51** | **$102** |
| GLM-5.3 Flash (estimate) | **$18** | **$86** | **$171** |
| Llama 4 Scout | **$20** | **$96** | **$191** |
| gpt-oss-120b | **$40** | **$193** | **$385** |
| DeepSeek V4 Flash (estimate) | **$41** | **$202** | **$402** |

The total: Workers Paid ($5), the Vectorize queries past the included amount
(about $2 at 5,000 a day, $4 at 10,000) and the neurons past the free 10,000 a
day at $0.011 per 1,000. Neurons per answer are the measured ones from
[[AI models|AI-Models]] (search, answer and the conversation's summary).

### Answers by another provider (their bill, plus Cloudflare's)

| Model | Per 1,000 answers | 1,000 a day | 5,000 a day | 10,000 a day |
| --- | --- | --- | --- | --- |
| Gemini 2.5 Flash-Lite | $0.38 | **$16** | **$71** | **$141** |
| GPT-6 Luna | $0.40 | **$17** | **$74** | **$147** |
| Claude Haiku 5.5 | $0.40 | **$17** | **$74** | **$147** |
| DeepSeek V4.1 Flash (off-peak – peak) | $0.57 – $1.14 | **$22 – 39** | **$100 – 185** | **$198 – 369** |
| GPT-5.6 Luna | $0.84 | **$30** | **$140** | **$279** |
| GPT-5.4 nano | $0.85 | **$30** | **$142** | **$282** |
| Gemini 3.1 Flash-Lite | $1.05 | **$36** | **$172** | **$342** |
| Gemini 3.6 Flash (until 2026-12-31) | $3.00 | **$95** | **$464** | **$927** |
| Gemini 3.6 Flash (from 2027) | $6.00 | **$185** | **$914** | **$1,827** |
| GPT-5.4 mini | $3.15 | **$100** | **$487** | **$972** |
| Claude Haiku 4.5 | $4.00 | **$125** | **$614** | **$1,227** |
| Claude Sonnet 5.5 | $8.00 | **$245** | **$1,214** | **$2,427** |
| GPT-6.1 Sol | $8.00 | **$245** | **$1,214** | **$2,427** |

The total: the provider's tokens, plus Cloudflare's part: Workers Paid ($5),
Vectorize, and HelpPuff's own knowledge search and conversation summaries,
which still run on Workers AI (about $7 a month at 5,000 a day, $18 at
10,000; free at 1,000).

**How these are worked out:**

- **An answer** reads about 3,000 tokens (instructions, four passages, recent
  history; capped by `model.budget.maxInputTokens`) and writes about 200,
  which matches what Workers AI measures for the default model. A provider's
  "thinking" tokens are billed as output, so a model thinking hard costs more
  than the table; prompt caching, where a provider offers it, costs less.
- **A conversation** is taken as four messages, with one summary.
- **Cloudflare's other parts stay within Workers Paid at these volumes:**
  requests (10 million a month included; each page view loads the widget's
  settings once, so about 300,000 page views a day fit), D1 (25 billion rows
  read, 50 million written), Workflows (one job per conversation), KV and
  logs. Vectorize counts (queries + stored passages) × 1,024 dimensions, with
  50 million included.
- **Your own API** (`http`, Retell, OpenAI with its own file store) bills you
  directly; Cloudflare's part is then about $5–10 a month.

Keep `security.limits.messagesPerSitePerDay` a little above your real
traffic: it is still the backstop if someone scripts the widget.

## The daily AI budget

With the default backend, HelpPuff tracks every neuron it spends (in D1, by
UTC day) and steps down gracefully instead of failing:

| Spent today (of `budget.dailyNeurons`, default 9,000) | Visitors get |
| --- | --- |
| under 80% | normal answers |
| 80–100% | shorter answers from fewer passages |
| 100% | no AI: a short note with your phone number and the callback form. Leads still come in |

[[Webhooks]] can tell you as it happens: `budget.warning` at 80% and
`budget.exhausted` at 100%, each once a day.

It resets at 00:00 UTC. Settings → Knowledge in the dashboard and `helppuff knowledge
status` show today's use. On Workers Paid, raise
`model.budget.dailyNeurons` to whatever you are happy to spend (see
[[Costs at higher volume|Costs-and-Limits#costs-at-higher-volume]]).

Learning your site costs a few neurons per page, once: unchanged pages are
never embedded again. Uploaded files cost the same per page of text. Each
conversation's automatic summary costs about 15–30 neurons, counted in the
same budget, and is skipped once the budget is spent.

## Limits that protect you

All in `security` in `helppuff.json`; see the [[Configuration reference|Configuration-Reference#security]].

| Limit | Default | |
| --- | --- | --- |
| `limits.messagesPerSitePerDay` | 500 | The cost backstop. When it trips, visitors see your contact details |
| `limits.messagesPerIpPerMinute` | 10 | One visitor, per minute |
| `limits.messagesPerIpPerDay` | 100 | One visitor, per day, so nobody uses up the cap alone |
| `limits.sessionsPerIpPerHour` | 5 | New chats from one visitor, per hour |
| `limits.sessionsPerIpPerDay` | 20 | New chats from one visitor, per day |
| `limits.messagesPerSession` | 60 | One conversation |
| `limits.maxMessageLength` | 1000 | Characters per message |
| `sessionTtlHours` | 24 | How long a chat can be continued |

[[Security|Security#every-limit]] lists every limit (ratings, polls, form
lengths, dashboard sign-in, IP allow and block lists) and how each is
counted. All of them are also on the dashboard's **Settings → Advanced** page.

You (and your coding agent) are exempt from the per-visitor limits when
testing with `helppuff chat` or `helppuff ask`, never from the daily caps.

## Speed

A reply usually starts streaming within 1–2 seconds with the default backend.
`helppuff ask "<question>" --timing` shows where the time goes; see
[[Workers AI|Provider-Workers-AI#speed]].
