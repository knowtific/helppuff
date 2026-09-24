import { describe, expect, it } from 'vitest';
import { widgetConfigSchema, type Message, type WidgetConfig } from '@murmur/protocol';
import {
  MAX_STORED_MESSAGES,
  initialState,
  isBusy,
  leadIsComplete,
  reducer,
  visibleMessages,
  type Action,
  type Pending,
  type State,
} from '../src/app/store.js';

const config = (overrides: Parameters<typeof widgetConfigSchema.parse>[0] = {}): WidgetConfig =>
  widgetConfigSchema.parse(overrides);

const agentMessage = (id: string, text = 'hi'): Message => ({
  id, ts: 1, role: 'agent', type: 'text', text,
});

const userPending = (clientId: string, text: string): Pending => ({
  clientId,
  message: { id: clientId, ts: 1, role: 'user', type: 'text', text },
  input: { kind: 'text', text },
});

/** Apply a sequence of actions to the initial state. */
function run(actions: Action[], from: State = initialState): State {
  return actions.reduce(reducer, from);
}

const withConfig = (overrides = {}) => run([{ type: 'config/loaded', config: config(overrides) }]);

describe('panel visibility', () => {
  it('opens, closes and toggles', () => {
    const opened = run([{ type: 'open' }]);
    expect(opened.open).toBe(true);
    expect(reducer(opened, { type: 'close' }).open).toBe(false);
    expect(reducer(opened, { type: 'toggle' }).open).toBe(false);
    expect(reducer(initialState, { type: 'toggle' }).open).toBe(true);
  });

  it('clears the unread count on open', () => {
    const state = { ...initialState, unread: 3 };
    expect(reducer(state, { type: 'open' }).unread).toBe(0);
  });

  it('counts messages that arrive while closed as unread', () => {
    const state = run([
      { type: 'config/loaded', config: config() },
      { type: 'lead/submit', lead: { name: 'Ada' } },
      { type: 'session/started', session: { token: 't', id: 's', expiresAt: 9e15 }, messages: [agentMessage('a'), agentMessage('b')] },
    ]);
    expect(state.unread).toBe(2);
  });

  it('does not count messages as unread while open', () => {
    const state = run([
      { type: 'open' },
      { type: 'config/loaded', config: config() },
      { type: 'session/started', session: { token: 't', id: 's', expiresAt: 9e15 }, messages: [agentMessage('a')] },
    ]);
    expect(state.unread).toBe(0);
  });

  it('closing the panel keeps the conversation intact', () => {
    const open = run([
      { type: 'config/loaded', config: config() },
      { type: 'lead/submit', lead: { name: 'Ada' } },
      { type: 'session/started', session: { token: 't', id: 's', expiresAt: 9e15 }, messages: [agentMessage('a')] },
    ]);
    const closed = reducer(open, { type: 'close' });
    expect(closed.messages).toHaveLength(1);
    expect(closed.session).not.toBeNull();
    expect(closed.screen).toBe('chat');
  });
});

describe('start — routing through the lead form', () => {
  it('goes to the lead form when the form is enabled and nothing is known', () => {
    const state = reducer(withConfig(), { type: 'start' });
    expect(state.screen).toBe('lead_form');
    expect(state.status).toBe('idle');
  });

  it('skips the form when it is disabled', () => {
    const state = reducer(withConfig({ leadForm: { enabled: false } }), { type: 'start' });
    expect(state.screen).toBe('chat');
    expect(state.status).toBe('starting');
  });

  it('skips the form when identify() supplied every required field', () => {
    const identified = run([
      { type: 'config/loaded', config: config() },
      { type: 'identify', lead: { name: 'Ada', phone: '0400000000' } },
    ]);
    const state = reducer(identified, { type: 'start' });
    expect(state.screen).toBe('chat');
    expect(state.status).toBe('starting');
  });

  it('still shows the form when identify() was partial', () => {
    const identified = run([
      { type: 'config/loaded', config: config() },
      { type: 'identify', lead: { name: 'Ada' } },
    ]);
    expect(reducer(identified, { type: 'start' }).screen).toBe('lead_form');
  });

  it('merges successive identify() calls', () => {
    const state = run([
      { type: 'identify', lead: { name: 'Ada' } },
      { type: 'identify', lead: { phone: '0400000000' } },
    ]);
    expect(state.lead).toEqual({ name: 'Ada', phone: '0400000000' });
  });

  it('goes straight to the thread when a session already exists', () => {
    const live = { ...withConfig(), session: { token: 't', id: 's', expiresAt: 9e15 } };
    const state = reducer(live, { type: 'start' });
    expect(state.screen).toBe('chat');
    expect(state.status).toBe('idle');
  });

  it('submitting the form stores the lead and begins starting', () => {
    const state = reducer(withConfig(), { type: 'lead/submit', lead: { name: 'Ada', phone: '04' } });
    expect(state.lead).toEqual({ name: 'Ada', phone: '04' });
    expect(state.screen).toBe('chat');
    expect(state.status).toBe('starting');
    expect(isBusy(state)).toBe(true);
  });
});

describe('leadIsComplete', () => {
  it('is false without a config', () => {
    expect(leadIsComplete(null, { name: 'Ada' })).toBe(false);
  });

  it('is true when the form is disabled', () => {
    expect(leadIsComplete(config({ leadForm: { enabled: false } }), null)).toBe(true);
  });

  it('ignores optional fields', () => {
    const c = config({
      leadForm: {
        fields: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'email', label: 'Email', type: 'email' },
        ],
      },
    });
    expect(leadIsComplete(c, { name: 'Ada' })).toBe(true);
  });

  it('rejects a whitespace-only required value', () => {
    expect(leadIsComplete(config(), { name: '  ', phone: '04' })).toBe(false);
  });
});

describe('sending', () => {
  const live = (): State => ({
    ...withConfig(),
    session: { token: 't0', id: 's', expiresAt: 9e15 },
    screen: 'chat',
    open: true,
  });

  it('appends the user message optimistically and clears the draft', () => {
    const state = reducer({ ...live(), draft: 'hello' }, { type: 'send', pending: userPending('c1', 'hello') });
    expect(state.status).toBe('sending');
    expect(state.draft).toBe('');
    expect(visibleMessages(state)).toHaveLength(1);
    expect(state.messages).toHaveLength(0);
  });

  it('commits the pending message ahead of the reply on success', () => {
    const sending = reducer(live(), { type: 'send', pending: userPending('c1', 'hello') });
    const state = reducer(sending, { type: 'send/ok', clientId: 'c1', messages: [agentMessage('a')] });
    expect(state.status).toBe('idle');
    expect(state.pending).toHaveLength(0);
    expect(state.messages.map((m) => m.role)).toEqual(['user', 'agent']);
  });

  it('adopts a refreshed token', () => {
    const sending = reducer(live(), { type: 'send', pending: userPending('c1', 'hi') });
    const state = reducer(sending, { type: 'send/ok', clientId: 'c1', messages: [], token: 't1' });
    expect(state.session?.token).toBe('t1');
    expect(state.session?.id).toBe('s');
  });

  it('keeps the old token when none is returned', () => {
    const sending = reducer(live(), { type: 'send', pending: userPending('c1', 'hi') });
    const state = reducer(sending, { type: 'send/ok', clientId: 'c1', messages: [] });
    expect(state.session?.token).toBe('t0');
  });

  it('returns the typed text to the composer when a send fails', () => {
    const sending = reducer(live(), { type: 'send', pending: userPending('c1', 'keep me') });
    const state = reducer(sending, {
      type: 'send/failed',
      clientId: 'c1',
      error: { code: 'connector_error', message: 'nope', retryable: true },
    });
    expect(state.draft).toBe('keep me');
    expect(state.status).toBe('idle');
    expect(state.error?.retryable).toBe(true);
    // The widget stays open and in the thread — it never vanishes mid-conversation.
    expect(state.screen).toBe('chat');
    expect(state.session).not.toBeNull();
  });

  it('does not clobber a newer draft when an older send fails', () => {
    const sending = reducer(live(), { type: 'send', pending: userPending('c1', 'old') });
    const typing = reducer(sending, { type: 'draft', text: 'new' });
    const state = reducer(typing, {
      type: 'send/failed',
      clientId: 'c1',
      error: { code: 'connector_error', message: 'nope', retryable: true },
    });
    expect(state.draft).toBe('new');
  });

  it('does not restore a draft for a failed action tap', () => {
    const pending: Pending = {
      clientId: 'c1',
      message: { id: 'c1', ts: 1, role: 'user', type: 'text', text: 'Get a quote' },
      input: { kind: 'action', actionId: 'a1', value: 'quote', label: 'Get a quote' },
    };
    const sending = reducer(live(), { type: 'send', pending });
    const state = reducer(sending, {
      type: 'send/failed',
      clientId: 'c1',
      error: { code: 'connector_error', message: 'nope', retryable: true },
    });
    expect(state.draft).toBe('');
  });

  it('stays busy while another send is still in flight', () => {
    let state = reducer(live(), { type: 'send', pending: userPending('c1', 'one') });
    state = reducer(state, { type: 'send', pending: userPending('c2', 'two') });
    state = reducer(state, { type: 'send/ok', clientId: 'c1', messages: [] });
    expect(state.status).toBe('sending');
    expect(state.pending).toHaveLength(1);
  });

  it('caps the stored transcript', () => {
    const many = Array.from({ length: MAX_STORED_MESSAGES + 10 }, (_, i) => agentMessage(`m${i}`));
    const state = reducer(live(), { type: 'send/ok', clientId: 'none', messages: many });
    expect(state.messages).toHaveLength(MAX_STORED_MESSAGES);
    expect(state.messages.at(-1)?.id).toBe(`m${MAX_STORED_MESSAGES + 9}`);
  });
});

describe('errors', () => {
  it('places the visitor\'s first message ahead of the server\'s reply', () => {
    const userMessage: Message = { id: 'u1', ts: 1, role: 'user', type: 'text', text: 'qwedae' };
    const state = reducer(withConfig(), {
      type: 'session/started',
      session: { token: 't', id: 's', expiresAt: 9e15 },
      messages: [agentMessage('greet', 'Hi there'), agentMessage('reply', 'You said: qwedae')],
      userMessage,
    });
    expect(state.messages.map((m) => m.role)).toEqual(['user', 'agent', 'agent']);
    expect(state.messages[0]).toBe(userMessage);
  });

  it('adds nothing extra when no first message was sent', () => {
    const state = reducer(withConfig(), {
      type: 'session/started',
      session: { token: 't', id: 's', expiresAt: 9e15 },
      messages: [agentMessage('greet')],
    });
    expect(state.messages.map((m) => m.role)).toEqual(['agent']);
  });

  it('records a failed session start without leaving the screen', () => {
    const starting = reducer(withConfig(), { type: 'lead/submit', lead: { name: 'Ada' } });
    const state = reducer(starting, {
      type: 'session/failed',
      error: { code: 'rate_limited', message: 'Slow down', retryable: true, retryAfter: 30 },
    });
    expect(state.status).toBe('idle');
    expect(state.error).toMatchObject({ code: 'rate_limited', retryAfter: 30 });
  });

  it('is a flag, not a state — the thread is still rendered', () => {
    const state: State = {
      ...withConfig(),
      messages: [agentMessage('a')],
      error: { code: 'connector_error', message: 'x', retryable: true },
    };
    expect(visibleMessages(state)).toHaveLength(1);
  });

  it('dismisses an error', () => {
    const state: State = { ...initialState, error: { code: 'internal', message: 'x', retryable: false } };
    expect(reducer(state, { type: 'error/dismiss' }).error).toBeNull();
  });

  it('expiry drops the session and offers a fresh start', () => {
    const live: State = { ...withConfig(), session: { token: 't', id: 's', expiresAt: 1 }, messages: [agentMessage('a')] };
    const state = reducer(live, { type: 'expired' });
    expect(state.session).toBeNull();
    expect(state.status).toBe('ended');
    expect(state.error?.code).toBe('session_expired');
    expect(state.error?.retryable).toBe(false);
    // The transcript stays on screen so the visitor can still read it.
    expect(state.messages).toHaveLength(1);
  });

  it('clears a non-retryable error on open but keeps a retryable one', () => {
    const fatal: State = { ...initialState, error: { code: 'internal', message: 'x', retryable: false } };
    expect(reducer(fatal, { type: 'open' }).error).toBeNull();
    const retryable: State = { ...initialState, error: { code: 'rate_limited', message: 'x', retryable: true } };
    expect(reducer(retryable, { type: 'open' }).error).not.toBeNull();
  });
});

describe('restore and reset', () => {
  it('restores a session straight into the thread', () => {
    const state = reducer(withConfig(), {
      type: 'restore',
      restored: {
        session: { token: 't', id: 's', expiresAt: 9e15 },
        messages: [agentMessage('a')],
        lead: { name: 'Ada' },
        consumedActions: ['opt1'],
      },
    });
    expect(state.screen).toBe('chat');
    expect(state.messages).toHaveLength(1);
    expect(state.consumedActions).toEqual(['opt1']);
  });

  it('never restores an in-flight send or a stale error', () => {
    const dirty: State = {
      ...initialState,
      pending: [userPending('c1', 'x')],
      error: { code: 'internal', message: 'x', retryable: false },
    };
    const state = reducer(dirty, { type: 'restore', restored: { messages: [agentMessage('a')] } });
    expect(state.pending).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.status).toBe('idle');
  });

  it('stays on home when there is no session to restore', () => {
    const state = reducer(withConfig(), { type: 'restore', restored: { sound: true } });
    expect(state.screen).toBe('home');
    expect(state.sound).toBe(true);
  });

  it('reset clears the conversation but keeps the config and panel state', () => {
    const live: State = {
      ...withConfig(),
      open: true,
      sound: true,
      teaserDismissed: true,
      session: { token: 't', id: 's', expiresAt: 9e15 },
      messages: [agentMessage('a')],
      lead: { name: 'Ada' },
      consumedActions: ['x'],
    };
    const state = reducer(live, { type: 'reset' });
    expect(state.session).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.lead).toBeNull();
    expect(state.consumedActions).toEqual([]);
    expect(state.screen).toBe('home');
    expect(state.config).not.toBeNull();
    expect(state.open).toBe(true);
    expect(state.sound).toBe(true);
    expect(state.teaserDismissed).toBe(true);
  });
});

describe('miscellaneous', () => {
  it('records a consumed action once', () => {
    let state = reducer(initialState, { type: 'action/consumed', id: 'opt1' });
    state = reducer(state, { type: 'action/consumed', id: 'opt1' });
    expect(state.consumedActions).toEqual(['opt1']);
  });

  it('takes the sound default from the config', () => {
    expect(withConfig({ sound: { enabled: true } }).sound).toBe(true);
    expect(withConfig().sound).toBe(false);
  });

  it('toggles sound', () => {
    expect(reducer(initialState, { type: 'sound/toggle' }).sound).toBe(true);
  });

  it('dismisses the teaser', () => {
    expect(reducer(initialState, { type: 'teaser/dismiss' }).teaserDismissed).toBe(true);
  });

  it('ignores an unknown action rather than throwing', () => {
    expect(reducer(initialState, { type: 'nonsense' } as unknown as Action)).toBe(initialState);
  });

  it('never mutates the state it is given', () => {
    const before = JSON.stringify(initialState);
    reducer(initialState, { type: 'open' });
    reducer(initialState, { type: 'identify', lead: { name: 'Ada' } });
    expect(JSON.stringify(initialState)).toBe(before);
  });
});

describe('streamed text', () => {
  it('previews only while a reply is in flight, and never outlives it', () => {
    const idle = reducer(initialState, { type: 'stream/text', text: 'late' });
    expect(idle.preview).toBe('');

    const sending = { ...initialState, status: 'sending' as const };
    const written = reducer(reducer(sending, { type: 'stream/text', text: 'Hel' }), { type: 'stream/text', text: 'lo' });
    expect(written.preview).toBe('Hello');

    const failed = reducer(written, {
      type: 'send/failed',
      clientId: 'x',
      error: { code: 'unknown', message: 'no', retryable: true },
    });
    expect(failed.preview).toBe('');
  });
});
