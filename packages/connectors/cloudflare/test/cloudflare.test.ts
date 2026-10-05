import { describe, expect, it } from 'vitest';
import { messageSchema } from '@murmur/protocol';
import { isConnectorError, markerFilter, type ConnectorContext } from '@murmur/connector-types';
import cloudflare, { completionText, readCompletionStream } from '../src/index.js';

/** Built against developers.cloudflare.com/ai-search — see `src/index.ts`. */

type ChatInput = { messages: { role: string; content: string }[]; stream?: boolean; model?: string };

function sse(frames: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
}

const chunkFrame = 'event: chunks\ndata: [{"id":"c1","text":"Pricing starts at $49."}]\n\n';
const deltaFrame = (text: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`;

function harness(options: Record<string, unknown> = {}, replies: unknown[] = [], fetchImpl?: typeof fetch) {
  const calls: ChatInput[] = [];
  const kv = new Map<string, string>();
  let index = 0;
  const binding = {
    async chatCompletions(input: ChatInput) {
      calls.push(input);
      return replies[index++];
    },
    async search() {
      return { chunks: [] };
    },
  };
  const ctx = {
    options: cloudflare.parseOptions({ instructions: 'You help {{lead.name}} at Acme.', ...options }),
    siteId: 'acme',
    sessionId: 's1',
    env: { AI_SEARCH: binding },
    kv: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    },
    fetch: fetchImpl ?? (fetch as typeof fetch),
    log: () => {},
    waitUntil: () => {},
  } as ConnectorContext<unknown>;
  return { ctx, calls, kv };
}

const completion = (content: string) => ({ choices: [{ message: { role: 'assistant', content } }], chunks: [] });

describe('requests', () => {
  it('sends the system prompt with the lead filled in, then the question', async () => {
    const { ctx, calls } = harness({}, [completion('Hi Ada.')]);
    const started = await cloudflare.start(ctx, {
      context: { pageUrl: 'https://acme.com' },
      lead: { name: 'Ada' },
      firstMessage: 'What does it cost?',
    });

    expect(calls[0]?.messages[0]).toMatchObject({ role: 'system' });
    expect(calls[0]?.messages[0]?.content).toContain('You help Ada at Acme.');
    expect(calls[0]?.messages.at(-1)).toEqual({ role: 'user', content: 'What does it cost?' });
    expect(started.messages[0]).toMatchObject({ type: 'text', text: 'Hi Ada.' });
  });

  it('replays history on the next turn and keeps the lead in the prompt', async () => {
    const { ctx, calls } = harness({}, [completion('One.'), completion('Two.')]);
    const started = await cloudflare.start(ctx, {
      context: { pageUrl: 'https://acme.com' },
      lead: { name: 'Ada' },
      firstMessage: 'first',
    });
    await cloudflare.send(ctx, started.state, { kind: 'text', text: 'second', clientId: 'c2' });

    const roles = calls[1]!.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    expect(calls[1]!.messages[0]!.content).toContain('Ada');
    expect(calls[1]!.messages[2]!.content).toBe('One.');
  });

  it("reads history from the server's record when there is one, and keeps no copy in KV", async () => {
    const { ctx, calls, kv } = harness({}, [completion('Two.')]);
    ctx.history = async () => [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'One.' },
    ];
    await cloudflare.send(ctx, { turns: 1 }, { kind: 'text', text: 'second', clientId: 'c2' });

    expect(calls[0]!.messages.map((m) => m.content).slice(1)).toEqual(['first', 'One.', 'second']);
    expect([...kv.keys()].filter((k) => !k.endsWith(':scope'))).toEqual([]);
  });

  it('passes the model and retrieval options through', async () => {
    const { ctx, calls } = harness({ model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', maxResults: 4 }, [
      completion('ok'),
    ]);
    await cloudflare.send(ctx, { turns: 0 }, { kind: 'text', text: 'hi', clientId: 'c1' });
    expect(calls[0]).toMatchObject({
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      ai_search_options: { retrieval: { max_num_results: 4 }, query_rewrite: { enabled: true } },
    });
  });
});

describe('rich messages', () => {
  it('turns an options marker into chips and strips it from the text', async () => {
    const { ctx } = harness({}, [completion('When suits you?\n[[options: Today | Tomorrow]]')]);
    const result = await cloudflare.send(ctx, { turns: 0 }, { kind: 'text', text: 'book', clientId: 'c1' });
    expect(result.messages.map((m) => m.type)).toEqual(['text', 'options']);
    expect(result.messages[0]).toMatchObject({ text: 'When suits you?' });
    for (const m of result.messages) expect(messageSchema.safeParse(m).success).toBe(true);
  });

  it('teaches the marker syntax only when rich messages are on', async () => {
    const off = harness({ richMessages: false }, [completion('ok')]);
    await cloudflare.send(off.ctx, { turns: 0 }, { kind: 'text', text: 'hi', clientId: 'c1' });
    expect(off.calls[0]!.messages[0]!.content).not.toContain('[[options');
  });
});

describe('streaming', () => {
  it('forwards deltas, skips the chunks frame and hides markers from the preview', async () => {
    const stream = sse([chunkFrame, deltaFrame('From $49'), deltaFrame('.\n[[options: Buy'), deltaFrame(' | Ask]]'), 'data: [DONE]\n\n']);
    const { ctx, calls } = harness({}, [stream]);
    const deltas: string[] = [];
    ctx.onText = (d) => deltas.push(d);

    const result = await cloudflare.send(ctx, { turns: 0 }, { kind: 'text', text: 'price?', clientId: 'c1' });

    expect(calls[0]?.stream).toBe(true);
    expect(deltas.join('')).toBe('From $49.\n');
    expect(result.messages.map((m) => m.type)).toEqual(['text', 'options']);
  });

  it('accepts a Response as well as a bare stream', async () => {
    const text = await readCompletionStream(new Response(sse([deltaFrame('a'), deltaFrame('b')])), () => {});
    expect(text).toBe('ab');
  });
});

describe('a public endpoint instead of a binding', () => {
  it('posts to {endpoint}/chat/completions', async () => {
    const urls: string[] = [];
    const doFetch = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(completion('via endpoint')), { status: 200 });
    }) as unknown as typeof fetch;
    const { ctx } = harness({ endpoint: 'https://ai-search.example.com/mcp' }, [], doFetch);
    const result = await cloudflare.send(ctx, { turns: 0 }, { kind: 'text', text: 'hi', clientId: 'c1' });
    expect(urls).toEqual(['https://ai-search.example.com/chat/completions']);
    expect(result.messages[0]).toMatchObject({ text: 'via endpoint' });
  });
});

describe('failures', () => {
  it('a missing binding is a configuration error, not a crash', async () => {
    const { ctx } = harness({ binding: 'NOPE' });
    await expect(cloudflare.send(ctx, { turns: 0 }, { kind: 'text', text: 'hi', clientId: 'c1' })).rejects.toSatisfy(
      (e: unknown) => isConnectorError(e) && !e.retryable,
    );
  });

  it('an error thrown by the binding becomes a retryable connector error', async () => {
    const { ctx } = harness();
    (ctx.env['AI_SEARCH'] as { chatCompletions: () => Promise<never> }).chatCompletions = async () => {
      throw new Error('AiError: 3040');
    };
    await expect(cloudflare.send(ctx, { turns: 0 }, { kind: 'text', text: 'hi', clientId: 'c1' })).rejects.toSatisfy(
      (e: unknown) => isConnectorError(e) && e.retryable,
    );
  });
});

describe('helpers', () => {
  it('reads the legacy `response` field too', () => {
    expect(completionText({ response: 'legacy' })).toBe('legacy');
    expect(completionText(null)).toBe('');
  });

  it('markerFilter never leaks a marker split across deltas', () => {
    const out: string[] = [];
    const filter = markerFilter((d) => out.push(d));
    for (const piece of ['Hello [', '[link: A', ' | https://a.co]', '] bye']) filter.push(piece);
    filter.flush();
    expect(out.join('')).toBe('Hello  bye');
  });
});

describe('document names are not links', () => {
  it('drops links to indexed documents and keeps real pages', async () => {
    const { ctx } = harness({}, [
      completion(
        'Our warranty is 400 days, see [the policy](https://x.workers.dev/file__docs__warranty.pdf).\n[[link: Warranty policy | https://x.workers.dev/file__docs__warranty.pdf]]\n[[link: Pricing | https://acme.com/pricing]]',
      ),
    ]);
    const result = await cloudflare.send(ctx, { turns: 0 }, { kind: 'text', text: 'warranty?', clientId: 'c1' });
    expect(result.messages[0]).toMatchObject({ type: 'text', text: 'Our warranty is 400 days, see the policy.' });
    expect(result.messages[1]).toMatchObject({ type: 'links', links: [{ label: 'Pricing', url: 'https://acme.com/pricing' }] });
  });
});

describe('markers a model copies instead of writing', () => {
  it('reads an echoed history note as options and drops template placeholders', async () => {
    const { parseMarkers } = await import('@murmur/connector-types');
    const echoed = parseMarkers('We install hybrid.\n\n[Offered choices: Get a quote | Call me back]');
    expect(echoed.text).toBe('We install hybrid.');
    expect(echoed.messages).toMatchObject([{ type: 'options', options: [{ label: 'Get a quote' }, { label: 'Call me back' }] }]);

    const template = parseMarkers('Here you go.\n[Showed a card: Hybrid]\n[[options: First choice | Second choice | Third choice]]');
    expect(template).toEqual({ text: 'Here you go.', messages: [] });
    expect(parseMarkers('Sure.\n[[options: A | B | C]]')).toEqual({ text: 'Sure.', messages: [] });
  });
});
