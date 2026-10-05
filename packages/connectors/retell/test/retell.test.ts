import { describe, expect, it, vi } from 'vitest';
import { messageSchema } from '@murmur/protocol';
import { isConnectorError, type ConnectorContext } from '@murmur/connector-types';
import retell, { mapRetellMessages } from '../src/index.js';

/**
 * Built against the shapes verified from docs.retellai.com — see the header
 * of `src/index.ts`. Every request is asserted against the documented body,
 * so a drift in what we send shows up here rather than in production.
 */

type Call = { url: string; init: RequestInit };

function ctx(options: Record<string, unknown> = {}, responses: unknown[] = []): {
  ctx: ConnectorContext<unknown>;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[index++];
    if (next instanceof Response) return next;
    return new Response(JSON.stringify(next ?? {}), { status: 200 });
  }) as unknown as typeof fetch;

  return {
    calls,
    ctx: {
      options: retell.parseOptions({ apiKey: 'key_123', agentId: 'agent_abc', ...options }),
      siteId: 'demo',
      sessionId: 'sid-1',
      env: {},
      kv: { get: async () => null, put: async () => {}, delete: async () => {} },
      fetch: doFetch,
      log: () => {},
      waitUntil: () => {},
    },
  };
}

const body = (call: Call) => JSON.parse(call.init.body as string);
const start = { context: { pageUrl: 'https://example.com/pricing' } };

const expectValid = (messages: unknown[]) => {
  for (const m of messages) {
    const result = messageSchema.safeParse(m);
    if (!result.success) throw new Error(`invalid: ${JSON.stringify(m)}\n${result.error.message}`);
  }
};

describe('start', () => {
  it('creates a chat with the agent id and keeps only the chat id as state', async () => {
    const { ctx: c, calls } = ctx({}, [{ chat_id: 'chat_1' }]);
    const result = await retell.start(c, start);

    expect(calls[0]?.url).toBe('https://api.retellai.com/create-chat');
    expect(calls[0]?.init.method).toBe('POST');
    expect((calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe('Bearer key_123');
    expect(body(calls[0]!)).toMatchObject({ agent_id: 'agent_abc' });

    expect(result.state).toEqual({ chatId: 'chat_1' });
    // Retell holds the history, so state stays well under the 1 kb budget.
    expect(JSON.stringify(result.state).length).toBeLessThan(100);
  });

  it('renders dynamic variables from the lead and page context', async () => {
    const { ctx: c, calls } = ctx(
      {
        dynamicVariables: {
          customer_name: '{{lead.name}}',
          page_url: '{{context.pageUrl}}',
          missing: '{{lead.nothing}}',
        },
      },
      [{ chat_id: 'chat_1' }],
    );
    await retell.start(c, { ...start, lead: { name: 'Ada' } });

    const sent = body(calls[0]!).retell_llm_dynamic_variables;
    expect(sent).toEqual({ customer_name: 'Ada', page_url: 'https://example.com/pricing' });
    // An unresolved variable is left out rather than sent empty.
    expect(sent.missing).toBeUndefined();
  });

  it('answers firstMessage in the same turn', async () => {
    const { ctx: c, calls } = ctx({}, [
      { chat_id: 'chat_1' },
      { messages: [{ role: 'agent', content: 'Hello there', message_id: 'm1', created_timestamp: 1 }] },
    ]);
    const result = await retell.start(c, { ...start, firstMessage: 'hi' });

    expect(calls[1]?.url).toBe('https://api.retellai.com/create-chat-completion');
    expect(body(calls[1]!)).toEqual({ chat_id: 'chat_1', content: 'hi' });
    expect(result.messages[0]).toMatchObject({ type: 'text', text: 'Hello there' });
  });

  it('fails cleanly when Retell returns no chat id', async () => {
    const { ctx: c } = ctx({}, [{}]);
    await expect(retell.start(c, start)).rejects.toSatisfy(
      (e: unknown) => isConnectorError(e) && e.detail === 'retell_no_chat_id',
    );
  });
});

describe('send', () => {
  it('posts the completion and maps the reply', async () => {
    const { ctx: c, calls } = ctx({}, [
      { messages: [{ role: 'agent', content: 'Sure', message_id: 'm1', created_timestamp: 1 }] },
    ]);
    const result = await retell.send(c, { chatId: 'chat_1' }, {
      kind: 'text',
      text: 'a question',
      clientId: 'c1',
    });

    expect(body(calls[0]!)).toEqual({ chat_id: 'chat_1', content: 'a question' });
    expect(result.messages).toHaveLength(1);
  });

  it("sends an action's value, which is what the agent prompt is written against", async () => {
    const { ctx: c, calls } = ctx({}, [{ messages: [] }]);
    await retell.send(c, { chatId: 'chat_1' }, {
      kind: 'action',
      actionId: 'a1',
      value: 'book_emergency',
      label: 'Book it',
      clientId: 'c1',
    });
    expect(body(calls[0]!).content).toBe('book_emergency');
  });
});

describe('mapping Retell messages', () => {
  it('keeps agent prose and ignores the six roles that are not ours', async () => {
    const messages = mapRetellMessages(
      [
        { role: 'user', content: 'my question', message_id: 'u1', created_timestamp: 1 },
        { role: 'agent', content: 'the answer', message_id: 'a1', created_timestamp: 2 },
        { role: 'tool_call_result', tool_call_id: 't1', content: '{}', successful: true },
        { role: 'node_transition', new_node_name: 'x' },
        { role: 'state_transition', new_state_name: 'y' },
        { role: 'sms', content: 'not our channel', message_id: 's1', created_timestamp: 3 },
        { role: 'injected', content: 'injected note', message_id: 'i1', created_timestamp: 4 },
      ],
      false,
    );
    expectValid(messages);
    expect(messages.map((m) => (m.type === 'text' ? m.text : m.type))).toEqual([
      'the answer',
      'injected note',
    ]);
  });

  it('turns a show_options tool call into chips', () => {
    const messages = mapRetellMessages(
      [
        {
          role: 'tool_call_invocation',
          tool_call_id: 't1',
          name: 'show_options',
          // Documented as "a stringified JSON object".
          arguments: JSON.stringify({ text: 'Which one?', options: ['Today', 'Tomorrow'] }),
          message_id: 'm1',
          created_timestamp: 1,
        },
      ],
      false,
    );
    expectValid(messages);
    expect(messages[0]).toMatchObject({ type: 'options', text: 'Which one?' });
    expect((messages[0] as { options: unknown[] }).options).toHaveLength(2);
  });

  it('turns show_card and show_links into their messages', () => {
    const messages = mapRetellMessages(
      [
        {
          role: 'tool_call_invocation',
          name: 'show_card',
          arguments: JSON.stringify({
            title: 'Emergency callout',
            body: 'Within the hour',
            image_url: 'https://example.com/van.png',
            actions: [{ label: 'Book', value: 'book' }, { label: 'Read more', url: 'https://example.com' }],
          }),
          tool_call_id: 't1', message_id: 'm1', created_timestamp: 1,
        },
        {
          role: 'tool_call_invocation',
          name: 'show_links',
          arguments: JSON.stringify({ links: [{ label: 'Pricing', url: 'https://example.com/p' }] }),
          tool_call_id: 't2', message_id: 'm2', created_timestamp: 2,
        },
      ],
      false,
    );
    expectValid(messages);
    expect(messages.map((m) => m.type)).toEqual(['card', 'links']);
  });

  it('drops a tool call it cannot use rather than breaking the turn', () => {
    const messages = mapRetellMessages(
      [
        { role: 'tool_call_invocation', name: 'show_options', arguments: 'not json', tool_call_id: 't', message_id: 'm', created_timestamp: 1 },
        { role: 'tool_call_invocation', name: 'show_card', arguments: '{}', tool_call_id: 't2', message_id: 'm2', created_timestamp: 2 },
        { role: 'tool_call_invocation', name: 'unknown_tool', arguments: '{}', tool_call_id: 't3', message_id: 'm3', created_timestamp: 3 },
        { role: 'agent', content: 'still fine', message_id: 'a1', created_timestamp: 4 },
      ],
      false,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'text', text: 'still fine' });
  });

  it('parses inline markers when the agent has no tools', () => {
    const messages = mapRetellMessages(
      [
        {
          role: 'agent',
          content: 'When suits?\n[[options: Today | Tomorrow | This week]]',
          message_id: 'a1',
          created_timestamp: 1,
        },
      ],
      true,
    );
    expectValid(messages);
    expect(messages[0]).toMatchObject({ type: 'text', text: 'When suits?' });
    expect(messages[1]).toMatchObject({ type: 'options' });
  });

  it('strips a malformed marker rather than showing the visitor punctuation', () => {
    const messages = mapRetellMessages(
      [{ role: 'agent', content: 'Hello [[options:]] [[link: broken]]', message_id: 'a1', created_timestamp: 1 }],
      true,
    );
    expect(messages).toHaveLength(1);
    expect((messages[0] as { text: string }).text).toBe('Hello');
  });

  it('tolerates a response that is not an array', () => {
    expect(mapRetellMessages(null, false)).toEqual([]);
    expect(mapRetellMessages({ messages: [] }, false)).toEqual([]);
  });
});

describe('failures', () => {
  it.each([
    [500, true],
    [429, true],
    [401, false],
    [404, false],
  ])('maps HTTP %i to a safe message (retryable: %s)', async (status, retryable) => {
    const { ctx: c } = ctx({}, [new Response('backend detail here', { status })]);
    await expect(retell.start(c, start)).rejects.toSatisfy((e: unknown) => {
      if (!isConnectorError(e)) return false;
      // Retell's own error text must never reach the visitor.
      return e.retryable === retryable && !e.message.includes('backend detail');
    });
  });

  it('refuses to run with an unresolved secret', async () => {
    const { ctx: c } = ctx({ apiKey: { env: 'RETELL_API_KEY' } }, [{ chat_id: 'x' }]);
    await expect(retell.start(c, start)).rejects.toSatisfy(
      (e: unknown) => isConnectorError(e) && e.detail === 'unresolved_secret:RETELL_API_KEY',
    );
  });
});

describe('end', () => {
  it('PATCHes end-chat with the id in the path', async () => {
    const { ctx: c, calls } = ctx({}, [new Response(null, { status: 204 })]);
    await retell.end?.(c, { chatId: 'chat_9' });
    expect(calls[0]?.url).toBe('https://api.retellai.com/end-chat/chat_9');
    expect(calls[0]?.init.method).toBe('PATCH');
  });

  it('never throws, since ending is best effort', async () => {
    const doFetch = vi.fn(async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    const { ctx: c } = ctx();
    await expect(retell.end?.({ ...c, fetch: doFetch }, { chatId: 'x' })).resolves.toBeUndefined();
  });
});

describe('capabilities', () => {
  it('supports ending but not polling', () => {
    expect(retell.capabilities).toEqual({ poll: false, end: true });
  });
});
