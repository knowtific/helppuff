import { readSse } from '@helppuff/protocol';
import {
  CONNECTOR_TIMEOUT_MS,
  ConnectorError,
  extensions,
  fetchWithTimeout,
  type ChatMessage,
  type Completion,
  type ConnectorContext,
  type ExtensionContext,
  type ModelRequest,
  type ToolCall,
} from '@helppuff/connector-types';
import type { AiLike } from '@helppuff/rag';
import { complete, isQuotaError, readCompletion, readStream, withTextCalls } from './chat.js';
import type { Provider, WorkersAiOptions } from './options.js';

/**
 * The model that writes the answers, behind one call (`chat`), whoever runs
 * it. The assistant around it (prompt, tools, grounding, budget) is the same
 * for all of them.
 */

export type AnswerModel = {
  id: string;
  chat(request: ModelRequest): Promise<Completion>;
  /** Workers AI is billed in neurons, counted against the site's budget; the others bill the site directly. */
  neurons: boolean;
  /** The provider said the account is out of allowance (Workers AI's daily neurons). */
  outOfAllowance(thrown: unknown): boolean;
};

const busy = (detail: string, retryable = true) =>
  new ConnectorError(retryable ? 'The assistant is busy right now. Please try again.' : 'The assistant is unavailable right now.', { retryable, detail });

/** An HTTP failure from a provider: a short, safe error (the body only in the detail, cut). */
async function providerError(response: Response, label: string): Promise<ConnectorError> {
  const text = await response.text().catch(() => '');
  const retryable = response.status === 429 || response.status >= 500;
  return busy(`${label}_${response.status}:${text.slice(0, 200)}`, retryable);
}

const streamOf = (response: Response) => (response.body && /event-stream/.test(response.headers.get('content-type') ?? '') ? response.body : null);

/** Any `/chat/completions` API: OpenAI, Gemini, DeepInfra, OpenRouter, DeepSeek, Groq, the AI gateways… */
export function openAiCompatibleModel(provider: Extract<Provider, { type: 'openai-compatible' }>, ectx: ExtensionContext): AnswerModel {
  const label = provider.label ?? 'openai_compatible';
  const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    id: label,
    neurons: false,
    outOfAllowance: () => false,
    async chat(request) {
      const stream = Boolean(request.onText);
      const tools = provider.tools && request.tools?.length ? request.tools : undefined;
      const body = {
        model: request.model,
        messages: request.messages,
        [provider.maxTokensField]: request.maxTokens,
        ...(provider.temperature && request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(tools ? { tools } : {}),
        ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      };
      const response = await fetchWithTimeout(ectx.fetch, endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: stream ? 'text/event-stream' : 'application/json',
          ...(typeof provider.apiKey === 'string' ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
          // Secrets in headers are filled in by the server before the options arrive here.
          ...Object.fromEntries(Object.entries(provider.headers ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string')),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw await providerError(response, label);
      const sse = stream ? streamOf(response) : null;
      const completion = sse ? await readStream(sse, request.onText!) : readCompletion(await response.json().catch(() => null));
      // Tools offered but not native: calls the model wrote into its text are still read.
      return withTextCalls(completion, (request.tools ?? []).map((t) => t.function.name));
    },
  };
}

// ---------------------------------------------------------------- Claude

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };
type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicBlock[] };

const parsedArgs = (text: string): unknown => {
  try {
    return JSON.parse(text || '{}') as unknown;
  } catch {
    return {};
  }
};

/** Chat-completions messages as Claude's: one system text, tool calls and results as blocks. */
export function toAnthropic(messages: ChatMessage[]): { system: string; messages: AnthropicMessage[] } {
  const system: string[] = [];
  const out: AnthropicMessage[] = [];
  const push = (role: 'user' | 'assistant', block: AnthropicBlock) => {
    const last = out.at(-1);
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === 'system') system.push(m.content);
    else if (m.role === 'user') push('user', { type: 'text', text: m.content });
    else if (m.role === 'tool') push('user', { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content });
    else if (m.role === 'assistant') {
      if (m.content) push('assistant', { type: 'text', text: m.content });
      for (const call of m.tool_calls ?? []) push('assistant', { type: 'tool_use', id: call.id, name: call.function.name, input: parsedArgs(call.function.arguments) });
    }
  }
  return { system: system.join('\n\n'), messages: out };
}

/** Claude's Messages API (not its OpenAI compatibility layer, which Anthropic says is not for production). */
export function anthropicModel(provider: Extract<Provider, { type: 'anthropic' }>, ectx: ExtensionContext): AnswerModel {
  const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/v1/messages`;
  return {
    id: 'anthropic',
    neurons: false,
    outOfAllowance: () => false,
    async chat(request) {
      const stream = Boolean(request.onText);
      const { system, messages } = toAnthropic(request.messages);
      const tools = request.tools?.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
      const response = await fetchWithTimeout(ectx.fetch, endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': typeof provider.apiKey === 'string' ? provider.apiKey : '', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens,
          ...(system ? { system } : {}),
          messages,
          ...(tools?.length ? { tools } : {}),
          ...(request.temperature !== undefined ? { temperature: Math.min(1, request.temperature) } : {}),
          ...(stream ? { stream: true } : {}),
        }),
      });
      if (!response.ok) throw await providerError(response, 'anthropic');
      const sse = stream ? streamOf(response) : null;
      if (!sse) return readAnthropic(await response.json().catch(() => null));
      return readAnthropicStream(sse, request.onText!);
    },
  };
}

export function readAnthropic(raw: unknown): Completion {
  const body = (raw ?? {}) as { content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  let content = '';
  const toolCalls: ToolCall[] = [];
  for (const block of body.content ?? []) {
    if (block.type === 'text' && typeof block.text === 'string') content += block.text;
    if (block.type === 'tool_use' && block.name) toolCalls.push({ id: block.id ?? `call_${toolCalls.length}`, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
  }
  const u = body.usage;
  return { content, toolCalls, usage: typeof u?.input_tokens === 'number' && typeof u.output_tokens === 'number' ? { input: u.input_tokens, output: u.output_tokens } : null };
}

async function readAnthropicStream(body: ReadableStream<Uint8Array>, onText: (delta: string) => void): Promise<Completion> {
  let content = '';
  let input: number | null = null;
  let output: number | null = null;
  const calls = new Map<number, { id: string; name: string; json: string }>();
  await readSse(
    body,
    ({ data }) => {
      type Event = {
        type?: string;
        index?: number;
        message?: { usage?: { input_tokens?: number } };
        content_block?: { type?: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
        usage?: { output_tokens?: number };
      };
      let event: Event;
      try {
        event = JSON.parse(data) as Event;
      } catch {
        return;
      }
      const index = event.index ?? 0;
      switch (event.type) {
        case 'message_start':
          input = event.message?.usage?.input_tokens ?? input;
          break;
        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') calls.set(index, { id: event.content_block.id ?? `call_${index}`, name: event.content_block.name ?? '', json: '' });
          break;
        case 'content_block_delta': {
          const delta = event.delta ?? {};
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            content += delta.text;
            onText(delta.text);
          } else if (delta.type === 'input_json_delta' && calls.has(index)) {
            calls.get(index)!.json += delta.partial_json ?? '';
          }
          break;
        }
        case 'message_delta':
          output = event.usage?.output_tokens ?? output;
          break;
      }
    },
    CONNECTOR_TIMEOUT_MS,
  );
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => ({ id: c.id, name: c.name, arguments: c.json || '{}' }));
  return { content, toolCalls, usage: input !== null && output !== null ? { input, output } : null };
}

// ------------------------------------------------------------ the choice

export function workersAiModel(ai: AiLike, gateway: string | undefined): AnswerModel {
  return {
    id: 'workers-ai',
    neurons: true,
    outOfAllowance: isQuotaError,
    chat: (request) =>
      complete(ai, request.model, request.messages, {
        maxTokens: request.maxTokens,
        ...(request.tools ? { tools: request.tools } : {}),
        gateway,
        onText: request.onText,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.reasoning ? { reasoning: request.reasoning } : {}),
      }),
  };
}

export function extensionContext(ctx: Pick<ConnectorContext<unknown>, 'siteId' | 'env' | 'fetch' | 'log'>): ExtensionContext {
  return { siteId: ctx.siteId, env: ctx.env, fetch: ctx.fetch, log: (event, data) => ctx.log(event, data) };
}

/** The site's model: its provider, from the options (`provider`), with the AI binding for Workers AI. */
export function answerModel(ctx: ConnectorContext<WorkersAiOptions>, ai: AiLike | null): AnswerModel {
  const provider = ctx.options.provider;
  const ectx = extensionContext(ctx);
  switch (provider.type) {
    case 'workers-ai':
      if (!ai) throw new ConnectorError('The assistant is not set up yet.', { retryable: false, detail: 'workers_ai_binding_missing' });
      return workersAiModel(ai, ctx.options.gateway);
    case 'openai-compatible':
      return openAiCompatibleModel(provider, ectx);
    case 'anthropic':
      return anthropicModel(provider, ectx);
    case 'custom': {
      const own = extensions().models?.[provider.id];
      if (!own) throw new ConnectorError('The assistant is not set up yet.', { retryable: false, detail: `custom_model_missing:${provider.id}` });
      return {
        id: own.id || provider.id,
        neurons: false,
        outOfAllowance: () => false,
        async chat(request) {
          try {
            const result = await own.chat(request, ectx);
            const completion: Completion = { content: typeof result?.content === 'string' ? result.content : '', toolCalls: Array.isArray(result?.toolCalls) ? result.toolCalls : [], usage: result?.usage ?? null };
            return own.capabilities?.tools === false ? withTextCalls(completion, (request.tools ?? []).map((t) => t.function.name)) : completion;
          } catch (thrown) {
            if (thrown instanceof ConnectorError) throw thrown;
            throw busy(`custom_model_error:${String((thrown as Error)?.message ?? thrown).slice(0, 160)}`);
          }
        },
      };
    }
  }
}
