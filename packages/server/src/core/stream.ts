import { STREAM_MEDIA_TYPE, sseFrame } from '@helppuff/protocol';
import { toHelpPuffError } from './errors.js';
import type { PreparedConnector } from './run.js';
import type { RequestCtx } from './request.js';

/**
 * Streamed replies (see wiki/Protocol.md). A route streams only when both
 * sides want it: the client asked with `Accept: text/event-stream`, and the
 * site's connector has streaming turned on. Otherwise it answers with the
 * usual JSON, so a client that asks is never worse off.
 */
export function wantsStream(accept: string | undefined, prepared: PreparedConnector): boolean {
  return Boolean(accept?.includes(STREAM_MEDIA_TYPE)) && prepared.connector.streams(prepared.options);
}

/**
 * Deltas are a preview, capped at the length of the longest text message;
 * past that the visitor waits for `done`, which carries the sanitized whole.
 */
const MAX_PREVIEW_CHARS = 8000;

/**
 * Answer with an event stream. `work` runs the connector with an `onText`
 * that forwards reply text as `delta` events, and returns the body that
 * becomes `done`.
 *
 * By the time `work` runs, the 200 and its headers are on their way, so a
 * failure can no longer be a status code. It becomes an `error` event with
 * the same envelope an error response would carry, and is logged the same
 * way the error handler would log it.
 */
export function streamResponse(
  ctx: RequestCtx,
  path: string,
  work: (onText: (delta: string) => void) => Promise<unknown>,
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // A visitor who closes the tab makes every later write fail. That is not
  // an error worth reporting, and the connector call finishes regardless.
  const write = (event: string, data: unknown) =>
    writer.write(encoder.encode(sseFrame(event, data))).catch(() => {});

  let previewed = 0;
  const onText = (delta: string) => {
    if (typeof delta !== 'string' || !delta || previewed >= MAX_PREVIEW_CHARS) return;
    const piece = delta.slice(0, MAX_PREVIEW_CHARS - previewed);
    previewed += piece.length;
    void write('delta', { text: piece });
  };

  const run = (async () => {
    try {
      const body = await work(onText);
      // Stage timings, as a comment clients skip: readable with curl or the network panel.
      await writer.write(encoder.encode(`: timing ${ctx.timing.header()}\n\n`)).catch(() => {});
      ctx.platform.log('timing', { path, ...ctx.timing.summary() });
      await write('done', body);
    } catch (thrown) {
      const error = toHelpPuffError(thrown);
      ctx.platform.log('request.error', { code: error.code, detail: error.detail ?? 'none', path, streamed: true });
      await write('error', error.toEnvelope().error);
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  ctx.platform.waitUntil(run);

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': `${STREAM_MEDIA_TYPE}; charset=utf-8`,
      'Cache-Control': 'no-store',
      // Proxies that buffer would turn a stream back into one late response.
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Reply text produced before the stream exists (a gated connector starts
 * before the limits are known): queued, then flushed when the stream attaches.
 */
export function textRelay(): { onText: (delta: string) => void; attach: (target: (delta: string) => void) => void } {
  let target: ((delta: string) => void) | null = null;
  const queued: string[] = [];
  return {
    onText: (delta) => {
      if (target) target(delta);
      else queued.push(delta);
    },
    attach: (next) => {
      target = next;
      for (const delta of queued.splice(0)) next(delta);
    },
  };
}
