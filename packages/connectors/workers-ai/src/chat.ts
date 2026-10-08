import { readSse } from '@helppuff/protocol';
import { CONNECTOR_TIMEOUT_MS } from '@helppuff/connector-types';
import { reasoningInputs, thinkingRoom, type AiLike, type Reasoning } from '@helppuff/rag';

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

export type { ChatMessage, ToolDef, ToolCall, Completion } from '@helppuff/connector-types';
import type { ChatMessage, ToolDef, ToolCall, Completion } from '@helppuff/connector-types';

export type CompleteOptions = {
  maxTokens: number;
  tools?: ToolDef[];
  gateway?: string | undefined;
  onText?: ((delta: string) => void) | undefined;
  temperature?: number;
  /** How long the model thinks first. Background and helper calls leave it `off`. */
  reasoning?: Reasoning;
};

export async function complete(ai: AiLike, model: string, messages: ChatMessage[], options: CompleteOptions): Promise<Completion> {
  const stream = Boolean(options.onText);
  const inputs: Record<string, unknown> = {
    messages,
    // Thinking tokens count against the cap: room for them, on top of the answer's own.
    max_tokens: options.maxTokens + thinkingRoom(model, options.reasoning ?? 'off'),
    temperature: options.temperature ?? 0.3,
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...reasoningInputs(model, options.reasoning ?? 'off'),
  };
  const raw = await ai.run(model, inputs, options.gateway ? { gateway: { id: options.gateway } } : undefined);
  const body = streamOf(raw);
  const names = (options.tools ?? []).map((t) => t.function.name);
  return withTextCalls(body ? await readStream(body, options.onText ?? (() => {})) : readCompletion(raw), names);
}

const TAG = '<tool_call>';

/**
 * Tool calls a model wrote into its text instead of the tool-call field:
 * GLM's `<tool_call>name<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>`
 * (or JSON inside the tags), a bare `{"name": …, "parameters": …}` object, or
 * `name(key="value")`. Calls to tools that were offered are made; the
 * markup never reaches the visitor either way.
 */
export function textCalls(content: string, toolNames: string[]): { content: string; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  const offered = new Set(toolNames);
  const add = (name: string, args: Record<string, unknown>) => {
    if (offered.has(name)) calls.push({ id: `text_${calls.length}`, name, arguments: JSON.stringify(args) });
  };
  let text = content.replace(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g, (_all, body: string) => {
    const inner = body.trim();
    if (inner.startsWith('{')) {
      try {
        const parsed = JSON.parse(inner) as { name?: unknown; arguments?: unknown; parameters?: unknown };
        if (typeof parsed.name === 'string') add(parsed.name, (parsed.arguments ?? parsed.parameters ?? {}) as Record<string, unknown>);
      } catch {
        // Unreadable: dropped.
      }
      return '';
    }
    const name = /^[\w-]+/.exec(inner)?.[0] ?? '';
    const args: Record<string, unknown> = {};
    for (const [, key, value] of inner.matchAll(/<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g)) args[key!.trim()] = value!.trim();
    if (name) add(name, args);
    return '';
  });
  for (const name of offered) {
    // `{"name": "request_callback", "parameters": {...}}`, fenced or bare.
    text = text.replace(new RegExp(`(?:\`\`\`(?:json)?\\s*)?\\{\\s*"name"\\s*:\\s*"${name}"[\\s\\S]*\\}(?:\\s*\`\`\`)?`, 'g'), (json) => {
      try {
        const parsed = JSON.parse(json.replace(/^```(?:json)?|```$/g, '').trim()) as { arguments?: unknown; parameters?: unknown };
        add(name, (parsed.arguments ?? parsed.parameters ?? {}) as Record<string, unknown>);
        return '';
      } catch {
        return json;
      }
    });
    // `[request_callback(name="Sam", phone="0400 111 222")]`
    text = text.replace(new RegExp(`\\[?\\b${name}\\(((?:\\s*\\w+\\s*=\\s*"[^"]*"\\s*,?)*)\\)\\]?`, 'g'), (_all, body: string) => {
      const args: Record<string, unknown> = {};
      for (const [, key, value] of body.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) args[key!] = value;
      add(name, args);
      return '';
    });
  }
  return { content: text.replace(/\n{3,}/g, '\n\n').trim(), calls };
}

export function withTextCalls(completion: Completion, toolNames: string[]): Completion {
  if (completion.toolCalls.length) return { ...completion, content: textCalls(completion.content, []).content };
  const found = textCalls(completion.content, toolNames);
  return { ...completion, content: found.content, toolCalls: found.calls };
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
  // Text is passed on as it comes, except from a `<tool_call>` onwards: held
  // back while it might be one, dropped once it is.
  let shown = 0;
  let inCall = false;
  const forward = () => {
    if (inCall) return;
    const at = content.indexOf(TAG, shown);
    if (at !== -1) {
      if (at > shown) onText(content.slice(shown, at));
      shown = at;
      inCall = true;
      return;
    }
    let keep = 0;
    for (let n = Math.min(TAG.length - 1, content.length - shown); n > 0; n--) {
      if (TAG.startsWith(content.slice(content.length - n))) {
        keep = n;
        break;
      }
    }
    const end = content.length - keep;
    if (end > shown) {
      onText(content.slice(shown, end));
      shown = end;
    }
  };
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
        forward();
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

  // A held-back `<tool` that never became a tag is ordinary text.
  if (!inCall && shown < content.length) onText(content.slice(shown));

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
