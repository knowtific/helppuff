import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concerns, nudge, setBaseTitle, setWaiting } from '../src/lib/attention';

/**
 * Getting a person's attention: who is told about what, and the tab's title
 * counting and flashing while they are away, then clearing when they look.
 */

const ME = 'sam@acme.test';
let focused = true;
let hidden = false;

beforeEach(() => {
  focused = true;
  hidden = false;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  window.location.hash = '#/conversations';
  setWaiting(0);
  setBaseTitle('Acme · Dashboard');
});
afterEach(() => vi.useRealTimers());

const away = () => {
  focused = false;
  hidden = true;
};
const back = () => {
  focused = true;
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('who is told about what', () => {
  const message = (assignedTo: string | null) => ({ t: 'message', conversationId: 'c1', message: { role: 'user', text: 'My tap leaks' }, assignedTo, who: 'Ada' });

  it('tells everyone available about a new chat, and nobody who is away', () => {
    const handover = { t: 'handover', conversationId: 'c1', conversation: { leadName: 'Ada', firstMessage: 'Hello?' } };
    expect(concerns(handover, ME, true)).toMatchObject({ kind: 'new-chat', title: 'Ada wants to talk to someone', body: 'Hello?' });
    expect(concerns(handover, ME, false)).toBeNull();
  });

  it("tells you about messages in your chats and in nobody's, never in a colleague's", () => {
    expect(concerns(message(ME), ME, false)).toMatchObject({ kind: 'message', title: 'Ada', body: 'My tap leaks' });
    expect(concerns(message(null), ME, true)).toMatchObject({ kind: 'message' });
    expect(concerns(message(null), ME, false)).toBeNull();
    expect(concerns(message('mo@acme.test'), ME, true)).toBeNull();
    // The team's own messages are never an alert.
    expect(concerns({ ...message(ME), message: { role: 'agent', text: 'hi' } }, ME, true)).toBeNull();
  });

  it('says nothing about the conversation you are looking at', () => {
    window.location.hash = '#/conversations/c1';
    expect(concerns(message(ME), ME, true)).toBeNull();
    away();
    expect(concerns(message(ME), ME, true)).toMatchObject({ kind: 'message' });
  });

  it('tells you when someone else gives you a chat, not when you take it', () => {
    expect(concerns({ t: 'assigned', conversationId: 'c1', to: ME, by: 'olivia@acme.test' }, ME, true)).toMatchObject({ kind: 'assigned' });
    expect(concerns({ t: 'assigned', conversationId: 'c1', to: ME, by: ME }, ME, true)).toBeNull();
    expect(concerns({ t: 'assigned', conversationId: 'c1', to: 'mo@acme.test', by: 'olivia@acme.test' }, ME, true)).toBeNull();
  });
});

describe("the tab's title", () => {
  it('counts what waits, looking or not', () => {
    setWaiting(2);
    expect(document.title).toBe('(2) Acme · Dashboard');
    setWaiting(0);
    expect(document.title).toBe('Acme · Dashboard');
  });

  it('counts and flashes what happened while you were away, and clears when you look', () => {
    vi.useFakeTimers();
    nudge('Ada: my tap leaks');
    // Looking: nothing to nudge.
    expect(document.title).toBe('Acme · Dashboard');
    away();
    nudge('Ada: my tap leaks');
    nudge('Ada: are you there?');
    expect(document.title).toBe('(2) Acme · Dashboard');
    vi.advanceTimersByTime(1200);
    expect(document.title).toBe('💬 Ada: are you there?');
    vi.advanceTimersByTime(1200);
    expect(document.title).toBe('(2) Acme · Dashboard');
    back();
    expect(document.title).toBe('Acme · Dashboard');
    vi.advanceTimersByTime(5000);
    expect(document.title).toBe('Acme · Dashboard');
  });
});
