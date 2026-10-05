import { z } from 'zod';
import { readSse, type Message, type SendRequest, type StartSessionRequest } from '@murmur/protocol';
import {
  CONNECTOR_TIMEOUT_MS,
  ConnectorError,
  appendHistory,
  defineConnector,
  fetchWithTimeout,
  loadHistory,
  loadScope,
  messageId,
  promptSourceSchema,
  readJson,
  readJsonEvents,
  resolvePrompt,
  saveScope,
  summarizeReply,
  textMessage,
  type Connector,
  type ConnectorContext,
  type PromptScope,
} from '@murmur/connector-types';

/**
 * Your own backend. Two shapes, picked by `mode`:
 *
 * **`murmur`** — your service speaks a two-endpoint version of the protocol,
 * and owns everything AI-shaped (prompt, retrieval, model, tools):
 *
 *   POST {url}/start    { siteId, sessionId, lead?, context, firstMessage? }
 *   POST {url}/message  { siteId, sessionId, state, input }
 *     -> { messages?: Message[], text?: string, state?: unknown }
 *
 * `text` is shorthand for one text message; messages may omit `id`, `ts`
 * and `role`. Ask for a stream with `stream: true` and the request carries
 * `Accept: text/event-stream`; answer with SSE —
 *   event: delta  data: { "text": "…" }       (repeat)
 *   event: done   data: { "messages": [...], "state": … }
 * — or with plain JSON. Either is accepted, whatever was asked for.
 *
 * **`openai`** — any OpenAI-compatible Chat Completions endpoint (vLLM,
 * Ollama, LiteLLM, OpenRouter, DeepSeek, a gateway of your own). History is
 * kept in KV; `instructions` becomes the system message.
 *
 * With `signingSecret`, every request is signed so your service can check
 * it came from this Worker:
 *   X-Murmur-Timestamp: <unix seconds>
 *   X-Murmur-Signature: sha256=<hex HMAC-SHA256 of `${timestamp}.${body}`>
 */

const secretOrString = z.union([z.string().min(1), z.object({ env: z.string().min(1) })]);

export const httpOptionsSchema = z.object({
  url: z.string().url(),
  mode: z.enum(['murmur', 'openai']).default('murmur'),
  /** Extra headers, e.g. `{ Authorization: { env: 'BACKEND_TOKEN' } }` resolved to a string. */
  headers: z.record(z.string().min(1).max(100), secretOrString).default({}),
  /** Sent as `Authorization: Bearer …`, in either mode. */
  apiKey: secretOrString.optional(),
  /** `openai` mode: the model name your endpoint expects. */
  model: z.string().min(1).max(200).optional(),
  /** `openai` mode: the system prompt. */
  instructions: promptSourceSchema.optional(),
  signingSecret: secretOrString.optional(),
  stream: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(60_000).default(CONNECTOR_TIMEOUT_MS),
});

export type HttpOptions = z.infer<typeof httpOptionsSchema>;
/** In `murmur` mode, whatever your backend returned; opaque and under 1 kb. */
export type HttpState = { backend?: unknown };

function resolved(value: string | { env: string }, what: string): string {
  if (typeof value === 'string') return value;
  throw new ConnectorError('The assistant is not configured correctly.', {
    retryable: false,
    detail: `unresolved_secret:${what}:${value.env}`,
  });
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Header value for a signed request — exported so a backend's tests can build one. */
export async function signBody(secret: string, body: string, timestamp: number): Promise<string> {
  return `sha256=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

async function headersFor(options: HttpOptions, body: string, stream: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: stream ? 'text/event-stream, application/json' : 'application/json',
    'User-Agent': 'Murmur/1 (+https://github.com/murmur)',
  };
  for (const [name, value] of Object.entries(options.headers)) headers[name] = resolved(value, name);
  if (options.apiKey) {
    headers['Authorization'] = `Bearer ${resolved(options.apiKey, 'apiKey')}`;
  }
  if (options.signingSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    headers['X-Murmur-Timestamp'] = String(timestamp);
    headers['X-Murmur-Signature'] = await signBody(resolved(options.signingSecret, 'signingSecret'), body, timestamp);
  }
  return headers;
}

async function fail(response: Response): Promise<never> {
  const body = await response.text().catch(() => '');
  const retryable = response.status >= 500 || response.status === 429;
  throw new ConnectorError(
    retryable ? 'The assistant is busy right now. Please try again.' : 'The assistant is unavailable right now.',
    { retryable, detail: `http_${response.status}:${body.slice(0, 200)}` },
  );
}

function isStream(response: Response): boolean {
  return (response.headers.get('Content-Type') ?? '').includes('text/event-stream');
}

/**
 * Fill in what a backend is allowed to leave out. The server's sanitizer
 * validates every message afterwards, so anything still malformed is
 * dropped there rather than reaching the widget.
 */
export function normalizeBackendReply(raw: unknown): { messages: Message[]; state?: unknown } {
  if (typeof raw !== 'object' || raw === null) return { messages: [] };
  const body = raw as { messages?: unknown; text?: unknown; state?: unknown };
  const messages: Message[] = [];

  if (typeof body.text === 'string') {
    const built = textMessage(body.text);
    if (built) messages.push(built);
  }
  if (Array.isArray(body.messages)) {
    for (const entry of body.messages) {
      if (typeof entry !== 'object' || entry === null) continue;
      const row = entry as Record<string, unknown>;
      if (typeof row['type'] !== 'string') continue;
      messages.push({
        ...row,
        id: typeof row['id'] === 'string' ? row['id'] : messageId('h'),
        ts: typeof row['ts'] === 'number' ? row['ts'] : Date.now(),
        role: row['role'] === 'user' || row['role'] === 'system' ? row['role'] : 'agent',
      } as Message);
    }
  }
  return { messages, ...(body.state === undefined ? {} : { state: body.state }) };
}

async function readMurmurStream(response: Response, onText: (delta: string) => void): Promise<unknown> {
  let done: unknown = null;
  await readJsonEvents(response, (data, event) => {
    if (event === 'delta' && typeof data['text'] === 'string') onText(data['text']);
    else if (event === 'done') done = data;
    else if (event === 'error') {
      throw new ConnectorError('The assistant could not answer that. Please try again.', {
        retryable: true,
        detail: `http_stream_error:${String(data['message'] ?? data['code'] ?? 'unknown').slice(0, 100)}`,
      });
    }
  });
  if (!done) {
    throw new ConnectorError('The assistant stopped before finishing. Please try again.', {
      retryable: true,
      detail: 'http_stream_truncated',
    });
  }
  return done;
}

async function callMurmur(
  ctx: ConnectorContext<HttpOptions>,
  path: 'start' | 'message',
  payload: object,
): Promise<{ messages: Message[]; state?: unknown }> {
  const options = ctx.options;
  const body = JSON.stringify(payload);
  const streaming = Boolean(ctx.onText);
  const response = await fetchWithTimeout(
    ctx.fetch,
    `${options.url.replace(/\/$/, '')}/${path}`,
    { method: 'POST', headers: await headersFor(options, body, streaming), body },
    options.timeoutMs,
  );
  if (!response.ok) await fail(response);

  const raw = isStream(response)
    ? await readMurmurStream(response, (delta) => ctx.onText?.(delta))
    : await readJson(response);
  return normalizeBackendReply(raw);
}

/** `openai` mode: one Chat Completions call with the stored history. */
async function callOpenAi(ctx: ConnectorContext<HttpOptions>, input: string, scope: PromptScope | Promise<PromptScope>): Promise<Message[]> {
  const options = ctx.options;
  const [history, system] = await Promise.all([loadHistory(ctx), Promise.resolve(scope).then((s) => resolvePrompt(ctx, options.instructions, s))]);
  const streaming = Boolean(ctx.onText);

  const body = JSON.stringify({
    ...(options.model ? { model: options.model } : {}),
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...history,
      { role: 'user', content: input },
    ],
    ...(streaming ? { stream: true } : {}),
  });
  const base = options.url.replace(/\/$/, '');
  const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const response = await fetchWithTimeout(
    ctx.fetch,
    endpoint,
    { method: 'POST', headers: await headersFor(options, body, streaming), body },
    options.timeoutMs,
  );
  if (!response.ok) await fail(response);

  let answer = '';
  if (isStream(response) && response.body) {
    await readSse(
      response.body,
      ({ data }) => {
        if (data === '[DONE]') return;
        try {
          const delta = (JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0]?.delta
            ?.content;
          if (typeof delta === 'string' && delta) {
            answer += delta;
            ctx.onText?.(delta);
          }
        } catch {
          // A keep-alive or a frame we do not understand.
        }
      },
      options.timeoutMs,
    );
  } else {
    const parsed = await readJson<{ choices?: { message?: { content?: unknown } }[] }>(response);
    const content = parsed.choices?.[0]?.message?.content;
    answer = typeof content === 'string' ? content : '';
  }

  const reply = [textMessage(answer)].filter((m): m is Message => m !== null);
  appendHistory(ctx, history, [
    { role: 'user', content: input },
    { role: 'assistant', content: summarizeReply(reply) },
  ]);
  return reply;
}

function inputFor(input: SendRequest): string {
  return input.kind === 'text' ? input.text : input.value;
}

function startPayload(ctx: ConnectorContext<HttpOptions>, input: StartSessionRequest): object {
  return {
    siteId: ctx.siteId,
    sessionId: ctx.sessionId,
    ...(input.lead ? { lead: input.lead } : {}),
    context: input.context,
    ...(input.firstMessage ? { firstMessage: input.firstMessage } : {}),
  };
}

const http: Connector<HttpOptions, HttpState> = {
  type: 'http',
  optionsSchema: httpOptionsSchema,
  capabilities: { poll: false, end: false },
  streams: (options) => options.stream,
  // In `murmur` mode the owner's API builds its own prompt.
  promptOption: (options) => (options.mode === 'openai' ? 'instructions' : null),

  async start(ctx, input) {
    if (ctx.options.mode === 'openai') {
      const scope: PromptScope = { lead: input.lead, context: input.context, site: { id: ctx.siteId } };
      saveScope(ctx, scope);
      const messages = input.firstMessage ? await callOpenAi(ctx, input.firstMessage, scope) : [];
      return { state: {}, messages };
    }
    const result = await callMurmur(ctx, 'start', startPayload(ctx, input));
    return { state: result.state === undefined ? {} : { backend: result.state }, messages: result.messages };
  },

  async send(ctx, state, input) {
    if (ctx.options.mode === 'openai') {
      return { messages: await callOpenAi(ctx, inputFor(input), loadScope(ctx)) };
    }
    const result = await callMurmur(ctx, 'message', {
      siteId: ctx.siteId,
      sessionId: ctx.sessionId,
      state: state.backend ?? null,
      input,
    });
    return {
      ...(result.state === undefined ? {} : { state: { backend: result.state } }),
      messages: result.messages,
    };
  },
};

export const httpConnector = defineConnector(http);
export default httpConnector;
