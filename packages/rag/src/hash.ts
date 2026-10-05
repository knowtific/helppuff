/** Hex digests through WebCrypto, which Workers and Node 20+ both have. */

async function digest(algorithm: 'SHA-1' | 'SHA-256', text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const sha1Hex = (text: string) => digest('SHA-1', text);
export const sha256Hex = (text: string) => digest('SHA-256', text);

/** A short, stable, synchronous fingerprint (FNV-1a) for de-duplicating text blocks. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
