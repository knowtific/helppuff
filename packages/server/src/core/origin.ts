import { TOKEN_HEADER } from '@murmur/protocol';
import { MurmurError } from './errors.js';

/**
 * The origin allowlist is mandatory (§7.2). Without it anyone can copy the
 * embed snippet and spend the site owner's AI budget.
 */
export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowedOrigin(origin: string | null | undefined, allowlist: readonly string[]): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowlist.some((entry) => normalizeOrigin(entry) === normalized);
}

/**
 * Session endpoints require a recognised `Origin`. A request without one is
 * not a browser request from an allowed site, so it is rejected.
 */
export function assertAllowedOrigin(origin: string | null | undefined, allowlist: readonly string[]): string {
  if (!isAllowedOrigin(origin, allowlist)) {
    throw new MurmurError('forbidden_origin', { detail: 'origin_not_allowed' });
  }
  return normalizeOrigin(origin as string) as string;
}

export const ALLOWED_REQUEST_HEADERS = 'content-type, authorization';
export const EXPOSED_RESPONSE_HEADERS = `${TOKEN_HEADER}, Retry-After`;

/** CORS headers reflecting only an allowlisted origin. */
export function corsHeaders(origin: string | null | undefined, allowlist: readonly string[]): Record<string, string> {
  if (!isAllowedOrigin(origin, allowlist)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': EXPOSED_RESPONSE_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
