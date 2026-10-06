import type { Action, Message, Option } from '@helppuff/protocol';
import { Card, Carousel } from './Card.js';
import { FormMessage } from './Form.js';
import { Links } from './Links.js';
import { NoticeMessage } from './Notice.js';
import { OptionsMessage } from './Options.js';
import { TextMessage, UserMessage } from './Text.js';
import { Rating } from './Rating.js';

/** What a message needs from the app to be interactive. */
export type MessageHandlers = {
  /** An option chip, or a set of them when the message is `multi`. */
  onPick: (message: Message, options: Option[]) => void;
  /** A card, carousel or shortcut action. */
  onAction: (message: Message, action: Action) => void;
  /** An inline form, already encoded as a value and a readable label. */
  onFormSubmit: (message: Message, value: string, label: string) => void;
  /** Whether this message has already been answered. */
  isConsumed: (message: Message) => boolean;
  /** Thumbs up/down on a reply, when the server records ratings. */
  rating?: { get: (message: Message) => number; set: (message: Message, value: 1 | -1 | 0) => void; labels: [string, string] } | undefined;
};

/**
 * Handlers for a context where nothing is interactive — the gallery, and
 * tests that only assert rendering.
 */
export const inertHandlers: MessageHandlers = {
  onPick: () => {},
  onAction: () => {},
  onFormSubmit: () => {},
  isConsumed: () => false,
};

/**
 * The renderer switch. An unknown type renders nothing rather than throwing
 * — that is what lets a newer server talk to an older widget.
 */
export function MessageView({ message, handlers }: { message: Message; handlers: MessageHandlers }) {
  if (message.role === 'user' && message.type === 'text') {
    return <UserMessage text={message.text} />;
  }

  const consumed = handlers.isConsumed(message);

  switch (message.type) {
    case 'text':
      return handlers.rating && message.role === 'agent' && !Number.isNaN(handlers.rating.get(message)) ? (
        <>
          <TextMessage text={message.text} />
          <Rating value={handlers.rating.get(message)} labels={handlers.rating.labels} onRate={(value) => handlers.rating!.set(message, value)} />
        </>
      ) : (
        <TextMessage text={message.text} />
      );

    case 'notice':
      return <NoticeMessage text={message.text} {...(message.tone ? { tone: message.tone } : {})} />;

    case 'options':
      return (
        <OptionsMessage
          message={message}
          consumed={consumed}
          onPick={(options) => handlers.onPick(message, options)}
        />
      );

    case 'card':
      return (
        <Card
          card={message}
          consumed={consumed}
          onAction={(action) => handlers.onAction(message, action)}
        />
      );

    case 'carousel':
      return (
        <Carousel
          cards={message.cards}
          consumed={consumed}
          onAction={(action) => handlers.onAction(message, action)}
        />
      );

    case 'links':
      return <Links title={message.title} links={message.links} />;

    case 'form':
      return (
        <FormMessage
          message={message}
          consumed={consumed}
          onSubmit={(value, label) => handlers.onFormSubmit(message, value, label)}
        />
      );

    default:
      return null;
  }
}

/**
 * Whether this build can actually draw the message.
 *
 * The fail-safe says an unrenderable message renders nothing — which has to mean no
 * row at all. Emitting an empty wrapper still costs a fade-in animation, a
 * gap and a timestamp, so the visitor sees something flash and disappear.
 */
const DRAWABLE = new Set(['text', 'notice', 'options', 'card', 'carousel', 'links', 'form']);

export function canRender(message: Message): boolean {
  return DRAWABLE.has(message.type);
}

/** Whether two adjacent messages should be visually grouped. */
export function isGrouped(previous: Message | undefined, current: Message): boolean {
  if (!previous) return false;
  if (previous.role !== current.role) return false;
  if (current.type !== 'text' || previous.type !== 'text') return false;
  return current.ts - previous.ts < 60_000;
}
