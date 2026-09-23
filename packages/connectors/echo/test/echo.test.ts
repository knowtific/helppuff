import { describe, expect, it, vi } from 'vitest';
import { messageSchema, type StartSessionRequest } from '@murmur/protocol';
import { isConnectorError, type ConnectorContext } from '@murmur/connector-types';
import echo from '../src/index.js';

function ctx(options: unknown = {}): ConnectorContext<unknown> {
  return {
    options: echo.parseOptions(options),
    siteId: 'test',
    sessionId: 's1',
    env: {},
    kv: { get: async () => null, put: async () => {}, delete: async () => {} },
    fetch: (() => {
      throw new Error('echo must not make network calls');
    }) as unknown as typeof fetch,
    log: () => {},
    waitUntil: () => {},
  };
}

const start: StartSessionRequest = { context: { pageUrl: 'https://example.com/' } };

function expectValid(messages: unknown[]) {
  for (const message of messages) {
    const result = messageSchema.safeParse(message);
    if (!result.success) {
      throw new Error(`invalid message: ${JSON.stringify(message)}\n${result.error.message}`);
    }
  }
}

describe('echo connector', () => {
  it('greets on start', async () => {
    const { messages, state } = await echo.start(ctx(), start);
    expectValid(messages);
    expect(messages[0]).toMatchObject({ type: 'text', role: 'agent' });
    expect(state).toEqual({ turn: 1 });
  });

  it('answers firstMessage in the same batch as the greeting', async () => {
    const { messages } = await echo.start(ctx(), { ...start, firstMessage: '/options' });
    expectValid(messages);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ type: 'options' });
  });

  it('uses a configured greeting', async () => {
    const { messages } = await echo.start(ctx({ greeting: 'Custom hello' }), start);
    expect(messages[0]).toMatchObject({ type: 'text', text: 'Custom hello' });
  });

  it.each([
    ['/options', 'options'],
    ['/multi', 'options'],
    ['/card', 'card'],
    ['/carousel', 'carousel'],
    ['/links', 'links'],
    ['/form', 'form'],
    ['/notice', 'notice'],
    ['/long', 'text'],
  ])('%s returns a valid %s message', async (command, type) => {
    const { messages } = await echo.send(ctx(), { turn: 1 }, { kind: 'text', text: command, clientId: 'c1' });
    expectValid(messages);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type });
  });

  it('is case- and whitespace-insensitive about commands', async () => {
    const { messages } = await echo.send(ctx(), { turn: 1 }, { kind: 'text', text: '  /CARD ', clientId: 'c1' });
    expect(messages[0]).toMatchObject({ type: 'card' });
  });

  it('echoes anything else and advances the turn', async () => {
    const result = await echo.send(ctx(), { turn: 3 }, { kind: 'text', text: 'hello', clientId: 'c1' });
    expectValid(result.messages);
    expect(result.messages[0]).toMatchObject({ type: 'text', text: 'You said: **hello**' });
    expect(result.state).toEqual({ turn: 4 });
  });

  it('acts on an action\'s value, not its label (§4.3)', async () => {
    const { messages } = await echo.send(
      ctx(),
      { turn: 1 },
      { kind: 'action', actionId: 'a1', value: '/card', label: 'Show a card', clientId: 'c1' },
    );
    expect(messages[0]).toMatchObject({ type: 'card' });
  });

  it('echoes the label of an action input', async () => {
    const { messages } = await echo.send(
      ctx(),
      { turn: 1 },
      { kind: 'action', actionId: 'a1', value: 'quote', label: 'Get a quote', clientId: 'c1' },
    );
    expect(messages[0]).toMatchObject({ type: 'text', text: 'You said: **Get a quote**' });
  });

  it('/error throws a ConnectorError with a visitor-safe message', async () => {
    const promise = echo.send(ctx(), { turn: 1 }, { kind: 'text', text: '/error', clientId: 'c1' });
    await expect(promise).rejects.toSatisfy(
      (error: unknown) =>
        isConnectorError(error) && error.code === 'connector_error' && !error.message.includes('echo_forced'),
    );
  });

  it('/slow waits three seconds', async () => {
    vi.useFakeTimers();
    try {
      const promise = echo.send(ctx(), { turn: 1 }, { kind: 'text', text: '/slow', clientId: 'c1' });
      await vi.advanceTimersByTimeAsync(3000);
      const { messages } = await promise;
      expect(messages[0]).toMatchObject({ type: 'text' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('/multipart returns two messages with distinct ids', async () => {
    const { messages } = await echo.send(ctx(), { turn: 1 }, { kind: 'text', text: '/multipart', clientId: 'c1' });
    expectValid(messages);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.id).not.toBe(messages[1]!.id);
  });

  it('declares its capabilities', () => {
    expect(echo.capabilities).toEqual({ poll: false, end: true });
  });

  it('rejects options outside the schema', () => {
    expect(() => echo.parseOptions({ delayMs: -1 })).toThrow();
  });
});
