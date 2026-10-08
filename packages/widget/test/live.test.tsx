import { afterEach, describe, expect, it, vi } from 'vitest';
import { HANDOVER_ACTION as SERVER_HANDOVER_ACTION, LIVE_SUBPROTOCOL } from '@helppuff/protocol';
import { HANDOVER_ACTION } from '@helppuff/protocol/live';
import { connectLive } from '../src/live/index.js';
import { parseMessage } from '../src/app/validate.js';
import { initialState, reducer } from '../src/app/store.js';

/** A WebSocket that the test drives: open it, send it frames, close it. */
class FakeSocket {
  static made: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.made.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  frame(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

afterEach(() => {
  FakeSocket.made = [];
  vi.useRealTimers();
});

const hooks = () => {
  const got = { messages: [] as unknown[], typing: [] as boolean[], statuses: [] as string[] };
  return {
    got,
    hooks: {
      onMessage: (m: unknown) => void got.messages.push(m),
      onStatus: (s: string) => void got.statuses.push(s),
      onTyping: (on: boolean) => void got.typing.push(on),
      parse: parseMessage,
    },
  };
};

describe('the live client', () => {
  it('connects with the token as a subprotocol, never in the URL, and passes on what the team sends', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    const { got, hooks: h } = hooks();
    const conn = connectLive({ apiBase: 'https://chat.example.com', token: () => 'tok.sig', lastTs: () => 5, hooks: h, WebSocket: FakeSocket as never, fetch });
    const socket = FakeSocket.made[0]!;
    expect(socket.url).toBe('wss://chat.example.com/v1/live/socket');
    expect(socket.protocols).toEqual([LIVE_SUBPROTOCOL, 't.tok.sig']);
    socket.open();
    // On connect it catches up on anything missed.
    expect(fetch).toHaveBeenCalledWith('https://chat.example.com/v1/sessions/messages?after=5', expect.objectContaining({ headers: { Authorization: 'Bearer tok.sig' } }));
    socket.frame({ t: 'msg', message: { id: 'h1', ts: 9, role: 'agent', type: 'text', text: 'Hi, Sam here.', meta: { human: true, agentName: 'Sam' } } });
    socket.frame({ t: 'msg', message: { id: 'bad', role: 'agent', type: 'text' } });
    socket.frame({ t: 'typing', on: true });
    socket.frame({ t: 'status', status: 'joined', agentName: 'Sam' });
    expect(got.messages).toEqual([{ id: 'h1', ts: 9, role: 'agent', type: 'text', text: 'Hi, Sam here.', meta: { human: true, agentName: 'Sam' } }]);
    expect(got.typing).toEqual([true]);
    expect(got.statuses).toEqual(['joined']);
    conn.typing(true);
    expect(socket.sent).toContain(JSON.stringify({ t: 'typing', on: true }));
    conn.close();
  });

  it('polls instead when sockets never connect, and stops when the team hands back', async () => {
    vi.useFakeTimers();
    const responses = [
      { messages: [{ id: 'h2', ts: 10, role: 'agent', type: 'text', text: 'Still there?', meta: { human: true } }] },
      { messages: [{ id: 'ho', ts: 11, role: 'system', type: 'handover', status: 'left', text: 'You’re back with the assistant.' }] },
    ];
    const fetch = vi.fn(async () => new Response(JSON.stringify(responses.shift() ?? { messages: [] }), { status: 200 }));
    const { got, hooks: h } = hooks();
    connectLive({ apiBase: 'https://chat.example.com', token: () => 'tok', lastTs: () => 0, hooks: h, WebSocket: FakeSocket as never, fetch });
    for (let i = 0; i < 3; i++) {
      FakeSocket.made.at(-1)!.onclose?.({ code: 1006, reason: '' });
      await vi.runOnlyPendingTimersAsync();
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(got.messages.map((m) => (m as { id: string }).id)).toEqual(['h2', 'ho']);
    expect(got.statuses).toEqual(['left']);
    const calls = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch.mock.calls.length).toBe(calls);
  });
});

describe('live messages in the store', () => {
  it('appends a message once, counts it unread when closed, and stops the typing dots', () => {
    const message = { id: 'h1', ts: 1, role: 'agent' as const, type: 'text' as const, text: 'Hi' };
    let state = reducer(initialState, { type: 'live/typing', on: true });
    expect(state.agentTyping).toBe(true);
    state = reducer(state, { type: 'live/message', message });
    state = reducer(state, { type: 'live/message', message });
    expect(state.messages).toEqual([message]);
    expect(state.unread).toBe(1);
    expect(state.agentTyping).toBe(false);
  });

  it('parses handover messages and drops a bad status', () => {
    expect(parseMessage({ id: 'x', ts: 1, role: 'system', type: 'handover', status: 'joined', text: 'Sam joined the chat.', agentName: 'Sam' })).toEqual({
      id: 'x',
      ts: 1,
      role: 'system',
      type: 'handover',
      status: 'joined',
      text: 'Sam joined the chat.',
      agentName: 'Sam',
    });
    expect(parseMessage({ id: 'x', ts: 1, role: 'system', type: 'handover', status: 'busy', text: 'x' })).toBeNull();
  });

  it('uses the same handover action as the server', () => {
    expect(HANDOVER_ACTION).toBe(SERVER_HANDOVER_ACTION);
  });
});
