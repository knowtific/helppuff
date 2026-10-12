import echo from '@helppuff/connector-echo';
import { ConnectorError, type ConnectorContext } from '@helppuff/connector-types';
import type { Message, SendRequest, StartSessionRequest } from '@helppuff/protocol';
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
  /**
   * Scripted answers (`showcase.ts`) in place of echo's. A chat then starts
   * with no greeting of its own (the site's welcome message stands alone),
   * and anything the script returns `null` for still goes to echo.
   */
  respond?: (text: string) => Message[] | null;
};

const GREETING = 'Hi! This is the HelpPuff playground. Ask anything, or try /options, /card, /carousel, /links, /form, /booking, /slow, /long or /error.';

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Stream scripted text the way echo streams its own: a word at a time. */
async function streamScripted(messages: Message[], onText?: (delta: string) => void): Promise<void> {
  if (!onText) return sleep(500);
  let first = true;
  for (const item of messages) {
    if (item.type !== 'text') continue;
    if (!first) onText('\n\n');
    first = false;
    for (const word of item.text.split(/(?<=\s)/)) {
      onText(word);
      await sleep(18);
    }
  }
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
  /** Times booked in this page, and the appointments. */
  const booked = new Set<number>();
  const appointments = new Map<string, { id: string; title: string; start: number; end: number; timezone: string; status: 'confirmed'; location: string; cancel: boolean; change: boolean }>();

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
        const input = body as StartSessionRequest;
        const scripted = options.respond && (input.firstMessage ? options.respond(input.firstMessage) : []);
        if (scripted) await streamScripted(scripted, onText);
        const { state, messages } = scripted
          ? { state: { turn: scripted.length }, messages: scripted }
          : await echo.start(context(sessionId, onText), input);
        const sessionToken = crypto.randomUUID();
        sessions.set(sessionToken, state);
        return { sessionToken, sessionId, expiresAt: Date.now() + 24 * 3600_000, messages, capabilities };
      });
    }

    if (url.pathname === '/v1/sessions/messages' && method === 'POST') {
      if (!sessions.has(token)) return failure('session_expired', 'This chat has ended. Start a new one.', 401);
      return respond(streamed, async (onText) => {
        const input = body as SendRequest;
        const scripted = options.respond?.(input.kind === 'text' ? input.text : input.value);
        if (scripted) {
          await streamScripted(scripted, onText);
          return { messages: scripted };
        }
        const result = await echo.send(context(token, onText), sessions.get(token), input);
        if (result.state !== undefined) sessions.set(token, result.state);
        return { messages: result.messages };
      });
    }

    // Booking in the chat: a week of times from tomorrow, booked in memory (the server's own rules are tested there).
    if (url.pathname.startsWith('/v1/sessions/booking')) {
      if (!sessions.has(token)) return failure('session_expired', 'This chat has ended. Start a new one.', 401);
      const asked = body as { tz?: string; from?: string };
      const zone = asked.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (url.pathname.endsWith('/slots')) {
        const from = asked.from;
        const first = from ? new Date(`${from}T00:00:00`) : new Date(Date.now() + 86_400_000);
        const days = [];
        for (let d = 0; d < 7; d++) {
          const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + d);
          if (day.getDay() === 0 || day.getDay() === 6) continue;
          const slots = [];
          for (let h = 9; h < 17; h++) {
            for (const m of [0, 30]) {
              const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
              // Some times are taken, the same ones every time.
              if ((h * 7 + m + d * 3) % 5 === 0 || booked.has(start)) continue;
              slots.push({ id: `s.${start}`, start, end: start + 30 * 60_000 });
            }
          }
          const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
          if (slots.length) days.push({ date, slots });
        }
        const next = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7);
        return json({ timezone: zone, days, next: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`, phone: 'optional', title: 'Consultation', duration: 30 });
      }
      const input = body as { slot?: string; appointment?: string };
      if (url.pathname.endsWith('/cancel')) {
        const found = [...appointments.values()].find((a) => a.id === input.appointment);
        if (!found) return failure('not_found', 'That appointment is not part of this chat.', 404);
        booked.delete(found.start);
        return json({ messages: [{ id: `bkd_${Date.now()}`, ts: Date.now(), role: 'agent', type: 'booking', booked: { ...found, status: 'cancelled', cancel: undefined, change: undefined } }] });
      }
      const start = Number(String(input.slot ?? '').slice(2));
      if (!start || booked.has(start)) return failure('conflict', 'That time was just taken. Please pick another.', 409);
      booked.add(start);
      const appointment = { id: `apt_${appointments.size + 1}`, title: 'Consultation', start, end: start + 30 * 60_000, timezone: zone, status: 'confirmed' as const, location: '12 Wharf St, Balmain', cancel: true, change: true };
      appointments.set(appointment.id, appointment);
      return json({ messages: [{ id: `bkd_${Date.now()}`, ts: Date.now(), role: 'agent', type: 'booking', booked: appointment }] });
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
