import { describe, expect, it } from 'vitest';
import { SseIdleTimeout, readSse, sseFrame, type SseEvent } from '../src/sse.js';

/** A body delivered in exactly these chunks, to test framing across boundaries. */
function chunked(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  await readSse(chunked(chunks), (event) => out.push(event));
  return out;
}

describe('readSse', () => {
  it('reads events framed by sseFrame', async () => {
    expect(await collect([sseFrame('delta', { text: 'Hi' }), sseFrame('done', { ok: true })])).toEqual([
      { event: 'delta', data: '{"text":"Hi"}' },
      { event: 'done', data: '{"ok":true}' },
    ]);
  });

  it('reassembles events split at any byte, CRLF included', async () => {
    const whole = 'event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n';
    for (let cut = 1; cut < whole.length; cut += 1) {
      expect(await collect([whole.slice(0, cut), whole.slice(cut)])).toEqual([
        { event: 'a', data: '1' },
        { event: 'b', data: '2' },
      ]);
    }
  });

  it('reassembles a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: café\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 9)); // splits the two bytes of "é"
        controller.enqueue(bytes.slice(9));
        controller.close();
      },
    });
    const out: SseEvent[] = [];
    await readSse(body, (e) => out.push(e));
    expect(out).toEqual([{ event: 'message', data: 'café' }]);
  });

  it('joins multi-line data, ignores comments, and defaults the event name', async () => {
    expect(await collect([': keep-alive\n', 'data: one\ndata: two\n\n'])).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });

  it('dispatches a final event that lacks its blank line', async () => {
    expect(await collect(['data: last'])).toEqual([{ event: 'message', data: 'last' }]);
  });

  it('gives up on a stream that goes quiet, and cancels it', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: first\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const out: SseEvent[] = [];
    await expect(readSse(body, (e) => out.push(e), 30)).rejects.toBeInstanceOf(SseIdleTimeout);
    expect(out).toEqual([{ event: 'message', data: 'first' }]);
    expect(cancelled).toBe(true);
  });
});
