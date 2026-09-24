/**
 * Server-sent events, both directions of a streamed reply.
 *
 * Connectors read their backend's stream with this (OpenAI and Gemini both
 * speak SSE), the server writes the widget's stream with `sseFrame`, and the
 * widget reads it back with `readSse`. Kept free of Zod and of everything
 * else in this package, so the widget can import it without the weight.
 *
 * A streamed reply (see docs/protocol.md) is three event types:
 *
 *   delta   { text }       Reply text as it is written. A preview only: it is
 *                          never stored, and `done` supersedes it.
 *   done    { ...body }    The endpoint's usual JSON body — sanitized
 *                          messages, plus the session token. Authoritative.
 *   error   { code, ... }  The error envelope's `error`, for a failure after
 *                          the response has already started.
 *
 * Reasoning or "thinking" output is never sent as a delta: connectors
 * forward only the text meant for the visitor, and the widget shows its
 * typing indicator until the first delta arrives.
 */

/** The media type a client puts in `Accept` to ask for a streamed reply. */
export const STREAM_MEDIA_TYPE = 'text/event-stream';

export type SseEvent = { event: string; data: string };

/** A stream that went quiet for longer than the caller allows. */
export class SseIdleTimeout extends Error {
  constructor() {
    super('stream idle timeout');
    this.name = 'SseIdleTimeout';
  }
}

/** One event, framed. JSON never contains a raw newline, so one `data:` line suffices. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function readWithIdle<T>(read: Promise<T>, idleMs: number): Promise<T> {
  if (idleMs <= 0) return read;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SseIdleTimeout()), idleMs);
  });
  return Promise.race([read, idle]).finally(() => clearTimeout(timer));
}

/**
 * Read an event stream to its end, calling `onEvent` for each event.
 *
 * `idleMs` bounds the wait for each chunk rather than the whole stream: a
 * long answer that keeps arriving is fine, a stream that stops is not. On a
 * timeout, or if `onEvent` throws, the stream is cancelled so the upstream
 * request is released, and the error propagates.
 */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
  idleMs = 0,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];

  const line = (text: string) => {
    if (text === '') {
      if (data.length > 0) onEvent({ event: event || 'message', data: data.join('\n') });
      event = '';
      data = [];
      return;
    }
    if (text.startsWith(':')) return; // A comment, used as a keep-alive.
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };

  try {
    for (;;) {
      const { done, value } = await readWithIdle(reader.read(), idleMs);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // A trailing `\r` is held back: it may be the first half of `\r\n`.
      const lines = buffer.split(/\r\n|\n|\r(?!$)/);
      buffer = lines.pop() ?? '';
      for (const text of lines) line(text);
    }
    buffer += decoder.decode();
    // Lenient about a missing final blank line: dispatch what is complete.
    if (buffer) line(buffer.replace(/\r$/, ''));
    line('');
  } catch (thrown) {
    void reader.cancel().catch(() => {});
    throw thrown;
  }
}
