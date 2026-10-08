import {
  ConnectorError,
  aiSearchClient,
  extensions,
  fetchWithTimeout,
  type ConnectorContext,
  type ExtensionContext,
  type Passage,
  type RetrievalRequest,
  type Retriever,
} from '@helppuff/connector-types';
import type { RetrievedChunk } from '@helppuff/rag';
import { extensionContext } from './models.js';
import type { Knowledge, WorkersAiOptions } from './options.js';

/**
 * Where the passages come from. `helppuff` is the site's own knowledge base
 * (the engine searches it itself: hybrid search, rerank, its neurons
 * counted). `none`: no passages. Every other kind is a `Retriever`: one
 * `search` that returns passages, which the engine numbers, quotes and cites
 * exactly as it does its own.
 */

export type KnowledgeSource = { kind: 'helppuff' } | { kind: 'none' } | { kind: 'external'; retriever: Retriever };

const MAX_PASSAGE = 4000;
const isHttp = (url: unknown): url is string => typeof url === 'string' && /^https?:\/\//i.test(url);

/** What a retriever returned, made safe to use: text only, cut to size, at most `limit`. */
export function cleanPassages(raw: unknown, limit: number): Passage[] {
  if (!Array.isArray(raw)) return [];
  const out: Passage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const content = typeof p['content'] === 'string' ? p['content'].trim().slice(0, MAX_PASSAGE) : '';
    if (!content) continue;
    out.push({
      title: typeof p['title'] === 'string' && p['title'].trim() ? p['title'].trim().slice(0, 300) : 'Document',
      content,
      ...(isHttp(p['url']) ? { url: p['url'] } : {}),
      ...(typeof p['heading'] === 'string' && p['heading'].trim() ? { heading: p['heading'].trim().slice(0, 300) } : {}),
      ...(typeof p['score'] === 'number' && Number.isFinite(p['score']) ? { score: p['score'] } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Passages in the shape the engine numbers and cites. */
export function asChunks(passages: Passage[]): RetrievedChunk[] {
  return passages.map((p, i) => ({
    id: `p${i + 1}`,
    pageId: p.url ?? `p${i + 1}`,
    url: p.url ?? '',
    title: p.title,
    headingPath: p.heading ?? p.title,
    category: 'external',
    content: p.content,
    ordinal: i,
    score: p.score ?? 1,
  }));
}

/** Cloudflare AI Search, searched (not asked): its passages, answered by the site's model. */
export function aiSearchRetriever(knowledge: Extract<Knowledge, { type: 'ai-search' }>, ctx: Pick<ConnectorContext<unknown>, 'env' | 'fetch'>): Retriever {
  return {
    id: 'ai-search',
    async search(request) {
      const client = aiSearchClient(ctx, { binding: knowledge.binding, ...(knowledge.endpoint ? { endpoint: knowledge.endpoint } : {}) });
      const result = (await client.search({
        messages: [{ role: 'user', content: request.query }],
        ai_search_options: { retrieval: { max_num_results: request.limit } },
      })) as { chunks?: { text?: unknown; score?: unknown; item?: { key?: unknown; metadata?: Record<string, unknown> } }[] } | null;
      return (result?.chunks ?? []).map((c) => {
        const key = typeof c.item?.key === 'string' ? c.item.key : 'Document';
        const url = c.item?.metadata?.['url'] ?? (isHttp(key) ? key : undefined);
        return { title: key.replace(/^.*\//, '').slice(0, 200) || 'Document', content: typeof c.text === 'string' ? c.text : '', ...(isHttp(url) ? { url } : {}), ...(typeof c.score === 'number' ? { score: c.score } : {}) };
      });
    },
  };
}

/** An OpenAI vector store, searched directly (`POST /vector_stores/{id}/search`). */
export function openAiVectorStoreRetriever(knowledge: Extract<Knowledge, { type: 'openai-vector-store' }>): Retriever {
  return {
    id: 'openai-vector-store',
    async search(request, ectx) {
      const response = await fetchWithTimeout(ectx.fetch, `${knowledge.baseUrl.replace(/\/+$/, '')}/vector_stores/${encodeURIComponent(knowledge.vectorStoreId)}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${typeof knowledge.apiKey === 'string' ? knowledge.apiKey : ''}` },
        body: JSON.stringify({ query: request.query, max_num_results: Math.min(50, request.limit) }),
      });
      if (!response.ok) throw new ConnectorError('The knowledge base is unavailable.', { retryable: true, detail: `openai_vector_store_${response.status}` });
      const body = (await response.json().catch(() => null)) as { data?: { filename?: unknown; score?: unknown; content?: { type?: string; text?: unknown }[] }[] } | null;
      return (body?.data ?? []).map((d) => ({
        title: typeof d.filename === 'string' ? d.filename : 'Document',
        content: (d.content ?? []).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n'),
        ...(typeof d.score === 'number' ? { score: d.score } : {}),
      }));
    },
  };
}

/** The site's own search over HTTP: `POST url { query, question, siteId, limit }` → `{ passages: [...] }`. */
export function httpRetriever(knowledge: Extract<Knowledge, { type: 'http' }>): Retriever {
  return {
    id: 'http',
    async search(request, ectx) {
      const response = await fetchWithTimeout(ectx.fetch, knowledge.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(typeof knowledge.token === 'string' ? { Authorization: `Bearer ${knowledge.token}` } : {}) },
        body: JSON.stringify({ query: request.query, question: request.question, siteId: ectx.siteId, limit: request.limit }),
      });
      if (!response.ok) throw new ConnectorError('The knowledge base is unavailable.', { retryable: true, detail: `http_retrieval_${response.status}` });
      const body = (await response.json().catch(() => null)) as { passages?: unknown } | null;
      return Array.isArray(body?.passages) ? (body.passages as Passage[]) : [];
    },
  };
}

export function knowledgeSource(ctx: ConnectorContext<WorkersAiOptions>): KnowledgeSource {
  const knowledge = ctx.options.knowledge;
  switch (knowledge.type) {
    case 'helppuff':
      return { kind: 'helppuff' };
    case 'none':
      return { kind: 'none' };
    case 'ai-search':
      return { kind: 'external', retriever: aiSearchRetriever(knowledge, ctx) };
    case 'openai-vector-store':
      return { kind: 'external', retriever: openAiVectorStoreRetriever(knowledge) };
    case 'http':
      return { kind: 'external', retriever: httpRetriever(knowledge) };
    case 'custom': {
      const own = extensions().retrievers?.[knowledge.id];
      if (!own) throw new ConnectorError('The assistant is not set up yet.', { retryable: false, detail: `custom_retriever_missing:${knowledge.id}` });
      return { kind: 'external', retriever: own };
    }
  }
}

/**
 * Search an external knowledge base. A failure is not a reason to fail the
 * answer: it is logged, and the assistant answers without passages (it then
 * says it is not sure, as when nothing matched).
 */
export async function searchExternal(retriever: Retriever, request: RetrievalRequest, ctx: ConnectorContext<WorkersAiOptions>): Promise<RetrievedChunk[]> {
  const ectx: ExtensionContext = extensionContext(ctx);
  try {
    return asChunks(cleanPassages(await retriever.search(request, ectx), request.limit));
  } catch (thrown) {
    ctx.log('retrieve.failed', { retriever: retriever.id, detail: thrown instanceof ConnectorError ? thrown.detail : 'error' });
    return [];
  }
}

/** The same search, failing loudly: for `helppuff rag test`, where the error is the answer. */
export async function searchExternalOrThrow(retriever: Retriever, request: RetrievalRequest, ctx: ConnectorContext<WorkersAiOptions>): Promise<RetrievedChunk[]> {
  try {
    return asChunks(cleanPassages(await retriever.search(request, extensionContext(ctx)), request.limit));
  } catch (thrown) {
    if (thrown instanceof ConnectorError) throw thrown;
    throw new ConnectorError('The knowledge base failed.', { retryable: true, detail: `retriever_error:${String((thrown as Error)?.message ?? thrown).slice(0, 200)}` });
  }
}

