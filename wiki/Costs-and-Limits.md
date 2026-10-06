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

It resets at 00:00 UTC. The dashboard's Knowledge page and `helppuff knowledge
status` show today's use. On Workers Paid, raise
`backend.budget.dailyNeurons` to whatever you are happy to spend.

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
| `limits.sessionsPerIpPerHour` | 5 | New chats from one visitor, per hour |
| `limits.messagesPerSession` | 60 | One conversation |
| `limits.maxMessageLength` | 1000 | Characters per message |
| `sessionTtlHours` | 24 | How long a chat can be continued |

You (and your coding agent) are exempt from the per-visitor limits when
testing with `helppuff chat` or `helppuff ask`, never from the daily caps.

## Speed

A reply usually starts streaming within 1–2 seconds with the default backend.
`helppuff ask "<question>" --timing` shows where the time goes; see
[[Workers AI|Provider-Workers-AI#speed]].
