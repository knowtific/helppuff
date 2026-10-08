# Custom knowledge base

Answer from your own knowledge: a search API, a vector database, a
product catalogue, a document store. You write one function, `search`, that
returns the passages for a question; HelpPuff numbers them, gives them to the
model as quoted context, cites the ones it uses, and says "not sure" when
none answer. What you search, and how, is up to you.

The other options need no code: HelpPuff's own knowledge base (the default),
Cloudflare AI Search, an OpenAI vector store, your own search over HTTP, or
none. See [[Providers]].

## Over HTTP (no code)

```bash
helppuff rag set http --url https://search.example.com/query --token-env SEARCH_TOKEN
```

HelpPuff sends `POST url` with `{ "query", "question", "siteId", "limit" }`
(and `Authorization: Bearer <token>`), and expects:

```json
{ "passages": [{ "title": "Prices", "content": "Our callout fee is $99…", "url": "https://acme.com/prices", "score": 0.9 }] }
```

## In TypeScript

```bash
helppuff scaffold rag --use       # writes ./rag.ts and points helppuff.json at it
```

```json
"knowledge": { "retrieval": { "type": "custom", "module": "./rag.ts", "secrets": ["MY_SEARCH_KEY"] } }
```

```ts
import type { Retriever } from '@knowtific/helppuff/sdk';

export default {
  id: 'my-knowledge',
  async search(request, ctx) {
    const response = await ctx.fetch('https://search.example.com/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(ctx.env['MY_SEARCH_KEY'])}` },
      body: JSON.stringify({ query: request.query, limit: request.limit }),
    });
    if (!response.ok) throw new Error(`search ${response.status}`);
    const { results } = await response.json();
    return results.map((r) => ({ title: r.title, content: r.text, url: r.url, score: r.score }));
  },
} satisfies Retriever;
```

**What you get (`request`)**: `query` (the question, made to stand alone
when it was a follow-up), `question` (the visitor's own words), `limit` (how
many passages the answer can use).

**What you return**, best first, each:

| Field | What |
| --- | --- |
| `title` | Shown to the model, and as the source link's text |
| `content` | The text (up to 4,000 characters are used) |
| `url` | Optional: linked as a source when the answer cites it (http/https only) |
| `heading` | Optional: where in the page, e.g. "Pricing › Hot water" |
| `score` | Optional: higher is better |

The passages are quoted to the model as content, not instructions: text in
them cannot change the assistant's rules. A search that throws, or times
out, is logged and the assistant answers without passages (it says it is not
sure and offers a callback), so a slow search never fails the chat.

**What you can use (`ctx`)**: `ctx.fetch`, `ctx.env` (your secrets and the
Worker's bindings), `ctx.log`, `ctx.siteId`.

## Secrets, deploy, test

```bash
helppuff secret set MY_SEARCH_KEY
helppuff deploy
helppuff rag test "price of a blocked drain"   # the passages the deployed Worker finds
```

The file is bundled into the Worker at deploy, like a
[[custom model|Custom-Model]]. HelpPuff's crawl keeps reading your website
for the dashboard (business details, suggestions, jobs) whatever the
knowledge base; to have your search include it, index the site in your own
store.
