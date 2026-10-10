<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Knowledge API

What the assistant knows: the website it learned, uploaded files, hand-written knowledge and business details. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[Knowledge base status|API-Reference-Knowledge#knowledge-base-status]]: `GET /knowledge/status`
- [[Find the website pages|API-Reference-Knowledge#find-the-website-pages]]: `POST /knowledge/discover`
- [[Learn the website|API-Reference-Knowledge#learn-the-website]]: `POST /knowledge/crawl`
- [[Try failed pages again|API-Reference-Knowledge#try-failed-pages-again]]: `POST /knowledge/crawl/retry`
- [[Cancel a crawl|API-Reference-Knowledge#cancel-a-crawl]]: `POST /knowledge/runs/:id/cancel`
- [[List learned pages|API-Reference-Knowledge#list-learned-pages]]: `GET /knowledge/pages`
- [[Chunks of a page|API-Reference-Knowledge#chunks-of-a-page]]: `GET /knowledge/pages/:id/chunks`
- [[Search the knowledge base|API-Reference-Knowledge#search-the-knowledge-base]]: `POST /knowledge/search`
- [[Suggest starter questions|API-Reference-Knowledge#suggest-starter-questions]]: `POST /knowledge/suggest-questions`
- [[List hand-written knowledge|API-Reference-Knowledge#list-hand-written-knowledge]]: `GET /knowledge/manual`
- [[Add or replace hand-written knowledge|API-Reference-Knowledge#add-or-replace-hand-written-knowledge]]: `POST /knowledge/manual`
- [[Remove hand-written knowledge|API-Reference-Knowledge#remove-hand-written-knowledge]]: `DELETE /knowledge/manual/:id`
- [[List uploaded files|API-Reference-Knowledge#list-uploaded-files]]: `GET /knowledge/files`
- [[Upload a file|API-Reference-Knowledge#upload-a-file]]: `POST /knowledge/files`
- [[Remove an uploaded file|API-Reference-Knowledge#remove-an-uploaded-file]]: `DELETE /knowledge/files/:id`
- [[Business details|API-Reference-Knowledge#business-details]]: `GET /knowledge/facts`
- [[Set business details|API-Reference-Knowledge#set-business-details]]: `PUT /knowledge/facts`
- [[Read business details from the site|API-Reference-Knowledge#read-business-details-from-the-site]]: `POST /knowledge/facts/detect`

## Knowledge base status

`GET /knowledge/status` · scope `knowledge:read`

The latest crawl, page counts, chunks and today's AI usage.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/knowledge/status" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/status`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as KnowledgeBaseStatusResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "connector": "workers-ai",
  "browserRendering": false,
  "workflow": true,
  "schedule": "weekly",
  "run": {
    "id": "run_1",
    "status": "done",
    "trigger": "dashboard",
    "total": 42,
    "done": 42,
    "failed": 0,
    "chunks": 310,
    "error": null,
    "startedAt": 1760000000000,
    "finishedAt": 1760000090000
  },
  "pages": {
    "indexed": 40,
    "unchanged": 2
  },
  "chunks": 310,
  "lastIndexedAt": 1760000090000,
  "usage": {
    "day": "2025-10-09",
    "neurons": 1240.5,
    "messages": 64,
    "budget": 9000,
    "freeAllocation": 10000,
    "messagesLeft": 400,
    "state": "ok"
  }
}
```
```ts [Type]
type KnowledgeBaseStatusResponse = {
  site: string;
  connector: string;
  browserRendering: boolean;
  workflow: boolean;
  schedule: string;
  run: {
    id: string;
    status: string;
    trigger: string;
    total: number;
    done: number;
    failed: number;
    chunks: number;
    error: string | null;
    startedAt: number;
    finishedAt: number;
  };
  pages: Record<string, number>;
  chunks: number;
  lastIndexedAt: number;
  usage: {
    day: string;
    neurons: number;
    messages: number;
    budget: number;
    freeAllocation: number;
    messagesLeft: number;
    state: string;
  };
};
```
<!-- /tabs -->

## Find the website pages

`POST /knowledge/discover` · scope `knowledge:write`

Reads robots.txt and the sitemaps, and suggests which pages to learn.

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/knowledge/discover" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```
```ts [TypeScript]
type FindWebsitePagesRequest = Record<string, never>;

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/discover`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({} satisfies FindWebsitePagesRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as FindWebsitePagesResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "origin": "https://acme.example",
  "reachable": true,
  "sitemaps": [
    "https://acme.example/sitemap.xml"
  ],
  "warnings": [],
  "urls": [
    {
      "url": "https://acme.example/pricing",
      "category": "pricing",
      "suggested": true,
      "status": "indexed",
      "title": "Pricing",
      "error": null,
      "selected": true
    }
  ]
}
```
```ts [Type]
type FindWebsitePagesResponse = {
  site: string;
  origin: string;
  reachable: boolean;
  sitemaps: string[];
  warnings: string[];
  urls: Array<{
    url: string;
    category: string;
    suggested: boolean;
    status: string;
    title: string;
    error: string | null;
    selected: boolean;
  }>;
};
```
<!-- /tabs -->

## Learn the website

`POST /knowledge/crawl` · scope `knowledge:write`

Crawls the given pages (or the selected ones) in the background. Follow progress with `GET /knowledge/status`.

| Body field | Required | Description |
| --- | --- | --- |
| `urls` | no | The pages to learn. Without it, the selected pages. |
| `include` | no | Glob patterns of pages to add, e.g. `["/services/**"]`. |
| `exclude` | no | Glob patterns of pages to leave out. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/knowledge/crawl" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "urls": [
    "https://acme.example/pricing",
    "https://acme.example/services"
  ]
}'
```
```ts [TypeScript]
type LearnWebsiteRequest = {
  /** The pages to learn. Without it, the selected pages. */
  urls?: string[];
  /** Glob patterns of pages to add, e.g. `["/services/**"]`. */
  include?: string;
  /** Glob patterns of pages to leave out. */
  exclude?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/crawl`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    urls: [
      'https://acme.example/pricing',
      'https://acme.example/services'
    ]
  } satisfies LearnWebsiteRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as LearnWebsiteResponse;
```
<!-- /tabs -->

**Response** `202`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "runId": "run_2",
  "total": 2
}
```
```ts [Type]
type LearnWebsiteResponse = {
  site: string;
  runId: string;
  total: number;
};
```
<!-- /tabs -->

## Try failed pages again

`POST /knowledge/crawl/retry` · scope `knowledge:write`

Crawls the pages that failed (or the given ones among them) again, in the background, without changing which pages are selected. Pages that failed for a passing reason are also retried by themselves after a crawl. `409` while a crawl is running.

| Body field | Required | Description |
| --- | --- | --- |
| `urls` | no | Only these failed pages. Without it, every failed page. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/knowledge/crawl/retry" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "urls": [
    "https://acme.example/industries"
  ]
}'
```
```ts [TypeScript]
type TryFailedPagesAgainRequest = {
  /** Only these failed pages. Without it, every failed page. */
  urls?: string[];
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/crawl/retry`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    urls: [
      'https://acme.example/industries'
    ]
  } satisfies TryFailedPagesAgainRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as TryFailedPagesAgainResponse;
```
<!-- /tabs -->

**Response** `202`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "runId": "run_3",
  "total": 1
}
```
```ts [Type]
type TryFailedPagesAgainResponse = {
  site: string;
  runId: string;
  total: number;
};
```
<!-- /tabs -->

## Cancel a crawl

`POST /knowledge/runs/:id/cancel` · scope `knowledge:write`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/knowledge/runs/ID/cancel" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/runs/${id}/cancel`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as CancelCrawlResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "cancelled": true
}
```
```ts [Type]
type CancelCrawlResponse = {
  cancelled: boolean;
};
```
<!-- /tabs -->

## List learned pages

`GET /knowledge/pages` · scope `knowledge:read`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `status` | query | no | `discovered`, `indexed`, `unchanged`, `failed`… |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/knowledge/pages" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/pages`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListLearnedPagesResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "pages": [
    {
      "id": "pg_1",
      "url": "https://acme.example/pricing",
      "finalUrl": "https://acme.example/pricing",
      "title": "Pricing",
      "category": "pricing",
      "status": "indexed",
      "httpStatus": 200,
      "error": null,
      "selected": 1,
      "source": "crawl",
      "crawledAt": 1760000000000,
      "chunks": 6
    }
  ]
}
```
```ts [Type]
type ListLearnedPagesResponse = {
  site: string;
  pages: Array<{
    id: string;
    url: string;
    finalUrl: string;
    title: string;
    category: string;
    status: string;
    httpStatus: number;
    error: string | null;
    selected: number;
    source: string;
    crawledAt: number;
    chunks: number;
  }>;
};
```
<!-- /tabs -->

## Chunks of a page

`GET /knowledge/pages/:id/chunks` · scope `knowledge:read`

The passages the assistant searches, as stored.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/knowledge/pages/ID/chunks" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/pages/${id}/chunks`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ChunksPageResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "chunks": [
    {
      "id": "ch_1",
      "headingPath": "Pricing › Drains",
      "ordinal": 0,
      "content": "Blocked drains: $180–$250 including the first hour.",
      "tokens": 14
    }
  ]
}
```
```ts [Type]
type ChunksPageResponse = {
  chunks: Array<{
    id: string;
    headingPath: string;
    ordinal: number;
    content: string;
    tokens: number;
  }>;
};
```
<!-- /tabs -->

## Search the knowledge base

`POST /knowledge/search` · scope `knowledge:read`

What the assistant would find for a question (hybrid search, then the reranker). A few neurons.

| Body field | Required | Description |
| --- | --- | --- |
| `query` | yes | The question (up to 1000 characters). |
| `k` | no | How many passages to return. |
| `rerank` | no | `false` to skip the reranker. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/knowledge/search" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "query": "blocked drain price",
  "k": 3
}'
```
```ts [TypeScript]
type SearchKnowledgeBaseRequest = {
  /** The question (up to 1000 characters). */
  query: string;
  /** How many passages to return. */
  k?: number;
  /** `false` to skip the reranker. */
  rerank?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/search`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: 'blocked drain price',
    k: 3
  } satisfies SearchKnowledgeBaseRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SearchKnowledgeBaseResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "query": "blocked drain price",
  "neurons": 2.1,
  "chunks": [
    {
      "id": "ch_1",
      "pageId": "pg_1",
      "url": "https://acme.example/pricing",
      "title": "Pricing",
      "headingPath": "Pricing › Drains",
      "category": "pricing",
      "content": "Blocked drains: $180–$250…",
      "ordinal": 0,
      "score": 0.91
    }
  ],
  "trace": {
    "vector": 8,
    "keyword": 5,
    "fused": 10,
    "reranked": true,
    "threshold": 0.2,
    "errors": [],
    "ms": {
      "embed": 40,
      "vector": 30,
      "keyword": 6,
      "rerank": 120
    }
  }
}
```
```ts [Type]
type SearchKnowledgeBaseResponse = {
  site: string;
  query: string;
  neurons: number;
  chunks: Array<{
    id: string;
    pageId: string;
    url: string;
    title: string;
    headingPath: string;
    category: string;
    content: string;
    ordinal: number;
    score: number;
  }>;
  trace: {
    vector: number;
    keyword: number;
    fused: number;
    reranked: boolean;
    threshold: number;
    errors: string[];
    ms: Record<string, number>;
  };
};
```
<!-- /tabs -->

## Suggest starter questions

`POST /knowledge/suggest-questions` · scope `knowledge:read`

Four questions a customer might ask, written from what the site taught the assistant.

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/knowledge/suggest-questions" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```
```ts [TypeScript]
type SuggestStarterQuestionsRequest = Record<string, never>;

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/suggest-questions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({} satisfies SuggestStarterQuestionsRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SuggestStarterQuestionsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "questions": [
    "How much is a blocked drain?",
    "Do you do emergency callouts?",
    "Which suburbs do you cover?",
    "Can I book online?"
  ],
  "source": "model"
}
```
```ts [Type]
type SuggestStarterQuestionsResponse = {
  questions: string[];
  source: string;
};
```
<!-- /tabs -->

## List hand-written knowledge

`GET /knowledge/manual` · scope `knowledge:read`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/knowledge/manual" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/manual`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListHandWrittenKnowledgeResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "entries": [
    {
      "id": "holiday-hours",
      "title": "Holiday hours",
      "content": "Closed 25–26 December.",
      "updatedAt": 1760000000000
    }
  ]
}
```
```ts [Type]
type ListHandWrittenKnowledgeResponse = {
  entries: Array<{
    id: string;
    title: string;
    content: string;
    updatedAt: number;
  }>;
};
```
<!-- /tabs -->

## Add or replace hand-written knowledge

`POST /knowledge/manual` · scope `knowledge:write`

Searchable at once. The same `id` replaces an entry.

| Body field | Required | Description |
| --- | --- | --- |
| `title` | yes | Up to 200 characters. |
| `content` | yes | Markdown or plain text, up to 100,000 characters. |
| `id` | no | Lowercase letters, digits and `-`. The same id replaces an entry. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/knowledge/manual" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "id": "holiday-hours",
  "title": "Holiday hours",
  "content": "We are closed on 25 and 26 December."
}'
```
```ts [TypeScript]
type AddReplaceHandWrittenKnowledgeRequest = {
  /** Up to 200 characters. */
  title: string;
  /** Markdown or plain text, up to 100,000 characters. */
  content: string;
  /** Lowercase letters, digits and `-`. The same id replaces an entry. */
  id?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/manual`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    id: 'holiday-hours',
    title: 'Holiday hours',
    content: 'We are closed on 25 and 26 December.'
  } satisfies AddReplaceHandWrittenKnowledgeRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AddReplaceHandWrittenKnowledgeResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "holiday-hours",
  "chunks": 1
}
```
```ts [Type]
type AddReplaceHandWrittenKnowledgeResponse = {
  id: string;
  chunks: number;
};
```
<!-- /tabs -->

## Remove hand-written knowledge

`DELETE /knowledge/manual/:id` · scope `knowledge:write`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/knowledge/manual/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/manual/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RemoveHandWrittenKnowledgeResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "deleted": true
}
```
```ts [Type]
type RemoveHandWrittenKnowledgeResponse = {
  deleted: boolean;
};
```
<!-- /tabs -->

## List uploaded files

`GET /knowledge/files` · scope `knowledge:read`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/knowledge/files" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/files`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListUploadedFilesResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "files": [
    {
      "id": "0b8f…",
      "name": "price-list.pdf",
      "kind": "pdf",
      "size": 182044,
      "status": "indexed",
      "error": null,
      "chunks": 12,
      "truncated": 0,
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000
    }
  ]
}
```
```ts [Type]
type ListUploadedFilesResponse = {
  files: Array<{
    id: string;
    name: string;
    kind: string;
    size: number;
    status: string;
    error: string | null;
    chunks: number;
    truncated: number;
    createdAt: number;
    updatedAt: number;
  }>;
};
```
<!-- /tabs -->

## Upload a file

`POST /knowledge/files` · scope `knowledge:write`

The raw bytes as the body, the file name as `?name=`. PDF, Word (.docx), Markdown or text, up to 10 MB. Read and learned in the background.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `name` | query | yes | The file name, with its extension. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/knowledge/files?name=price-list.pdf" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @price-list.pdf
```
```ts [TypeScript]
import { readFile } from 'node:fs/promises';

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/files?${new URLSearchParams({ name: 'price-list.pdf' })}`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/octet-stream',
  },
  body: await readFile('price-list.pdf'),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as UploadFileResponse;
```
<!-- /tabs -->

The body is the file's bytes.

**Response** `202`

<!-- tabs -->
```json [Example]
{
  "id": "0b8f…",
  "name": "price-list.pdf",
  "kind": "pdf",
  "size": 182044,
  "status": "queued"
}
```
```ts [Type]
type UploadFileResponse = {
  id: string;
  name: string;
  kind: string;
  size: number;
  status: string;
};
```
<!-- /tabs -->

## Remove an uploaded file

`DELETE /knowledge/files/:id` · scope `knowledge:write`

And everything learned from it.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/knowledge/files/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/files/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RemoveUploadedFileResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "deleted": true,
  "chunks": 12
}
```
```ts [Type]
type RemoveUploadedFileResponse = {
  deleted: boolean;
  chunks: number;
};
```
<!-- /tabs -->

## Business details

`GET /knowledge/facts` · scope `knowledge:read`

Phone, email, address, hours, service areas: read from the site (`crawl`) or set by you (`owner`).

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/knowledge/facts" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/facts`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as BusinessDetailsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "facts": [
    {
      "key": "phone",
      "value": "1300 000 000",
      "source": "owner",
      "sourceUrl": "owner"
    }
  ]
}
```
```ts [Type]
type BusinessDetailsResponse = {
  facts: Array<{
    key: string;
    value: string;
    source: string;
    sourceUrl: string;
  }>;
};
```
<!-- /tabs -->

## Set business details

`PUT /knowledge/facts` · scope `knowledge:write`

Yours are never overwritten by a crawl. An empty value removes one. Re-indexed at once.

| Body field | Required | Description |
| --- | --- | --- |
| `facts` | yes | Keys `name`, `phone`, `email`, `address`, `hours`, `serviceAreas` and others; an empty value removes one. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PUT "$HELPPUFF_URL/api/v1/knowledge/facts" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "facts": {
    "phone": "1300 000 000",
    "hours": "Mon–Fri 8am–5pm"
  }
}'
```
```ts [TypeScript]
type SetBusinessDetailsRequest = {
  /**
   * Keys `name`, `phone`, `email`, `address`, `hours`, `serviceAreas` and
   * others; an empty value removes one.
   */
  facts: Record<string, string>;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/facts`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    facts: {
      phone: '1300 000 000',
      hours: 'Mon–Fri 8am–5pm'
    }
  } satisfies SetBusinessDetailsRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SetBusinessDetailsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "facts": [
    {
      "key": "phone",
      "value": "1300 000 000"
    },
    {
      "key": "hours",
      "value": "Mon–Fri 8am–5pm"
    }
  ]
}
```
```ts [Type]
type SetBusinessDetailsResponse = {
  facts: Array<{
    key: string;
    value: string;
  }>;
};
```
<!-- /tabs -->

## Read business details from the site

`POST /knowledge/facts/detect` · scope `knowledge:write`

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/knowledge/facts/detect" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```
```ts [TypeScript]
type ReadBusinessDetailsFromSiteRequest = Record<string, never>;

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/knowledge/facts/detect`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({} satisfies ReadBusinessDetailsFromSiteRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ReadBusinessDetailsFromSiteResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "found": 4,
  "facts": [
    {
      "key": "phone",
      "value": "1300 000 000",
      "source": "site"
    }
  ]
}
```
```ts [Type]
type ReadBusinessDetailsFromSiteResponse = {
  found: number;
  facts: Array<{
    key: string;
    value: string;
    source: string;
  }>;
};
```
<!-- /tabs -->
