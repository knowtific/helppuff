import { MurmurError } from './errors.js';
import type { Platform } from './platform.js';

/**
 * Cloudflare Turnstile siteverify.
 *
 * This is the only layer that meaningfully separates a human in a browser
 * from a script — origin checks stop other websites, not `curl`. See
 * `wiki/Security.md`.
 */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 8000;

export type TurnstileResult = { success: boolean; codes: string[] };

/**
 * Verify a token. A network failure is treated as a failure to verify, not
 * as a pass — otherwise taking Cloudflare offline would take the captcha
 * offline with it.
 */
export async function verifyTurnstile(
  secret: string,
  token: string | undefined,
  options: { ip?: string | null; fetch?: typeof fetch } = {},
): Promise<TurnstileResult> {
  if (!token) return { success: false, codes: ['missing-input-response'] };

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  // Cloudflare accepts the raw IP here; it never reaches our own logs.
  if (options.ip) body.append('remoteip', options.ip);

  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await doFetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: controller.signal,
    });
    if (!response.ok) return { success: false, codes: [`http-${response.status}`] };

    const result = (await response.json()) as { success?: unknown; 'error-codes'?: unknown };
    const codes = Array.isArray(result['error-codes'])
      ? result['error-codes'].filter((c): c is string => typeof c === 'string')
      : [];
    return { success: result.success === true, codes };
  } catch {
    return { success: false, codes: ['verification-unreachable'] };
  } finally {
    clearTimeout(timer);
  }
}

/** Verify, or throw the visitor-safe `captcha_failed` envelope. */
export async function assertTurnstile(
  secret: string,
  token: string | undefined,
  platform: Pick<Platform, 'log' | 'ip'>,
  doFetch?: typeof fetch,
): Promise<void> {
  const result = await verifyTurnstile(secret, token, {
    ip: platform.ip,
    ...(doFetch ? { fetch: doFetch } : {}),
  });
  if (result.success) return;

  // Error codes are Cloudflare's, not the visitor's business.
  platform.log('captcha.failed', { codes: result.codes.join(',') || 'none' });
  throw new MurmurError('captcha_failed', { detail: `turnstile:${result.codes[0] ?? 'unknown'}` });
}
