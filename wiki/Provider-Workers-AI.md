# Provider: Workers AI (default)

`"backend": { "type": "workers-ai" }`

Answers with Cloudflare Workers AI, from **Murmur's own knowledge base**: your
website and files, learned into Vectorize and D1 on your account by a
background Workflow. Everything runs on your Cloudflare account and fits the
**Workers Free plan**. No other account or key is needed.

## Set up

```bash
npx @knowtific/murmur          # the default
```

That is all. The setup page (or, for agents, `init --json`) starts learning
your site. See [[Knowledge base|Knowledge-Base]] for how it crawls, reads files
and finds answers.

## How an answer is made

1. The question is embedded (`@cf/baai/bge-m3`) and searched two ways at once:
   by meaning in Vectorize and by keywords in D1's full-text index.
2. The two result lists are merged, and the reranker
   (`@cf/baai/bge-reranker-base`) re-reads the best ten and keeps those that
   actually answer the question.
3. The model (GLM-4.7 Flash by default) writes a short answer from those
   passages and the business details, with links to the pages it used.
4. Nothing relevant? It says it is not sure and offers a callback, instead of guessing.

## Options

The common ones; every option is in the
[[Configuration reference|Configuration-Reference#type-workers-ai]].

| Option | Default | |
| --- | --- | --- |
| `model` | `@cf/zai-org/glm-4.7-flash` | `@cf/openai/gpt-oss-120b` is steadier and costs about 4× as much. `@cf/zai-org/glm-5.3-flash` needs Workers Paid |
| `fallbackModel` | — | Tried once if the main model fails |
| `timezone`, `locale` | — | e.g. `Australia/Melbourne`, `en-AU`: "are you open now?", spelling |
| `maxAnswerSentences` | `4` | Shorter is cheaper and reads better in a chat |
| `historyMessages` | `6` | Earlier messages sent with each question |
| `retrieval.rerankerModel` | `@cf/baai/bge-reranker-base` | `null` turns re-scoring off (Settings → Advanced → "Double-check answers") |
| `retrieval.minScore` | `0.2` | Passages scored lower are dropped |
| `retrieval.embeddingModel` | `@cf/baai/bge-m3` | Changing it re-learns the site on the next deploy |
| `tools.callback` | `true` | "Talk to a person" means a callback: it asks only for the contact details it does not already have |
| `tools.businessHours` | `true` | Opening hours and "open now" |
| `budget.dailyNeurons` | `9000` | Past this many neurons in a UTC day, visitors get your contact details and a callback form |
| `gateway` | — | An AI Gateway id, for caching and logs in front of every model call |

Change any of them with `murmur config set backend.<option> <value>` and
deploy, or in the dashboard (model, reranker, time zone, language).

## Speed

A reply usually starts streaming within 1–2 seconds. Where the time goes, for
a typical message measured from a Worker: limits and context ~20 ms, keyword
search ~20 ms, embedding 50–400 ms, vector search ~190 ms, reranking
300–800 ms (capped at 0.8 s), the model's first words 350–550 ms. See where
yours goes with:

```bash
murmur ask "How much is a service call?" --timing
```

## Cost

Measured in Workers AI **neurons**: 10,000 a day are free. A typical answer
uses a few dozen, so the free allowance covers a few hundred answers a day;
the dashboard's Knowledge page shows today's use. Crawling costs neurons only
for pages that changed. See [[Costs and limits|Costs-and-Limits]].
