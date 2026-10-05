import type { BrowserLike } from './types.js';

/**
 * Fetching one page politely: a clear user agent, a timeout, redirects
 * followed and recorded, and a cap on how much of the body is read.
 */

export const DEFAULT_USER_AGENT = 'murmur-crawler/0.1 (+https://github.com/knowtific/murmur)';
const MAX_BYTES = 3 * 1024 * 1024;

export type FetchedPage =
  | { ok: true; status: number; finalUrl: string; html: string; contentType: string }
  | { ok: false; status: number | null; finalUrl: string; error: string; blocked: boolean };

/** Bot walls answer 403/429/503 with a challenge page; we report them as blocked rather than broken. */
function looksBlocked(status: number, headers: Headers, body: string): boolean {
  if (status === 401 || status === 403 || status === 429) return true;
  if (status === 503 && (headers.get('cf-mitigated') || /challenge|captcha|attention required|just a moment/i.test(body))) return true;
  return false;
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return out + decoder.decode();
}

export async function fetchPage(
  url: string,
  options: { fetch?: typeof fetch; userAgent?: string; timeoutMs?: number } = {},
): Promise<FetchedPage> {
  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await doFetch(url, {
      headers: {
        'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en;q=0.9,*;q=0.5',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const finalUrl = response.url || url;
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const blocked = looksBlocked(response.status, response.headers, body.slice(0, 5000));
      return { ok: false, status: response.status, finalUrl, error: blocked ? `blocked (HTTP ${response.status})` : `HTTP ${response.status}`, blocked };
    }
    if (contentType && !/html|xml/i.test(contentType)) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, status: response.status, finalUrl, error: `not a web page (${contentType.split(';')[0]})`, blocked: false };
    }
    return { ok: true, status: response.status, finalUrl, html: await readCapped(response), contentType };
  } catch (thrown) {
    const aborted = (thrown as Error)?.name === 'AbortError';
    return { ok: false, status: null, finalUrl: url, error: aborted ? 'timed out' : `unreachable: ${String((thrown as Error)?.message ?? thrown).slice(0, 200)}`, blocked: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a small text resource (robots.txt, a sitemap). Null when it is missing. */
export async function fetchText(url: string, options: { fetch?: typeof fetch; userAgent?: string; timeoutMs?: number } = {}): Promise<string | null> {
  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    const response = await doFetch(url, { headers: { 'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT }, redirect: 'follow', signal: controller.signal });
    if (!response.ok) return null;
    return await readCapped(response);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The page as a browser sees it, through Browser Rendering's `content`
 * quick action. Returns the rendered HTML and the browser time it cost, or
 * null when the binding is missing, out of free time, or failed.
 */
export async function renderPage(browser: BrowserLike | undefined, url: string): Promise<{ html: string; browserMs: number } | null> {
  if (!browser || typeof browser.quickAction !== 'function') return null;
  try {
    const response = await browser.quickAction('content', { url, gotoOptions: { waitUntil: 'networkidle2', timeout: 20_000 }, rejectResourceTypes: ['image', 'media', 'font'] });
    if (!response.ok) return null;
    const browserMs = Number(response.headers.get('X-Browser-Ms-Used') ?? 0) || 0;
    const text = await response.text();
    // The REST shape is `{ success, result: "<html>" }`; accept raw HTML too.
    let html = text;
    if (text.trimStart().startsWith('{')) {
      try {
        const body = JSON.parse(text) as { result?: unknown };
        html = typeof body.result === 'string' ? body.result : '';
      } catch {
        // Not JSON after all.
      }
    }
    return html ? { html, browserMs } : null;
  } catch {
    return null;
  }
}
