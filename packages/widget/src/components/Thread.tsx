import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Message } from '@helppuff/protocol';
import { canRender, isGrouped, MessageView, type MessageHandlers } from './messages/index.js';
import { stripMarkdown } from '../lib/markdown.js';
import { TextMessage } from './messages/Text.js';
import type { StringKey } from '../app/strings.js';

/** How close to the bottom still counts as "at the bottom". */
const NEAR_BOTTOM_PX = 80;

export function Typing() {
  return (
    <div class="hp-typing" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

function relativeTime(ts: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function Thread({
  messages,
  busy,
  preview = '',
  pendingIds,
  handlers,
  t,
}: {
  messages: Message[];
  busy: boolean;
  /** A streamed reply as it is written; the typing dots stand in until it starts. */
  preview?: string;
  pendingIds: Set<string>;
  handlers: MessageHandlers;
  t: (key: StringKey) => string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const now = Date.now();

  // Drop what this build cannot draw before grouping, so neither an empty
  // row nor a gap in the grouping survives.
  const drawable = messages.filter(canRender);

  // Auto-scroll only when the visitor was already near the bottom.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !stuck) return;
    element.scrollTop = element.scrollHeight;
  }, [drawable.length, busy, preview.length, stuck]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onScroll = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      setStuck(distance < NEAR_BOTTOM_PX);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div class="hp-scroll" ref={scroller}>
      <div class="hp-thread">
        {drawable.map((message, index) => {
          const grouped = isGrouped(drawable[index - 1], message);
          const isUser = message.role === 'user';
          return (
            <div
              key={message.id}
              class="hp-row"
              {...(grouped ? { 'data-grouped': '' } : {})}
              {...(isUser ? { 'data-user': '' } : {})}
              {...(pendingIds.has(message.id) ? { 'data-pending': '' } : {})}
            >
              <MessageView message={message} handlers={handlers} />
              <span class="hp-time">{relativeTime(message.ts, now)}</span>
            </div>
          );
        })}

        {busy && preview ? (
          <div class="hp-row" data-streaming="">
            <TextMessage text={preview} />
          </div>
        ) : busy ? (
          <div class="hp-row">
            <Typing />
            <span class="hp-sr">{t('thinking')}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Agent messages are announced politely; the visitor's own messages are not,
 * since they already know what they typed.
 */
export function LiveRegion({ messages }: { messages: Message[] }) {
  const last = messages[messages.length - 1];
  const announce =
    last && last.role !== 'user' && (last.type === 'text' || last.type === 'notice')
      ? stripMarkdown(last.text)
      : '';
  return (
    <div class="hp-sr" aria-live="polite" aria-atomic="true">
      {announce}
    </div>
  );
}
