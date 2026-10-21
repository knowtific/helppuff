import { ALL_WEBHOOK_EVENTS, type WebhookEnvelope, type WebhookEventType } from '@helppuff/protocol';
import { openHeaders, sendOutbound, storedHeaders, type OutboundSpec } from '../core/outbound.js';
import type { RequestCtx } from '../core/request.js';
import { emailBindingOf, notifyByEmail, type EmailBinding } from '../notifications/email.js';
import { dbFrom, ensureSchema, type D1Like } from '../db/d1.js';
import { reasonOf } from '../core/log.js';

/**
 * Webhooks the owner adds in the dashboard (D1 `webhooks`), and their
 * deliveries. Every event goes to every enabled endpoint that asked for it,
 * signed with that endpoint's secret (see `@helppuff/protocol` webhooks.ts for
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
  /** 'custom': the owner's own request below; null or 'helppuff': the signed envelope. */
  format?: string | null;
  method?: string | null;
  /** JSON headers, secret values sealed (`HEADER_PURPOSE`). */
  headers?: string | null;
  body?: string | null;
};

/** What seals a custom webhook's secret header values. */
export const HEADER_PURPOSE = 'webhook-header';

export type Delivery = { ok: boolean; status: number | null; error: string | null; attempts: number; durationMs: number; retryable: boolean };

/** A delivery handed to the Workflow after its first attempt failed in a way worth retrying. */
export type WebhookRetryParams = { kind: 'webhook'; siteId: string; hookId: string; event: WebhookEnvelope };
/** When the Workflow tries again after a failure: 1 min, 5 min, 30 min, 2 h, 6 h. */
export const RETRY_SCHEDULE_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];

type Retry = (params: WebhookRetryParams) => Promise<void>;

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

/** A custom webhook's request, its secret header values opened; null when one cannot be (HELPPUFF_SECRET changed). */
async function customSpec(hook: WebhookRow, secret: string | undefined): Promise<OutboundSpec | null> {
  const headers = await openHeaders(storedHeaders(hook.headers), secret, HEADER_PURPOSE);
  if (!headers) return null;
  const method = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).find((m) => m === hook.method) ?? 'POST';
  return { method, url: hook.url, headers, body: hook.body ?? '' };
}

/**
 * Deliver one event to one endpoint, up to `tries` times a moment apart, and
 * record the outcome. The signed envelope by default; a `custom` endpoint
 * gets its own request, filled from `{{event.*}}` and `{{data.*}}` (an empty
 * body sends the envelope), with the same X-HelpPuff-* headers. Never throws.
 * `retryable` says whether trying later could help (a timeout, a network
 * error, 429 or 5xx). `secret` opens a custom endpoint's secret headers.
 */
export async function deliver(db: D1Like, hook: WebhookRow, event: WebhookEnvelope, doFetch: typeof fetch, now: () => number, tries = 2, status_ = 'failed', secret?: string): Promise<Delivery> {
  const envelopeBody = JSON.stringify(event);
  const custom = hook.format === 'custom' ? await customSpec(hook, secret) : undefined;
  const spec: OutboundSpec | null = custom === undefined ? { method: 'POST', url: hook.url, headers: [], body: '' } : custom;
  const scope = { event: { id: event.id, type: event.type, createdAt: event.createdAt, site: event.site }, data: event.data, site: { id: event.site } };
  const started = now();
  let status: number | null = null;
  let error: string | null = null;
  let again = false;
  let attempts = 0;
  if (!spec) {
    error = 'A secret header could not be read (HELPPUFF_SECRET changed): enter its value again.';
  } else {
    while (attempts < tries) {
      attempts++;
      const timestamp = Math.floor(now() / 1000);
      const sent = await sendOutbound(spec, scope, doFetch, {
        timeoutMs: TIMEOUT_MS,
        userAgent: 'HelpPuff-Webhooks/1',
        fallbackBody: envelopeBody,
        extraHeaders: async (body) => ({
          'X-HelpPuff-Event': event.type,
          'X-HelpPuff-Delivery': event.id,
          'X-HelpPuff-Timestamp': String(timestamp),
          'X-HelpPuff-Signature': await signDelivery(hook.secret, timestamp, body),
        }),
      });
      status = sent.status;
      error = sent.error;
      again = sent.retryable;
      if (sent.ok || !sent.retryable) break;
      if (attempts < tries) await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
    }
  }
  const result: Delivery = { ok: error === null, status, error, attempts, durationMs: now() - started, retryable: error !== null && again };
  const at = now();
  await db
    .batch([
      db
        .prepare('INSERT INTO webhook_deliveries (id, webhook_id, event_id, event, ok, http_status, error, attempts, duration_ms, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), hook.id, event.id, event.type, result.ok ? 1 : 0, status, error, attempts, result.durationMs, at),
      db.prepare('UPDATE webhooks SET last_status = ?, last_error = ?, last_at = ? WHERE id = ?').bind(result.ok ? 'ok' : status_, error, at, hook.id),
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

/**
 * Send an event to every endpoint of the site that wants it, and wait.
 *
 * With `retry` (a Workflow binding), each endpoint gets one attempt now and a
 * failure worth retrying is handed to the Workflow, which tries again over
 * the next hours (RETRY_SCHEDULE_MS): an endpoint that is down for a while
 * still gets everything. Without it, a second attempt follows a moment later.
 */
export type EmitDeps = {
  db: D1Like;
  fetch: typeof fetch;
  now?: () => number;
  log?: (event: string, data?: object) => void;
  retry?: Retry | undefined;
  /** HELPPUFF_SECRET: opens custom webhooks' and the email service's secret headers. */
  secret?: string | undefined;
  /** ADMIN_EMAIL: the owner, who may have no row in `admins`, can choose emails too. */
  owner?: string | undefined;
  /** Cloudflare Email Service's binding, when the site sends with it. */
  emailBinding?: EmailBinding | undefined;
};

export async function emitTo(deps: EmitDeps, siteId: string, type: WebhookEventType, data: Record<string, unknown>): Promise<void> {
  await Promise.all([emitHooks(deps, siteId, type, data), notifyByEmail(deps, siteId, type, data)]);
}

async function emitHooks(deps: EmitDeps, siteId: string, type: WebhookEventType, data: Record<string, unknown>): Promise<void> {
  const now = deps.now ?? Date.now;
  const hooks = (await enabledHooks(deps.db, siteId, now())).filter((hook) => wants(hook, type));
  if (!hooks.length) return;
  const event = envelope(siteId, type, data, now());
  await Promise.all(
    hooks.map(async (hook) => {
      const result = await deliver(deps.db, hook, event, deps.fetch, now, deps.retry ? 1 : 2, deps.retry ? 'retrying' : 'failed', deps.secret);
      if (result.ok) return;
      // The type and status only: never the payload.
      deps.log?.('webhook.failed', { type, status: result.status });
      if (result.retryable && deps.retry) {
        await deps.retry({ kind: 'webhook', siteId, hookId: hook.id, event }).catch(async () => {
          await deps.db.prepare("UPDATE webhooks SET last_status = 'failed' WHERE id = ?").bind(hook.id).run().catch(() => null);
        });
      } else if (deps.retry) {
        await deps.db.prepare("UPDATE webhooks SET last_status = 'failed' WHERE id = ?").bind(hook.id).run().catch(() => null);
      }
    }),
  );
}

/**
 * A failed delivery, retried by the Workflow on RETRY_SCHEDULE_MS. Stops at
 * the first success, at an answer that retrying cannot fix (a 4xx), or when
 * the endpoint is removed or turned off meanwhile. Each try is in the
 * delivery log; the endpoint shows `retrying` until it settles.
 */
export async function runWebhookRetry(
  step: { do<T>(name: string, run: () => Promise<T>): Promise<T>; sleep(name: string, ms: number): Promise<void> },
  deps: { db: D1Like; fetch: typeof fetch; now?: () => number; secret?: string | undefined },
  params: WebhookRetryParams,
): Promise<{ delivered: boolean; tries: number }> {
  const now = deps.now ?? Date.now;
  for (const [i, wait] of RETRY_SCHEDULE_MS.entries()) {
    await step.sleep(`wait:${i}`, wait);
    const last = i === RETRY_SCHEDULE_MS.length - 1;
    const outcome = await step.do(`try:${i + 2}`, async () => {
      const hook = await deps.db.prepare('SELECT * FROM webhooks WHERE id = ? AND site_id = ? AND enabled = 1').bind(params.hookId, params.siteId).first<WebhookRow>();
      if (!hook) return 'gone' as const;
      const result = await deliver(deps.db, hook, params.event, deps.fetch, now, 1, last ? 'failed' : 'retrying', deps.secret);
      if (result.ok) return 'ok' as const;
      if (!result.retryable && !last) {
        await deps.db.prepare("UPDATE webhooks SET last_status = 'failed' WHERE id = ?").bind(hook.id).run();
      }
      return result.retryable ? ('again' as const) : ('stop' as const);
    });
    if (outcome !== 'again') return { delivered: outcome === 'ok', tries: i + 2 };
  }
  return { delivered: false, tries: RETRY_SCHEDULE_MS.length + 1 };
}

/** HELPPUFF_SECRET from the Worker's env. */
export const secretOf = (env: Record<string, unknown>): string | undefined => (typeof env['HELPPUFF_SECRET'] === 'string' && env['HELPPUFF_SECRET'] ? env['HELPPUFF_SECRET'] : undefined);

/** What sending needs from the Worker's env: the secret, and the owner (ADMIN_EMAIL). */
export const outboundOf = (env: Record<string, unknown>) => ({
  secret: secretOf(env),
  emailBinding: emailBindingOf(env),
  owner: typeof env['ADMIN_EMAIL'] === 'string' && env['ADMIN_EMAIL'] ? env['ADMIN_EMAIL'].toLowerCase() : undefined,
});

/** The Worker's Workflow, as a retry hand-off; undefined without the binding. */
export function workflowRetry(env: Record<string, unknown>): Retry | undefined {
  const workflow = env['CRAWL_WORKFLOW'] as { create?: (options: { id?: string; params: unknown }) => Promise<unknown> } | undefined;
  if (!workflow || typeof workflow.create !== 'function') return undefined;
  return async (params) => {
    await workflow.create!({ id: `wh-${params.event.id}-${params.hookId}`.slice(0, 100), params });
  };
}

/** Send an event after the response, never blocking or failing it. */
export function emit(ctx: RequestCtx, siteId: string, type: WebhookEventType, data: Record<string, unknown>): void {
  const db = dbFrom(ctx.env);
  if (!db) return;
  ctx.platform.waitUntil(
    emitTo(
      { db, fetch: globalThis.fetch.bind(globalThis), now: () => ctx.platform.now(), log: (name, extra) => ctx.platform.log(name, extra), retry: workflowRetry(ctx.env), ...outboundOf(ctx.env) },
      siteId,
      type,
      data,
    ).catch((thrown) => {
      ctx.platform.log('webhook.emit_failed', { type, reason: reasonOf(thrown) });
    }),
  );
}
