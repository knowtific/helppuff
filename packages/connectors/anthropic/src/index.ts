import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ground } from '@murmur/rag';
import type { Message, SendRequest } from '@murmur/protocol';
import {
  ConnectorError,
  RICH_TOOL_SCHEMAS,
  aiSearchClient,
  aiSearchSourceSchema,
  appendHistory,
  defineConnector,
  loadHistory,
  loadScope,
  notice,
  promptSourceSchema,
  resolvePrompt,
  saveScope,
  summarizeReply,
  textMessage,
  toolCallToMessage,
  withoutDocumentLinks,
  type Connector,
  type ConnectorContext,
  type PromptScope,
  type Turn,
} from '@murmur/connector-types';

/**
 * Claude, through the Anthropic Messages API and the official SDK.
 *
 * The Messages API is stateless, so the conversation is kept in KV (see
 * `history.ts`) and replayed each turn. Knowledge is optional: point
 * `knowledge` at a Cloudflare AI Search instance (binding or public endpoint) and the top chunks
 * for each question are handed to Claude alongside it.
 *
 * `show_options` / `show_card` / `show_links` are declared as tools. A call
 * to one is rendered, never executed, so no tool result is ever sent back:
 * the next turn's history carries a plain-text summary of what was shown
 * (`summarizeReply`), which keeps every replayed request valid.
 *
 * Claude Opus 5 and Fable 5.1 run with server-side refusal fallbacks on
 * (`fallbacks: "default"`), so a false-positive safety decline is retried on
 * another model inside the same call instead of reaching the visitor.
 */

const secretOrString = z.union([z.string().min(1), z.object({ env: z.string().min(1) })]);

export const anthropicOptionsSchema = z.object({
  apiKey: secretOrString,
  model: z.string().min(1).default('claude-opus-5'),
  instructions: promptSourceSchema.optional(),
  /**
   * Reasoning effort. Omitted uses the API default; `low` answers fastest,
   * which suits most support chat. Ignored on models without effort control.
   */
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  /** Includes any thinking the model does, so it is not set low. */
  maxTokens: z.number().int().min(256).max(64_000).default(16_000),
  richMessages: z.boolean().default(true),
  /** Retry a safety decline on another model, server-side. Opus 5 / Fable 5.1 only. */
  fallbacks: z.boolean().default(true),
  /** Retrieve from a Cloudflare AI Search instance before each answer. */
  /** `murmur`: retrieve from Murmur's own knowledge base (Vectorize + D1) instead of AI Search. */
  retrieval: z.literal('murmur').optional(),
  knowledge: aiSearchSourceSchema
    .extend({ maxResults: z.number().int().min(1).max(20).default(6) })
    .optional(),
  stream: z.boolean().default(true),
  baseUrl: z.string().url().optional(),
});

export type AnthropicOptions = z.infer<typeof anthropicOptionsSchema>;
export type AnthropicState = { turns: number };

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = ['claude-opus-5', 'claude-fable-5-1'];
/** Haiku 4.5 and older models reject `output_config.effort`. */
const supportsEffort = (model: string) => !/haiku|claude-3|sonnet-4-5|opus-4-5|opus-4-1|opus-4$|sonnet-4$/.test(model);

function apiKey(options: AnthropicOptions): string {
  if (typeof options.apiKey === 'string') return options.apiKey;
  throw new ConnectorError('The assistant is not configured correctly.', {
    retryable: false,
    detail: `unresolved_secret:${options.apiKey.env}`,
  });
}

/** Rich tools, in the Messages API's shape. */
function tools(streaming: boolean): Anthropic.Beta.BetaTool[] {
  return Object.values(RICH_TOOL_SCHEMAS).map((schema) => ({
    name: schema.name,
    description: schema.description,
    input_schema: schema.parameters as Anthropic.Beta.BetaTool.InputSchema,
    // Tool input streams as it is written rather than in one burst. The
    // input is never executed, and `toolCallToMessage` drops anything that
    // does not parse, so a truncated call yields no card rather than a bad one.
    ...(streaming ? { eager_input_streaming: true } : {}),
  }));
}

type SearchChunk = { text?: unknown; item?: { key?: unknown } };

/**
 * Top chunks for the question, as a context block. Retrieval failing is not
 * a reason to fail the turn — Claude still answers, just without the
 * documents — so errors are logged and swallowed.
 */
async function retrieve(ctx: ConnectorContext<AnthropicOptions>, history: Turn[], input: string): Promise<string> {
  if (ctx.options.retrieval === 'murmur') {
    const grounding = await ground(ctx.env, ctx.siteId, input, { log: ctx.log, waitUntil: ctx.waitUntil });
    return grounding ? `<knowledge>\n${grounding.block}\n</knowledge>` : '';
  }
  const knowledge = ctx.options.knowledge;
  if (!knowledge) return '';
  try {
    const result = (await aiSearchClient(ctx, knowledge).search({
      messages: [...history.slice(-4), { role: 'user', content: input }],
      ai_search_options: { retrieval: { max_num_results: knowledge.maxResults } },
    })) as { chunks?: SearchChunk[] } | null;
    const documents = (result?.chunks ?? [])
      .filter((chunk) => typeof chunk.text === 'string' && chunk.text.trim())
      .map((chunk) => {
        const source = typeof chunk.item?.key === 'string' ? chunk.item.key : 'document';
        return `<document source="${source.replace(/"/g, '')}">\n${String(chunk.text).trim()}\n</document>`;
      });
    return documents.length ? `<knowledge>\n${documents.join('\n')}\n</knowledge>` : '';
  } catch {
    ctx.log('anthropic.knowledge_failed');
    return '';
  }
}

function failure(thrown: unknown): ConnectorError {
  if (thrown instanceof ConnectorError) return thrown;
  if (thrown instanceof Anthropic.APIError && typeof thrown.status === 'number') {
    const status = thrown.status;
    const retryable = status === 429 || status === 529 || status >= 500;
    return new ConnectorError(
      retryable ? 'The assistant is busy right now. Please try again.' : 'The assistant is unavailable right now.',
      {
        retryable,
        ...(status === 429 ? { retryAfter: 20 } : {}),
        detail: `anthropic_${status}:${thrown.message.slice(0, 200)}`,
      },
    );
  }
  if (thrown instanceof Anthropic.APIConnectionTimeoutError) {
    return new ConnectorError('That took too long. Please try again.', { retryable: true, detail: 'timeout' });
  }
  return new ConnectorError('We could not reach the assistant. Please try again.', {
    retryable: true,
    detail: thrown instanceof Error ? `anthropic_error:${thrown.message.slice(0, 200)}` : 'anthropic_error',
  });
}

/** Map a final message to protocol messages. */
export function mapAnthropicContent(response: Pick<Anthropic.Beta.BetaMessage, 'content' | 'stop_reason'>): Message[] {
  if (response.stop_reason === 'refusal') {
    return [notice("Sorry, I can't help with that one. Is there something else I can do?")];
  }
  const out: Message[] = [];
  let text = '';
  const flush = () => {
    const built = textMessage(text);
    if (built) out.push(built);
    text = '';
  };
  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      flush();
      const built = toolCallToMessage(block.name, block.input);
      if (built) out.push(built);
    }
    // Thinking, fallback markers and anything else: nothing for the visitor.
  }
  flush();
  return out;
}

async function respond(ctx: ConnectorContext<AnthropicOptions>, input: string, scope: PromptScope): Promise<Message[]> {
  const options = ctx.options;
  const [history, system] = await Promise.all([loadHistory(ctx), resolvePrompt(ctx, options.instructions, scope)]);
  const context = await retrieve(ctx, history, input);

  const client = new Anthropic({
    apiKey: apiKey(options),
    fetch: ctx.fetch,
    // The widget's own retry covers a failed turn; one SDK retry smooths a blip.
    maxRetries: 1,
    timeout: 60_000,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
  });

  const streaming = Boolean(ctx.onText);
  const fallbacks = options.fallbacks && FALLBACK_MODELS.includes(options.model);
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: options.model,
    max_tokens: options.maxTokens,
    // A stable system block first, so it can be cached across turns.
    ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
    messages: [
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      {
        role: 'user',
        content: context
          ? [
              { type: 'text', text: context },
              { type: 'text', text: input },
            ]
          : input,
      },
    ],
    ...(options.richMessages ? { tools: tools(streaming) } : {}),
    ...(options.effort && supportsEffort(options.model) ? { output_config: { effort: options.effort } } : {}),
    ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
  };

  let final: Anthropic.Beta.BetaMessage;
  try {
    if (streaming) {
      const stream = client.beta.messages.stream(params);
      stream.on('text', (delta) => ctx.onText?.(delta));
      final = await stream.finalMessage();
    } else {
      final = await client.beta.messages.create(params);
    }
  } catch (thrown) {
    throw failure(thrown);
  }

  const reply = withoutDocumentLinks(mapAnthropicContent(final));
  await appendHistory(ctx, history, [
    { role: 'user', content: input },
    { role: 'assistant', content: summarizeReply(reply) },
  ]);
  return reply;
}

function contentFor(input: SendRequest): string {
  return input.kind === 'text' ? input.text : input.value;
}

const anthropic: Connector<AnthropicOptions, AnthropicState> = {
  type: 'anthropic',
  optionsSchema: anthropicOptionsSchema,
  capabilities: { poll: false, end: false },
  streams: (options) => options.stream,
  promptOption: () => 'instructions',

  async start(ctx, input) {
    const scope: PromptScope = { lead: input.lead, context: input.context, site: { id: ctx.siteId } };
    await saveScope(ctx, scope);
    if (!input.firstMessage) return { state: { turns: 0 }, messages: [] };
    const messages = await respond(ctx, input.firstMessage, scope);
    ctx.log('anthropic.started');
    return { state: { turns: 1 }, messages };
  },

  async send(ctx, state, input) {
    const messages = await respond(ctx, contentFor(input), await loadScope(ctx));
    return { state: { turns: state.turns + 1 }, messages };
  },
};

export const anthropicConnector = defineConnector(anthropic);
export default anthropicConnector;
