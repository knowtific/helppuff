/**
 * Workers AI cost in neurons, the unit of the free daily allocation.
 *
 * Rates are neurons per million tokens, from
 * developers.cloudflare.com/workers-ai/platform/pricing (checked 2026-10-04).
 * They change; this table is data, and an unknown model falls back to a
 * deliberately pessimistic rate so the budget guard errs towards caution.
 */

export const FREE_DAILY_NEURONS = 10_000;

type Rate = { input: number; output: number };

export const NEURON_RATES: Record<string, Rate> = {
  '@cf/zai-org/glm-4.7-flash': { input: 5_500, output: 36_400 },
  '@cf/openai/gpt-oss-120b': { input: 31_818, output: 68_182 },
  '@cf/openai/gpt-oss-20b': { input: 18_182, output: 27_273 },
  '@cf/zai-org/glm-5.3-flash': { input: 13_636, output: 45_455 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 26_668, output: 204_805 },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { input: 24_545, output: 77_273 },
  '@cf/baai/bge-m3': { input: 1_075, output: 0 },
  '@cf/qwen/qwen3-embedding-0.6b': { input: 1_075, output: 0 },
  '@cf/baai/bge-reranker-base': { input: 283, output: 0 },
  '@cf/cloudflare/clef-flash': { input: 8_182, output: 0 },
  '@cf/cloudflare/clef': { input: 21_818, output: 0 },
  // Third-party through Workers AI, priced in dollars ($0.042 per M input); shown here in neurons at $0.011 per 1,000.
  'typesafe/jev': { input: 3_818, output: 0 },
};

const UNKNOWN: Rate = { input: 40_000, output: 120_000 };

/** Models Cloudflare only serves on Workers Paid (or with AI Gateway credits). */
export const PAID_ONLY_MODELS = new Set(['@cf/zai-org/glm-5.3-flash', '@cf/zai-org/glm-5.3', '@cf/zai-org/glm-5.2']);

export function neurons(model: string, inputTokens: number, outputTokens = 0): number {
  const rate = NEURON_RATES[model] ?? UNKNOWN;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/** The UTC day the free allocation is counted against. */
export const usageDay = (now: number) => new Date(now).toISOString().slice(0, 10);
