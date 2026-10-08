import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Message } from '@helppuff/protocol';
import { App, type AppHandleRef } from '../src/app/App.js';
import type { Api } from '../src/app/api.js';
import { parseConfig } from '../src/app/validate.js';
import { Disposer } from '../src/lib/safe.js';
import type { Runtime } from '../src/loader.js';

/**
 * Live chat as a visitor sees it: the "Talk to a person" button (only with
 * live chat on), the hand-over notices, the team's replies with a name, and
 * the live chunk loaded only once a chat is handed over.
 */

const agentText = (text: string, extra: Partial<Message> = {}): Message => ({ id: `a${Math.random()}`, ts: Date.now(), role: 'agent', type: 'text', text, ...extra }) as Message;
const handover = (status: 'waiting' | 'joined' | 'left' | 'missed', text: string, agentName?: string): Message =>
  ({ id: `ho${Math.random()}`, ts: Date.now(), role: 'system', type: 'handover', status, text, ...(agentName ? { agentName } : {}) }) as Message;

/** Sockets the live chunk opens, recorded instead of connecting. */
class FakeSocket {
  static made: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.made.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
}

beforeEach(() => {
  FakeSocket.made = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  // The build defines this; here it points at the source, so the real chunk loads.
  vi.stubGlobal('__HELPPUFF_LIVE_FILE__', pathToFileURL(resolve(__dirname, '../src/live/index.ts')).href);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

function setup(live: boolean, send: (input: { kind: string; actionId?: string }) => Promise<{ messages: Message[] }>) {
  const host = document.createElement('helppuff-widget');
  document.body.appendChild(host);
  const runtime = {
    host,
    root: host.attachShadow({ mode: 'open' }),
    apiBase: 'https://api.test',
    siteId: `live-${Math.random()}`,
    rawConfig: {},
    capabilities: { poll: false, end: true, stream: false, live },
    disposer: new Disposer(),
    version: 'test',
    hide: vi.fn(),
    emit: vi.fn(),
  } as unknown as Runtime;
  const config = parseConfig({ brand: { name: 'Acme', agentName: 'Alex', accent: '#5B5BF7' }, leadForm: { enabled: false, fields: [] } })!;
  const sendSpy = vi.fn(send);
  const api = {
    startSession: vi.fn(async () => ({ session: { token: 'tok-1', id: 'sid-1', expiresAt: Date.now() + 3600_000 }, messages: [agentText('Hi! How can I help?')] })),
    send: sendSpy,
    end: vi.fn(),
    rate: vi.fn(),
  } as unknown as Api;
  const handle: AppHandleRef = { current: null };
  render(<App runtime={runtime} config={config} api={api} handle={handle} />);
  return { handle, send: sendSpy };
}

const inThread = () => within(document.querySelector('.hp-thread') as HTMLElement);

async function startChat(handle: AppHandleRef) {
  await act(async () => handle.current!.open());
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button').find((b) => /start|conversation/i.test(b.textContent ?? ''))!);
  });
  await waitFor(() => expect(inThread().getByText('Hi! How can I help?')).toBeTruthy());
}

describe('live chat in the widget', () => {
  it('has no "Talk to a person" button, and loads no live code, while live chat is off', async () => {
    const { handle } = setup(false, async () => ({ messages: [agentText('ok')] }));
    await startChat(handle);
    expect(screen.queryByRole('button', { name: 'Talk to a person' })).toBeNull();
    expect(FakeSocket.made).toEqual([]);
  });

  it('asks for a person, shows the wait, then who joined and what they wrote', async () => {
    const { handle, send } = setup(true, async () => ({ messages: [handover('waiting', 'Connecting you with someone from the team.')] }));
    await startChat(handle);
    // Connected as soon as there is a chat (the team can take it over), with the token as a subprotocol.
    await waitFor(() => expect(FakeSocket.made).toHaveLength(1));
    const socket = FakeSocket.made[0]!;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Talk to a person' }));
    });
    expect(send).toHaveBeenCalledWith('tok-1', expect.objectContaining({ kind: 'action', actionId: 'handover' }), undefined);
    await waitFor(() => expect(inThread().getByText('Connecting you with someone from the team.')).toBeTruthy());
    // Waiting for a person now: the button goes, and the same connection carries on.
    expect(screen.queryByRole('button', { name: 'Talk to a person' })).toBeNull();
    expect(FakeSocket.made).toHaveLength(1);
    expect(socket.url).toBe('wss://api.test/v1/live/socket');
    expect(socket.protocols).toEqual(['helppuff.v1', 't.tok-1']);

    // The team joins and answers over the socket.
    await act(async () => {
      socket.readyState = 1;
      socket.onopen?.();
      socket.onmessage?.({ data: JSON.stringify({ t: 'typing', on: true }) });
      socket.onmessage?.({ data: JSON.stringify({ t: 'msg', message: handover('joined', 'Sam joined the chat.', 'Sam') }) });
      socket.onmessage?.({ data: JSON.stringify({ t: 'msg', message: agentText('Hi, Sam here. How can I help?', { meta: { human: true, agentName: 'Sam' } }) }) });
    });
    await waitFor(() => expect(inThread().getByText('Hi, Sam here. How can I help?')).toBeTruthy());
    expect(inThread().getByText('Sam joined the chat.')).toBeTruthy();
    // The person's name over their message, and in the header.
    expect(document.querySelector('.hp-agent-name')?.textContent).toBe('Sam');
    expect(document.querySelector('.hp-header-status')?.textContent).toContain('Sam');
  });

  it('stays with the assistant when nobody was free (a "missed" with no wait before it)', async () => {
    const { handle } = setup(true, async () => ({
      messages: [handover('missed', 'Nobody from the team is free right now.'), { id: 'callback_live', ts: Date.now(), role: 'agent', type: 'form', fields: [{ name: 'phone', label: 'Phone', type: 'tel' }] } as Message],
    }));
    await startChat(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Talk to a person' }));
    });
    await waitFor(() => expect(inThread().getByText('Nobody from the team is free right now.')).toBeTruthy());
    // Still the one quiet connection, nothing polling, and they can ask again later.
    expect(screen.getByRole('button', { name: 'Talk to a person' })).toBeTruthy();
  });

  it('stays connected after a wait runs out ("missed" after "waiting"): the visitor may keep waiting', async () => {
    const { handle } = setup(true, async () => ({ messages: [handover('waiting', 'Connecting you…')] }));
    await startChat(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Talk to a person' }));
    });
    await waitFor(() => expect(FakeSocket.made).toHaveLength(1));
    const socket = FakeSocket.made[0]!;
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ t: 'msg', message: handover('missed', 'Nobody is free just now.') }) });
    });
    await waitFor(() => expect(inThread().getByText('Nobody is free just now.')).toBeTruthy());
    expect(socket.readyState).not.toBe(3);
    expect(FakeSocket.made).toHaveLength(1);
  });

  it('stays connected when the team hands back to the assistant, so it can take over again', async () => {
    const { handle } = setup(true, async () => ({ messages: [handover('waiting', 'Connecting you…')] }));
    await startChat(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Talk to a person' }));
    });
    await waitFor(() => expect(FakeSocket.made).toHaveLength(1));
    const socket = FakeSocket.made[0]!;
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ t: 'msg', message: handover('left', 'You’re back with the assistant.') }) });
    });
    await waitFor(() => expect(inThread().getByText('You’re back with the assistant.')).toBeTruthy());
    expect(socket.readyState).not.toBe(3);
    // The button is back: the visitor can ask again.
    expect(screen.getByRole('button', { name: 'Talk to a person' })).toBeTruthy();
    // The team takes it over again: it arrives on the same connection.
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ t: 'msg', message: handover('joined', 'Sam joined the chat.', 'Sam') }) });
    });
    await waitFor(() => expect(inThread().getByText('Sam joined the chat.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Talk to a person' })).toBeNull();
  });
});
