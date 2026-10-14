import { useEffect, useRef } from 'preact/hooks';
import type { Message } from '@helppuff/protocol';

/**
 * Where a chunk draws a message: the booking chunk the picker or the
 * appointment card, the upload chunk a file message's photos. Each chunk is
 * loaded by the app only when one is shown.
 */
export function BookingView({ message, consumed, mount }: { message: Message; consumed: boolean; mount: (el: HTMLElement, message: Message, consumed: boolean) => () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Mounted once per message: the chunk keeps its own state (and says when it is used).
  useEffect(() => (ref.current ? mount(ref.current, message, consumed) : undefined), [message.id]);
  return <div ref={ref} class="hp-booking" />;
}
