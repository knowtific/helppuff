import type { Message, MessageBody, SendRequest } from '@murmur/protocol';
import {
  ConnectorError,
  defineConnector,
  message,
  messageId,
  text,
  type Connector,
} from '@murmur/connector-types';
import { echoOptionsSchema, type EchoOptions } from './schema.js';

export type EchoState = { turn: number };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function agent(body: MessageBody): Message {
  return message(body, { id: messageId('echo'), role: 'agent' });
}

const LONG_PARAGRAPH = [
  'Murmur keeps the widget and the backend apart on purpose.',
  'The widget speaks one small REST protocol and knows nothing about which',
  'assistant is answering, which means the same bundle works against Retell,',
  'an OpenAI-compatible endpoint, or a webhook you wrote this afternoon.',
].join(' ');

function longReply(): Message {
  const body = Array.from({ length: 12 }, (_, i) => `**Paragraph ${i + 1}.** ${LONG_PARAGRAPH}`).join('\n\n');
  return agent({ type: 'text', text: body });
}

/** Deterministic commands that exercise every widget feature (§6.2). */
async function respond(command: string, raw: string, delayMs: number): Promise<Message[]> {
  switch (command) {
    case '/options':
      return [
        agent({
          type: 'options',
          text: 'What would you like to do?',
          options: [
            { id: 'quote', label: 'Get a quote', value: 'quote' },
            { id: 'hours', label: 'Opening hours', value: 'hours' },
            { id: 'human', label: 'Talk to a human', value: 'human' },
          ],
        }),
      ];

    case '/multi':
      return [
        agent({
          type: 'options',
          text: 'Pick everything that applies.',
          multi: true,
          options: [
            { id: 'tap', label: 'Leaking tap', value: 'tap' },
            { id: 'drain', label: 'Blocked drain', value: 'drain' },
            { id: 'hw', label: 'Hot water', value: 'hot-water' },
          ],
        }),
      ];

    case '/card':
      return [
        agent({
          type: 'card',
          title: 'Emergency callout',
          body: 'A technician on site within 60 minutes, any hour of the day.',
          image: { src: 'https://picsum.photos/seed/murmur/640/360', alt: 'A service van', aspect: '16:9' },
          actions: [
            { id: 'book', kind: 'reply', label: 'Book it', value: 'book emergency callout' },
            { id: 'call', kind: 'tel', label: 'Call now', phone: '+61400000000' },
            { id: 'more', kind: 'url', label: 'Details', url: 'https://example.com/emergency', newTab: true },
          ],
        }),
      ];

    case '/carousel':
      return [
        agent({
          type: 'carousel',
          cards: [
            {
              title: 'Standard service',
              body: 'Next business day, 9am to 5pm.',
              image: { src: 'https://picsum.photos/seed/mm1/480/480', alt: 'Toolkit', aspect: '1:1' },
              actions: [{ id: 'c1', kind: 'reply', label: 'Choose', value: 'standard service' }],
            },
            {
              title: 'Priority service',
              body: 'Same day, within four hours.',
              image: { src: 'https://picsum.photos/seed/mm2/480/480', alt: 'Clock', aspect: '1:1' },
              actions: [{ id: 'c2', kind: 'reply', label: 'Choose', value: 'priority service' }],
            },
            {
              title: 'Emergency',
              body: 'Within the hour, around the clock.',
              image: { src: 'https://picsum.photos/seed/mm3/480/480', alt: 'Siren', aspect: '1:1' },
              actions: [{ id: 'c3', kind: 'reply', label: 'Choose', value: 'emergency service' }],
            },
          ],
        }),
      ];

    case '/links':
      return [
        agent({
          type: 'links',
          title: 'Might help',
          links: [
            { label: 'Pricing', url: 'https://example.com/pricing', description: 'What a callout costs.' },
            { label: 'Service areas', url: 'https://example.com/areas', description: 'Suburbs we cover.' },
            { label: 'Email us', url: 'mailto:hello@example.com' },
          ],
        }),
      ];

    case '/form':
      return [
        agent({
          type: 'form',
          title: 'Book a visit',
          submitLabel: 'Request booking',
          fields: [
            { name: 'suburb', label: 'Suburb', type: 'text', required: true, placeholder: 'Richmond' },
            { name: 'when', label: 'When', type: 'select', required: true, options: ['Today', 'Tomorrow', 'This week'] },
            { name: 'notes', label: 'Anything else?', type: 'textarea' },
          ],
        }),
      ];

    case '/notice':
      return [
        { id: messageId('echo'), ts: Date.now(), role: 'system', type: 'notice', text: 'This is a warning notice.', tone: 'warn' },
      ];

    case '/slow':
      await sleep(3000);
      return [agent({ type: 'text', text: 'That took three seconds.' })];

    case '/long':
      return [longReply()];

    case '/error':
      throw new ConnectorError('The assistant is having a moment. Please try again.', {
        retryable: true,
        detail: 'echo_forced_error',
      });

    case '/multipart':
      return [
        agent({ type: 'text', text: 'First message.' }),
        agent({ type: 'text', text: 'Second message, sent in the same batch.' }),
      ];

    default: {
      if (delayMs > 0) await sleep(delayMs);
      return [agent({ type: 'text', text: `You said: **${raw}**` })];
    }
  }
}

/**
 * §4.3: an action carries both a `value` (what the backend acts on) and a
 * `label` (what the transcript shows). Echo dispatches on the value so a
 * shortcut like `{ label: 'Show a card', value: '/card' }` works, and echoes
 * the label so the reply reads the way the visitor expects.
 */
function inputToCommand(input: SendRequest): string {
  return input.kind === 'text' ? input.text : input.value;
}

function inputToDisplay(input: SendRequest): string {
  return input.kind === 'text' ? input.text : input.label;
}

const echo: Connector<EchoOptions, EchoState> = {
  type: 'echo',
  optionsSchema: echoOptionsSchema,
  capabilities: { poll: false, end: true },

  async start(ctx, input) {
    const messages: Message[] = [text(ctx.options.greeting)];
    if (input.firstMessage) {
      messages.push(...(await respond(input.firstMessage.trim().toLowerCase(), input.firstMessage, ctx.options.delayMs)));
    }
    return { state: { turn: messages.length }, messages };
  },

  async send(ctx, state, input) {
    const command = inputToCommand(input).trim().toLowerCase();
    const messages = await respond(command, inputToDisplay(input), ctx.options.delayMs);
    return { state: { turn: state.turn + 1 }, messages };
  },

  async end(ctx) {
    ctx.log('echo.end');
  },
};

export const echoConnector = defineConnector(echo);
export { echoOptionsSchema };
export default echoConnector;
