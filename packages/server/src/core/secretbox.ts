/**
 * Secrets the dashboard sets (a Telegram bot token), encrypted at rest in D1:
 * AES-GCM with a key derived from HELPPUFF_SECRET by HKDF, so the database
 * alone opens nothing, and the dashboard can save one without Cloudflare
 * credentials. Rotating HELPPUFF_SECRET makes them unreadable: they are set
 * again (the wiki says so).
 *
 * Format: `v1.<iv base64url>.<ciphertext base64url>`.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keys = new Map<string, Promise<CryptoKey>>();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

function keyFor(secret: string, purpose: string): Promise<CryptoKey> {
  const id = `${purpose}\u0000${secret}`;
  let key = keys.get(id);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('helppuff-secretbox'), info: encoder.encode(purpose) },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    keys.set(id, key);
  }
  return key;
}

export async function seal(secret: string, purpose: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret, purpose), encoder.encode(plaintext));
  return `v1.${b64(iv)}.${b64(new Uint8Array(data))}`;
}

/** The plaintext, or null when it was sealed with another secret (or tampered with). */
export async function open(secret: string, purpose: string, sealed: string): Promise<string | null> {
  const [version, iv, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !data) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await keyFor(secret, purpose), unb64(data));
    return decoder.decode(plain);
  } catch {
    return null;
  }
}
