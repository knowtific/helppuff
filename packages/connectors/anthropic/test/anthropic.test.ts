import { describe, expect, it } from 'vitest';
import { messageSchema } from '@murmur/protocol';
import { isConnectorError, type ConnectorContext } from '@murmur/connector-types';
import anthropic, { mapAnthropicContent } from '../src/index.js';

type Call = { url: string; init: RequestInit; headers: Headers };

const message = (content: unknown[], stop_reason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5',
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
});

function harness(options: Record<string, unknown> = {}, responses: (Response | object)[] = [], env: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const kv = new Map<string, string>();
  let index = 0;
  const doFetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, headers: new Headers(init.headers) });
    const next = responses[index++];
    return next instanceof Response
      ? next
      : new Response(JSON.stringify(next ?? message([])), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  const ctx = {
    options: anthropic.parseOptions({ apiKey: 'sk-ant-test', instructions: 'You are Acme support.', ...options }),
    siteId: 'acme',
    sessionId: 's1',
    env,
    kv: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    },
    fetch: doFetch,
    log: () => {},
    waitUntil: () => {},
  } as ConnectorContext<unknown>;
  return { ctx, calls };
}

const body = (c: Call) => JSON.parse(c.init.body as string);

describe('requests', () => {
  it('calls the Messages API with the key, model, system prompt and tools', async () => {
    const { ctx, calls } = harness({}, [message([{ type: 'text', text: 'Hello!' }])]);
    const result = await anthropic.send(ctx, { turns: 0 }, { kind: 'text', text: 'hi', clientId: 'c1' });

    expect(calls[0]?.url).toContain('/v1/messages');
    expect(calls[0]?.headers.get('x-api-key')).toBe('sk-ant-test');
    const sent = body(calls[0]!);
    expect(sent.model).toBe('claude-opus-5');
    expect(sent.system[0]).toMatchObject({ type: 'text', text: 'You are Acme support.' });
    expect(sent.tools.map((t: { name: string }) => t.name)).toEqual(['show_options', 'show_card', 'show_links']);
    expect(result.messages[0]).toMatchObject({ type: 'text', text: 'Hello!' });
  });

  it('turns on server-side refusal fallbacks for Opus 5 only', async () => {
    const opus = harness({}, [message([{ type: 'text', text: 'x' }])]);
    await anthropic.send(opus.ctx, { turns: 0 }, { kind: 'text', text: 'hi', clientId: 'c1' });
    expect(body(opus.calls[0]!).fallbacks).toBe('default');
    expect(opus.calls[0]!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');

    const haiku = harness({ model: 'claude-haiku-4-5', effort: 'low' }, [message([{ type: 'text', text: 'x' }])]);
    await anthropic.send(haiku.ctx, { turns: 0 }, { kind: 'text', text: 'hi', clientId: 'c1' });
    expect(body(haiku.calls[0]!).fallbacks).toBeUndefined();
    // Haiku 4.5 rejects effort, so it is not sent.
    expect(body(haiku.calls[0]!).output_config).toBeUndefined();
  });

  it('replays history as plain text, including a summary of a card it showed', async () => {
    const { ctx, calls } = harness({}, [
      message([
        { type: 'text', text: 'Here is our plan:' },
        { type: 'tool_use', id: 't1', name: 'show_card', input: { title: 'Pro', body: '$49/mo' } },
      ], 'tool_use'),
      message([{ type: 'text', text: 'Great.' }]),
    ]);
    await anthropic.send(ctx, { turns: 0 }, { kind: 'text', text: 'plans?', clientId: 'c1' });
    await anthropic.send(ctx, { turns: 1 }, { kind: 'text', text: 'the pro one', clientId: 'c2' });

    const replay = body(calls[1]!).messages;
    expect(replay.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(replay[1].content).toContain('[Showed a card: Pro — $49/mo]');
  });

  it('adds retrieved knowledge to the question, not the cached system prompt', async () => {
    const search = async () => ({ chunks: [{ text: 'Open 9–5 weekdays.', item: { key: 'hours.md' } }] });
    const { ctx, calls } = harness({ knowledge: {} }, [message([{ type: 'text', text: '9 to 5.' }])], {
      AI_SEARCH: { search, chatCompletions: async () => ({}) },
    });
    await anthropic.send(ctx, { turns: 0 }, { kind: 'text', text: 'hours?', clientId: 'c1' });
    const last = body(calls[0]!).messages.at(-1);
    expect(last.content[0].text).toContain('<document source="hours.md">');
    expect(last.content[1].text).toBe('hours?');
  });
});

describe('mapping', () => {
  it('maps text and rich tool calls, and every message validates', () => {
    const out = mapAnthropicContent({
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: '', signature: 's' },
        { type: 'text', text: 'Pick one:', citations: null },
        { type: 'tool_use', id: 't', name: 'show_options', input: { options: ['A', 'B'] }, caller: { type: 'direct' } },
      ] as never,
    });
    expect(out.map((m) => m.type)).toEqual(['text', 'options']);
    for (const m of out) expect(messageSchema.safeParse(m).success).toBe(true);
  });

  it('a refusal becomes a polite notice', () => {
    const out = mapAnthropicContent({ stop_reason: 'refusal', content: [] });
    expect(out[0]).toMatchObject({ type: 'notice' });
  });
});

describe('failures', () => {
  it('a 429 is retryable with a retry-after', async () => {
    const { ctx } = harness({}, [
      new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
      new Response('{}', { status: 429 }),
    ]);
    await expect(anthropic.send(ctx, { turns: 0 }, { kind: 'text', text: 'hi', clientId: 'c1' })).rejects.toSatisfy(
      (e: unknown) => isConnectorError(e) && e.retryable && e.retryAfter === 20,
    );
  });

  it('an unresolved key is a configuration error', async () => {
    const { ctx } = harness({ apiKey: { env: 'ANTHROPIC_API_KEY' } });
    await expect(anthropic.send(ctx, { turns: 0 }, { kind: 'text', text: 'hi', clientId: 'c1' })).rejects.toSatisfy(
      (e: unknown) => isConnectorError(e) && !e.retryable,
    );
  });
});
