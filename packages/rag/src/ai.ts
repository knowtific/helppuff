import { neurons } from './pricing.js';
import type { AiLike } from './types.js';

/**
 * Embedding and reranking through Workers AI (schemas read from the
 * account's model catalog on 2026-10-04):
 *
 *   @cf/qwen/qwen3-embedding-0.6b  { documents | queries: string | string[] (≤ 32), instruction? }
 *                                  → { data: number[][], shape: [n, 1024] }
 *   @cf/baai/bge-reranker-base     { query, contexts: [{ text }], top_k? }
 *                                  → { response: [{ id, score }] }  (id = index into contexts)
 *
 * Queries and documents are embedded differently: qwen3 prefixes queries
 * with a task instruction, which is what makes short questions land near
 * the long passages that answer them.
 */

export const EMBED_BATCH = 32;

/**
 * Vector size per embedding model: the Vectorize index must be created with the same.
 * bge-m3 is the default: measured from a Worker on 2026-10-04 at ~0.1–0.2 s a
 * query, where qwen3-embedding took 0.3–3 s; same price, same 1024 dimensions.
 */
export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  '@cf/qwen/qwen3-embedding-0.6b': 1024,
  '@cf/baai/bge-m3': 1024,
  '@cf/baai/bge-large-en-v1.5': 1024,
  '@cf/baai/bge-base-en-v1.5': 768,
  '@cf/baai/bge-small-en-v1.5': 384,
};
/** The reranker reads about 512 tokens; the rest of a long passage is ignored anyway. */
const RERANK_CHARS = 1800;

export type AiOptions = { gateway?: string | null | undefined };

export const runOptions = (options: AiOptions) => (options.gateway ? { gateway: { id: options.gateway } } : undefined);

function vectorsFrom(result: unknown, expected: number): number[][] {
  const data = (result as { data?: unknown })?.data;
  if (!Array.isArray(data) || data.length !== expected || !data.every((v) => Array.isArray(v) && v.length > 0)) {
    throw new Error('The embedding model returned an unexpected shape.');
  }
  return data as number[][];
}

/**
 * The input field a model takes. qwen3 distinguishes queries from documents
 * (queries get a retrieval instruction); the BGE models take plain `text`.
 */
const inputFor = (model: string, kind: 'documents' | 'queries', texts: string[]) =>
  /qwen3-embedding/.test(model) ? { [kind]: texts } : { text: texts };

/** Embed passages for storage, in batches. Returns vectors and the neurons spent. */
export async function embedDocuments(ai: AiLike, model: string, texts: string[], options: AiOptions = {}): Promise<{ vectors: number[][]; neurons: number }> {
  const vectors: number[][] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH).map((t) => t.slice(0, 24_000) || ' ');
    tokens += batch.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
    vectors.push(...vectorsFrom(await ai.run(model, inputFor(model, 'documents', batch), runOptions(options)), batch.length));
  }
  return { vectors, neurons: neurons(model, tokens) };
}

export async function embedQuery(ai: AiLike, model: string, query: string, options: AiOptions = {}): Promise<{ vector: number[]; neurons: number }> {
  const [vector] = vectorsFrom(await ai.run(model, inputFor(model, 'queries', [query.slice(0, 4000)]), runOptions(options)), 1);
  return { vector: vector!, neurons: neurons(model, Math.ceil(query.length / 4)) };
}

/** Several search queries in one embedding call. */
export async function embedQueries(ai: AiLike, model: string, queries: string[], options: AiOptions = {}): Promise<{ vectors: number[][]; neurons: number }> {
  if (!queries.length) return { vectors: [], neurons: 0 };
  const batch = queries.map((q) => q.slice(0, 4000));
  const vectors = vectorsFrom(await ai.run(model, inputFor(model, 'queries', batch), runOptions(options)), batch.length);
  return { vectors, neurons: neurons(model, batch.reduce((n, q) => n + Math.ceil(q.length / 4), 0)) };
}

/** Relevance of each passage to the query, in the passages' order. */
export async function rerank(
  ai: AiLike,
  model: string,
  query: string,
  passages: string[],
  options: AiOptions = {},
): Promise<{ scores: number[]; neurons: number }> {
  if (!passages.length) return { scores: [], neurons: 0 };
  if (isJudge(model)) return judge(ai, model, query, passages, options);
  const contexts = passages.map((p) => ({ text: p.slice(0, RERANK_CHARS) || ' ' }));
  const result = (await ai.run(model, { query: query.slice(0, 1000), contexts }, runOptions(options))) as { response?: { id?: number; score?: number }[] };
  if (!Array.isArray(result?.response)) throw new Error('The reranker returned an unexpected shape.');
  const scores = passages.map(() => 0);
  for (const item of result.response) {
    if (typeof item.id === 'number' && item.id >= 0 && item.id < scores.length && typeof item.score === 'number') scores[item.id] = item.score;
  }
  const tokens = contexts.reduce((n, c) => n + Math.ceil((c.text.length + query.length) / 4), 0);
  return { scores, neurons: neurons(model, tokens) };
}

/** Decision models (Clef on Workers AI, TypeSafe's Jev through the same binding) answer typed questions instead of scoring pairs. */
export const isJudge = (model: string) => /\/clef(-flash)?$/.test(model) || /^typesafe\/jev/.test(model);

/** Clef reads more than the BGE reranker's 512 tokens, but each passage costs neurons; this keeps the whole set near 3k tokens. */
const JUDGE_CHARS = 1200;

/**
 * Rerank with a decision model: one yes/no question per passage, all in one
 * call, each answered with the probability that the passage answers the
 * visitor's question. Schemas read 2026-10-04 (Jev: developers.cloudflare.com/ai/models/typesafe/jev):
 *
 *   { model (Clef only), state: { visitorQuestion, passages: { p0: text… } }, questions: { p0: { type: 'noul', instructions, criteria } } }
 *   → { answers: { p0: { type: 'noul', noul: p } }, usage: { input_tokens } }
 */
async function judge(ai: AiLike, model: string, query: string, passages: string[], options: AiOptions): Promise<{ scores: number[]; neurons: number }> {
  const ids = passages.map((_, i) => `p${i}`);
  const state = { visitorQuestion: query.slice(0, 1000), passages: Object.fromEntries(ids.map((id, i) => [id, passages[i]!.slice(0, JUDGE_CHARS)])) };
  const criteria = {
    true: 'The passage states facts that answer the question, or directly help answer it.',
    false: 'The passage is about something else, or only shares some words with the question.',
  };
  const result = (await ai.run(
    model,
    {
      // Clef's schema also wants the size by name; Jev's has no such field.
      ...(model.startsWith('typesafe/') ? {} : { model: model.endsWith('/clef') ? 'clef' : 'clef-flash' }),
      state,
      questions: Object.fromEntries(ids.map((id) => [id, { type: 'noul', instructions: `Does passage ${id} help answer the visitor's question?`, criteria }])),
    },
    runOptions(options),
  )) as { answers?: Record<string, { noul?: number }>; usage?: { input_tokens?: number } };
  if (!result?.answers || typeof result.answers !== 'object') throw new Error('The reranker returned an unexpected shape.');
  const scores = ids.map((id) => {
    const p = result.answers![id]?.noul;
    return typeof p === 'number' && p >= 0 && p <= 1 ? p : 0;
  });
  const tokens = result.usage?.input_tokens ?? Math.ceil(JSON.stringify(state).length / 4);
  return { scores, neurons: neurons(model, tokens) };
}

/**
 * Which kinds of page a question leans towards, from Cloudflare's Clef
 * models (`@cf/cloudflare/clef-flash`; schema read 2026-10-04):
 *
 *   { model: 'clef-flash', state, questions: { id: { type: 'choice', instructions, criteria: { option: description } } } }
 *   → { answers: { id: { choice, probabilities: { option: p }, confidence } } }
 *
 * Returns every category with probability ≥ 0.3, best first, or [] when the
 * question is general. About one neuron a call.
 */
export async function classifyIntent(ai: AiLike, model: string, query: string, options: AiOptions = {}): Promise<{ categories: string[]; neurons: number }> {
  const criteria: Record<string, string> = {
    contact: 'How to reach the business: phone, email, address, opening hours, directions.',
    pricing: 'Prices, costs, fees, quotes, payment.',
    location: 'Which suburbs, towns or areas are served; travel; where the business is.',
    booking: 'Booking, appointments, availability, scheduling.',
    service: 'What a particular service or product involves, or whether it is offered.',
    general: 'Anything else: greetings, the business in general, other topics.',
  };
  const result = (await ai.run(
    model,
    {
      model: model.endsWith('/clef') ? 'clef' : 'clef-flash',
      state: query.slice(0, 2000),
      questions: { intent: { type: 'choice', instructions: 'What is the website visitor asking about?', criteria } },
    },
    runOptions(options),
  )) as { answers?: { intent?: { probabilities?: Record<string, number> } } };
  const probabilities = result?.answers?.intent?.probabilities ?? {};
  const categories = Object.entries(probabilities)
    .filter(([key, p]) => key !== 'general' && key in criteria && typeof p === 'number' && p >= 0.3)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
  return { categories, neurons: neurons(model, Math.ceil((query.length + 600) / 4)) };
}

/**
 * How long a chat model thinks before it answers. Deeper thinking helps
 * multi-step questions; it is slower, and the thinking tokens are billed.
 */
export const REASONING_LEVELS = ['off', 'low', 'medium', 'high'] as const;
export type Reasoning = (typeof REASONING_LEVELS)[number];
/**
 * What an owner may choose. `off` is only for work nobody reads as a reply
 * (summaries, facts): answers without thinking leaked their instructions,
 * promised discounts and agreed to false facts in testing (wiki: AI models).
 */
export const ANSWER_REASONING = ['low', 'medium', 'high'] as const;
export type AnswerReasoning = (typeof ANSWER_REASONING)[number];
/** An older config's `off` is read as the lowest level a reply may use. */
export const answerReasoning = (value: unknown): AnswerReasoning =>
  value === 'off' ? 'low' : ANSWER_REASONING.includes(value as AnswerReasoning) ? (value as AnswerReasoning) : 'medium';

/**
 * The inputs that set a model's thinking, by family, from each model's
 * Workers AI schema (checked 2026-10-05). Families with only on/off treat
 * every level above `off` as on; GLM-5.3 cannot stop thinking, so `off` is
 * its lowest level. A family not listed here (Qwen, Llama, Kimi, Mistral,
 * and gpt-oss until its parameter is confirmed) thinks as it does by
 * default: an unknown field could make every call fail.
 */
export function reasoningInputs(model: string, level: Reasoning): Record<string, unknown> {
  if (/zai-org\/glm-5/i.test(model)) return { reasoning_effort: ({ off: 'low', low: 'low', medium: 'high', high: 'max' } as const)[level] };
  if (/deepseek-v4/i.test(model)) return { reasoning_effort: ({ off: 'none', low: 'low', medium: 'high', high: 'max' } as const)[level] };
  if (/nemotron-3/i.test(model)) return { chat_template_kwargs: level === 'off' ? { enable_thinking: false } : { enable_thinking: true, low_effort: level === 'low' } };
  if (/zai-org\/glm-4|gemma-4/i.test(model)) return { chat_template_kwargs: { enable_thinking: level !== 'off' } };
  return {};
}

/** Room for the thinking, on top of the answer's own token cap: thinking tokens count against `max_tokens`. */
export function thinkingRoom(model: string, level: Reasoning): number {
  if (level === 'off' && !/zai-org\/glm-5/i.test(model)) return 0;
  return { off: 1024, low: 1024, medium: 2048, high: 4096 }[level];
}
