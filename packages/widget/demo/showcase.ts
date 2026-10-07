import type { Message, MessageBody } from '@helppuff/protocol';

/**
 * Believable answers for a made-up plumbing business, for the website's
 * screenshots and its live demo (`preview.html?demo=showcase`). Echo's
 * "You said: …" shows the mechanics; this shows what a visitor would see.
 *
 * Keyword-matched and deterministic, so the screenshot script gets the same
 * picture every run. Anything it does not recognise falls back to echo.
 */

let next = 0;
const agent = (body: MessageBody): Message =>
  ({ id: `show_${++next}`, ts: Date.now(), role: 'agent', ...body }) as Message;

const has = (text: string, ...words: string[]) => words.some((word) => text.includes(word));

export function showcaseReply(input: string): Message[] | null {
  const text = input.toLowerCase();

  if (has(text, 'emergency', 'burst', 'urgent', 'leak')) {
    return [
      agent({
        type: 'text',
        text: 'Yes, we run **24/7 emergency callouts** across the inner north. A licensed plumber is usually with you within **60 minutes**.',
      }),
      agent({
        type: 'card',
        title: 'Emergency callout',
        body: '$180 + GST, including the first 30 minutes on site. No extra charge at night or on weekends.',
        actions: [
          { id: 'book', kind: 'reply', label: 'Book now', value: 'Book an emergency callout' },
          { id: 'call', kind: 'tel', label: 'Call us', phone: '+61400000000' },
        ],
      }),
    ];
  }

  if (has(text, 'drain', 'price', 'cost', 'quote', 'how much')) {
    return [
      agent({
        type: 'text',
        text: 'A standard blocked-drain visit is **$180 + GST**, which covers:\n\n- the callout\n- up to 30 minutes on site\n- a camera inspection if needed\n\nIf it needs jetting, we quote that before any work starts. When suits you?',
      }),
      agent({
        type: 'options',
        options: [
          { id: 'today', label: 'Today', value: 'Today please' },
          { id: 'tomorrow', label: 'Tomorrow', value: 'Tomorrow' },
          { id: 'week', label: 'Later this week', value: 'Later this week' },
        ],
      }),
    ];
  }

  if (has(text, 'service', 'what do you', 'offer', 'hot water')) {
    return [
      agent({ type: 'text', text: 'Here is what we do most often:' }),
      agent({
        type: 'carousel',
        cards: [
          { title: 'Blocked drains', body: 'Camera inspection and jetting.', actions: [{ id: 'c1', kind: 'reply', label: 'Get a quote', value: 'Quote for a blocked drain' }] },
          { title: 'Hot water', body: 'Repairs and same-day replacements.', actions: [{ id: 'c2', kind: 'reply', label: 'Get a quote', value: 'Quote for hot water' }] },
          { title: 'Leaks and bursts', body: 'Found and fixed, day or night.', actions: [{ id: 'c3', kind: 'reply', label: 'Get help now', value: 'I have an emergency leak' }] },
        ],
      }),
    ];
  }

  if (has(text, 'today', 'tomorrow', 'week', 'book')) {
    return [
      agent({
        type: 'text',
        text: "Done. I've passed your details to the team, and they'll text you within **15 minutes** to confirm a time. Anything else I can help with?",
      }),
    ];
  }

  return null;
}
