/**
 * Dashboard sign-in: email and password, then a signed, HttpOnly cookie.
 *
 * Passwords are PBKDF2-SHA256 hashes (`pbkdf2$<iterations>$<salt>$<hash>`,
 * base64url), computed by `murmur` on the owner's machine — a password
 * never travels to Cloudflare in the clear except at sign-in, over TLS.
 * The owner account comes from Worker secrets (`ADMIN_EMAIL`,
 * `ADMIN_PASSWORD_HASH`); further accounts live in the `admins` table and
 * are managed with `murmur users`.
 *
 * Sessions are stateless: `base64url(payload).base64url(hmac)`, keyed from
 * MURMUR_SECRET, valid for seven days.
 */

const encoder = new TextEncoder();
export const SESSION_COOKIE = 'mm_admin';
export const SESSION_TTL_MS = 7 * 24 * 3600_000;
/** Workers caps PBKDF2 at 100k iterations. */
export const PBKDF2_ITERATIONS = 100_000;

export function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, iterations))}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [scheme, rounds, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !rounds || !salt || !hash) return false;
  const iterations = Number(rounds);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > PBKDF2_ITERATIONS) return false;
  try {
    return equal(await pbkdf2(password, fromB64url(salt), iterations), fromB64url(hash));
  } catch {
    return false;
  }
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(`${secret}:admin-session`), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

export type AdminSession = { email: string; exp: number };

export async function issueSession(secret: string, email: string, now: number): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify({ e: email, x: now + SESSION_TTL_MS })));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export async function readSession(secret: string, token: string | undefined, now: number): Promise<AdminSession | null> {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  try {
    if (!equal(await hmac(secret, payload), fromB64url(signature))) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { e?: unknown; x?: unknown };
    if (typeof data.e !== 'string' || typeof data.x !== 'number' || data.x <= now) return null;
    return { email: data.e, exp: data.x };
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, secure: boolean, maxAgeSeconds = SESSION_TTL_MS / 1000): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}
