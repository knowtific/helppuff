import type { KvStore } from '@murmur/connector-types';
import { MurmurError } from './errors.js';

/**
 * Abuse bounds, held in KV.
 *
 * KV is eventually consistent, so a determined attacker racing many requests
 * can slip a few past a limit. That is an accepted trade: these exist to
 * bound cost and stop casual abuse, never to bill against. The hard daily
 * site quota is the backstop that has to hold, and it is checked the same
 * way — a few extra messages past 500 is fine, a few thousand is not.
 */

export type LimitVerdict = { allowed: boolean; count: number; retryAfter?: number };

/**
 * Hand a counter's write to `waitUntil` instead of waiting for it. A KV write
 * goes to Cloudflare's central store — hundreds of milliseconds from far
 * away — and the verdict needs only the read. Without it, the write is awaited.
 */
export type Defer = (write: Promise<unknown>) => void;

async function store(kv: KvStore, key: string, value: string, ttl: number, defer?: Defer): Promise<void> {
  const write = kv.put(key, value, { expirationTtl: ttl });
  if (defer) defer(write.catch(() => {}));
  else await write;
}

/** `rl:{scope}:{key}:{window}` — the window number keeps keys self-expiring. */
function windowKey(scope: string, key: string, windowSeconds: number, now: number): string {
  return `rl:${scope}:${key}:${Math.floor(now / 1000 / windowSeconds)}`;
}

async function readCount(kv: KvStore, key: string): Promise<number> {
  const raw = await kv.get(key);
  if (!raw) return 0;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Count one event against a rolling window. Returns the verdict *before*
 * this event is counted, so a limit of 10 allows exactly 10.
 */
export async function hitWindow(
  kv: KvStore,
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
  defer?: Defer,
): Promise<LimitVerdict> {
  const bucket = windowKey(scope, key, windowSeconds, now);
  const count = await readCount(kv, bucket);

  if (count >= limit) {
    const elapsed = Math.floor(now / 1000) % windowSeconds;
    return { allowed: false, count, retryAfter: Math.max(1, windowSeconds - elapsed) };
  }

  // A TTL twice the window keeps the key alive across the boundary without
  // accumulating; KV rounds TTLs up to a minute anyway.
  await store(kv, bucket, String(count + 1), Math.max(60, windowSeconds * 2), defer);
  return { allowed: true, count: count + 1 };
}

/**
 * A running total with no window, for per-session caps.
 *
 * The count deliberately lives server-side rather than in the session token:
 * the client chooses which token it sends, so a token-held counter can be
 * rewound simply by replaying an older one, and the cap never trips.
 */
export async function hitTotal(
  kv: KvStore,
  key: string,
  limit: number,
  ttlSeconds: number,
  defer?: Defer,
): Promise<LimitVerdict> {
  const count = await readCount(kv, key);
  if (count >= limit) return { allowed: false, count };
  await store(kv, key, String(count + 1), Math.max(60, Math.ceil(ttlSeconds)), defer);
  return { allowed: true, count: count + 1 };
}

export const sessionMessageKey = (sessionId: string) => `msg:${sessionId}`;

/** `quota:{siteId}:{yyyy-mm-dd}` in UTC — the cost backstop. */
export function dailyKey(siteId: string, now = Date.now()): string {
  return `quota:${siteId}:${new Date(now).toISOString().slice(0, 10)}`;
}

export async function hitDaily(
  kv: KvStore,
  siteId: string,
  limit: number,
  now = Date.now(),
  defer?: Defer,
): Promise<LimitVerdict> {
  const key = dailyKey(siteId, now);
  const count = await readCount(kv, key);
  if (count >= limit) {
    // Until midnight UTC, when the key rolls over.
    const midnight = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate() + 1,
    );
    return { allowed: false, count, retryAfter: Math.max(1, Math.ceil((midnight - now) / 1000)) };
  }
  await store(kv, key, String(count + 1), 172_800, defer);
  return { allowed: true, count: count + 1 };
}

export function rateLimited(verdict: LimitVerdict, detail: string): MurmurError {
  return new MurmurError('rate_limited', {
    ...(verdict.retryAfter === undefined ? {} : { retryAfter: verdict.retryAfter }),
    detail,
  });
}

export function quotaExceeded(detail: string, message?: string): MurmurError {
  return new MurmurError('quota_exceeded', { ...(message ? { message } : {}), detail });
}
