/**
 * URL safety, with no dependencies — the widget imports this directly so its
 * bundle never pulls in Zod (the widget's dependency budget). The Zod wrappers live
 * in `url-schema.ts`.
 */

/**
 * The only URL schemes allowed anywhere in the protocol. Everything else is
 * rejected server-side and rendered as plain text client-side.
 */
export const ALLOWED_SCHEMES = ['https:', 'http:', 'mailto:', 'tel:'] as const;

export function isSafeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (ALLOWED_SCHEMES as readonly string[]).includes(parsed.protocol);
}

/** `https:`/`http:` only — used for images, where mailto/tel make no sense. */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
