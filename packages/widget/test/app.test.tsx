import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { Message } from '@murmur/protocol';
import { App, Boundary, type AppCommands, type AppHandleRef } from '../src/app/App.js';
import { ApiError, type Api } from '../src/app/api.js';
import { parseConfig } from '../src/app/validate.js';
import { Disposer } from '../src/lib/safe.js';
import type { Runtime } from '../src/loader.js';

/**
 * Functional tests for the whole app: the real components, the real reducer
 * and the real persistence layer, driven through a fake transport. These are
 * the tests that prove the pieces work together — the widget's state machine as a
 * visitor actually experiences it.
 */

const CONFIG_INPUT = {
  brand: { name: 'Knowtific', agentName: 'Alex', accent: '#5B5BF7' },
  home: { title: 'Hi there', subtitle: 'Ask anything.' },
  leadForm: {
    enabled: true,
    fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
    submitLabel: 'Start chat',
  },
  chat: { placeholder: 'Type a message…', fallbackContact: { phone: '+61400000000' } },
};

const agentText = (text: string, id = `a${Math.random()}`): Message => ({
  id,
  ts: Date.now(),
  role: 'agent',
  type: 'text',
  text,
});

type AnyFn = (...args: never[]) => unknown;

type FakeApi = {
  api: Api;
  startSession: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function fakeApi(overrides: { startSession?: AnyFn; send?: AnyFn } = {}): FakeApi {
  const startSession = vi.fn(
    overrides.startSession ??
      (async () => ({
        session: { token: 'tok-1', id: 'sid-1', expiresAt: Date.now() + 3600_000 },
        messages: [agentText('Hi — how can I help?', 'greet')],
      })),
  );
  const send = vi.fn(overrides.send ?? (async () => ({ messages: [agentText('You said that.')] })));
  const end = vi.fn();
  return { api: { startSession, send, end } as unknown as Api, startSession, send, end };
}

function setup(
  options: { config?: Record<string, unknown>; api?: FakeApi; siteId?: string; stream?: boolean } = {},
) {
  const host = document.createElement('murmur-widget');
  document.body.appendChild(host);

  const hide = vi.fn();
  const emit = vi.fn();
  const runtime = {
    host,
    root: host.attachShadow({ mode: 'open' }),
    apiBase: 'https://api.test',
    siteId: options.siteId ?? 'demo',
    rawConfig: {},
    capabilities: { poll: false, end: true, stream: options.stream ?? false },
    disposer: new Disposer(),
    version: 'test',
    hide,
    emit,
  } as unknown as Runtime;

  const config = parseConfig({ ...CONFIG_INPUT, ...(options.config ?? {}) })!;
  const transport = options.api ?? fakeApi();
  const handle: AppHandleRef = { current: null };

  const utils = render(<App runtime={runtime} config={config} api={transport.api} handle={handle} />);

  return { ...utils, runtime, hide, emit, handle, ...transport };
}

/**
 * The thread and the `aria-live` region deliberately carry the same text —
 * one to read, one to announce. Assertions scope to the thread so they
 * are not ambiguous.
 */
const inThread = () => within(document.querySelector('.mm-thread') as HTMLElement);

const seeMessage = async (text: string) =>
  waitFor(() => expect(inThread().getByText(text)).toBeTruthy());

const commands = (handle: AppHandleRef): AppCommands => {
  if (!handle.current) throw new Error('app handle was never published');
  return handle.current;
};

const openPanel = async (handle: AppHandleRef) => {
  await act(async () => {
    commands(handle).open();
  });
};

describe('opening and closing', () => {
  it('shows only the launcher until it is opened', () => {
    setup();
    expect(screen.getByRole('button', { name: /chat with knowtific/i })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the panel on the launcher, landing on the home screen', async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /chat with knowtific/i }));
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(screen.getByRole('heading', { name: 'Hi there' })).toBeTruthy();
  });

  it('labels the dialog by the agent name in the header', async () => {
    const { handle } = setup();
    await openPanel(handle);
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Alex');
  });

  it('emits open and close for host-page analytics', async () => {
    const { handle, emit } = setup();
    await openPanel(handle);
    expect(emit).toHaveBeenCalledWith('open');

    vi.useFakeTimers();
    void act(() => {
      commands(handle).close();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();
    expect(emit).toHaveBeenCalledWith('close');
  });
});

describe('the lead form path', () => {
  it('goes home → form → thread and starts a session with the lead', async () => {
    const { handle, startSession } = setup();
    await openPanel(handle);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    expect(screen.getByLabelText(/Name/)).toBeTruthy();

    await act(async () => {
      fireEvent.input(screen.getByLabelText(/Name/), { target: { value: 'Ada' } });
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    });

    await seeMessage('Hi — how can I help?');
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({ lead: { name: 'Ada' }, context: expect.objectContaining({ pageUrl: expect.any(String) }) }),
      // No streaming on this site, so no preview callback.
      undefined,
    );
  });

  it("shows the visitor's own first message, not just the reply to it", async () => {
    const api = fakeApi();
    api.startSession.mockResolvedValue({
      session: { token: 'tok-1', id: 'sid-1', expiresAt: Date.now() + 3600_000 },
      messages: [agentText('Hi — how can I help?', 'greet'), agentText('You said: qwedae', 'reply')],
    });

    const { handle } = setup({
      config: { leadForm: { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text', required: true }], askFirstMessage: true } },
      api,
    });
    await openPanel(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });

    await act(async () => {
      fireEvent.input(screen.getByLabelText(/Name/), { target: { value: 'Ada' } });
      fireEvent.input(screen.getByLabelText(/How can we help/), { target: { value: 'qwedae' } });
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    });

    await seeMessage('You said: qwedae');
    // Regression: the first message rides along with the session, so nothing
    // else would put it in the thread — the visitor saw an answer to a
    // question that was never shown.
    const rows = [...document.querySelectorAll('.mm-row')];
    expect(rows[0]?.hasAttribute('data-user'), 'the visitor spoke first').toBe(true);
    expect(rows[0]?.textContent).toContain('qwedae');
    expect(api.startSession.mock.calls[0]?.[0]).toMatchObject({ firstMessage: 'qwedae' });
  });

  describe('a message written before the lead form (a finished flow, or send())', () => {
    const askFirst = {
      leadForm: { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text', required: true }], askFirstMessage: true },
    };

    const writeThenFillLead = async (handle: AppHandleRef, text: string) => {
      await act(async () => {
        commands(handle).send(text);
      });
      await act(async () => {
        fireEvent.input(screen.getByLabelText(/Name/), { target: { value: 'Ada' } });
      });
    };

    it('prefills the first-message box and sends it', async () => {
      const { handle, startSession } = setup({ config: askFirst });
      await writeThenFillLead(handle, "I'd like a quote for a new website.");

      const box = screen.getByLabelText(/How can we help/) as HTMLTextAreaElement;
      expect(box.value).toBe("I'd like a quote for a new website.");

      await act(async () => {
        fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      });
      expect(startSession.mock.calls[0]?.[0]).toMatchObject({ firstMessage: "I'd like a quote for a new website." });
    });

    it('sends the edited text, not the original, when the visitor changes it', async () => {
      // Regression: typing in the box used to replace a flow's summary
      // outright, so its answers never reached the agent.
      const { handle, startSession } = setup({ config: askFirst });
      await writeThenFillLead(handle, "I'd like a quote for a new website.");

      await act(async () => {
        fireEvent.input(screen.getByLabelText(/How can we help/), {
          target: { value: "I'd like a quote for a new website. Budget is flexible." },
        });
      });
      await act(async () => {
        fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      });
      expect(startSession.mock.calls[0]?.[0]).toMatchObject({
        firstMessage: "I'd like a quote for a new website. Budget is flexible.",
      });
    });
  });

  it('will not start a session until the required field is filled', async () => {
    const { handle, startSession } = setup();
    await openPanel(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(document.querySelector('.mm-error-text')?.textContent).toMatch(/required/i);
  });

  it('skips the form entirely when it is disabled', async () => {
    const { handle, startSession } = setup({ config: { leadForm: { enabled: false } } });
    await openPanel(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await waitFor(() => expect(startSession).toHaveBeenCalledOnce());
    expect(document.querySelector('form')).toBeNull();
  });

  it('skips the form when identify() already supplied everything required', async () => {
    const { handle, startSession } = setup();
    void act(() => {
      commands(handle).identify({ name: 'Grace' });
    });
    await openPanel(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await waitFor(() => expect(startSession).toHaveBeenCalledOnce());
    expect(startSession.mock.calls[0]?.[0]).toMatchObject({ lead: { name: 'Grace' } });
  });

  it('still shows the form when identify() was partial', async () => {
    const { handle } = setup({
      config: {
        leadForm: {
          enabled: true,
          fields: [
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'phone', label: 'Phone', type: 'tel', required: true },
          ],
        },
      },
    });
    void act(() => {
      commands(handle).identify({ name: 'Grace' });
    });
    await openPanel(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    expect(screen.getByLabelText(/Phone/)).toBeTruthy();
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe('Grace');
  });
});

describe('sending and receiving', () => {
  async function liveChat() {
    const harness = setup({ config: { leadForm: { enabled: false } } });
    await openPanel(harness.handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await seeMessage('Hi — how can I help?');
    return harness;
  }

  it('renders the user message optimistically, then the reply', async () => {
    const { handle } = await liveChat();
    const box = screen.getByRole('textbox');

    await act(async () => {
      fireEvent.input(box, { target: { value: 'Hello there' } });
    });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });

    expect(inThread().getByText('Hello there')).toBeTruthy();
    await seeMessage('You said that.');
    expect(commands(handle).state()).toMatchObject({ screen: 'chat', status: 'idle' });
  });

  it('clears the composer when a message is sent', async () => {
    await liveChat();
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.input(box, { target: { value: 'Hello' } });
    });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''));
  });

  it('shows a typing indicator while waiting', async () => {
    let release: (value: { messages: Message[] }) => void = () => {};
    const api = fakeApi({ send: (() => new Promise((resolve) => { release = resolve as typeof release; })) as AnyFn });
    const harness = setup({ config: { leadForm: { enabled: false } }, api });

    await openPanel(harness.handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await seeMessage('Hi — how can I help?');

    const box = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.input(box, { target: { value: 'Slow one' } });
    });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });

    expect(harness.container.querySelector('.mm-typing')).toBeTruthy();

    await act(async () => {
      release({ messages: [agentText('Done')] });
    });
    await waitFor(() => expect(harness.container.querySelector('.mm-typing')).toBeNull());
  });

  it('adopts a refreshed session token for the next request', async () => {
    const api = fakeApi();
    api.send.mockResolvedValueOnce({ messages: [agentText('One')], token: 'tok-2' });
    const harness = setup({ config: { leadForm: { enabled: false } }, api });

    await openPanel(harness.handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await seeMessage('Hi — how can I help?');

    for (const text of ['first', 'second']) {
      const box = screen.getByRole('textbox');
      await act(async () => {
        fireEvent.input(box, { target: { value: text } });
      });
      await act(async () => {
        fireEvent.keyDown(box, { key: 'Enter' });
      });
      await waitFor(() => expect(api.send).toHaveBeenCalledTimes(text === 'first' ? 1 : 2));
    }

    expect(api.send.mock.calls[0]?.[0]).toBe('tok-1');
    expect(api.send.mock.calls[1]?.[0]).toBe('tok-2');
  });

  it('drops a malformed message from the server rather than rendering junk', async () => {
    const api = fakeApi();
    // The Api layer validates, so a bad message never reaches the app —
    // this asserts the app tolerates an empty batch.
    api.send.mockResolvedValueOnce({ messages: [] });
    const harness = setup({ config: { leadForm: { enabled: false } }, api });

    await openPanel(harness.handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await seeMessage('Hi — how can I help?');

    const box = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.input(box, { target: { value: 'hi' } });
    });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });

    await seeMessage('hi');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('recoverable failures degrade in place', () => {
  async function failingChat(error: ApiError) {
    const api = fakeApi();
    api.send.mockRejectedValue(error);
    const harness = setup({ config: { leadForm: { enabled: false } }, api });

    await openPanel(harness.handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await seeMessage('Hi — how can I help?');

    const box = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.input(box, { target: { value: 'will fail' } });
    });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    return harness;
  }

  it('keeps the panel open and hands the typed message back', async () => {
    const { hide } = await failingChat(
      new ApiError({ code: 'connector_error', message: 'The assistant is unavailable.', retryable: true }),
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // The widget must not vanish mid-conversation.
    expect(hide).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    // The typed text is returned to the composer, not lost.
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('will fail'));
  });

  it('offers the fallback contact when the backend is down', async () => {
    await failingChat(new ApiError({ code: 'quota_exceeded', message: 'Unavailable', retryable: false }));
    await waitFor(() => expect(screen.getByRole('link', { name: /call us/i })).toBeTruthy());
  });

  it('retries the same message', async () => {
    const api = fakeApi();
    api.send.mockRejectedValueOnce(new ApiError({ code: 'connector_error', message: 'Nope', retryable: true }));
    api.send.mockResolvedValueOnce({ messages: [agentText('Second time lucky')] });

    const harness = setup({ config: { leadForm: { enabled: false } }, api });
    await openPanel(harness.handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await seeMessage('Hi — how can I help?');

    const box = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.input(box, { target: { value: 'retry me' } });
    });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    });
    await seeMessage('Second time lucky');
  });

  it('reports a failed session start without leaving the form', async () => {
    const api = fakeApi();
    api.startSession.mockRejectedValue(
      new ApiError({ code: 'rate_limited', message: 'Too many. Try again shortly.', retryable: true, retryAfter: 30 }),
    );
    const { handle, hide } = setup({ api });

    await openPanel(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await act(async () => {
      fireEvent.input(screen.getByLabelText(/Name/), { target: { value: 'Ada' } });
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/too many/i)).toBeTruthy();
    expect(hide).not.toHaveBeenCalled();
  });
});

describe('persistence across a reload', () => {
  it('restores the session and lands in the thread', async () => {
    const first = setup({ config: { leadForm: { enabled: false } } });
    await openPanel(first.handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await seeMessage('Hi — how can I help?');
    await waitFor(() => expect(localStorage.getItem('mm:demo')).toBeTruthy());

    first.unmount();

    // A fresh mount, as if the page had reloaded.
    const second = setup({ config: { leadForm: { enabled: false } } });
    await openPanel(second.handle);
    await seeMessage('Hi — how can I help?');
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('writes under one mm:-prefixed key and sets no cookies', async () => {
    const { handle } = setup({ config: { leadForm: { enabled: false } }, siteId: 'acme' });
    await openPanel(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await waitFor(() => expect(localStorage.getItem('mm:acme')).toBeTruthy());
    expect(Object.keys(localStorage).every((key) => key.startsWith('mm:'))).toBe(true);
    expect(document.cookie).toBe('');
  });

  it('reset() clears the stored conversation', async () => {
    const { handle } = setup({ config: { leadForm: { enabled: false } } });
    await openPanel(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await waitFor(() => expect(localStorage.getItem('mm:demo')).toBeTruthy());

    await act(async () => {
      commands(handle).reset();
    });
    expect(localStorage.getItem('mm:demo')).toBeNull();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Hi there' })).toBeTruthy());
  });

  it('keeps working when localStorage throws', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });

    try {
      const { handle, hide } = setup({ config: { leadForm: { enabled: false } } });
      await openPanel(handle);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
      });
      await seeMessage('Hi — how can I help?');
      expect(hide).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});

describe('streamed replies', () => {
  it('shows the typing dots until text arrives, then the reply as it is written, then the real message', async () => {
    let release: (value: { messages: Message[] }) => void = () => {};
    let write: (text: string) => void = () => {};
    const api = fakeApi({
      send: (_token: string, _input: unknown, onText?: (text: string) => void) => {
        write = onText ?? (() => {});
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    } as never);
    const { handle } = setup({ config: { leadForm: { enabled: false } }, api, stream: true });

    await openPanel(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await seeMessage('Hi — how can I help?');

    await act(async () => {
      commands(handle).send('How much?');
    });
    // Nothing written yet — a reasoning model is still thinking.
    await waitFor(() => expect(document.querySelector('.mm-typing')).not.toBeNull());
    expect(api.send.mock.calls[0]?.[2]).toBeTypeOf('function');

    await act(async () => {
      write('Plans start ');
      write('from **$90**');
    });
    const streaming = document.querySelector('[data-streaming]');
    expect(streaming?.textContent).toBe('Plans start from $90');
    expect(streaming?.querySelector('strong')).not.toBeNull();
    expect(document.querySelector('.mm-typing')).toBeNull();

    await act(async () => {
      release({ messages: [agentText('Plans start from **$90/month**.', 'final')] });
    });
    await waitFor(() => expect(document.querySelector('[data-streaming]')).toBeNull());
    // The preview is display only: the transcript holds the real message.
    expect(document.querySelector('.mm-thread')?.textContent).toContain('Plans start from $90/month.');
    expect(document.querySelector('.mm-thread')?.textContent).not.toContain('from $90Plans');
  });

  it('does not ask for a stream on a site that does not stream', async () => {
    const { handle, send } = setup({ config: { leadForm: { enabled: false } } });
    await openPanel(handle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start a conversation/i }));
    });
    await seeMessage('Hi — how can I help?');
    await act(async () => {
      commands(handle).send('Hello');
    });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0]?.[2]).toBeUndefined();
  });
});

describe('the window.Murmur surface', () => {
  it('publishes a handle with every command', async () => {
    const { handle } = setup();
    await waitFor(() => expect(handle.current).not.toBeNull());
    for (const name of ['open', 'close', 'toggle', 'send', 'identify', 'reset', 'state']) {
      expect(typeof (handle.current as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('send() opens a session and delivers the message', async () => {
    const { handle, startSession } = setup({ config: { leadForm: { enabled: false } } });
    await act(async () => {
      commands(handle).send('I need a quote');
    });
    await waitFor(() => expect(startSession).toHaveBeenCalledOnce());
    expect(startSession.mock.calls[0]?.[0]).toMatchObject({ firstMessage: 'I need a quote' });
  });

  it('toggle() flips the panel', async () => {
    const { handle } = setup();
    await act(async () => {
      commands(handle).toggle();
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('the error boundary', () => {
  function Bomb(): never {
    throw new Error('render exploded');
  }

  it('recovers once, then hides on a second failure, and never rethrows', async () => {
    const runtime = { hide: vi.fn() } as unknown as Runtime;
    const onReset = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { container } = render(
        <Boundary runtime={runtime} onReset={onReset}>
          <Bomb />
        </Boundary>,
      );

      // First failure: nothing is rendered and the widget does not hide.
      expect(container.innerHTML).toBe('');
      expect(runtime.hide).not.toHaveBeenCalled();

      // Recovery runs on a microtask, which re-renders the same failing tree.
      await act(async () => {
        await Promise.resolve();
      });

      expect(onReset).toHaveBeenCalledOnce();
      // The second failure is fatal — and must not propagate to the host page.
      await waitFor(() => expect(runtime.hide).toHaveBeenCalledWith('render_error_twice'));
      expect(container.innerHTML).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  it('renders its children when nothing throws', () => {
    const runtime = { hide: vi.fn() } as unknown as Runtime;
    render(
      <Boundary runtime={runtime} onReset={() => {}}>
        <p>fine</p>
      </Boundary>,
    );
    expect(screen.getByText('fine')).toBeTruthy();
    expect(runtime.hide).not.toHaveBeenCalled();
  });
});

describe('keyboard and focus', () => {
  it('closes on Escape', async () => {
    const { handle } = setup();
    await openPanel(handle);
    expect(screen.getByRole('dialog')).toBeTruthy();

    vi.useFakeTimers();
    void act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ignores Escape while closed, so the host page keeps its own handler', () => {
    setup();
    const onKeyDown = vi.fn();
    window.addEventListener('keydown', onKeyDown);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onKeyDown).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', onKeyDown);
  });

  it('moves focus into the panel when it opens', async () => {
    const { handle, container } = setup();
    await openPanel(handle);
    await waitFor(() => {
      const panel = container.querySelector('.mm-panel');
      expect(panel?.contains(document.activeElement)).toBe(true);
    });
  });
});
