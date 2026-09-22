import type { Message } from '../src/index.js';

const base = { id: 'm1', ts: 1_700_000_000_000, role: 'agent' } as const;

export const validMessages: Message[] = [
  { ...base, type: 'text', text: 'Hello **there**' },
  { ...base, type: 'notice', text: 'Rate limited', tone: 'warn' },
  {
    ...base,
    type: 'options',
    text: 'Pick one',
    options: [
      { id: 'a', label: 'Quote', value: 'quote' },
      { id: 'b', label: 'Hours', value: 'hours' },
    ],
  },
  {
    ...base,
    type: 'card',
    title: 'Emergency callout',
    body: 'Within 60 minutes',
    image: { src: 'https://example.com/a.png', alt: 'Van', aspect: '16:9' },
    actions: [
      { id: 'c1', kind: 'reply', label: 'Book it', value: 'book' },
      { id: 'c2', kind: 'tel', label: 'Call', phone: '+61400000000' },
      { id: 'c3', kind: 'url', label: 'Details', url: 'https://example.com', newTab: true },
    ],
  },
  { ...base, type: 'carousel', cards: [{ title: 'One' }, { title: 'Two' }] },
  { ...base, type: 'links', title: 'Help', links: [{ label: 'Docs', url: 'https://example.com/docs' }] },
  {
    ...base,
    type: 'form',
    fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
    submitLabel: 'Send',
  },
];

/** Each entry must be rejected by `messageSchema`. */
export const invalidMessages: Array<[name: string, value: unknown]> = [
  ['missing id', { ts: 1, role: 'agent', type: 'text', text: 'hi' }],
  ['missing ts', { id: 'm', role: 'agent', type: 'text', text: 'hi' }],
  ['unknown role', { ...base, role: 'robot', type: 'text', text: 'hi' }],
  ['unknown type', { ...base, type: 'video', url: 'https://example.com/v.mp4' }],
  ['empty text', { ...base, type: 'text', text: '' }],
  ['text not a string', { ...base, type: 'text', text: 42 }],
  ['javascript: link', { ...base, type: 'links', links: [{ label: 'x', url: 'javascript:alert(1)' }] }],
  ['data: image', { ...base, type: 'card', title: 't', image: { src: 'data:image/png;base64,AA', alt: '' } }],
  ['mailto image', { ...base, type: 'card', title: 't', image: { src: 'mailto:a@b.co', alt: '' } }],
  ['options empty', { ...base, type: 'options', options: [] }],
  ['options too many', { ...base, type: 'options', options: Array.from({ length: 11 }, (_, i) => ({ id: `o${i}`, label: 'x', value: 'y' })) }],
  ['card with 4 actions', {
    ...base, type: 'card', title: 't',
    actions: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, kind: 'reply', label: 'l', value: 'v' })),
  }],
  ['unknown action kind', { ...base, type: 'card', title: 't', actions: [{ id: 'a', kind: 'ussd', label: 'l', value: 'v' }] }],
  ['form with no fields', { ...base, type: 'form', fields: [] }],
  ['field with unknown type', { ...base, type: 'form', fields: [{ name: 'a', label: 'A', type: 'color' }] }],
  ['null', null],
  ['array', []],
  ['string', 'text'],
];
