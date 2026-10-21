import { HelpPuffError } from './errors.js';

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
  /**
   * Ids of the forms this chat was shown (the latest few). A submitted form
   * must be one of them, so a script cannot post leads or callback requests
   * into a chat that never offered a form.
   */
  forms?: string[];
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
    throw new HelpPuffError('internal', { detail: 'helppuff_secret_too_short' });
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
  forms?: readonly string[] | undefined;
  ttlMs: number;
  now?: number;
};

/** How many offered form ids a token remembers. */
export const MAX_TOKEN_FORMS = 5;

export async function issueToken(secret: string, input: IssueTokenInput): Promise<{ token: string; expiresAt: number }> {
  assertSecret(secret);
  const now = input.now ?? Date.now();
  const payload: SessionTokenPayload = {
    v: 1,
    siteId: input.siteId,
    sessionId: input.sessionId,
    state: input.state ?? null,
    count: input.count,
    ...(input.forms?.length ? { forms: input.forms.slice(-MAX_TOKEN_FORMS) } : {}),
    iat: now,
    exp: now + input.ttlMs,
  };

  const json = JSON.stringify(payload);
  if (encoder.encode(JSON.stringify(payload.state)).length > MAX_STATE_BYTES) {
    throw new HelpPuffError('internal', { detail: 'connector_state_too_large' });
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
    throw new HelpPuffError('unauthorized', { detail: 'token_malformed' });
  }
  const [body, signature] = parts as [string, string];

  const expected = await sign(secret, body);
  if (!timingSafeEqual(expected, signature)) {
    throw new HelpPuffError('unauthorized', { detail: 'token_bad_signature' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(base64urlDecode(body)));
  } catch {
    throw new HelpPuffError('unauthorized', { detail: 'token_bad_payload' });
  }

  if (!isPayload(payload)) {
    throw new HelpPuffError('unauthorized', { detail: 'token_bad_payload' });
  }
  if (payload.exp <= now) {
    throw new HelpPuffError('session_expired', { detail: 'token_expired' });
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
    (p['forms'] === undefined || (Array.isArray(p['forms']) && p['forms'].every((f) => typeof f === 'string'))) &&
    typeof p['iat'] === 'number' &&
    typeof p['exp'] === 'number'
  );
}

export function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * A small signed value for a link HelpPuff sends: `resume` (continue a chat
 * from an email), `unsubscribe` (stop the emails). Base64url JSON, signed
 * with HMAC-SHA256 over `<purpose>.<body>`, so one purpose's token is never
 * another's. `exp` (ms) is checked when it is there.
 */
export async function signLink(secret: string, purpose: string, payload: Record<string, unknown>): Promise<string> {
  assertSecret(secret);
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  return `${body}.${await sign(secret, `${purpose}.${body}`)}`;
}

/** The payload of a link token, or null when it is malformed, signed for something else, or expired. */
export async function openLink(secret: string, purpose: string, token: string, now = Date.now()): Promise<Record<string, unknown> | null> {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH || typeof token !== 'string' || token.length > 2000) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  if (!timingSafeEqual(await sign(secret, `${purpose}.${body}`), signature)) return null;
  try {
    const payload = JSON.parse(decoder.decode(base64urlDecode(body))) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const exp = (payload as { exp?: unknown }).exp;
    if (exp !== undefined && (typeof exp !== 'number' || exp <= now)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** HMAC-SHA256 of `data` as lowercase base32 (RFC 4648 letters), for short signatures inside email addresses. */
export async function base32Mac(secret: string, data: string, length: number): Promise<string> {
  assertSecret(secret);
  const key = await importKey(secret);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export { timingSafeEqual };
