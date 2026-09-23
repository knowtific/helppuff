import { describe, expect, it } from 'vitest';
import { messageSchema } from '@murmur/protocol';
import { isConnectorError, type ConnectorContext } from '@murmur/connector-types';
import gemini, { collectCitations, mapGeminiSteps } from '../src/index.js';

/** Built against ai.google.dev's Interactions + File Search docs. */

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
      options: gemini.parseOptions({ apiKey: 'AIza-test', ...options }),
      siteId: 'demo',
      sessionId: 'sid-1',
      env: {},
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
const reply = (text: string, extra: object = {}) => ({
  id: 'int_1',
  object: 'interaction',
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text }] }],
  ...extra,
});

describe('requests', () => {
  it('posts to /interactions with the API key header Google documents', async () => {
    const { ctx: c, calls } = ctx({}, [reply('hi')]);
    await gemini.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'hello' });

    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect((calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test');
    expect(body(calls[0]!)).toMatchObject({ model: 'gemini-3-flash', input: 'hello', store: true });
  });

  it('attaches File Search as a tool, which is how RAG is wired', async () => {
    const { ctx: c, calls } = ctx(
      { fileSearchStores: ['fileSearchStores/kb-123'], metadataFilter: 'author="Ada"' },
      [reply('grounded')],
    );
    await gemini.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'q' });

    const tools = body(calls[0]!).tools;
    expect(tools[0]).toEqual({
      type: 'file_search',
      file_search_store_names: ['fileSearchStores/kb-123'],
      metadata_filter: 'author="Ada"',
    });
  });

  it('omits the file_search tool when no store is configured', async () => {
    const { ctx: c, calls } = ctx({}, [reply('x')]);
    await gemini.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'q' });
    const types = body(calls[0]!).tools.map((t: { type: string }) => t.type);
    expect(types).not.toContain('file_search');
  });

  it('chains turns with previous_interaction_id', async () => {
    const { ctx: c, calls } = ctx({}, [reply('one'), reply('two')]);
    const started = await gemini.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'hi' });
    expect(started.state).toEqual({ interactionId: 'int_1' });

    await gemini.send(c, { interactionId: 'int_1' }, { kind: 'text', text: 'more', clientId: 'c1' });
    expect(body(calls[1]!).previous_interaction_id).toBe('int_1');
  });

  it('resolves the system instruction from KV, editable with no redeploy', async () => {
    const kv = new Map([['prompt:demo', 'You help visitors of {{site.id}}.']]);
    const { ctx: c, calls } = ctx({ systemInstruction: { kv: 'prompt:demo' } }, [reply('x')], kv);
    await gemini.start(c, { context: { pageUrl: 'https://a.co' }, firstMessage: 'hi' });
    expect(body(calls[0]!).system_instruction).toBe('You help visitors of demo.');
  });
});

describe('mapping steps', () => {
  const expectValid = (ms: unknown[]) => {
    for (const m of ms) expect(messageSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
  };

  it('keeps model_output text and ignores the echoed user_input', () => {
    const messages = mapGeminiSteps([
      { type: 'user_input', content: [{ type: 'text', text: 'my question' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'the answer' }] },
    ]);
    expectValid(messages);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'text', text: 'the answer' });
  });

  it('accepts function_call arguments as an object, which is how Gemini sends them', () => {
    const messages = mapGeminiSteps([
      // Unlike Retell and OpenAI, these are not a JSON string.
      { type: 'function_call', name: 'show_options', id: 'c1', arguments: { options: ['A', 'B'] } },
    ]);
    expectValid(messages);
    expect(messages[0]).toMatchObject({ type: 'options' });
    expect((messages[0] as { options: unknown[] }).options).toHaveLength(2);
  });

  it('tolerates junk', () => {
    expect(mapGeminiSteps(undefined)).toEqual([]);
    expect(mapGeminiSteps([null, { type: 'model_output' }])).toEqual([]);
  });
});

describe('citations', () => {
  const grounded = {
    id: 'int_1',
    status: 'completed',
    steps: [
      {
        type: 'model_output',
        content: [
          {
            type: 'text',
            text: 'A callout is $180.',
            annotations: [
              { type: 'file_citation', file_name: 'pricing-2026.pdf', page_number: 2 },
              { type: 'file_citation', file_name: 'pricing-2026.pdf', page_number: 3 },
              { type: 'file_citation', file_name: 'terms.pdf', page_number: 1 },
            ],
          },
        ],
      },
    ],
  };

  it('collapses repeated citations of the same document', () => {
    expect(collectCitations(grounded.steps)).toEqual(['pricing-2026.pdf', 'terms.pdf']);
  });

  it('shows plain filenames as a notice, since they are not somewhere to send anyone', async () => {
    const { ctx: c } = ctx({ fileSearchStores: ['fileSearchStores/kb'] }, [grounded]);
    const result = await gemini.send(c, { interactionId: null }, { kind: 'text', text: 'q', clientId: 'c1' });

    expect(result.messages[0]).toMatchObject({ type: 'text' });
    expect(result.messages[1]).toMatchObject({
      type: 'notice',
      text: 'Based on: pricing-2026.pdf, terms.pdf',
    });
  });

  it('shows URL-named documents as tappable links', async () => {
    const withUrls = {
      ...grounded,
      steps: [
        {
          type: 'model_output',
          content: [
            {
              type: 'text',
              text: 'See the guide.',
              annotations: [{ type: 'file_citation', file_name: 'https://example.com/guide' }],
            },
          ],
        },
      ],
    };
    const { ctx: c } = ctx({}, [withUrls]);
    const result = await gemini.send(c, { interactionId: null }, { kind: 'text', text: 'q', clientId: 'c1' });
    expect(result.messages[1]).toMatchObject({ type: 'links', title: 'Sources' });
  });

  it('can be turned off', async () => {
    const { ctx: c } = ctx({ showCitations: false }, [grounded]);
    const result = await gemini.send(c, { interactionId: null }, { kind: 'text', text: 'q', clientId: 'c1' });
    expect(result.messages).toHaveLength(1);
  });
});

describe('failures', () => {
  it('treats a failed status as an error', async () => {
    const { ctx: c } = ctx({}, [{ id: 'i', status: 'failed', steps: [] }]);
    await expect(
      gemini.send(c, { interactionId: null }, { kind: 'text', text: 'hi', clientId: 'c1' }),
    ).rejects.toSatisfy((e: unknown) => isConnectorError(e) && e.detail === 'gemini_status_failed');
  });

  it('never leaks Google’s error body to the visitor', async () => {
    const { ctx: c } = ctx({}, [new Response('quota project 12345 exceeded', { status: 429 })]);
    await expect(
      gemini.send(c, { interactionId: null }, { kind: 'text', text: 'hi', clientId: 'c1' }),
    ).rejects.toSatisfy((e: unknown) => isConnectorError(e) && !e.message.includes('12345'));
  });
});
