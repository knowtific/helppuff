import { readSse, SseIdleTimeout, type Message, type MessageBody, type Option, type Role } from '@helppuff/protocol';
import { ConnectorError } from './errors.js';

/** Outbound calls from a connector time out at 25s. */
export const CONNECTOR_TIMEOUT_MS = 25_000;

let counter = 0;

/** Message ids only need to be unique within a session. */
export function messageId(prefix = 'm'): string {
  counter = (counter + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${random}`;
}

/**
 * The callback form's id starts with this. A submitted form comes back with
 * its id as the action id, so the server can record it as a callback request
 * (`callback.requested`) whichever backend showed it.
 */
export const CALLBACK_FORM = 'callback';
export const isCallbackForm = (actionId: string | undefined): boolean => Boolean(actionId?.startsWith(`${CALLBACK_FORM}_`));

type BaseInit = { id?: string; ts?: number; role?: Role };

function base(init: BaseInit = {}): { id: string; ts: number; role: Role } {
  return { id: init.id ?? messageId(), ts: init.ts ?? Date.now(), role: init.role ?? 'agent' };
}

/**
 * Build a message from its payload plus a generated envelope. The cast is the
 * one place the discriminated union is reassembled; every field inside `body`
 * is already checked against the variant it belongs to.
 */
export function message(body: MessageBody, init?: BaseInit): Message {
  return { ...base(init), ...body } as Message;
}

export function text(value: string, init?: BaseInit): Message {
  return { ...base(init), type: 'text', text: value };
}

export function notice(value: string, tone: 'info' | 'warn' = 'info', init?: BaseInit): Message {
  return { ...base({ role: 'system', ...init }), type: 'notice', text: value, tone };
}

export function options(list: Option[], prompt?: string, init?: BaseInit): Message {
  return { ...base(init), type: 'options', options: list, ...(prompt ? { text: prompt } : {}) };
}

/** `fetch` with the connector timeout applied and network failures normalised. */
export async function fetchWithTimeout(
  doFetch: typeof fetch,
  input: string,
  init: RequestInit = {},
  timeoutMs = CONNECTOR_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await doFetch(input, { ...init, signal: controller.signal });
  } catch {
    const aborted = controller.signal.aborted;
    throw new ConnectorError(
      aborted ? 'That took too long. Please try again.' : 'We could not reach the assistant. Please try again.',
      { retryable: true, detail: aborted ? 'timeout' : 'network_error' },
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a JSON response body, turning anything unexpected into a safe error. */
export async function readJson<T = unknown>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ConnectorError('The assistant sent an unexpected response.', {
      retryable: true,
      detail: 'invalid_json',
    });
  }
}

/** Render `{{lead.name}}` / `{{context.pageUrl}}` style templates. */
export function renderTemplate(template: string, scope: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, scope);
    return value === undefined || value === null ? '' : String(value);
  });
}

/**
 * Read a backend's event stream, one parsed JSON event at a time.
 *
 * The request's own timeout stops at the response headers, so a stream is
 * bounded here instead, by the gap between chunks: a long answer that keeps
 * arriving is fine, one that stalls is abandoned. Events whose data is not
 * JSON (a `[DONE]` sentinel, say) are skipped.
 */
export async function readJsonEvents(
  response: Response,
  onEvent: (data: Record<string, unknown>, event: string) => void,
  idleMs = CONNECTOR_TIMEOUT_MS,
): Promise<void> {
  if (!response.body) {
    throw new ConnectorError('The assistant sent an unexpected response.', {
      retryable: true,
      detail: 'stream_no_body',
    });
  }
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
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          onEvent(parsed as Record<string, unknown>, event);
        }
      },
      idleMs,
    );
  } catch (thrown) {
    if (thrown instanceof ConnectorError) throw thrown;
    const idle = thrown instanceof SseIdleTimeout;
    throw new ConnectorError(
      idle ? 'That took too long. Please try again.' : 'We lost the connection to the assistant. Please try again.',
      { retryable: true, detail: idle ? 'stream_idle_timeout' : 'stream_read_failed' },
    );
  }
}
