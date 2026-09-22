import type { Message } from '@murmur/protocol';
import { NoticeMessage } from './Notice.js';
import { TextMessage, UserMessage } from './Text.js';

/**
 * The renderer switch. An unknown type renders nothing rather than throwing
 * (§8.3) — that is what lets a newer server talk to an older widget.
 *
 * `options`, `card`, `carousel`, `links` and `form` arrive in M4.
 */
export function MessageView({ message }: { message: Message }) {
  if (message.role === 'user' && message.type === 'text') {
    return <UserMessage text={message.text} />;
  }

  switch (message.type) {
    case 'text':
      return <TextMessage text={message.text} />;
    case 'notice':
      return <NoticeMessage text={message.text} {...(message.tone ? { tone: message.tone } : {})} />;
    default:
      return null;
  }
}

/**
 * Whether this build can actually draw the message.
 *
 * §8.3 says an unrenderable message renders nothing — which has to mean no
 * row at all. Emitting an empty wrapper still costs a fade-in animation, a
 * gap and a timestamp, so the visitor sees something flash and disappear.
 */
export function canRender(message: Message): boolean {
  return message.type === 'text' || message.type === 'notice';
}

/** Whether two adjacent messages should be visually grouped (§8.7). */
export function isGrouped(previous: Message | undefined, current: Message): boolean {
  if (!previous) return false;
  if (previous.role !== current.role) return false;
  if (current.type === 'notice' || previous.type === 'notice') return false;
  return current.ts - previous.ts < 60_000;
}
