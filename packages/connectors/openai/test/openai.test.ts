import { describe, expect, it } from 'vitest';
import { messageSchema } from '@murmur/protocol';
import { isConnectorError, type ConnectorContext } from '@murmur/connector-types';
import openai, { mapOpenAiOutput } from '../src/index.js';

/** Built against the official openai-openapi spec — see `src/index.ts`. */

type Call = { url: string; init: RequestInit };

function ctx(options: Record<string, unknown> = {}, responses: unknown[] = [], kv = new Map<string, string>()) {
  const calls: Call[] = [];
  let index = 0;
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[index++];
    return next instanceof Response ? next : new Response(JSON.stringify(next ?? {}), { status: 200 });
  }) as unknown as typeof fetch;

  return {
    calls,
    ctx: {
      options: openai.parseOptions({ apiKey: 'sk-test', model: 'gpt-5', ...options }),
      siteId: 'demo',
      sessionId: 'sid-1',
      env: { SYSTEM_PROMPT: 'from the environment' },
      kv: {
        get: async (k: string) => kv.get(k) ?? null,
        put: async (k: string, v: string) => void kv.set(k, v),
        delete: async (k: string) => void kv.delete(k),
      },
      fetch: doFetch,
      log: () => {},
      waitUntil: () => {},
    } as ConnectorContext<unknown>,
  };
}

const body = (c: Call) => JSON.parse(c.init.body as string);
const reply = (text: string) => ({
  id: 'resp_1',
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', status: 'completed', id: 'm1', content: [{ type: 'output_text', text }] }],
});

describe('requests', () => {
  it('posts to /responses with the model and input', async () => {
    const { ctx: c, calls } = ctx({}, [reply('hello')]);
    await openai.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'hi' });

    expect(calls[0]?.url).toBe('https://api.openai.com/v1/responses');
    expect((calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
    expect(body(calls[0]!)).toMatchObject({ model: 'gpt-5', input: 'hi', store: true });
  });

  it('chains turns with previous_response_id rather than resending history', async () => {
    const { ctx: c, calls } = ctx({}, [reply('one'), reply('two')]);
    const started = await openai.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'hi' });
    expect(started.state).toEqual({ responseId: 'resp_1' });

    await openai.send(c, { responseId: 'resp_1' }, { kind: 'text', text: 'more', clientId: 'c1' });
    expect(body(calls[1]!).previous_response_id).toBe('resp_1');
    // State stays tiny; no transcript in the token.
    expect(JSON.stringify(started.state).length).toBeLessThan(60);
  });

  it('does not chain when store is off, since there is nothing to chain to', async () => {
    const { ctx: c } = ctx({ store: false }, [reply('one')]);
    const result = await openai.send(c, { responseId: null }, { kind: 'text', text: 'hi', clientId: 'c1' });
    expect(result.state).toEqual({ responseId: null });
  });

  it('declares the rich-message tools so the model can return chips', async () => {
    const { ctx: c, calls } = ctx({}, [reply('x')]);
    await openai.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'hi' });
    const names = body(calls[0]!).tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(['show_options', 'show_card', 'show_links']);
    // Flattened, as the Responses API expects — not nested under `function`.
    expect(body(calls[0]!).tools[0]).toMatchObject({ type: 'function', name: 'show_options' });
  });

  it('can be pointed at any OpenAI-compatible endpoint', async () => {
    const { ctx: c, calls } = ctx({ baseUrl: 'https://openrouter.ai/api/v1' }, [reply('x')]);
    await openai.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'hi' });
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/responses');
  });
});

describe('the system prompt', () => {
  it('takes an inline string and interpolates the lead and page', async () => {
    const { ctx: c, calls } = ctx({ instructions: 'Helping {{lead.name}} on {{context.pageUrl}}.' }, [reply('x')]);
    await openai.start(c, {
      context: { pageUrl: 'https://a.co/pricing' },
      lead: { name: 'Ada' },
      firstMessage: 'hi',
    });
    expect(body(calls[0]!).instructions).toBe('Helping Ada on https://a.co/pricing.');
  });

  it('reads it from an environment variable', async () => {
    const { ctx: c, calls } = ctx({ instructions: { env: 'SYSTEM_PROMPT' } }, [reply('x')]);
    await openai.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'hi' });
    expect(body(calls[0]!).instructions).toBe('from the environment');
  });

  it('reads it from KV, so it can be edited with no redeploy', async () => {
    const kv = new Map([['prompt:demo', 'live prompt for {{site.id}}']]);
    const { ctx: c, calls } = ctx({ instructions: { kv: 'prompt:demo' } }, [reply('x')], kv);
    await openai.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'hi' });
    expect(body(calls[0]!).instructions).toBe('live prompt for demo');
  });

  it('carries on without a prompt when the source is missing', async () => {
    const { ctx: c, calls } = ctx({ instructions: { kv: 'prompt:absent' } }, [reply('x')]);
    // An assistant with no system prompt still answers; a failed request does not.
    await expect(openai.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'hi' })).resolves
      .toBeDefined();
    expect(body(calls[0]!).instructions).toBeUndefined();
  });

  it('prefers a stored prompt and sends the variables to it', async () => {
    const { ctx: c, calls } = ctx(
      { promptRef: { id: 'pmpt_123', version: '4' }, instructions: 'ignored' },
      [reply('x')],
    );
    await openai.start(c, {
      context: { pageUrl: 'https://a.co/p', locale: 'en-AU' },
      lead: { name: 'Ada' },
      firstMessage: 'hi',
    });

    const sent = body(calls[0]!);
    expect(sent.prompt).toMatchObject({ id: 'pmpt_123', version: '4' });
    expect(sent.prompt.variables).toMatchObject({
      lead_name: 'Ada',
      page_url: 'https://a.co/p',
      locale: 'en-AU',
      site_id: 'demo',
    });
    // Inline text would silently override the stored prompt, so it is dropped.
    expect(sent.instructions).toBeUndefined();
  });
});

describe('mapping the output array', () => {
  const expectValid = (ms: unknown[]) => {
    for (const m of ms) expect(messageSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
  };

  it('aggregates output_text parts, since output_text is SDK-only', () => {
    const messages = mapOpenAiOutput([
      {
        type: 'message', role: 'assistant', id: 'm', status: 'completed',
        content: [{ type: 'output_text', text: 'Part one. ' }, { type: 'output_text', text: 'Part two.' }],
      },
    ]);
    expectValid(messages);
    expect(messages[0]).toMatchObject({ type: 'text', text: 'Part one. Part two.' });
  });

  it('turns a function_call into a rich message, parsing the JSON-string arguments', () => {
    const messages = mapOpenAiOutput([
      {
        type: 'function_call', id: 'fc', call_id: 'call_1', name: 'show_options',
        arguments: JSON.stringify({ options: ['A', 'B'] }),
      },
    ]);
    expectValid(messages);
    expect(messages[0]).toMatchObject({ type: 'options' });
  });

  it('ignores reasoning and built-in tool calls, which have nothing to show', () => {
    const messages = mapOpenAiOutput([
      { type: 'reasoning', id: 'r', summary: [] },
      { type: 'file_search_call', id: 'fs', status: 'completed', queries: ['x'] },
      { type: 'web_search_call', id: 'ws', status: 'completed' },
      { type: 'message', role: 'assistant', id: 'm', status: 'completed', content: [{ type: 'output_text', text: 'answer' }] },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ text: 'answer' });
  });

  it('tolerates junk', () => {
    expect(mapOpenAiOutput(null)).toEqual([]);
    expect(mapOpenAiOutput([null, 'x', { type: 'message' }])).toEqual([]);
  });
});

describe('failures', () => {
  it('treats a failed status in a 200 body as an error', async () => {
    const { ctx: c } = ctx({}, [{ id: 'r', status: 'failed', error: { message: 'internal detail' } }]);
    await expect(
      openai.send(c, { responseId: null }, { kind: 'text', text: 'hi', clientId: 'c1' }),
    ).rejects.toSatisfy((e: unknown) => isConnectorError(e) && !e.message.includes('internal detail'));
  });

  it.each([[500, true], [429, true], [401, false]])(
    'maps HTTP %i without leaking the body (retryable: %s)',
    async (status, retryable) => {
      const { ctx: c } = ctx({}, [new Response('secret backend text', { status })]);
      await expect(
        openai.send(c, { responseId: null }, { kind: 'text', text: 'hi', clientId: 'c1' }),
      ).rejects.toSatisfy(
        (e: unknown) => isConnectorError(e) && e.retryable === retryable && !e.message.includes('secret backend'),
      );
    },
  );
});

describe('start with no first message', () => {
  it('opens a session without calling the model', async () => {
    const { ctx: c, calls } = ctx({}, []);
    const result = await openai.start(c, { context: { pageUrl: 'https://a.co' } });
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ state: { responseId: null }, messages: [] });
  });
});
