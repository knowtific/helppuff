import { describe, expect, it } from 'vitest';
import { actionSchema, isSafeUrl, messageSchema, sanitizeMessages } from '../src/index.js';
import { invalidMessages, validMessages } from './fixtures.js';

describe('messageSchema', () => {
  it.each(validMessages.map((m) => [m.type, m] as const))('accepts a valid %s message', (_type, message) => {
    expect(messageSchema.safeParse(message).success).toBe(true);
  });

  it.each(invalidMessages)('rejects %s', (_name, value) => {
    expect(messageSchema.safeParse(value).success).toBe(false);
  });

  it('covers every message type in the fixtures', () => {
    const types = new Set(validMessages.map((m) => m.type));
    expect([...types].sort()).toEqual(['card', 'carousel', 'form', 'links', 'notice', 'options', 'text']);
  });
});

describe('actionSchema', () => {
  it.each([
    ['reply', { id: 'a', kind: 'reply', label: 'Yes', value: 'yes' }],
    ['url', { id: 'a', kind: 'url', label: 'Site', url: 'https://example.com' }],
    ['tel', { id: 'a', kind: 'tel', label: 'Call', phone: '+61400000000' }],
    ['email', { id: 'a', kind: 'email', label: 'Mail', email: 'a@b.co' }],
    ['flow', { id: 'a', kind: 'flow', label: 'Quote', flowId: 'quote' }],
    ['form', { id: 'a', kind: 'form', label: 'Book', formId: 'booking' }],
  ])('accepts a %s action', (_kind, action) => {
    expect(actionSchema.safeParse(action).success).toBe(true);
  });

  it.each([
    ['a javascript: url', { id: 'a', kind: 'url', label: 'x', url: 'javascript:alert(1)' }],
    ['a data: url', { id: 'a', kind: 'url', label: 'x', url: 'data:text/html,<script>' }],
    ['a vbscript: url', { id: 'a', kind: 'url', label: 'x', url: 'vbscript:msgbox' }],
    ['a relative url', { id: 'a', kind: 'url', label: 'x', url: '/relative' }],
    ['a missing label', { id: 'a', kind: 'reply', value: 'v' }],
  ])('rejects %s', (_name, action) => {
    expect(actionSchema.safeParse(action).success).toBe(false);
  });
});

describe('isSafeUrl', () => {
  it.each(['https://a.co', 'http://a.co', 'mailto:a@b.co', 'tel:+61400000000'])('allows %s', (url) => {
    expect(isSafeUrl(url)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'blob:https://a.co/x',
    'not a url',
    '',
  ])('blocks %s', (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });
});

describe('sanitizeMessages', () => {
  it('keeps valid messages and counts the dropped ones', () => {
    const { messages, dropped } = sanitizeMessages([
      validMessages[0],
      { type: 'text' },
      validMessages[1],
      null,
    ]);
    expect(messages).toHaveLength(2);
    expect(dropped).toBe(2);
  });

  it('returns nothing for a non-array', () => {
    expect(sanitizeMessages({ messages: [] })).toEqual({ messages: [], dropped: 0 });
  });

  it('caps the batch at 20 messages', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...validMessages[0], id: `m${i}` }));
    expect(sanitizeMessages(many).messages).toHaveLength(20);
  });
});
