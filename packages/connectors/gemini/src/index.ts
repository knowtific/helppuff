import { z } from 'zod';
import type { LinkItem, Message, SendRequest } from '@murmur/protocol';
import {
  ConnectorError,
  RICH_TOOL_SCHEMAS,
  defineConnector,
  fetchWithTimeout,
  message,
  promptSourceSchema,
  readJson,
  readJsonEvents,
  resolvePrompt,
  textMessage,
  toolCallToMessage,
  type Connector,
  type ConnectorContext,
  type PromptScope,
} from '@murmur/connector-types';

/**
 * Gemini, with File Search as the retrieval layer — the RAG option.
 *
 * Verified against ai.google.dev on 2026-09-22:
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   header x-goog-api-key
 *   { model, input, system_instruction?, tools?, previous_interaction_id?,
 *     store?, generation_config? }
 *   -> { id, object: "interaction", status, steps: [...], usage }
 *
 * File Search is a tool rather than a separate call:
 *   tools: [{ type: "file_search", file_search_store_names: [...] }]
 *
 * Google does the chunking, embedding and retrieval; the store is built
 * ahead of time (see this package's README) and the connector only queries
 * it. Multi-turn rides on `previous_interaction_id`, so state is one id.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const secretOrString = z.union([z.string().min(1), z.object({ env: z.string().min(1) })]);

export const geminiOptionsSchema = z.object({
  apiKey: secretOrString,
  model: z.string().min(1).default('gemini-3-flash'),
  /**
   * The File Search stores to ground answers in, as returned by
   * `POST /v1beta/fileSearchStores` — for example
   * `fileSearchStores/my-store-abc123`. Leave empty for a plain
   * conversational agent with no retrieval.
   */
  fileSearchStores: z.array(z.string().min(1)).max(10).default([]),
  /** Narrow retrieval by the custom metadata attached at upload time. */
  metadataFilter: z.string().max(500).optional(),
  /**
   * The system prompt. Gemini has no stored-prompt object, so this is where
   * `{ kv }` earns its keep: the text is edited live, per site, with no
   * redeploy. See `docs/prompts.md`.
   */
  systemInstruction: promptSourceSchema.optional(),
  richMessages: z.boolean().default(true),
  /** Render the documents an answer came from as a `links` message. */
  showCitations: z.boolean().default(true),
  maxOutputTokens: z.number().int().min(16).max(32_000).default(800),
  store: z.boolean().default(true),
  /**
   * Stream replies to the visitor as they are written. Only the answer text
   * streams: thinking is never shown, and the typing indicator stays up until
   * the answer begins. Citations still arrive, once the answer is complete.
   */
  stream: z.boolean().default(false),
  baseUrl: z.string().url().default(BASE_URL),
});

export type GeminiOptions = z.infer<typeof geminiOptionsSchema>;
export type GeminiState = { interactionId: string | null };

function apiKey(options: GeminiOptions): string {
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
      detail: `gemini_${operation}_${response.status}:${body.slice(0, 200)}`,
    },
  );
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Pull the documents an answer cited, so the visitor can see what it was
 * grounded in. Annotations hang off text content as `file_citation`, one per
 * passage — the same document usually appears several times, so they are
 * collapsed by name.
 */
export function collectCitations(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  const names = new Set<string>();

  for (const step of steps) {
    const row = asRecord(step);
    if (!row || row['type'] !== 'model_output') continue;
    const content = Array.isArray(row['content']) ? row['content'] : [];

    for (const part of content) {
      const partRow = asRecord(part);
      const annotations = partRow && Array.isArray(partRow['annotations']) ? partRow['annotations'] : [];
      for (const annotation of annotations) {
        const note = asRecord(annotation);
        if (!note || note['type'] !== 'file_citation') continue;
        const name = note['file_name'];
        if (typeof name === 'string' && name.trim()) names.add(name.trim());
      }
    }
  }

  return [...names].slice(0, 10);
}

/**
 * Map the `steps` array to protocol messages.
 *
 * `model_output` carries the prose, `function_call` carries a rich message,
 * and `user_input` is the echo of what we just sent.
 */
export function mapGeminiSteps(steps: unknown): Message[] {
  if (!Array.isArray(steps)) return [];
  const out: Message[] = [];

  for (const step of steps) {
    const row = asRecord(step);
    if (!row) continue;

    if (row['type'] === 'model_output') {
      const content = Array.isArray(row['content']) ? row['content'] : [];
      const text = content
        .map((part) => {
          const partRow = asRecord(part);
          return partRow && partRow['type'] === 'text' ? String(partRow['text'] ?? '') : '';
        })
        .join('')
        .trim();
      const built = textMessage(text);
      if (built) out.push(built);
      continue;
    }

    if (row['type'] === 'function_call' && typeof row['name'] === 'string') {
      // Gemini returns `arguments` as an object, unlike Retell and OpenAI.
      const built = toolCallToMessage(row['name'], row['arguments']);
      if (built) out.push(built);
    }
  }

  return out;
}

/**
 * Citations become a `links` message when the document name looks like a
 * URL, and a plain notice otherwise — a file called `pricing-2026.pdf` is
 * worth naming, but it is not somewhere the visitor can be sent.
 */
function citationMessage(names: string[]): Message | null {
  if (names.length === 0) return null;

  const links: LinkItem[] = [];
  const plain: string[] = [];
  for (const name of names) {
    try {
      const { protocol } = new URL(name);
      if (protocol === 'https:' || protocol === 'http:') {
        links.push({ label: name, url: name });
        continue;
      }
    } catch {
      // Not a URL.
    }
    plain.push(name);
  }

  if (links.length > 0) return message({ type: 'links', title: 'Sources', links });
  return message(
    { type: 'notice', text: `Based on: ${plain.join(', ')}`, tone: 'info' },
    { role: 'system' },
  );
}

type InteractionBody = { id?: unknown; status?: unknown; steps?: unknown };

type StreamedStep = { type: unknown; name?: unknown; arguments?: unknown; text: string; args: string };

/**
 * Read a streamed interaction, forwarding the answer text as it arrives.
 *
 * Steps stream as `step.start`, `step.delta` and `step.stop`, keyed by
 * `index`. Text is forwarded only from a `model_output` step: `thought`
 * steps and `thought_summary` deltas are the model thinking, and never reach
 * the visitor. Function-call arguments arrive in pieces and are reassembled.
 *
 * `interaction.completed` carries no steps, so they are rebuilt here into the
 * non-streamed shape and mapped exactly as a non-streamed reply would be.
 */
export async function readGeminiStream(response: Response, onText: (delta: string) => void): Promise<InteractionBody> {
  const steps: StreamedStep[] = [];
  let id: unknown;
  let status: unknown;
  let completed = false;
  let lastIndex: number | null = null;

  await readJsonEvents(response, (event, name) => {
    const index = typeof event['index'] === 'number' ? event['index'] : -1;
    const kind = event['event_type'] ?? event['type'] ?? name;
    switch (kind) {
      case 'interaction.created':
      case 'interaction.completed': {
        const interaction = asRecord(event['interaction']);
        if (interaction?.['id'] !== undefined) id = interaction['id'];
        if (interaction?.['status'] !== undefined) status = interaction['status'];
        if (kind === 'interaction.completed') completed = true;
        return;
      }
      case 'step.start': {
        const step = asRecord(event['step']);
        if (step && index >= 0) {
          steps[index] = { type: step['type'], name: step['name'], arguments: step['arguments'], text: '', args: '' };
        }
        return;
      }
      case 'step.delta': {
        const step = steps[index];
        const delta = asRecord(event['delta']);
        if (!step || !delta) return;
        if (delta['type'] === 'text' && step.type === 'model_output' && typeof delta['text'] === 'string') {
          if (!delta['text']) return;
          // A second output step becomes a second message; keep them apart.
          if (lastIndex !== null && lastIndex !== index) onText('\n\n');
          lastIndex = index;
          step.text += delta['text'];
          onText(delta['text']);
        } else if (delta['type'] === 'arguments_delta' && typeof delta['arguments'] === 'string') {
          step.args += delta['arguments'];
        }
        // Anything else — thought summaries, signatures, images — is not shown.
        return;
      }
      case 'error': {
        const error = asRecord(event['error']);
        throw new ConnectorError('The assistant could not answer that. Please try again.', {
          retryable: true,
          detail: `gemini_stream_error:${String(error?.['code'] ?? 'unknown')}`,
        });
      }
      default:
        return;
    }
  });

  if (!completed) {
    throw new ConnectorError('The assistant stopped before finishing. Please try again.', {
      retryable: true,
      detail: 'gemini_stream_truncated',
    });
  }

  return {
    id,
    status,
    steps: steps
      .filter((step): step is StreamedStep => step !== undefined)
      .map((step) =>
        step.type === 'model_output'
          ? { type: 'model_output', content: [{ type: 'text', text: step.text }] }
          : step.type === 'function_call'
            ? { type: 'function_call', name: step.name, arguments: step.args || step.arguments }
            : { type: step.type },
      ),
  };
}

/**
 * The full steps of a stored interaction, for its citations. Best effort: a
 * missing source list is not worth failing an answer the visitor already has.
 */
async function storedSteps(ctx: ConnectorContext<GeminiOptions>, id: string): Promise<unknown> {
  try {
    const response = await fetchWithTimeout(
      ctx.fetch,
      `${ctx.options.baseUrl}/interactions/${encodeURIComponent(id)}`,
      { method: 'GET', headers: { 'x-goog-api-key': apiKey(ctx.options) } },
    );
    if (!response.ok) return [];
    const body = await readJson<InteractionBody>(response);
    return body.steps;
  } catch {
    ctx.log('gemini.citations_unavailable');
    return [];
  }
}

function toolsFor(options: GeminiOptions): unknown[] | undefined {
  const tools: unknown[] = [];

  if (options.fileSearchStores.length > 0) {
    tools.push({
      type: 'file_search',
      file_search_store_names: options.fileSearchStores,
      ...(options.metadataFilter ? { metadata_filter: options.metadataFilter } : {}),
    });
  }

  if (options.richMessages) {
    for (const schema of Object.values(RICH_TOOL_SCHEMAS)) {
      tools.push({
        type: 'function',
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
      });
    }
  }

  return tools.length > 0 ? tools : undefined;
}

async function interact(
  ctx: ConnectorContext<GeminiOptions>,
  input: string,
  previousInteractionId: string | null,
  scope: PromptScope,
): Promise<{ id: string | null; messages: Message[] }> {
  const options = ctx.options;
  const system = await resolvePrompt(ctx, options.systemInstruction, scope);

  const response = await fetchWithTimeout(ctx.fetch, `${options.baseUrl}/interactions`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(options), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      input,
      ...(system ? { system_instruction: system } : {}),
      ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
      ...(() => {
        const tools = toolsFor(options);
        return tools ? { tools } : {};
      })(),
      generation_config: { max_output_tokens: options.maxOutputTokens },
      store: options.store,
      ...(ctx.onText ? { stream: true } : {}),
    }),
  });
  if (!response.ok) await fail(response, 'interactions');

  const body = ctx.onText
    ? await readGeminiStream(response, ctx.onText)
    : await readJson<InteractionBody>(response);

  if (body.status === 'failed') {
    throw new ConnectorError('The assistant could not answer that. Please try again.', {
      retryable: true,
      detail: 'gemini_status_failed',
    });
  }

  const messages = mapGeminiSteps(body.steps);
  if (options.showCitations) {
    // Annotations are not part of a stream; a stored interaction has them.
    const steps =
      ctx.onText && options.fileSearchStores.length > 0 && options.store && typeof body.id === 'string'
        ? await storedSteps(ctx, body.id)
        : body.steps;
    const citations = citationMessage(collectCitations(steps));
    if (citations) messages.push(citations);
  }

  return { id: typeof body.id === 'string' ? body.id : null, messages };
}

function contentFor(input: SendRequest): string {
  return input.kind === 'text' ? input.text : input.value;
}

const gemini: Connector<GeminiOptions, GeminiState> = {
  type: 'gemini',
  optionsSchema: geminiOptionsSchema,
  capabilities: { poll: false, end: false },
  streams: (options) => options.stream,
  promptOption: () => 'systemInstruction',

  async start(ctx, input) {
    if (!input.firstMessage) return { state: { interactionId: null }, messages: [] };
    const result = await interact(ctx, input.firstMessage, null, {
      lead: input.lead,
      context: input.context,
      site: { id: ctx.siteId },
    });
    ctx.log('gemini.started');
    return { state: { interactionId: result.id }, messages: result.messages };
  },

  async send(ctx, state, input) {
    const result = await interact(ctx, contentFor(input), state.interactionId, { site: { id: ctx.siteId } });
    // Chaining only works for a stored interaction.
    return {
      state: { interactionId: ctx.options.store ? result.id : null },
      messages: result.messages,
    };
  },
};

export const geminiConnector = defineConnector(gemini);
export default geminiConnector;
