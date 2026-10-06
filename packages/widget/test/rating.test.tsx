import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { Message } from '@helppuff/protocol';
import { MessageView, inertHandlers, type MessageHandlers } from '../src/components/messages/index.js';
import { Api } from '../src/app/api.js';

const reply: Message = { id: 'm_1', ts: 1, role: 'agent', type: 'text', text: 'We cover **Mooroolbark**.' };

function withRating(initial = 0) {
  let value = initial;
  const set = vi.fn((_m: Message, next: 1 | -1 | 0) => {
    value = next;
  });
  const handlers: MessageHandlers = { ...inertHandlers, rating: { get: () => value, set, labels: ['Helpful', 'Not helpful'] } };
  return { handlers, set };
}

describe('rating a reply', () => {
  it('shows two labelled toggles under an assistant reply', () => {
    const { handlers, set } = withRating();
    render(<MessageView message={reply} handlers={handlers} />);
    const up = screen.getByRole('button', { name: 'Helpful' });
    expect(up.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(up);
    expect(set).toHaveBeenCalledWith(reply, 1);
  });

  it('takes a rating back when the chosen one is pressed again', () => {
    const { handlers, set } = withRating(-1);
    render(<MessageView message={reply} handlers={handlers} />);
    const down = screen.getByRole('button', { name: 'Not helpful' });
    expect(down.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(down);
    expect(set).toHaveBeenCalledWith(reply, 0);
  });

  it('is absent when the server does not record ratings, for the visitor’s own words, and for local messages', () => {
    render(<MessageView message={reply} handlers={inertHandlers} />);
    expect(screen.queryByRole('button', { name: 'Helpful' })).toBeNull();
    const { handlers } = withRating();
    render(<MessageView message={{ ...reply, id: 'u1', role: 'user' }} handlers={handlers} />);
    expect(screen.queryAllByRole('button', { name: 'Helpful' })).toHaveLength(0);
    const local: MessageHandlers = { ...handlers, rating: { ...handlers.rating!, get: () => NaN } };
    render(<MessageView message={{ ...reply, id: 'greeting-0' }} handlers={local} />);
    expect(screen.queryAllByRole('button', { name: 'Helpful' })).toHaveLength(0);
  });

  it('sends the rating without ever throwing', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    new Api('https://w.example', 'acme').rate('tok', 'm_1', -1);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith('https://w.example/v1/sessions/feedback', expect.objectContaining({ method: 'POST', body: JSON.stringify({ messageId: 'm_1', value: -1 }) }));
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(() => new Api('https://w.example', 'acme').rate('tok', 'm_1', 1)).not.toThrow();
    vi.unstubAllGlobals();
  });
});
