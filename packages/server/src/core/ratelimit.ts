import type { KvStore } from '@helppuff/connector-types';
import { usageDay } from '@helppuff/rag';
import type { D1Like } from '../db/d1.js';
import { HelpPuffError } from './errors.js';

/**
 * Abuse bounds. Where each is counted, cheapest first:
 *
 *  - messages per visitor a minute: Cloudflare's Rate Limiting binding when
 *    the Worker has one (counted in memory where the visitor is, no network
 *    trip, no KV write);
 *  - messages per conversation and per site a day: from what the database
 *    already records about each turn (`recordedCaps`), so they cost one read
 *    and no write;
 *  - otherwise (no binding, no database: `pnpm dev`, older deployments), KV
 *    counters, written after the response.
 *
 * Every check is a read; nothing a visitor waits for writes. KV is
 * eventually consistent, so a determined attacker racing many requests
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

/** `quota:{siteId}:{yyyy-hp-dd}` in UTC — the cost backstop. */
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
  if (count >= limit) return { allowed: false, count, retryAfter: untilMidnight(now) };
  await store(kv, key, String(count + 1), 172_800, defer);
  return { allowed: true, count: count + 1 };
}

/** Seconds until midnight UTC, when a day's count starts again. */
function untilMidnight(now: number): number {
  const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now) / 1000));
}

/** Cloudflare's Rate Limiting binding (`ratelimits` in the Worker's config). */
export type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export const IP_LIMITER_BINDING = 'HELPPUFF_IP_LIMITER';
/** The limit the binding was deployed with, so a different live limit falls back to KV rather than being ignored. */
export const IP_LIMIT_VAR = 'HELPPUFF_IP_LIMIT';

/** The per-visitor minute limiter, when the Worker has one deployed with this limit. */
export function ipLimiter(env: Record<string, unknown>, limit: number): RateLimiter | null {
  const binding = env[IP_LIMITER_BINDING] as Partial<RateLimiter> | undefined;
  if (!binding || typeof binding.limit !== 'function') return null;
  return Number(env[IP_LIMIT_VAR]) === limit ? (binding as RateLimiter) : null;
}

/** One event against a binding's 60-second window. A failing binding lets the request through. */
export async function hitLimiter(limiter: RateLimiter, key: string, now = Date.now()): Promise<LimitVerdict> {
  try {
    if ((await limiter.limit({ key })).success) return { allowed: true, count: 0 };
  } catch {
    return { allowed: true, count: 0 };
  }
  return { allowed: false, count: 0, retryAfter: Math.max(1, 60 - (Math.floor(now / 1000) % 60)) };
}

/**
 * The per-conversation and daily caps, from what the server records after
 * every turn (`admin/record.ts`): the conversation's visitor messages and
 * the site's `usage_daily.messages`. One read, no write. Verdicts are for
 * this message, counted as the KV ones are. A database that cannot answer
 * lets the request through: these bound cost, the model's own budget is
 * the backstop.
 */
export async function recordedCaps(
  db: D1Like,
  siteId: string,
  sessionId: string | null,
  limits: { perSession: number; perDay: number },
  now = Date.now(),
): Promise<{ session: LimitVerdict; daily: LimitVerdict }> {
  let row: { daily: number | null; session: number | null } | null = null;
  try {
    row = await db
      .prepare(
        `SELECT (SELECT messages FROM usage_daily WHERE day = ? AND site_id = ?) AS daily,
                (SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND role = 'user') AS session`,
      )
      .bind(usageDay(now), siteId, sessionId ?? '')
      .first<{ daily: number | null; session: number | null }>();
  } catch {
    // No schema yet (nothing recorded), or D1 unavailable.
  }
  const daily = row?.daily ?? 0;
  const session = sessionId ? (row?.session ?? 0) : 0;
  return {
    session: session >= limits.perSession ? { allowed: false, count: session } : { allowed: true, count: session + 1 },
    daily: daily >= limits.perDay ? { allowed: false, count: daily, retryAfter: untilMidnight(now) } : { allowed: true, count: daily + 1 },
  };
}

export function rateLimited(verdict: LimitVerdict, detail: string): HelpPuffError {
  return new HelpPuffError('rate_limited', {
    ...(verdict.retryAfter === undefined ? {} : { retryAfter: verdict.retryAfter }),
    detail,
  });
}

export function quotaExceeded(detail: string, message?: string): HelpPuffError {
  return new HelpPuffError('quota_exceeded', { ...(message ? { message } : {}), detail });
}
