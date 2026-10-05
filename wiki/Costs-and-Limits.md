# Costs and limits

Murmur runs on your Cloudflare account, so you pay Cloudflare (and your AI
provider, if you choose one), never Murmur. The default setup fits the
**Workers Free plan**.

## What the Free plan gives you

Every Cloudflare limit that matters, and what happens when one runs out, is on
**[[Cloudflare Free plan limits|Cloudflare-Free-Plan]]**. The short version:

**In practice**, a free account handles a few hundred conversations' worth of
answers a day:

- **Workers AI** is usually the first to run out. A typical answer is about
  30 neurons, so about 300 answers a day fit.
- **KV writes** come close: each message writes about four counters (rate
  limits, the conversation's history). Past 1,000 writes in a day, chats keep
  working, but the per-visitor rate limits stop counting until the next UTC
  day. The AI budget is counted in D1, so it still holds.

[Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/)
($5 a month) removes the daily caps on everything except Workers AI, which
is then billed per neuron past the free allocation. Other AI providers bill
you directly at their own prices.

## The daily AI budget

With the default backend, Murmur tracks every neuron it spends (in D1, by
UTC day) and steps down gracefully instead of failing:

| Spent today (of `budget.dailyNeurons`, default 9,000) | Visitors get |
| --- | --- |
| under 80% | normal answers |
| 80–100% | shorter answers from fewer passages |
| 100% | no AI: a short note with your phone number and the callback form. Leads still come in |

It resets at 00:00 UTC. The dashboard's Knowledge page and `murmur knowledge
status` show today's use. On Workers Paid, raise
`backend.budget.dailyNeurons` to whatever you are happy to spend.

Learning your site costs a few neurons per page, once: unchanged pages are
never embedded again. Uploaded files cost the same per page of text.

## Limits that protect you

All in `security` in `murmur.json`; see the [[Configuration reference|Configuration-Reference#security]].

| Limit | Default | |
| --- | --- | --- |
| `limits.messagesPerSitePerDay` | 500 | The cost backstop. When it trips, visitors see your contact details |
| `limits.messagesPerIpPerMinute` | 10 | One visitor, per minute |
| `limits.sessionsPerIpPerHour` | 5 | New chats from one visitor, per hour |
| `limits.messagesPerSession` | 60 | One conversation |
| `limits.maxMessageLength` | 1000 | Characters per message |
| `sessionTtlHours` | 24 | How long a chat can be continued |

You (and your coding agent) are exempt from the per-visitor limits when
testing with `murmur chat` or `murmur ask`, never from the daily caps.

## Speed

A reply usually starts streaming within 1–2 seconds with the default backend.
`murmur ask "<question>" --timing` shows where the time goes; see
[[Workers AI|Provider-Workers-AI#speed]].
