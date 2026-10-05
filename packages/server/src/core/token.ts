import { MurmurError } from './errors.js';

/**
 * Stateless session tokens. Payload is base64url JSON, signed with
 * HMAC-SHA256. No server-side session store exists, so the token is the
 * session.
 */
export type SessionTokenPayload = {
  v: 1;
  siteId: string;
  sessionId: string;
  /** Opaque connector state — kept small, it rides in every request. */
  state: unknown;
  /** Messages already counted against `messagesPerSession`. */
  count: number;
  iat: number;
  exp: number;
};

/** A connector state larger than this would bloat every request. */
export const MAX_STATE_BYTES = 1024;
const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const key = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  keyCache.set(secret, key);
  return key;
}

function assertSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new MurmurError('internal', { detail: 'murmur_secret_too_short' });
  }
}

async function sign(secret: string, data: string): Promise<string> {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64urlEncode(new Uint8Array(signature));
}

/** Length-independent, value-constant comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export type IssueTokenInput = {
  siteId: string;
  sessionId: string;
  state: unknown;
  count: number;
  ttlMs: number;
  now?: number;
};

export async function issueToken(secret: string, input: IssueTokenInput): Promise<{ token: string; expiresAt: number }> {
  assertSecret(secret);
  const now = input.now ?? Date.now();
  const payload: SessionTokenPayload = {
    v: 1,
    siteId: input.siteId,
    sessionId: input.sessionId,
    state: input.state ?? null,
    count: input.count,
    iat: now,
    exp: now + input.ttlMs,
  };

  const json = JSON.stringify(payload);
  if (encoder.encode(JSON.stringify(payload.state)).length > MAX_STATE_BYTES) {
    throw new MurmurError('internal', { detail: 'connector_state_too_large' });
  }

  const body = base64urlEncode(encoder.encode(json));
  const signature = await sign(secret, body);
  return { token: `${body}.${signature}`, expiresAt: payload.exp };
}

/**
 * Verify a token's signature and expiry. Throws `unauthorized` for anything
 * malformed or tampered with, and `session_expired` only for a well-formed
 * token that has aged out — the widget treats those differently.
 */
export async function verifyToken(secret: string, token: string, now = Date.now()): Promise<SessionTokenPayload> {
  assertSecret(secret);

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new MurmurError('unauthorized', { detail: 'token_malformed' });
  }
  const [body, signature] = parts as [string, string];

  const expected = await sign(secret, body);
  if (!timingSafeEqual(expected, signature)) {
    throw new MurmurError('unauthorized', { detail: 'token_bad_signature' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(base64urlDecode(body)));
  } catch {
    throw new MurmurError('unauthorized', { detail: 'token_bad_payload' });
  }

  if (!isPayload(payload)) {
    throw new MurmurError('unauthorized', { detail: 'token_bad_payload' });
  }
  if (payload.exp <= now) {
    throw new MurmurError('session_expired', { detail: 'token_expired' });
  }
  return payload;
}

function isPayload(value: unknown): value is SessionTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p['v'] === 1 &&
    typeof p['siteId'] === 'string' &&
    typeof p['sessionId'] === 'string' &&
    typeof p['count'] === 'number' &&
    typeof p['iat'] === 'number' &&
    typeof p['exp'] === 'number'
  );
}

export function newSessionId(): string {
  return crypto.randomUUID();
}
