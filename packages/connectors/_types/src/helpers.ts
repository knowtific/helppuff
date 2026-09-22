import type { Message, MessageBody, Option, Role } from '@murmur/protocol';
import { ConnectorError } from './errors.js';

/** Outbound calls from a connector time out at 25s (§6.1). */
export const CONNECTOR_TIMEOUT_MS = 25_000;

let counter = 0;

/** Message ids only need to be unique within a session. */
export function messageId(prefix = 'm'): string {
  counter = (counter + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${random}`;
}

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

/** Render `{{lead.name}}` / `{{context.pageUrl}}` style templates (§5). */
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
