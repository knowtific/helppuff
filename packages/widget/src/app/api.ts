import type { Message, VisitorContext } from '@murmur/protocol';
import { STREAM_MEDIA_TYPE, SseIdleTimeout, readSse } from '@murmur/protocol/sse';
import { fetchWithTimeout } from '../lib/safe.js';
import { parseConfig, parseMessages } from './validate.js';
import type { SendInput, Session, WidgetError } from './store.js';
import type { WidgetConfig } from '@murmur/protocol';

/** §8.3: config gets 6s, a message send gets 30s. Nothing is unbounded. */
export const CONFIG_TIMEOUT_MS = 6000;
export const SEND_TIMEOUT_MS = 30_000;

const TOKEN_HEADER = 'x-murmur-token';

export type Capabilities = { poll: boolean; end: boolean; stream: boolean };

export type ConfigResult = {
  config: WidgetConfig;
  capabilities: Capabilities;
};

/** Called with each piece of reply text while a streamed reply is written. */
export type OnText = (delta: string) => void;

export class ApiError extends Error {
  readonly widgetError: WidgetError;

  constructor(widgetError: WidgetError) {
    super(widgetError.message);
    this.name = 'ApiError';
    this.widgetError = widgetError;
  }
}

const GENERIC: WidgetError = {
  code: 'unknown',
  message: 'Something went wrong. Please try again.',
  retryable: true,
};

/**
 * Turn any failure response into a `WidgetError`. The server always sends the
 * envelope, but a proxy or a captive portal might not, so a body that is not
 * the envelope still produces something renderable.
 */
async function toError(response: Response): Promise<ApiError> {
  let code: WidgetError['code'] = 'unknown';
  let message = GENERIC.message;
  let retryAfter: number | undefined;

  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'error' in body) {
      const error = (body as { error: unknown }).error;
      if (error && typeof error === 'object') {
        const e = error as Record<string, unknown>;
        if (typeof e['code'] === 'string') code = e['code'] as WidgetError['code'];
        if (typeof e['message'] === 'string' && e['message']) message = e['message'];
        if (typeof e['retryAfter'] === 'number') retryAfter = e['retryAfter'];
      }
    }
  } catch {
    // Not JSON. The status alone decides how we describe it.
  }

  if (retryAfter === undefined) {
    const header = Number(response.headers.get('retry-after'));
    if (Number.isFinite(header) && header > 0) retryAfter = header;
  }

  // A 4xx other than a rate limit will not succeed on a retry.
  const retryable = code === 'rate_limited' || code === 'connector_error' || response.status >= 500;

  return new ApiError({ code, message, retryable, ...(retryAfter === undefined ? {} : { retryAfter }) });
}

/** An `error` event: the same envelope an error response carries, arriving mid-stream. */
function streamError(data: Record<string, unknown>): ApiError {
  const code = typeof data['code'] === 'string' ? (data['code'] as WidgetError['code']) : 'unknown';
  const message = typeof data['message'] === 'string' && data['message'] ? data['message'] : GENERIC.message;
  const retryAfter = typeof data['retryAfter'] === 'number' ? data['retryAfter'] : undefined;
  const retryable = code === 'rate_limited' || code === 'connector_error' || code === 'internal' || code === 'unknown';
  return new ApiError({ code, message, retryable, ...(retryAfter === undefined ? {} : { retryAfter }) });
}

/**
 * The body of a response, streamed or not. The server streams only when
 * asked and able, so either can come back from the same request; a streamed
 * one previews its text through `onText` and resolves with its `done`
 * event, which carries exactly what the JSON body would have.
 *
 * The request timeout stops at the headers, so a stream is bounded by the
 * gap between chunks instead — the server's own connector timeout is
 * shorter, so it reports a stall before this fires.
 */
async function readBody(response: Response, onText?: OnText): Promise<Record<string, unknown>> {
  if (!response.headers.get('content-type')?.includes(STREAM_MEDIA_TYPE) || !response.body) {
    return (await response.json()) as Record<string, unknown>;
  }

  let done: Record<string, unknown> | null = null;
  let failed: ApiError | null = null;
  try {
    await readSse(
      response.body,
      ({ event, data }) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        if (typeof parsed !== 'object' || parsed === null) return;
        const body = parsed as Record<string, unknown>;
        if (event === 'delta' && typeof body['text'] === 'string') onText?.(body['text']);
        else if (event === 'done') done = body;
        else if (event === 'error') failed = streamError(body);
      },
      SEND_TIMEOUT_MS,
    );
  } catch (thrown) {
    throw thrown instanceof SseIdleTimeout
      ? new ApiError({ code: 'unknown', message: 'That took too long. Please try again.', retryable: true })
      : new ApiError({ ...GENERIC });
  }

  if (failed) throw failed;
  // A stream cut off before `done` — a dropped connection — is retryable.
  if (!done) throw new ApiError({ ...GENERIC });
  return done;
}

function offlineError(): ApiError {
  return new ApiError({
    code: 'offline',
    message: "You're offline. Check your connection and try again.",
    retryable: true,
  });
}

export class Api {
  constructor(
    private readonly base: string,
    private readonly siteId: string,
  ) {}

  private url(path: string): string {
    return `${this.base.replace(/\/+$/, '')}${path}`;
  }

  /**
   * A failure here is fatal — the widget hides (§8.3) — so this throws rather
   * than returning a partial config.
   */
  async getConfig(): Promise<ConfigResult> {
    const response = await fetchWithTimeout(
      this.url(`/v1/sites/${encodeURIComponent(this.siteId)}/config`),
      { method: 'GET', credentials: 'omit', mode: 'cors' },
      CONFIG_TIMEOUT_MS,
    );

    if (!response.ok) throw await toError(response);

    const body: unknown = await response.json();
    const widget = parseConfig((body as { widget?: unknown } | null)?.widget);
    if (!widget) throw new ApiError({ code: 'internal', message: 'Bad config', retryable: false });

    const raw = (body as { capabilities?: { poll?: unknown; end?: unknown; stream?: unknown } } | null)
      ?.capabilities;
    return {
      config: widget,
      capabilities: { poll: raw?.poll === true, end: raw?.end === true, stream: raw?.stream === true },
    };
  }

  /**
   * `onText`, when given, asks for the reply to be streamed. Pass it only when
   * the site's capabilities say it streams; the result is the same either way.
   */
  async startSession(
    input: {
      lead?: Record<string, string>;
      context: VisitorContext;
      firstMessage?: string;
      captchaToken?: string;
    },
    onText?: OnText,
  ): Promise<{ session: Session; messages: Message[] }> {
    if (navigator.onLine === false) throw offlineError();

    const response = await fetchWithTimeout(
      this.url(`/v1/sites/${encodeURIComponent(this.siteId)}/sessions`),
      {
        method: 'POST',
        credentials: 'omit',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json', ...(onText ? { Accept: STREAM_MEDIA_TYPE } : {}) },
        body: JSON.stringify(input),
      },
      SEND_TIMEOUT_MS,
    );

    if (!response.ok) throw await toError(response);

    const body = await readBody(response, onText);
    const token = typeof body['sessionToken'] === 'string' ? body['sessionToken'] : '';
    const id = typeof body['sessionId'] === 'string' ? body['sessionId'] : '';
    const expiresAt = typeof body['expiresAt'] === 'number' ? body['expiresAt'] : 0;

    if (!token || !id || !expiresAt) {
      throw new ApiError({ code: 'internal', message: GENERIC.message, retryable: false });
    }

    return { session: { token, id, expiresAt }, messages: parseMessages(body['messages']) };
  }

  async send(
    token: string,
    input: SendInput & { clientId: string },
    onText?: OnText,
  ): Promise<{ messages: Message[]; token?: string }> {
    if (navigator.onLine === false) throw offlineError();

    const response = await fetchWithTimeout(
      this.url('/v1/sessions/messages'),
      {
        method: 'POST',
        credentials: 'omit',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(onText ? { Accept: STREAM_MEDIA_TYPE } : {}),
        },
        body: JSON.stringify(input),
      },
      SEND_TIMEOUT_MS,
    );

    if (!response.ok) throw await toError(response);

    const body = await readBody(response, onText);
    // A streamed reply carries its token in `done`; the headers left too early.
    const refreshed = response.headers.get(TOKEN_HEADER) ?? (typeof body['token'] === 'string' ? body['token'] : null);

    return {
      messages: parseMessages(body['messages']),
      ...(refreshed ? { token: refreshed } : {}),
    };
  }

  /** Fire-and-forget: nothing waits on it and nothing reports its failure. */
  end(token: string): void {
    try {
      const url = this.url('/v1/sessions/end');
      void fetchWithTimeout(
        url,
        {
          method: 'POST',
          credentials: 'omit',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: '{}',
          keepalive: true,
        },
        SEND_TIMEOUT_MS,
      ).catch(() => {});
    } catch {
      // Ending a session is best effort by definition.
    }
  }
}

/** Normalise a thrown value into something the UI can render. */
export function toWidgetError(thrown: unknown): WidgetError {
  if (thrown instanceof ApiError) return thrown.widgetError;
  if (thrown instanceof DOMException && thrown.name === 'AbortError') {
    return { code: 'unknown', message: 'That took too long. Please try again.', retryable: true };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { code: 'offline', message: "You're offline. Check your connection and try again.", retryable: true };
  }
  return GENERIC;
}
