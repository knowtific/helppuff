/**
 * Calls to an integration's API: JSON in and out, a timeout, and an error
 * that keeps the status (a 403 from Calendly means a free plan, a 409 from
 * Cal.com a time just taken) but never the provider's raw body, which can
 * echo what was sent.
 */

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type Fetcher = typeof fetch;

const TIMEOUT_MS = 10_000;

/** A short, safe reason from a provider's error body: its `message`, never the whole body. */
function reasonOf(body: unknown, status: number): string {
  const pick = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null);
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const error = o['error'];
    const nested = error && typeof error === 'object' ? pick((error as Record<string, unknown>)['message']) : pick(error);
    const found = nested ?? pick(o['message']) ?? pick(o['title']);
    if (found) return found;
  }
  return status === 401 ? 'The key was refused.' : status === 403 ? 'Not allowed with this key or plan.' : status === 404 ? 'Not found.' : `The service answered ${status}.`;
}

export async function callJson(fetcher: Fetcher, url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: init.method ?? 'GET',
      headers: { Accept: 'application/json', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: controller.signal,
    });
  } catch (thrown) {
    throw new ProviderError(0, (thrown as Error)?.name === 'AbortError' ? 'The service took too long to answer.' : 'Could not reach the service.');
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text().catch(() => '');
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) throw new ProviderError(response.status, reasonOf(body, response.status));
  return body;
}

export const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
export const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const time = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};
