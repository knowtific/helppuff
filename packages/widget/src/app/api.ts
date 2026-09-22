import type { Message, VisitorContext } from '@murmur/protocol';
import { fetchWithTimeout } from '../lib/safe.js';
import { parseConfig, parseMessages } from './validate.js';
import type { SendInput, Session, WidgetError } from './store.js';
import type { WidgetConfig } from '@murmur/protocol';

/** §8.3: config gets 6s, a message send gets 30s. Nothing is unbounded. */
export const CONFIG_TIMEOUT_MS = 6000;
export const SEND_TIMEOUT_MS = 30_000;

const TOKEN_HEADER = 'x-murmur-token';

export type ConfigResult = {
  config: WidgetConfig;
  capabilities: { poll: boolean; end: boolean };
};

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

    const raw = (body as { capabilities?: { poll?: unknown; end?: unknown } } | null)?.capabilities;
    return {
      config: widget,
      capabilities: { poll: raw?.poll === true, end: raw?.end === true },
    };
  }

  async startSession(input: {
    lead?: Record<string, string>;
    context: VisitorContext;
    firstMessage?: string;
    captchaToken?: string;
  }): Promise<{ session: Session; messages: Message[] }> {
    if (navigator.onLine === false) throw offlineError();

    const response = await fetchWithTimeout(
      this.url(`/v1/sites/${encodeURIComponent(this.siteId)}/sessions`),
      {
        method: 'POST',
        credentials: 'omit',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      SEND_TIMEOUT_MS,
    );

    if (!response.ok) throw await toError(response);

    const body = (await response.json()) as Record<string, unknown>;
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
  ): Promise<{ messages: Message[]; token?: string }> {
    if (navigator.onLine === false) throw offlineError();

    const response = await fetchWithTimeout(
      this.url('/v1/sessions/messages'),
      {
        method: 'POST',
        credentials: 'omit',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      },
      SEND_TIMEOUT_MS,
    );

    if (!response.ok) throw await toError(response);

    const refreshed = response.headers.get(TOKEN_HEADER);
    const body = (await response.json()) as Record<string, unknown>;

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
