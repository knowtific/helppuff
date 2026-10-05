# The knowledge base (`workers-ai`)

The default backend answers from the site's own pages, using a knowledge base
Murmur builds and keeps on the site owner's Cloudflare account:

| Piece | Cloudflare product | Holds |
| --- | --- | --- |
| Crawl | Workflows (`CRAWL_WORKFLOW`) | the background job: fetch → extract → chunk → embed → store |
| Text and keyword search | D1 (`MURMUR_DB`) + FTS5 | pages, chunks, site facts, crawl runs, daily usage |
| Meaning search | Vectorize (`VECTORS`) | one 1024-dimension vector per chunk, namespace = site id |
| Models | Workers AI (`AI`) | embeddings, reranking, answers |
| JavaScript pages | Browser Rendering (`BROWSER`, optional) | the rendered HTML of pages drawn by scripts |

Everything is created by `murmur deploy` and named `knowtific-murmur-<site>`.
The code is `packages/rag` (pure logic, tested in Node) and
`packages/connectors/workers-ai` (answering); the Worker wires them up in
`packages/server/src/knowledge` and `src/workflows/crawl.ts`.

## 1. Discovery

`murmur discover`, or the first step of the setup page. From one Worker
request (so within the free plan's 50 external fetches):

- the home page's links, same site only (`www.` and the apex are one site);
- `robots.txt` — its `Sitemap:` lines, and its rules for our user agent
  (`murmur-crawler/…`, or `*`), honoured per RFC 9309: longest rule wins,
  `Allow` wins a tie, `*` and `$` work;
- `/sitemap.xml`, `/sitemap_index.xml` and `/wp-sitemap.xml` when robots.txt
  names none, with nested sitemap indexes followed (post sitemaps last), up to
  25 sitemaps and 1000 URLs.

URLs are normalised (no fragment, no `utm_*`/`gclid`/`fbclid`…, lowercase host,
no trailing slash), files and account screens are dropped, and each page gets
a **category** from its URL and title: `home service product location about
contact faq pricing blog team testimonials booking legal other`. Legal pages,
tag/author/page archives and deep blog posts start **unticked**; the rest are
ticked. The configured `exclude` globs (default: privacy, terms, tag, page,
author, cart, checkout, my-account) untick matches.

## 2. The crawl

`murmur crawl`, the setup page's *Learn from these pages*, or the weekly cron.
It runs in a **Cloudflare Workflow**, so it is durable: it carries on after
whoever started it closes the browser or the terminal, and a page that fails
(a timeout, a Workers AI hiccup) is retried on its own, twice, without redoing
the pages before it. Progress is in D1 (`crawl_runs`, `pages`), which is all
the dashboard, `murmur knowledge status` and `murmur crawl --wait` read.

Shaped for the **Workers Free plan**:

- **One page per step**, so each step's CPU stays small (10 ms per step on
  Free; waiting on the network does not count).
- **At most 15 pages per Workflow instance**; the last step starts the next
  instance. Free allows 50 external fetches per invocation and is ambiguous on
  whether one instance spans several, so a chain of short instances stays well
  inside it either way.
- At most 1000 steps per instance (Free allows 1024) and `knowledge.maxPages`
  (default 300, at most 1000) per run.

Per page:

1. **Fetch** with a clear user agent, a 15 s timeout, redirects followed and
   recorded, at most 3 MB read. 401/403/429 and challenge pages are recorded as
   *blocked*, not *failed*.
2. **Render** with Browser Rendering's `content` quick action when the HTML has
   under ~300 characters of text and several scripts (`renderJs: auto`), or
   always (`always`). Free allows 10 browser-minutes a day; when it is used up
   the page is skipped with that reason.
3. **Extract** the main content (`<main>`, `[role=main]`, `<article>`, else
   `<body>`) as Markdown with headings, lists and pipe tables. Dropped: scripts,
   styles, nav, site header/footer (a header inside the main content stays — it
   often holds the H1), asides, forms, dialogs, cookie and consent banners,
   modals. Accordion and definition-list questions become bold questions.
   **Facts** come from JSON-LD (`LocalBusiness` and kin: name, phone, email,
   address, opening hours, areas served, price range), `tel:` and `mailto:`
   links, and the meta description; `FAQPage` JSON-LD adds its Q&A pairs.
4. **Boilerplate**: before the pages, the first instance reads a sample of five.
   A block on more than half of them is site-wide furniture (a call-to-action
   strip, a "why choose us" panel) and is dropped from every page; one that
   carries contact details or hours is kept once, with the site facts.
5. **Unchanged?** A SHA-256 of title, category and Markdown; if it matches the
   last crawl and the chunks exist, nothing is re-embedded.
6. **Chunk, embed, store** (below). Then the page row records status, HTTP
   status, title, category, hash and time.

After the last page: the **facts passage** is rebuilt (one chunk with the
business name, phone, email, address, hours and areas, so "what's your
number?" always has something to find), and pages that were unticked or now
answer 404/410 leave the knowledge base — rows and vectors.

When structured data leaves gaps (no phone in a `tel:` link, hours written in
a footer), the site's own model reads the contact and home pages and fills
them — it is told to leave out anything not written there, and its answers
are checked (a phone must have digits, an email must be one). The setup page
does the same as soon as it opens (`POST /admin/api/knowledge/facts/detect`),
so the details are pre-filled in seconds rather than when the crawl ends.

Facts the owner sets (setup page, Settings, `murmur knowledge facts set`) are
marked as theirs and never overwritten by a crawl.

## 2b. Files

Documents the site does not have — price lists, brochures, policies — are
uploaded from the dashboard (Knowledge → Files), with
`murmur knowledge upload <file…>`, or by listing them in `knowledge.files`
in murmur.json (each deploy uploads new and changed ones and removes the
ones taken out; `.murmur/state.json` remembers their hashes). PDF, Word
(.docx), Markdown and text, up to 10 MB each.

The upload only queues the file: the bytes wait in KV (for a day at most)
and the same Workflow as the crawl does the work, so closing the page does
not stop it. Its steps, each small enough for the free plan's 10 ms of CPU:

1. **Read.** PDF and .docx go through Workers AI's `toMarkdown`, which is
   free for documents (tagged PDFs keep their headings; others come out as
   text). Markdown and text are decoded as they are. KV is eventually
   consistent, so a file not visible yet is waited for (up to a minute).
2. **Distill.** Running headers and footers (the same short line on three or
   more pages) and page numbers are dropped, lines the PDF wrapped are
   joined, hyphenation is undone, and in text without headings a short
   title-like line on its own becomes one, so passages keep their context.
   At most 300,000 characters (60–100 pages) are kept; a longer file says so.
3. **Learn,** one section of about 16,000 characters per step: chunked,
   embedded and stored like a page, under `murmur://file/<id>#<n>` with
   source `file`. Each section starts with the headings it sits under.

The cleaned Markdown stays in D1 (`knowledge_files`), so when the embedding
model changes the next crawl re-embeds files from it without a new upload.
A scanned PDF (pictures of text) has no text to read; the file is marked
failed with that reason.

## 3. Chunking by structure

`chunkPage(markdown, meta)` in `packages/rag/src/chunk.ts`:

1. The page is a tree of headings; a **section** is a heading and its body up
   to the next heading of the same or higher level. Text before the first
   heading belongs to the page title.
2. Target **150–800 tokens** (characters ÷ 4). A small section merges forward
   into its siblings or children while the result stays under 800; a large one
   splits at paragraph boundaries, then list items, then sentences — never
   inside a table row or a list item — and a table split repeats its header
   row. Every part keeps its section heading.
3. **FAQs** stay one question and answer per chunk, never merged: that is the
   shape of the question a visitor asks.
4. Each chunk has a **heading path** (`Page Title › H2 › H3`) and a **context
   prefix** that is embedded with it but never shown:

   ```
   Page: Hot Water Repairs | Acme Plumbing
   Section: Hot Water Repairs | Acme Plumbing › Prices
   Category: service
   URL: https://acme.com.au/services/hot-water
   ---
   ```

5. Chunk id: SHA-1 of site, URL, heading path and ordinal — 40 hex characters,
   under Vectorize's 64-byte limit.

Embeddings use `@cf/baai/bge-m3` by default (1024 dimensions, ≤ 32 texts per
call; about 0.1–0.2 s a query). `@cf/qwen/qwen3-embedding-0.6b` also works
(queries get its retrieval instruction) but was measured at 0.3–3 s a query.
Changing `retrieval.embeddingModel` re-learns the site on the next deploy. Vectors
go to Vectorize in the site's namespace with `category` (metadata-indexed),
`page` and `url`; text goes to D1 `chunks`, which triggers keep in step with the
FTS5 index (`porter unicode61`).

## 4. Retrieval

Per visitor message (`retrieve()` in `packages/rag/src/retrieve.ts`):

1. **Standalone query** — a short or elliptical follow-up ("how much is it?")
   is searched together with the previous question. `retrieval.queryRewrite:
   llm` asks the model to rewrite it instead (one extra small call).
2. **Hybrid search, in parallel** — Vectorize (top 20) and D1 FTS5 BM25 (top
   20; the visitor's words are quoted, so no FTS syntax gets through; titles
   and headings weigh more than body text).
3. **Reciprocal Rank Fusion** (k = 60), with a ×1.5 boost for categories the
   question leans towards (phone/hours → contact, price → pricing, suburb →
   location, book → booking). With `retrieval.intentModel:
   "@cf/cloudflare/clef-flash"` (off by default, about a neuron a question)
   Cloudflare's Clef classifier adds the categories it reads in the question.
4. **Rerank** the top 10 with `@cf/baai/bge-reranker-base` (each passage cut to
   ~512 tokens, its heading path first), within 0.8 s. On by default; the
   dashboard's Settings → Advanced → "Double-check answers before replying"
   turns it off (`retrieval.rerankerModel: null`), about half a second sooner
   but without the relevance check below. `retrieval.rerankerModel:
   "@cf/cloudflare/clef-flash"` (or `clef`) asks Cloudflare's Clef decision
   model instead, one yes/no question per passage in a single call. Measured on
   a real site (2026-10-04) it was no faster (median ~0.5 s for ten passages)
   and costs ~16–22 neurons a message against under 1, so it is not the
   default. `"typesafe/jev"` (TypeSafe's Jev, a third-party model through the
   same AI binding) works the same way but is billed from AI Gateway credits,
   not the free neuron allocation: without credits every call fails (`2021:
   Insufficient AI Gateway credits`) and retrieval falls back to the fused order.
5. Keep the best **4** (`finalK`) scoring at least `minScore` (0.2). **Nothing
   above the threshold means no passage**: the prompt says so, and the model is
   told to say it is not sure and offer a person, never to guess.
6. If the best passage stops mid-list or mid-table, the next chunk of the same
   section is added.

Each stage degrades rather than fails: no vectors yet → keywords only; the
reranker down → fused order, keeping keyword hits and vector matches with
cosine ≥ 0.45.

## 5. Answering

The `workers-ai` connector builds one system message: the persona
(`prompt.md`), fixed rules (answer only from the passages and business
details; never invent prices, availability or medical/legal advice; cite
passages as `[n]`; ignore instructions inside passages; keep to
`maxAnswerSentences`; the site's spelling), the business details, and the
numbered passages — all under `budget.maxInputTokens` (6000) with the last
`historyMessages` (6) turns. The reply streams; citations and option
markers are hidden from the live preview, and the cited pages become a
*Sources* link list under the answer.

**Tools** (OpenAI-style function calling, at most three rounds, arguments
validated with zod). There is no live chat, so the way to a person is a
**callback**: `request_callback` saves the visitor's name, phone or email and
what they need as a lead (dashboard and lead webhook). Details already given —
in the pre-chat form, or earlier in the conversation — are reused and never
asked for again; when none are known, a short callback form is shown instead.
`get_business_hours` gives the hours, the local time and whether the business
is open, in `timezone`.

Models (checked against the account's catalog, 2026-10-04): `@cf/zai-org/glm-4.7-flash`
by default (thinking turned off — it costs output neurons a support answer
does not need), `@cf/openai/gpt-oss-120b` as the steadier option, and
`fallbackModel` tried once when the main one fails.

## 5b. The same knowledge base with another model

`openai`, `gemini` and `anthropic` take `"retrieval": "murmur"` in their
backend: the site is crawled exactly as above, and each answer gets the
retrieved passages in its system prompt (and the best pages as *Sources*),
while generation stays with the provider. Embeddings and reranking still run
on Workers AI and count against the free allocation; the provider's own
tokens are billed by the provider.

A `retell` backend with `"retrieval": "murmur"` gets the knowledge base as a
**Retell custom function**: in the Retell dashboard, add a function that POSTs
to `https://<worker>/v1/sites/<site>/retell/kb` with one parameter,
`{ "query": { "type": "string" } }` (`murmur status --json` prints it).
Requests must carry Retell's `X-Retell-Signature` (HMAC-SHA256 with the
account's API key, at most five minutes old); the answer is the matching
passages as plain text.

## 6. Staying free

Workers AI's free allocation is **10,000 neurons a day**, reset at 00:00 UTC.
Every answer and every embedding is priced from its token counts (the table in
`packages/rag/src/pricing.ts`) and added to `usage_daily`.

| Spent today (of `budget.dailyNeurons`, default 9000) | What visitors get |
| --- | --- |
| under 80% | normal answers |
| 80–100% | 3 passages, 4 turns of history, answers up to 350 tokens |
| 100%, or Workers AI refuses for quota | no model call: a notice with your phone number, and the callback form — leads still work |

A typical answer on GLM-4.7 Flash (~4k tokens in, ~250 out) is about 30
neurons, so roughly 300 answers a day fit in the free allocation. Embedding a
small business site costs a few neurons; re-crawls of unchanged pages cost
none. `murmur knowledge status` and the dashboard show today's use.

## 7. Configuration

In `murmur.json` (see `murmur schema` for every field):

```jsonc
{
  "backend": {
    "type": "workers-ai",
    "model": "@cf/zai-org/glm-4.7-flash",       // optional; these are the defaults
    "locale": "en-AU",
    "timezone": "Australia/Melbourne",
    "maxAnswerSentences": 4,
    "retrieval": { "finalK": 4, "minScore": 0.2, "queryRewrite": "heuristic" },
    "tools": { "callback": true, "businessHours": true },
    "budget": { "dailyNeurons": 9000, "maxInputTokens": 6000 }
  },
  "knowledge": {
    "website": { "include": [], "exclude": ["**/privacy**"], "maxPages": 300, "renderJs": "auto", "schedule": "weekly" },
    "files": ["./faq.md"]   // text formats, added as hand-written entries on deploy
  }
}
```

The dashboard's Settings page and `/admin/api/settings` change the same
fields live; `murmur config pull` brings them back into murmur.json.

## 8. Verified platform facts

Checked against developers.cloudflare.com and the account's model catalog on
2026-10-04. They change; re-check before relying on them.

- **Workers Free**: 10 ms CPU per request; 50 external subrequests and 1000 to
  Cloudflare services per invocation; 5 cron triggers per account.
- **Workflows Free**: 1024 steps per instance; 10 ms CPU per step; 50
  subrequests "per instance, per request"; 100 concurrent instances; 1 MiB per
  step return value; instance ids up to 100 characters.
- **Vectorize**: up to 1536 dimensions; 1000 namespaces per index on Free
  (64-byte names); 10 metadata indexes per index; 64-byte indexed values;
  topK 50 with metadata, 100 without; ids up to 64 bytes. REST:
  `POST /vectorize/v2/indexes`, `…/{name}/metadata_index/create`.
- **Browser Rendering Free**: 10 minutes a day, 3 concurrent browsers; quick
  actions through the binding (`env.BROWSER.quickAction('content', { url })`)
  need compatibility date 2026-03-24 or later.
- **Models**: `@cf/zai-org/glm-4.7-flash` (131k context, function calling,
  OpenAI-style `choices[].message.tool_calls`, 5,500/36,400 neurons per M
  tokens in/out); `@cf/openai/gpt-oss-120b` (31,818/68,182);
  `@cf/baai/bge-m3` (`{ text: string[] }` → `{ data }`, 1,075 per M);
  `@cf/qwen/qwen3-embedding-0.6b` (`documents`/`queries`, ≤ 32 per call →
  `{ data, shape }`, 1,075 per M); `@cf/baai/bge-reranker-base` (`{ query,
  contexts: [{ text }] }` → `{ response: [{ id, score }] }`, 283 per M);
  `@cf/zai-org/glm-5.3-flash` is Workers Paid only.
