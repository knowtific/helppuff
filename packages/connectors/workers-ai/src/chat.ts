import { readSse } from '@murmur/protocol';
import { CONNECTOR_TIMEOUT_MS } from '@murmur/connector-types';
import type { AiLike } from '@murmur/rag';

/**
 * One chat completion through the Workers AI binding.
 *
 * Verified against the account's model catalog (2026-10-04): GLM-4.7-Flash
 * and gpt-oss take OpenAI-style `messages` + `tools` and answer with
 * `choices[0].message.{content, tool_calls}` and `usage`; streamed, they
 * send SSE frames of `choices[0].delta`. Older catalog models answer
 * `{ response, tool_calls }` and stream `{ response }` frames — both shapes
 * are read, so swapping the model in config never needs a code change.
 */

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ToolCall = { id: string; name: string; arguments: string };

export type Completion = { content: string; toolCalls: ToolCall[]; usage: { input: number; output: number } | null };

export type CompleteOptions = {
  maxTokens: number;
  tools?: ToolDef[];
  gateway?: string | undefined;
  onText?: ((delta: string) => void) | undefined;
  temperature?: number;
};

/** GLM models think out loud by default; that costs output neurons and time a support answer does not need. */
const templateKwargs = (model: string) => (/glm/i.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {});

export async function complete(ai: AiLike, model: string, messages: ChatMessage[], options: CompleteOptions): Promise<Completion> {
  const stream = Boolean(options.onText);
  const inputs: Record<string, unknown> = {
    messages,
    max_tokens: options.maxTokens,
    temperature: options.temperature ?? 0.3,
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...templateKwargs(model),
  };
  const raw = await ai.run(model, inputs, options.gateway ? { gateway: { id: options.gateway } } : undefined);
  const body = streamOf(raw);
  if (body) return readStream(body, options.onText ?? (() => {}));
  return readCompletion(raw);
}

function streamOf(raw: unknown): ReadableStream<Uint8Array> | null {
  if (raw instanceof ReadableStream) return raw as ReadableStream<Uint8Array>;
  if (raw && typeof raw === 'object' && 'body' in raw && (raw as Response).body instanceof ReadableStream) return (raw as Response).body;
  return null;
}

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

function usageOf(value: unknown): Completion['usage'] {
  if (!value || typeof value !== 'object') return null;
  const u = value as { prompt_tokens?: unknown; completion_tokens?: unknown };
  return typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number' ? { input: u.prompt_tokens, output: u.completion_tokens } : null;
}

function callsOf(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((call, i): ToolCall | null => {
      if (!call || typeof call !== 'object') return null;
      const c = call as { id?: unknown; name?: unknown; arguments?: unknown; function?: { name?: unknown; arguments?: unknown } };
      const name = asString(c.function?.name ?? c.name);
      if (!name) return null;
      const args = c.function?.arguments ?? c.arguments;
      return { id: asString(c.id) || `call_${i}`, name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) };
    })
    .filter((c): c is ToolCall => c !== null);
}

export function readCompletion(raw: unknown): Completion {
  if (!raw || typeof raw !== 'object') return { content: '', toolCalls: [], usage: null };
  const body = raw as { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[]; response?: unknown; tool_calls?: unknown; usage?: unknown };
  const message = body.choices?.[0]?.message;
  if (message) return { content: asString(message.content), toolCalls: callsOf(message.tool_calls), usage: usageOf(body.usage) };
  return { content: asString(body.response), toolCalls: callsOf(body.tool_calls), usage: usageOf(body.usage) };
}

export async function readStream(body: ReadableStream<Uint8Array>, onText: (delta: string) => void): Promise<Completion> {
  let content = '';
  let usage: Completion['usage'] = null;
  const partial = new Map<number, { id: string; name: string; arguments: string }>();
  let whole: ToolCall[] = [];

  await readSse(
    body,
    ({ data }) => {
      if (data === '[DONE]') return;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return;
      }
      usage = usageOf(frame['usage']) ?? usage;
      const choice = (frame['choices'] as { delta?: Record<string, unknown> }[] | undefined)?.[0];
      const delta = choice?.delta;
      const text = delta ? asString(delta['content']) : asString(frame['response']);
      if (text) {
        content += text;
        onText(text);
      }
      const deltaCalls = delta?.['tool_calls'];
      if (Array.isArray(deltaCalls)) {
        for (const [n, piece] of deltaCalls.entries()) {
          const p = piece as { index?: number; id?: string; function?: { name?: string; arguments?: string } };
          const index = typeof p.index === 'number' ? p.index : n;
          const entry = partial.get(index) ?? { id: '', name: '', arguments: '' };
          if (p.id) entry.id = p.id;
          if (p.function?.name) entry.name += p.function.name;
          if (p.function?.arguments) entry.arguments += p.function.arguments;
          partial.set(index, entry);
        }
      }
      // Legacy models send their calls whole, in one frame.
      if (Array.isArray(frame['tool_calls'])) whole = callsOf(frame['tool_calls']);
    },
    CONNECTOR_TIMEOUT_MS,
  );

  const streamed = [...partial.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, c]) => c.name)
    .map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.arguments || '{}' }));
  return { content, toolCalls: streamed.length ? streamed : whole, usage };
}

/** Workers AI refusing because the free daily allocation (or the account's limit) is used up. */
export function isQuotaError(thrown: unknown): boolean {
  const text = String((thrown as Error)?.message ?? thrown);
  return /\b(4006|3036)\b|daily free allocation|neurons|exceeded.*(quota|limit)/i.test(text);
}
