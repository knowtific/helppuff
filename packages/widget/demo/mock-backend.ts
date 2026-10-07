import echo from '@helppuff/connector-echo';
import { ConnectorError, type ConnectorContext } from '@helppuff/connector-types';
import type { SendRequest, StartSessionRequest } from '@helppuff/protocol';
import { STREAM_MEDIA_TYPE, sseFrame } from '@helppuff/protocol/sse';

/**
 * The chat API, answered inside the page.
 *
 * The hosted playground has no Worker behind it, so this stands in for one:
 * it intercepts the widget's `fetch` calls to `MOCK_API` and answers them with
 * the real echo connector — the same commands and replies as `pnpm dev`.
 * Everything else the page fetches goes to the network untouched.
 *
 * It speaks the same wire format as the server (JSON, or SSE when the widget
 * asks to stream), so the widget runs exactly the code it runs in production.
 * What it skips is everything a demo does not need: tokens are opaque ids,
 * nothing is recorded, and no limit applies.
 */

/** Never resolves on the network: `.invalid` is reserved for exactly this. */
export const MOCK_API = 'https://playground.helppuff.invalid';

export type MockOptions = {
  /** The `widget` object `/config` serves. */
  widget: unknown;
  /** Stream replies a word at a time, as a model would. */
  stream: boolean;
  /** Extra wait before every plain reply, to watch the typing indicator. */
  delayMs: number;
  /** Told about every request, for the playground's event log. */
  onRequest?: (line: string) => void;
};

const GREETING = 'Hi! This is the HelpPuff playground. Ask anything, or try /options, /card, /carousel, /links, /form, /slow, /long or /error.';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const failure = (code: string, message: string, status: number) => json({ error: { code, message } }, status);

/** Run a connector call as a response: plain JSON, or an SSE stream of its text then `done`. */
function respond(
  streamed: boolean,
  run: (onText?: (delta: string) => void) => Promise<Record<string, unknown>>,
): Response | Promise<Response> {
  if (!streamed) {
    return run().then(
      (body) => json(body),
      (error: unknown) => failure('connector_error', errorMessage(error), 502),
    );
  }
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: unknown) => controller.enqueue(encoder.encode(sseFrame(event, data)));
      try {
        write('done', await run((text) => write('delta', { text })));
      } catch (error) {
        write('error', { code: 'connector_error', message: errorMessage(error) });
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': STREAM_MEDIA_TYPE } });
}

function errorMessage(error: unknown): string {
  return error instanceof ConnectorError ? error.message : 'Something went wrong. Please try again.';
}

export function installMockBackend(options: MockOptions): void {
  const realFetch = window.fetch.bind(window);
  const connectorOptions = echo.parseOptions({ greeting: GREETING, stream: options.stream, delayMs: options.delayMs });
  const capabilities = { poll: false, end: true, stream: options.stream, feedback: true };
  /** Connector state by session token: the server keeps it in the signed token instead. */
  const sessions = new Map<string, unknown>();

  const context = (sessionId: string, onText?: (delta: string) => void): ConnectorContext<unknown> => ({
    options: connectorOptions,
    siteId: 'playground',
    sessionId,
    env: {},
    kv: { get: () => Promise.resolve(null), put: () => Promise.resolve(), delete: () => Promise.resolve() },
    fetch: realFetch,
    log: () => {},
    waitUntil: () => {},
    ...(onText ? { onText } : {}),
  });

  const route = async (url: URL, init: RequestInit): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const streamed = options.stream && (headers.get('Accept') ?? '').includes(STREAM_MEDIA_TYPE);
    const token = (headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const body: unknown = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
    options.onRequest?.(`${method} ${url.pathname}`);

    if (method === 'GET' && /^\/v1\/sites\/[^/]+\/config$/.test(url.pathname)) {
      return json({ siteId: 'playground', widget: options.widget, capabilities });
    }

    if (method === 'POST' && /^\/v1\/sites\/[^/]+\/sessions$/.test(url.pathname)) {
      const sessionId = `pg_${crypto.randomUUID()}`;
      return respond(streamed, async (onText) => {
        const { state, messages } = await echo.start(context(sessionId, onText), body as StartSessionRequest);
        const sessionToken = crypto.randomUUID();
        sessions.set(sessionToken, state);
        return { sessionToken, sessionId, expiresAt: Date.now() + 24 * 3600_000, messages, capabilities };
      });
    }

    if (url.pathname === '/v1/sessions/messages' && method === 'POST') {
      if (!sessions.has(token)) return failure('session_expired', 'This chat has ended. Start a new one.', 401);
      return respond(streamed, async (onText) => {
        const result = await echo.send(context(token, onText), sessions.get(token), body as SendRequest);
        if (result.state !== undefined) sessions.set(token, result.state);
        return { messages: result.messages };
      });
    }

    if (url.pathname === '/v1/sessions/feedback' || url.pathname === '/v1/sessions/end') {
      return new Response(null, { status: 204 });
    }

    return failure('not_found', 'Not found.', 404);
  };

  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const href = input instanceof Request ? input.url : String(input);
    let url: URL;
    try {
      url = new URL(href, location.href);
    } catch {
      return realFetch(input, init);
    }
    if (url.origin !== MOCK_API) return realFetch(input, init);
    // A widget timeout aborts the signal; honour it as the network would.
    const signal = init.signal;
    return new Promise<Response>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      route(url, init).then(resolve, () => resolve(failure('internal', 'Something went wrong.', 500)));
    });
  };
}
