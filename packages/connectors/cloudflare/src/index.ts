import { z } from 'zod';
import { readSse, SseIdleTimeout, type Message, type SendRequest } from '@murmur/protocol';
import {
  CONNECTOR_TIMEOUT_MS,
  ConnectorError,
  MARKER_INSTRUCTIONS,
  aiSearchClient,
  aiSearchSourceSchema,
  appendHistory,
  defineConnector,
  loadHistory,
  loadScope,
  markerFilter,
  parseMarkers,
  promptSourceSchema,
  resolvePrompt,
  saveScope,
  summarizeReply,
  textMessage,
  withoutDocumentLinks,
  type AiSearchMessage,
  type Connector,
  type ConnectorContext,
  type PromptScope,
  type Turn,
} from '@murmur/connector-types';

/**
 * Cloudflare AI Search — retrieval and generation in one call, on the same
 * account as the Worker, with no provider key to manage.
 *
 * Verified against developers.cloudflare.com/ai-search on 2026-09-24:
 *
 *   wrangler:  [[ai_search]] binding = "AI_SEARCH", instance_name = "…"
 *              (or a public endpoint URL — see `ai-search.ts`)
 *   call:      env.AI_SEARCH.chatCompletions({ messages, model?, stream?,
 *                ai_search_options: { retrieval: { max_num_results },
 *                                     query_rewrite: { enabled } } })
 *   returns:   { choices: [{ message: { content } }], chunks: [...] }, or
 *              with `stream: true` an SSE stream: an `event: chunks` frame,
 *              then OpenAI-style `choices[0].delta.content` frames, then
 *              `data: [DONE]`.
 *
 * The API is stateless — `messages` is the whole conversation — so history
 * lives in KV (see `history.ts`). AI Search retrieves against the messages
 * itself, so the connector never sees an embedding.
 *
 * Chat completions here take no tool definitions, so chips and links come
 * from inline markers, which the system prompt teaches the model to write.
 */

export const cloudflareOptionsSchema = aiSearchSourceSchema.extend({
  /**
   * A Workers AI model id, or an AI Gateway alias such as `openai/gpt-5-mini`.
   * Omit to use the model configured on the instance.
   */
  model: z.string().min(1).max(200).optional(),
  instructions: promptSourceSchema.optional(),
  /** Chunks retrieved per question. More is better grounding and a slower, costlier call. */
  maxResults: z.number().int().min(1).max(50).default(8),
  /** Rewrites the visitor's question before retrieval. Helps short, vague questions. */
  rewriteQuery: z.boolean().default(true),
  /** Let the model offer chips and links with `[[options: …]]` markers. */
  richMessages: z.boolean().default(true),
  stream: z.boolean().default(true),
});

export type CloudflareOptions = z.infer<typeof cloudflareOptionsSchema>;
export type CloudflareState = { turns: number };

async function systemPrompt(ctx: ConnectorContext<CloudflareOptions>, scope: PromptScope): Promise<string> {
  const base = (await resolvePrompt(ctx, ctx.options.instructions, scope)) ?? '';
  return ctx.options.richMessages ? [base, MARKER_INSTRUCTIONS].filter(Boolean).join('\n\n') : base;
}

function failure(thrown: unknown): ConnectorError {
  if (thrown instanceof ConnectorError) return thrown;
  const detail = thrown instanceof Error ? thrown.message.slice(0, 200) : 'unknown';
  if (thrown instanceof SseIdleTimeout) {
    return new ConnectorError('That took too long. Please try again.', { retryable: true, detail: 'ai_search_idle' });
  }
  return new ConnectorError('The assistant is busy right now. Please try again.', {
    retryable: true,
    detail: `ai_search_error:${detail}`,
  });
}

/** Pull the answer text out of a non-streamed completion. */
export function completionText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    // Older AI Search responses carried the answer as `response`.
    const response = (body as { response?: unknown }).response;
    return typeof response === 'string' ? response : '';
  }
  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * Read a streamed completion. The binding may hand back a `Response` or a
 * bare `ReadableStream` depending on runtime version; both are accepted.
 */
export async function readCompletionStream(raw: unknown, onText: (delta: string) => void): Promise<string> {
  const body =
    raw instanceof ReadableStream
      ? raw
      : raw && typeof raw === 'object' && 'body' in raw && (raw as Response).body instanceof ReadableStream
        ? (raw as Response).body!
        : null;
  if (!body) return completionText(raw);

  let text = '';
  await readSse(
    body as ReadableStream<Uint8Array>,
    ({ event, data }) => {
      if (event === 'chunks' || data === '[DONE]') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const choice = (parsed as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta) {
        text += delta;
        onText(delta);
      }
    },
    CONNECTOR_TIMEOUT_MS,
  );
  return text;
}

async function respond(
  ctx: ConnectorContext<CloudflareOptions>,
  input: string,
  scope: PromptScope,
): Promise<Message[]> {
  const options = ctx.options;
  const instance = aiSearchClient(ctx, options);
  const [history, system] = await Promise.all([loadHistory(ctx), systemPrompt(ctx, scope)]);

  const messages: AiSearchMessage[] = [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    ...history,
    { role: 'user', content: input },
  ];
  const request = {
    messages,
    ...(options.model ? { model: options.model } : {}),
    ai_search_options: {
      retrieval: { max_num_results: options.maxResults },
      query_rewrite: { enabled: options.rewriteQuery },
    },
  };

  let answer: string;
  try {
    if (ctx.onText) {
      const filter = markerFilter(ctx.onText);
      answer = await readCompletionStream(
        await instance.chatCompletions({ ...request, stream: true }),
        (delta) => filter.push(delta),
      );
      filter.flush();
    } else {
      answer = completionText(await instance.chatCompletions(request));
    }
  } catch (thrown) {
    throw failure(thrown);
  }

  const parsed = options.richMessages ? parseMarkers(answer) : { text: answer, messages: [] };
  const reply = withoutDocumentLinks([textMessage(parsed.text), ...parsed.messages].filter((m): m is Message => m !== null));

  const turns: Turn[] = [
    { role: 'user', content: input },
    { role: 'assistant', content: summarizeReply(reply) },
  ];
  await appendHistory(ctx, history, turns);
  return reply;
}

function contentFor(input: SendRequest): string {
  return input.kind === 'text' ? input.text : input.value;
}

const cloudflare: Connector<CloudflareOptions, CloudflareState> = {
  type: 'cloudflare',
  optionsSchema: cloudflareOptionsSchema,
  capabilities: { poll: false, end: false },
  streams: (options) => options.stream,
  promptOption: () => 'instructions',

  async start(ctx, input) {
    const scope: PromptScope = { lead: input.lead, context: input.context, site: { id: ctx.siteId } };
    await saveScope(ctx, scope);
    if (!input.firstMessage) return { state: { turns: 0 }, messages: [] };
    const messages = await respond(ctx, input.firstMessage, scope);
    ctx.log('cloudflare.started');
    return { state: { turns: 1 }, messages };
  },

  async send(ctx, state, input) {
    const messages = await respond(ctx, contentFor(input), await loadScope(ctx));
    return { state: { turns: state.turns + 1 }, messages };
  },
};

export const cloudflareConnector = defineConnector(cloudflare);
export default cloudflareConnector;
