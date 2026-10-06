import { classifyIntent, embedQueries, embedQuery, rerank, type AiOptions } from './ai.js';
import { intentCategories } from './categorise.js';
import { chunksByIds, keywordSearch, vectorSearch, type ChunkRow } from './store.js';
import type { AiLike, D1Like, Log, VectorIndexLike, VectorMatch } from './types.js';

/**
 * Retrieval for one visitor message:
 *
 *   1. a standalone query (follow-ups like "how much is it?" borrow the
 *      previous question)
 *   2. vector search (Vectorize) and keyword search (D1 FTS5, BM25) in parallel
 *   3. Reciprocal Rank Fusion of the two lists
 *   4. a boost for the categories the question leans towards
 *   5. a cross-encoder rerank of the top candidates
 *   6. the best `finalK` above a relevance threshold — or nothing, so the
 *      assistant says it does not know rather than guessing
 *
 * Each stage degrades rather than fails: no vectors yet → keyword only; the
 * reranker down → fused order with a vector-score threshold.
 */

export type RetrievalOptions = AiOptions & {
  embeddingModel: string;
  rerankerModel: string | null;
  topKVector: number;
  topKKeyword: number;
  /** How many candidates go to the reranker. */
  rerankTop?: number;
  finalK: number;
  /** Reranker score (0–1) a passage needs to be used. */
  minScore: number;
  /** Cosine similarity a passage needs when the reranker is off or failed. */
  minVectorScore?: number;
  neighbours?: boolean;
  /** e.g. `@cf/cloudflare/clef-flash`: a model's reading of the question, added to the rule-based category boost. */
  intentModel?: string | null;
  /**
   * An embedding already on its way, started before the conversation was
   * loaded. Used when the query turned out to be exactly that text.
   */
  precomputed?: { text: string; embedding: Promise<{ vector: number[]; neurons: number }> } | undefined;
  /**
   * Time budgets. Workers AI is usually quick but sometimes takes seconds; a
   * slow reranker falls back to the fused order (with the vector threshold),
   * a slow embedding to keyword search alone, rather than hold up the answer.
   */
  rerankTimeoutMs?: number;
  embedTimeoutMs?: number;
};

class Timeout extends Error {
  constructor(stage: string) {
    super(`${stage} timed out`);
  }
}

function within<T>(promise: Promise<T>, ms: number | undefined, stage: string): Promise<T> {
  if (!ms) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(stage)), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export const DEFAULT_RETRIEVAL: RetrievalOptions = {
  embeddingModel: '@cf/baai/bge-m3',
  rerankerModel: '@cf/baai/bge-reranker-base',
  topKVector: 20,
  topKKeyword: 20,
  // Ten candidates keep the reranker fast; the best four almost always come from them.
  rerankTop: 10,
  finalK: 4,
  minScore: 0.2,
  minVectorScore: 0.45,
  neighbours: true,
  // Measured from a Worker (2026-10-04): rerank ~0.5 s, embedding ~0.2 s, with rare multi-second spikes.
  rerankTimeoutMs: 800,
  embedTimeoutMs: 1500,
};

export type RetrievedChunk = {
  id: string;
  pageId: string;
  url: string;
  title: string;
  headingPath: string;
  category: string;
  content: string;
  ordinal: number;
  /** Reranker score when reranked, else the fused score. */
  score: number;
};

export type Retrieval = {
  chunks: RetrievedChunk[];
  query: string;
  neurons: number;
  /** Which stages ran, for `murmur ask --json` and debugging. */
  trace: {
    vector: number;
    keyword: number;
    fused: number;
    reranked: boolean;
    threshold: number;
    errors: string[];
    /** Milliseconds per stage: embed, vector, keyword, rows, rerank, intent, neighbour. */
    ms: Record<string, number>;
    /** Sentences of a long message searched on their own (`subQueries`). */
    parts?: number;
  };
};

export type RetrieveDeps = { db: D1Like; ai: AiLike; vectors: VectorIndexLike | null; log?: Log };

const ELLIPTICAL = /\b(it|its|that|this|those|these|they|them|there|he|she|his|her|one|ones|same|also|too|else|more)\b/i;

/**
 * The query to search with. A short follow-up that leans on the previous
 * turn ("how much is it?", "and on weekends?") is searched together with the
 * previous question; a self-contained one is searched alone.
 */
export function standaloneQuery(message: string, previousUserMessages: readonly string[]): string {
  const words = message.trim().split(/\s+/).filter(Boolean);
  const previous = previousUserMessages[previousUserMessages.length - 1]?.trim();
  if (!previous) return message.trim();
  if (words.length <= 4 || (words.length <= 10 && ELLIPTICAL.test(message))) return `${previous} ${message.trim()}`.slice(0, 1000);
  return message.trim();
}

/** Reciprocal Rank Fusion: `Σ 1 / (k + rank)` over the lists an id appears in. */
export function rrf(lists: readonly (readonly string[])[], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  return scores;
}

const toRetrieved = (row: ChunkRow, score: number): RetrievedChunk => ({
  id: row.id,
  pageId: row.page_id,
  url: row.url,
  title: row.title ?? '',
  headingPath: row.heading_path ?? '',
  category: row.category ?? 'other',
  content: row.content,
  ordinal: row.ordinal,
  score,
});

/** The passage the reranker reads: where it sits, then what it says. */
/**
 * The sentences of a long message, to search as well as the whole: a
 * question wrapped in context ("My living room is 4m x 5m and the bedroom
 * 3m x 3.5m. Roughly what would installation cost?") is drowned by the
 * context when searched whole. Short messages are searched as they are.
 */
export function subQueries(query: string): string[] {
  if (query.length < 60) return [];
  const sentences = query
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
  return sentences.length >= 2 ? sentences.slice(-3) : [];
}

export const rerankText = (row: Pick<ChunkRow, 'heading_path' | 'title' | 'content'>) => `${row.heading_path || row.title || ''}\n${row.content}`;

export async function retrieve(deps: RetrieveDeps, siteId: string, query: string, options: RetrievalOptions = DEFAULT_RETRIEVAL): Promise<Retrieval> {
  const errors: string[] = [];
  let neurons = 0;
  const ai = { gateway: options.gateway };
  const ms: Record<string, number> = {};
  const timed = async <T,>(stage: string, work: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      return await work();
    } finally {
      ms[stage] = Date.now() - started;
    }
  };

  // A long message's sentences are searched as well as the whole of it.
  const parts = subQueries(query);
  const [vectorLists, keywordLists] = await Promise.all([
    (async (): Promise<VectorMatch[][]> => {
      if (!deps.vectors) return [];
      try {
        const early = options.precomputed?.text === query ? options.precomputed.embedding : null;
        const [whole, more] = await timed('embed', () =>
          within(
            Promise.all([early ?? embedQuery(deps.ai, options.embeddingModel, query, ai), embedQueries(deps.ai, options.embeddingModel, parts, ai)]),
            options.embedTimeoutMs ?? DEFAULT_RETRIEVAL.embedTimeoutMs,
            'embedding',
          ),
        );
        neurons += whole.neurons + more.neurons;
        return await timed('vector', () =>
          Promise.all([whole.vector, ...more.vectors].map((vector) => vectorSearch(deps.vectors!, siteId, vector, options.topKVector))),
        );
      } catch (thrown) {
        errors.push(`vector: ${String((thrown as Error)?.message ?? thrown).slice(0, 120)}`);
        return [];
      }
    })(),
    (async (): Promise<{ id: string; score: number }[][]> => {
      try {
        return await timed('keyword', () => Promise.all([query, ...parts].map((q) => keywordSearch(deps.db, siteId, q, options.topKKeyword))));
      } catch (thrown) {
        errors.push(`keyword: ${String((thrown as Error)?.message ?? thrown).slice(0, 120)}`);
        return [];
      }
    })(),
  ]);
  const vectorHits = vectorLists.flat();
  const keywordHits = keywordLists.flat();

  const fused = rrf([...vectorLists.map((list) => list.map((h) => h.id)), ...keywordLists.map((list) => list.map((h) => h.id))]);
  const vectorScore = new Map<string, number>();
  for (const h of vectorHits) vectorScore.set(h.id, Math.max(vectorScore.get(h.id) ?? 0, h.score));
  const keywordIds = new Set(keywordHits.map((h) => h.id));
  const rows = await timed('rows', () => chunksByIds(deps.db, siteId, [...fused.keys()]));

  const boost = new Set<string>(intentCategories(query));
  if (options.intentModel) {
    try {
      const intent = await timed('intent', () => classifyIntent(deps.ai, options.intentModel!, query, ai));
      neurons += intent.neurons;
      for (const category of intent.categories) boost.add(category);
    } catch (thrown) {
      errors.push(`intent: ${String((thrown as Error)?.message ?? thrown).slice(0, 120)}`);
    }
  }
  const ranked = rows
    .map((row) => ({ row, score: (fused.get(row.id) ?? 0) * (boost.has(row.category ?? '') ? 1.5 : 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.rerankTop ?? 20);

  let chosen: RetrievedChunk[] = [];
  let reranked = false;
  let threshold = options.minScore;
  if (options.rerankerModel && ranked.length) {
    try {
      // Each passage is judged against the whole message and each sentence, and keeps its best score.
      const texts = ranked.map((r) => rerankText(r.row));
      const results = await timed('rerank', () =>
        within(
          Promise.all([query, ...parts].map((q) => rerank(deps.ai, options.rerankerModel!, q, texts, ai))),
          options.rerankTimeoutMs ?? DEFAULT_RETRIEVAL.rerankTimeoutMs,
          'rerank',
        ),
      );
      for (const result of results) neurons += result.neurons;
      reranked = true;
      chosen = ranked
        .map((r, i) => ({ r, score: Math.max(...results.map((result) => result.scores[i] ?? 0)) * (boost.has(r.row.category ?? '') ? 1.1 : 1) }))
        .filter((x) => x.score >= options.minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, options.finalK)
        .map((x) => toRetrieved(x.r.row, x.score));
    } catch (thrown) {
      errors.push(`rerank: ${String((thrown as Error)?.message ?? thrown).slice(0, 120)}`);
    }
  }
  if (!reranked) {
    // No reranker verdict: trust a passage the keywords found, or one that is close in meaning.
    threshold = options.minVectorScore ?? DEFAULT_RETRIEVAL.minVectorScore!;
    chosen = ranked
      .filter((r) => keywordIds.has(r.row.id) || (vectorScore.get(r.row.id) ?? 0) >= threshold)
      .slice(0, options.finalK)
      .map((r) => toRetrieved(r.row, r.score));
  }

  if (options.neighbours !== false && chosen[0]) chosen = await timed('neighbour', () => withNeighbour(deps.db, siteId, chosen));
  if (errors.length) deps.log?.('rag.retrieve.degraded', { errors: errors.length });

  return {
    chunks: chosen,
    query,
    neurons,
    trace: { vector: vectorHits.length, keyword: keywordHits.length, fused: fused.size, reranked, threshold, errors, ms, ...(parts.length ? { parts: parts.length } : {}) },
  };
}

/**
 * When the best passage stops mid-list or mid-table, the next one from the
 * same section usually finishes the thought; add it.
 */
async function withNeighbour(db: D1Like, siteId: string, chosen: RetrievedChunk[]): Promise<RetrievedChunk[]> {
  const top = chosen[0]!;
  const lastBlock = top.content.trim().split(/\n{2,}/).pop() ?? '';
  if (!/^\s*(- |\d+\. |\|)/.test(lastBlock)) return chosen;
  const next = await db
    .prepare('SELECT * FROM chunks WHERE site_id = ? AND page_id = ? AND ordinal = ?')
    .bind(siteId, top.pageId, top.ordinal + 1)
    .first<ChunkRow>();
  if (!next || chosen.some((c) => c.id === next.id) || (next.heading_path ?? '') !== top.headingPath) return chosen;
  return [top, toRetrieved(next, top.score), ...chosen.slice(1)];
}
