import { describe, expect, it } from 'vitest';
import { messageSchema } from '@murmur/protocol';
import { isConnectorError, type ConnectorContext } from '@murmur/connector-types';
import http, { normalizeBackendReply, signBody } from '../src/index.js';

type Call = { url: string; init: RequestInit };

function harness(options: Record<string, unknown>, responses: Response[] = []) {
  const calls: Call[] = [];
  const kv = new Map<string, string>();
  let index = 0;
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses[index++] ?? Response.json({ text: 'default' });
  }) as unknown as typeof fetch;
  const ctx = {
    options: http.parseOptions(options),
    siteId: 'acme',
    sessionId: 's1',
    env: {},
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

const headers = (c: Call) => c.init.headers as Record<string, string>;
const body = (c: Call) => JSON.parse(c.init.body as string);
const sse = (text: string) => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });

describe('murmur mode', () => {
  it('posts start and message, and threads the backend state through', async () => {
    const { ctx, calls } = harness({ url: 'https://api.acme.com/chat/' }, [
      Response.json({ text: 'Welcome!', state: { conv: 'c-9' } }),
      Response.json({ messages: [{ type: 'text', text: 'Sure.' }] }),
    ]);
    const started = await http.start(ctx, { context: { pageUrl: 'https://acme.com' }, firstMessage: 'hi' });
    expect(calls[0]?.url).toBe('https://api.acme.com/chat/start');
    expect(body(calls[0]!)).toMatchObject({ siteId: 'acme', sessionId: 's1', firstMessage: 'hi' });
    expect(started.state).toEqual({ backend: { conv: 'c-9' } });

    const sent = await http.send(ctx, started.state, { kind: 'text', text: 'more', clientId: 'c1' });
    expect(calls[1]?.url).toBe('https://api.acme.com/chat/message');
    expect(body(calls[1]!).state).toEqual({ conv: 'c-9' });
    for (const m of [...started.messages, ...sent.messages]) expect(messageSchema.safeParse(m).success).toBe(true);
  });

  it('reads a streamed reply: deltas first, then done', async () => {
    const { ctx, calls } = harness({ url: 'https://api.acme.com' }, [
      sse('event: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n\nevent: done\ndata: {"text":"Hello"}\n\n'),
    ]);
    const deltas: string[] = [];
    ctx.onText = (d) => deltas.push(d);
    const result = await http.send(ctx, {}, { kind: 'text', text: 'hi', clientId: 'c1' });
    expect(headers(calls[0]!)['Accept']).toContain('text/event-stream');
    expect(deltas.join('')).toBe('Hello');
    expect(result.messages[0]).toMatchObject({ type: 'text', text: 'Hello' });
  });

  it('accepts plain JSON even when a stream was asked for', async () => {
    const { ctx } = harness({ url: 'https://api.acme.com' }, [Response.json({ text: 'no stream here' })]);
    ctx.onText = () => {};
    const result = await http.send(ctx, {}, { kind: 'text', text: 'hi', clientId: 'c1' });
    expect(result.messages[0]).toMatchObject({ text: 'no stream here' });
  });

  it('a stream that ends without done is a retryable failure', async () => {
    const { ctx } = harness({ url: 'https://api.acme.com' }, [sse('event: delta\ndata: {"text":"Hel"}\n\n')]);
    ctx.onText = () => {};
    await expect(http.send(ctx, {}, { kind: 'text', text: 'hi', clientId: 'c1' })).rejects.toSatisfy(
      (e: unknown) => isConnectorError(e) && e.retryable,
    );
  });

  it('signs the body when a signing secret is set', async () => {
    const { ctx, calls } = harness({ url: 'https://api.acme.com', signingSecret: 'shh' }, [Response.json({ text: 'ok' })]);
    await http.send(ctx, {}, { kind: 'text', text: 'hi', clientId: 'c1' });
    const h = headers(calls[0]!);
    const expected = await signBody('shh', calls[0]!.init.body as string, Number(h['X-Murmur-Timestamp']));
    expect(h['X-Murmur-Signature']).toBe(expected);
  });

  it('a 500 is retryable, a 401 is not', async () => {
    const a = harness({ url: 'https://api.acme.com' }, [new Response('boom', { status: 500 })]);
    await expect(http.send(a.ctx, {}, { kind: 'text', text: 'x', clientId: 'c' })).rejects.toSatisfy(
      (e: unknown) => isConnectorError(e) && e.retryable,
    );
    const b = harness({ url: 'https://api.acme.com' }, [new Response('no', { status: 401 })]);
    await expect(http.send(b.ctx, {}, { kind: 'text', text: 'x', clientId: 'c' })).rejects.toSatisfy(
      (e: unknown) => isConnectorError(e) && !e.retryable,
    );
  });
});

describe('openai mode', () => {
  it('calls /chat/completions with the system prompt and stored history', async () => {
    const { ctx, calls } = harness(
      { url: 'https://llm.acme.com/v1', mode: 'openai', model: 'llama3', apiKey: 'k', instructions: 'Be brief.' },
      [
        Response.json({ choices: [{ message: { content: 'One.' } }] }),
        Response.json({ choices: [{ message: { content: 'Two.' } }] }),
      ],
    );
    await http.start(ctx, { context: { pageUrl: 'https://acme.com' }, firstMessage: 'first' });
    await http.send(ctx, {}, { kind: 'text', text: 'second', clientId: 'c2' });

    expect(calls[1]?.url).toBe('https://llm.acme.com/v1/chat/completions');
    expect(headers(calls[1]!)['Authorization']).toBe('Bearer k');
    expect(body(calls[1]!).messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('streams OpenAI-style deltas', async () => {
    const { ctx } = harness({ url: 'https://llm.acme.com/v1', mode: 'openai' }, [
      sse('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n'),
    ]);
    const deltas: string[] = [];
    ctx.onText = (d) => deltas.push(d);
    const result = await http.send(ctx, {}, { kind: 'text', text: 'hi', clientId: 'c1' });
    expect(deltas.join('')).toBe('Hi there');
    expect(result.messages[0]).toMatchObject({ text: 'Hi there' });
  });
});

describe('normalizeBackendReply', () => {
  it('fills in id, ts and role, and ignores junk', () => {
    const out = normalizeBackendReply({ messages: [{ type: 'text', text: 'a' }, 'junk', { text: 'no type' }] });
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toMatchObject({ role: 'agent', type: 'text' });
    expect(typeof out.messages[0]!.id).toBe('string');
  });
});
