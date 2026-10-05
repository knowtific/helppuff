import { z } from 'zod';
import { ground } from '@murmur/rag';
import type { Message, SendRequest } from '@murmur/protocol';
import {
  ConnectorError,
  RICH_TOOL_SCHEMAS,
  defineConnector,
  fetchWithTimeout,
  message,
  promptSourceSchema,
  readJsonEvents,
  promptVariables,
  readJson,
  resolvePrompt,
  textMessage,
  toolCallToMessage,
  type Connector,
  type ConnectorContext,
  type PromptScope,
} from '@murmur/connector-types';

/**
 * The OpenAI Responses API.
 *
 * Verified against the official OpenAPI spec (openai/openai-openapi) on
 * 2026-09-22:
 *   POST https://api.openai.com/v1/responses
 *   { model, input, instructions?, tools?, tool_choice?,
 *     previous_response_id?, store?, max_output_tokens?, temperature? }
 *   -> { id, status, output: OutputItem[], error?, usage }
 *
 * Two details that shape this connector:
 *
 *  - `previous_response_id` carries the conversation, so state is one id and
 *    no history has to be kept in KV or in the session token. It requires
 *    `store: true`, which is the default here and can be turned off for a
 *    deployment that would rather not have OpenAI retain the thread — at the
 *    cost of the model losing the conversation.
 *  - `output_text` is an SDK-only convenience and is *not* in the HTTP
 *    response, so the text is aggregated from `output[]` here.
 */

const BASE_URL = 'https://api.openai.com/v1';

const secretOrString = z.union([z.string().min(1), z.object({ env: z.string().min(1) })]);

export const openaiOptionsSchema = z.object({
  apiKey: secretOrString,
  model: z.string().min(1).default('gpt-5'),
  /**
   * The system prompt. A string, or `{ env }` / `{ kv }` / `{ url }` so the
   * text lives outside this repository — see `wiki/Prompts-and-Instructions.md`.
   */
  instructions: promptSourceSchema.optional(),
  /**
   * Better still: reference a prompt stored in OpenAI's dashboard, which
   * carries its own versioning. Takes precedence over `instructions`, and
   * receives the same variables.
   */
  promptRef: z
    .object({ id: z.string().min(1), version: z.string().min(1).optional() })
    .optional(),
  /**
   * Declare `show_options` / `show_card` / `show_links` so the model can
   * return chips, cards and link lists instead of prose.
   */
  richMessages: z.boolean().default(true),
  /**
   * OpenAI vector stores to answer from, through the hosted `file_search`
   * tool. `murmur knowledge sync` creates and fills one.
   */
  vectorStoreIds: z.array(z.string().min(1)).max(2).default([]),
  /**
   * `murmur`: answer from Murmur's own knowledge base (Vectorize + D1 on the
   * site's Cloudflare account, crawled by the Worker) instead of a vector store.
   */
  retrieval: z.literal('murmur').optional(),
  /** Extra function tools, forwarded verbatim. */
  tools: z.array(z.record(z.string(), z.unknown())).max(16).optional(),
  maxOutputTokens: z.number().int().min(16).max(32_000).default(800),
  temperature: z.number().min(0).max(2).optional(),
  /** Off means OpenAI retains nothing — and the model forgets each turn. */
  store: z.boolean().default(true),
  /**
   * Stream replies to the visitor as they are written, instead of all at
   * once. Only the answer text streams: a reasoning model's thinking is never
   * shown, and the typing indicator stays up until the answer begins.
   */
  stream: z.boolean().default(false),
  /** Any OpenAI-compatible endpoint: Azure, OpenRouter, a local model. */
  baseUrl: z.string().url().default(BASE_URL),
});

export type OpenAiOptions = z.infer<typeof openaiOptionsSchema>;
export type OpenAiState = { responseId: string | null };

function apiKey(options: OpenAiOptions): string {
  if (typeof options.apiKey === 'string') return options.apiKey;
  throw new ConnectorError('The assistant is not configured correctly.', {
    retryable: false,
    detail: `unresolved_secret:${options.apiKey.env}`,
  });
}

async function fail(response: Response, operation: string): Promise<never> {
  const body = await response.text().catch(() => '');
  const retryable = response.status >= 500 || response.status === 429;
  throw new ConnectorError(
    retryable
      ? 'The assistant is busy right now. Please try again.'
      : 'The assistant is unavailable right now.',
    {
      retryable,
      ...(response.status === 429 ? { retryAfter: 20 } : {}),
      detail: `openai_${operation}_${response.status}:${body.slice(0, 200)}`,
    },
  );
}

/**
 * Map the `output` array to protocol messages.
 *
 * Items are a union: `message` carries the prose, `function_call` carries a
 * rich message, and the rest (reasoning, file search calls, web search
 * calls) are internal steps with nothing to show a visitor.
 */
export function mapOpenAiOutput(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  const out: Message[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;

    if (item['type'] === 'message') {
      const content = Array.isArray(item['content']) ? item['content'] : [];
      const text = content
        .map((part) =>
          typeof part === 'object' && part !== null && (part as Record<string, unknown>)['type'] === 'output_text'
            ? String((part as Record<string, unknown>)['text'] ?? '')
            : '',
        )
        .join('')
        .trim();
      const built = textMessage(text);
      if (built) out.push(built);
      continue;
    }

    if (item['type'] === 'function_call' && typeof item['name'] === 'string') {
      // `arguments` is documented as a JSON string.
      const built = toolCallToMessage(item['name'], item['arguments']);
      if (built) out.push(built);
    }
  }

  return out;
}

type ResponseBody = { id?: unknown; status?: unknown; error?: unknown; output?: unknown };

/**
 * Read a streamed response, forwarding the answer text as it arrives.
 *
 * Only `response.output_text.delta` reaches the visitor. Reasoning summaries,
 * refusals and tool-call arguments stream too, and are ignored — a card
 * arrives whole, with the final response. That final event
 * (`response.completed`, or `.incomplete` / `.failed`) carries the entire
 * response, which is then mapped exactly as a non-streamed one would be, so
 * what the visitor is left with never depends on the deltas.
 */
export async function readOpenAiStream(response: Response, onText: (delta: string) => void): Promise<ResponseBody> {
  let final: ResponseBody | null = null;
  let lastItem: unknown = null;
  let wrote = false;

  await readJsonEvents(response, (event) => {
    switch (event['type']) {
      case 'response.output_text.delta': {
        const delta = event['delta'];
        if (typeof delta !== 'string' || !delta) return;
        // A second message item becomes a second message; keep them apart.
        if (wrote && event['item_id'] !== lastItem) onText('\n\n');
        lastItem = event['item_id'];
        wrote = true;
        onText(delta);
        return;
      }
      case 'response.completed':
      case 'response.incomplete':
      case 'response.failed': {
        const body = event['response'];
        if (typeof body === 'object' && body !== null) final = body as ResponseBody;
        return;
      }
      case 'error':
        throw new ConnectorError('The assistant could not answer that. Please try again.', {
          retryable: true,
          detail: `openai_stream_error:${String(event['code'] ?? 'unknown')}`,
        });
      default:
        // Reasoning, tool arguments, lifecycle events: nothing for the visitor.
        return;
    }
  });

  if (!final) {
    throw new ConnectorError('The assistant stopped before finishing. Please try again.', {
      retryable: true,
      detail: 'openai_stream_truncated',
    });
  }
  return final;
}

function toolsFor(options: OpenAiOptions): unknown[] | undefined {
  const tools: unknown[] = [];
  if (options.richMessages) {
    // The Responses API takes function tools flattened, not nested under
    // `function` as Chat Completions does.
    for (const schema of Object.values(RICH_TOOL_SCHEMAS)) {
      tools.push({
        type: 'function',
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
      });
    }
  }
  if (options.vectorStoreIds.length > 0) {
    tools.push({ type: 'file_search', vector_store_ids: options.vectorStoreIds });
  }
  if (options.tools) tools.push(...options.tools);
  return tools.length > 0 ? tools : undefined;
}

async function respond(
  ctx: ConnectorContext<OpenAiOptions>,
  input: string,
  previousResponseId: string | null,
  scope: PromptScope,
): Promise<{ id: string | null; messages: Message[] }> {
  const options = ctx.options;
  // A stored prompt wins: it is versioned on OpenAI's side, so there is no
  // reason to also send text that would silently override it.
  const prompt = options.promptRef ? undefined : await resolvePrompt(ctx, options.instructions, scope);
  const grounding =
    options.retrieval === 'murmur' ? await ground(ctx.env, ctx.siteId, input, { log: ctx.log, waitUntil: ctx.waitUntil }) : null;
  // With a stored prompt, `instructions` would replace it; the passages ride with the input instead.
  const instructions = grounding && !options.promptRef ? [prompt, grounding.block].filter(Boolean).join('\n\n') : prompt;
  const sentInput = grounding && options.promptRef ? `${grounding.block}\n\nVisitor: ${input}` : input;

  const response = await fetchWithTimeout(ctx.fetch, `${options.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey(options)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      input: sentInput,
      ...(instructions ? { instructions } : {}),
      ...(options.promptRef
        ? {
            prompt: {
              id: options.promptRef.id,
              ...(options.promptRef.version ? { version: options.promptRef.version } : {}),
              variables: promptVariables(scope),
            },
          }
        : {}),
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      ...(() => {
        const tools = toolsFor(options);
        return tools ? { tools } : {};
      })(),
      max_output_tokens: options.maxOutputTokens,
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      store: options.store,
      ...(ctx.onText ? { stream: true } : {}),
    }),
  });
  if (!response.ok) await fail(response, 'responses');

  const body = ctx.onText
    ? await readOpenAiStream(response, ctx.onText)
    : await readJson<ResponseBody>(response);

  // A 200 can still carry a failure, and an incomplete response can carry
  // partial output worth showing.
  if (body.status === 'failed' || body.error) {
    throw new ConnectorError('The assistant could not answer that. Please try again.', {
      retryable: true,
      detail: `openai_status_${String(body.status)}`,
    });
  }

  const messages = mapOpenAiOutput(body.output);
  if (grounding?.sources.length) messages.push(message({ type: 'links', title: 'Sources', links: grounding.sources }));
  return { id: typeof body.id === 'string' ? body.id : null, messages };
}

function contentFor(input: SendRequest): string {
  return input.kind === 'text' ? input.text : input.value;
}

const openai: Connector<OpenAiOptions, OpenAiState> = {
  type: 'openai',
  optionsSchema: openaiOptionsSchema,
  capabilities: { poll: false, end: false },
  streams: (options) => options.stream,
  // A stored prompt is versioned in OpenAI's dashboard, not here.
  promptOption: (options) => (options.promptRef ? null : 'instructions'),

  async start(ctx, input) {
    if (!input.firstMessage) {
      // Nothing to ask yet; the greeting is the widget's own.
      return { state: { responseId: null }, messages: [] };
    }
    const result = await respond(ctx, input.firstMessage, null, {
      lead: input.lead,
      context: input.context,
      site: { id: ctx.siteId },
    });
    ctx.log('openai.started');
    return { state: { responseId: result.id }, messages: result.messages };
  },

  async send(ctx, state, input) {
    const result = await respond(ctx, contentFor(input), state.responseId, { site: { id: ctx.siteId } });
    // Only chain when the response was stored; otherwise each turn stands
    // alone and chaining would 404 on the next request.
    return {
      state: { responseId: ctx.options.store ? result.id : null },
      messages: result.messages,
    };
  },
};

export const openaiConnector = defineConnector(openai);
export default openaiConnector;
