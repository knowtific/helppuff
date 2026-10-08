import { z } from 'zod';
import { promptSourceSchema } from '@helppuff/connector-types';
import { ANSWER_REASONING, DEFAULT_RETRIEVAL } from '@helppuff/rag';

/**
 * Options for the `workers-ai` connector: HelpPuff's own RAG (Vectorize + D1
 * on the site's account) with generation on Workers AI. Every default runs
 * on the Workers Free plan; model ids are data, so a newer model is a config
 * change, never a code change.
 */

export const DEFAULT_MODEL = '@cf/zai-org/glm-4.7-flash';

/** A secret as the server passes it (resolved), or as a config holds it (`{ env }`), for validating either. */
const secret = z.union([z.string().min(1), z.object({ env: z.string().min(1) }).strict()]);

/**
 * Who writes the answers. `workers-ai` (the default) is the Workers AI
 * binding. `openai-compatible` is any `/chat/completions` API with tools
 * (OpenAI, Gemini, DeepInfra, OpenRouter, DeepSeek, Groq, the Vercel and
 * Cloudflare AI gateways…; the CLI's presets fill `baseUrl`). `anthropic`
 * is Claude's Messages API. `custom` is the site's own module, by id.
 */
export const providerSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('workers-ai') }).strict(),
    z
      .object({
        type: z.literal('openai-compatible'),
        baseUrl: z.string().url().describe('The API base, before `/chat/completions`.'),
        apiKey: secret.optional().describe('Sent as `Authorization: Bearer …`.'),
        headers: z.record(z.string(), z.union([z.string().max(2000), z.object({ env: z.string().min(1) }).strict()])).optional().describe('Extra headers, e.g. `cf-aig-authorization` for an authenticated AI Gateway; a value may be a secret.'),
        tools: z.boolean().default(true).describe('The model calls tools natively. Off: tools written in the text are still read.'),
        temperature: z.boolean().default(true).describe('The API accepts `temperature` (OpenAI\'s reasoning models do not).'),
        maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']).default('max_tokens').describe('How the API names the output cap.'),
        label: z.string().max(40).optional().describe('Its name in logs, e.g. `deepinfra`.'),
      })
      .strict(),
    z
      .object({
        type: z.literal('anthropic'),
        apiKey: secret,
        baseUrl: z.string().url().default('https://api.anthropic.com'),
      })
      .strict(),
    z.object({ type: z.literal('custom'), id: z.string().min(1).max(64) }).strict(),
  ])
  .default({ type: 'workers-ai' })
  .describe('Who writes the answers.');
export type Provider = z.infer<typeof providerSchema>;

/**
 * What the answers come from. `helppuff` (the default): the site's own
 * knowledge base, learned by the crawl (tuned by `retrieval`). `none`: the
 * prompt and the business details only. The others ask another search for
 * passages.
 */
export const knowledgeSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('helppuff') }).strict(),
    z.object({ type: z.literal('none') }).strict(),
    z
      .object({
        type: z.literal('ai-search'),
        binding: z.string().min(1).max(64).default('AI_SEARCH'),
        endpoint: z.string().url().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('openai-vector-store'),
        vectorStoreId: z.string().min(1),
        apiKey: secret,
        baseUrl: z.string().url().default('https://api.openai.com/v1'),
      })
      .strict(),
    z
      .object({
        type: z.literal('http'),
        url: z.string().url(),
        token: secret.optional(),
      })
      .strict(),
    z.object({ type: z.literal('custom'), id: z.string().min(1).max(64) }).strict(),
  ])
  .default({ type: 'helppuff' })
  .describe('What the answers come from.');
export type Knowledge = z.infer<typeof knowledgeSchema>;

export const workersAiOptionsSchema = z
  .object({
    provider: providerSchema,
    knowledge: knowledgeSchema,
    model: z.string().min(1).max(200).default(DEFAULT_MODEL).describe('The Workers AI model that writes answers. GLM-4.7 Flash is the best all-round on the Free plan; the wiki\'s AI models page compares the others for speed, quality and answers a day.'),
    reasoning: z
      // `off` was a choice once: answers without thinking proved unsafe, so it now means `low`.
      .preprocess((value) => (value === 'off' ? 'low' : value), z.enum(ANSWER_REASONING))
      .default('medium')
      .describe('How long the model thinks before answering: `low`, `medium` or `high`. Deeper is better on multi-step questions, slower to start, and the thinking is billed. Models that only switch thinking on or off treat every level as on.'),
    fallbackModel: z.string().min(1).max(200).optional().describe('Tried once when the main model fails for any reason other than the budget.'),
    gateway: z.string().min(1).max(64).optional().describe('An AI Gateway id: caching, logs and rate limits in front of every model call.'),
    instructions: promptSourceSchema.optional(),
    locale: z.string().max(35).optional().describe('BCP 47, e.g. `en-AU`: spelling and date style of answers.'),
    timezone: z.string().max(64).optional().describe('IANA, e.g. `Australia/Melbourne`: "are you open now?".'),
    maxAnswerSentences: z.number().int().min(1).max(20).default(4).describe('The longest answer, in sentences. Short answers cost less and read better in a chat.'),
    maxOutputTokens: z.number().int().min(64).max(4096).default(600).describe('A hard cap on tokens per answer.'),
    historyMessages: z.number().int().min(0).max(24).default(6).describe('Earlier messages sent with each question. The main cost lever after retrieval.'),
    stream: z.boolean().default(true),
    richMessages: z.boolean().default(true).describe('Let the model offer next-step chips (option buttons) after an answer.'),
    retrieval: z
      .object({
        embeddingModel: z.string().min(1).max(200).default(DEFAULT_RETRIEVAL.embeddingModel).describe('Turns pages and questions into vectors. Changing it re-learns the site (and uploaded files) on the next deploy.'),
        rerankerModel: z.string().min(1).max(200).nullable().default(DEFAULT_RETRIEVAL.rerankerModel).describe('Re-reads the passages search found and keeps only those that answer the question. `null` turns it off: about half a second faster, but more likely to answer from the wrong page.'),
        topKVector: z.number().int().min(1).max(50).default(DEFAULT_RETRIEVAL.topKVector).describe('Passages taken from meaning (vector) search before re-scoring.'),
        topKKeyword: z.number().int().min(1).max(50).default(DEFAULT_RETRIEVAL.topKKeyword).describe('Passages taken from keyword (full-text) search before re-scoring.'),
        finalK: z.number().int().min(1).max(10).default(DEFAULT_RETRIEVAL.finalK).describe('Passages the model reads for each answer.'),
        minScore: z.number().min(0).max(1).default(DEFAULT_RETRIEVAL.minScore).describe('Passages scored below this are dropped. With none left, the assistant says it is not sure and offers a callback instead of guessing.'),
        queryRewrite: z.enum(['heuristic', 'llm', 'off']).default('heuristic').describe('`heuristic`: follow-ups borrow the previous question. `llm`: one extra small call rewrites it.'),
        intentModel: z.string().min(1).max(200).nullable().default(null).describe('e.g. `@cf/cloudflare/clef-flash`: classify each question to steer retrieval. Off by default.'),
      })
      .strict()
      .default({})
      .describe('How answers find passages in the knowledge base.'),
    tools: z
      .object({
        callback: z.boolean().default(true).describe('Offer to have the team call or email back — the default way to a person.'),
        businessHours: z.boolean().default(true).describe('Answer "are you open now?" from the business hours and time zone.'),
        // Retired switches from before callbacks replaced handoff and booking:
        // accepted, so configs saved by older versions still load, and ignored.
        captureLead: z.boolean().optional().describe('Retired. Accepted from older configs and ignored.'),
        handoff: z.boolean().optional().describe('Retired. Accepted from older configs and ignored.'),
        booking: z.boolean().optional().describe('Retired. Accepted from older configs and ignored.'),
      })
      .strict()
      .default({})
      .describe('What the assistant can do besides answering.'),
    handoff: z.record(z.string(), z.unknown()).optional().describe('Retired (callbacks replaced handoff). Accepted from older configs and ignored.'),
    business: z
      .object({
        name: z.string().max(200).optional().describe('The business name.'),
        phone: z.string().max(100).optional().describe('The main phone number.'),
        email: z.string().max(200).optional().describe('The contact email.'),
        address: z.string().max(400).optional().describe('The street address.'),
        hours: z.array(z.string().max(200)).max(14).default([]).describe('Opening hours, one line per day or range, e.g. "Mon-Fri 7am-5pm".'),
        serviceAreas: z.array(z.string().max(100)).max(100).default([]).describe('Suburbs or regions served.'),
      })
      .strict()
      .default({})
      .describe('Details the owner confirmed. Usually left empty: the details learned from the site, and edited in the dashboard, are used.'),
    budget: z
      .object({
        dailyNeurons: z.number().int().min(0).max(10_000_000).default(9000).describe('Neurons per UTC day before answers stop; the free allocation is 10,000.'),
        maxInputTokens: z.number().int().min(1000).max(100_000).default(6000).describe('The most tokens sent to the model per answer — prompt, passages and history — trimmed to fit.'),
      })
      .strict()
      .default({})
      .describe('The daily Workers AI spend guard. Past it, visitors get your contact details and a callback form instead of answers.'),
    bindings: z
      .object({ ai: z.string().default('AI'), vectors: z.string().default('VECTORS'), db: z.string().default('HELPPUFF_DB') })
      .strict()
      .default({}),
  })
  .strict();

export type WorkersAiOptions = z.infer<typeof workersAiOptionsSchema>;
