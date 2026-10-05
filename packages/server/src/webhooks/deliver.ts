import { ALL_WEBHOOK_EVENTS, type WebhookEnvelope, type WebhookEventType } from '@murmur/protocol';
import type { RequestCtx } from '../core/request.js';
import { dbFrom, ensureSchema, type D1Like } from '../db/d1.js';

/**
 * Webhooks the owner adds in the dashboard (D1 `webhooks`), and their
 * deliveries. Every event goes to every enabled endpoint that asked for it,
 * signed with that endpoint's secret (see `@murmur/protocol` webhooks.ts for
 * the envelope and headers).
 *
 * Never on the visitor's path: requests emit through `waitUntil`, and a slow
 * or failing endpoint is retried once, logged in `webhook_deliveries`, and
 * otherwise ignored. The Workflow (crawl, files) awaits `emitTo` directly.
 */

export type WebhookRow = {
  id: string;
  site_id: string;
  url: string;
  description: string | null;
  events: string;
  secret: string;
  enabled: number;
  last_status: string | null;
  last_error: string | null;
  last_at: number | null;
  created_at: number;
  updated_at: number;
};

export type Delivery = { ok: boolean; status: number | null; error: string | null; attempts: number; durationMs: number };

const TIMEOUT_MS = 8000;
const RETRY_AFTER_MS = 1500;
const KEEP_DELIVERIES = 50;
/** A site's endpoints are read at most this often per isolate; an edit in the dashboard clears it. */
const MEMO_MS = 30_000;

const memo = new Map<string, { at: number; hooks: WebhookRow[] }>();
export function forgetWebhooks(siteId: string): void {
  memo.delete(siteId);
}

async function enabledHooks(db: D1Like, siteId: string, now: number): Promise<WebhookRow[]> {
  const cached = memo.get(siteId);
  if (cached && now - cached.at < MEMO_MS) return cached.hooks;
  await ensureSchema(db);
  const hooks = (await db.prepare('SELECT * FROM webhooks WHERE site_id = ? AND enabled = 1').bind(siteId).all<WebhookRow>()).results;
  memo.set(siteId, { at: now, hooks });
  return hooks;
}

export function eventsOf(hook: Pick<WebhookRow, 'events'>): string[] {
  try {
    const parsed = JSON.parse(hook.events) as unknown;
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

export const wants = (hook: Pick<WebhookRow, 'events'>, type: WebhookEventType) => {
  const events = eventsOf(hook);
  return type === 'test.ping' || events.includes(ALL_WEBHOOK_EVENTS) || events.includes(type);
};

export function envelope<T extends Record<string, unknown>>(siteId: string, type: WebhookEventType, data: T, now: number): WebhookEnvelope<T> {
  return { id: `evt_${crypto.randomUUID().replace(/-/g, '')}`, type, createdAt: new Date(now).toISOString(), site: siteId, data };
}

/** `sha256=<hex>` of `<timestamp>.<body>`: the timestamp is signed too, so an old delivery cannot be replayed as new. */
export async function signDelivery(secret: string, timestamp: number, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  return `sha256=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const retryable = (status: number) => status === 429 || status >= 500;

/** POST one envelope to one endpoint, retrying once; record the outcome. Never throws. */
export async function deliver(db: D1Like, hook: WebhookRow, event: WebhookEnvelope, doFetch: typeof fetch, now: () => number): Promise<Delivery> {
  const body = JSON.stringify(event);
  const started = now();
  let status: number | null = null;
  let error: string | null = null;
  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    const timestamp = Math.floor(now() / 1000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await doFetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Murmur-Webhooks/1',
          'X-Murmur-Event': event.type,
          'X-Murmur-Delivery': event.id,
          'X-Murmur-Timestamp': String(timestamp),
          'X-Murmur-Signature': await signDelivery(hook.secret, timestamp, body),
        },
        body,
        signal: controller.signal,
        redirect: 'manual',
      });
      status = response.status;
      error = response.ok ? null : `HTTP ${response.status}`;
      // The body is never needed; release it.
      await response.body?.cancel().catch(() => {});
      if (response.ok || !retryable(response.status)) break;
    } catch (thrown) {
      status = null;
      error = controller.signal.aborted ? `No answer within ${TIMEOUT_MS / 1000} s` : String((thrown as Error)?.message ?? thrown).slice(0, 200);
    } finally {
      clearTimeout(timer);
    }
    if (attempts < 2) await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  }
  const result: Delivery = { ok: error === null, status, error, attempts, durationMs: now() - started };
  const at = now();
  await db
    .batch([
      db
        .prepare('INSERT INTO webhook_deliveries (id, webhook_id, event_id, event, ok, http_status, error, attempts, duration_ms, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), hook.id, event.id, event.type, result.ok ? 1 : 0, status, error, attempts, result.durationMs, at),
      db.prepare('UPDATE webhooks SET last_status = ?, last_error = ?, last_at = ? WHERE id = ?').bind(result.ok ? 'ok' : 'failed', error, at, hook.id),
      db
        .prepare(
          `DELETE FROM webhook_deliveries WHERE webhook_id = ? AND id NOT IN (
             SELECT id FROM webhook_deliveries WHERE webhook_id = ? ORDER BY at DESC LIMIT ${KEEP_DELIVERIES})`,
        )
        .bind(hook.id, hook.id),
    ])
    .catch(() => null);
  return result;
}

/** Send an event to every endpoint of the site that wants it, and wait. For the Workflow. */
export async function emitTo(
  deps: { db: D1Like; fetch: typeof fetch; now?: () => number; log?: (event: string, data?: object) => void },
  siteId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const hooks = (await enabledHooks(deps.db, siteId, now())).filter((hook) => wants(hook, type));
  if (!hooks.length) return;
  const event = envelope(siteId, type, data, now());
  const results = await Promise.all(hooks.map((hook) => deliver(deps.db, hook, event, deps.fetch, now)));
  // The type and status only: never the payload.
  for (const result of results) if (!result.ok) deps.log?.('webhook.failed', { type, status: result.status });
}

/** Send an event after the response, never blocking or failing it. */
export function emit(ctx: RequestCtx, siteId: string, type: WebhookEventType, data: Record<string, unknown>): void {
  const db = dbFrom(ctx.env);
  if (!db) return;
  ctx.platform.waitUntil(
    emitTo({ db, fetch: globalThis.fetch.bind(globalThis), now: () => ctx.platform.now(), log: (name, extra) => ctx.platform.log(name, extra) }, siteId, type, data).catch(() => {
      ctx.platform.log('webhook.emit_failed', { type });
    }),
  );
}
