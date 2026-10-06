/**
 * Workers AI cost in neurons, the unit of the free daily allocation.
 *
 * Rates are neurons per million tokens, from
 * developers.cloudflare.com/workers-ai/platform/pricing (checked 2026-10-05).
 * They change; this table is data, and an unknown model falls back to a
 * deliberately pessimistic rate so the budget guard errs towards caution.
 */

export const FREE_DAILY_NEURONS = 10_000;

type Rate = { input: number; output: number };

export const NEURON_RATES: Record<string, Rate> = {
  // Chat models.
  '@cf/zai-org/glm-4.7-flash': { input: 5_500, output: 36_400 },
  '@cf/zai-org/glm-5.3-flash': { input: 13_636, output: 45_455 },
  '@cf/zai-org/glm-5.3': { input: 127_273, output: 400_000 },
  '@cf/zai-org/glm-5.2': { input: 127_273, output: 400_000 },
  '@cf/openai/gpt-oss-120b': { input: 31_818, output: 68_182 },
  '@cf/openai/gpt-oss-20b': { input: 18_182, output: 27_273 },
  '@cf/google/gemma-4-26b-a4b-it': { input: 9_091, output: 27_273 },
  '@cf/google/gemma-3-12b-it': { input: 31_371, output: 50_560 },
  '@cf/qwen/qwen3-30b-a3b-fp8': { input: 4_625, output: 30_475 },
  '@cf/qwen/qwen3.8-27b': { input: 40_909, output: 290_909 },
  '@cf/qwen/qwq-32b': { input: 60_000, output: 90_909 },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { input: 24_545, output: 77_273 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 26_668, output: 204_805 },
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': { input: 4_119, output: 34_868 },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { input: 31_876, output: 50_488 },
  '@cf/nvidia/nemotron-3-120b-a12b': { input: 45_455, output: 136_364 },
  '@cf/moonshotai/kimi-k2.5': { input: 54_545, output: 272_727 },
  '@cf/moonshotai/kimi-k2.6': { input: 86_364, output: 363_636 },
  '@cf/deepseek-ai/deepseek-v4-flash-0731': { input: 40_000, output: 120_000 },
  '@cf/deepseek-ai/deepseek-v4-pro-0813': { input: 120_000, output: 360_000 },
  '@cf/ibm-granite/granite-4.0-h-micro': { input: 1_542, output: 10_158 },
  // Embeddings and rerankers.
  '@cf/baai/bge-m3': { input: 1_075, output: 0 },
  '@cf/qwen/qwen3-embedding-0.6b': { input: 1_075, output: 0 },
  '@cf/baai/bge-small-en-v1.5': { input: 1_841, output: 0 },
  '@cf/baai/bge-base-en-v1.5': { input: 6_058, output: 0 },
  '@cf/baai/bge-large-en-v1.5': { input: 18_582, output: 0 },
  '@cf/baai/bge-reranker-base': { input: 283, output: 0 },
  '@cf/cloudflare/clef-flash': { input: 8_182, output: 0 },
  '@cf/cloudflare/clef': { input: 21_818, output: 0 },
  // Third-party through Workers AI, priced in dollars ($0.042 per M input); shown here in neurons at $0.011 per 1,000.
  'typesafe/jev': { input: 3_818, output: 0 },
};

const UNKNOWN: Rate = { input: 40_000, output: 120_000 };

/** Models Cloudflare only serves on Workers Paid (or with AI Gateway credits). */
export const PAID_ONLY_MODELS = new Set([
  '@cf/zai-org/glm-5.3-flash',
  '@cf/zai-org/glm-5.3',
  '@cf/zai-org/glm-5.2',
  '@cf/deepseek-ai/deepseek-v4-flash-0731',
  '@cf/deepseek-ai/deepseek-v4-pro-0813',
  '@cf/moonshotai/kimi-k2.6',
]);

export function neurons(model: string, inputTokens: number, outputTokens = 0): number {
  const rate = NEURON_RATES[model] ?? UNKNOWN;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/** The UTC day the free allocation is counted against. */
export const usageDay = (now: number) => new Date(now).toISOString().slice(0, 10);
