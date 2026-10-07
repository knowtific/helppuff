import { Hono, type Context } from 'hono';
import { ALL_WEBHOOK_EVENTS, WEBHOOK_EVENTS, isWebhookEvent } from '@helppuff/protocol';
import { HelpPuffError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import { ensureSchema } from '../db/d1.js';
import { deliver, envelope, eventsOf, forgetWebhooks, type WebhookRow } from '../webhooks/deliver.js';
import { assertSameOrigin, currentAdmin, db, jsonBody, siteParam } from './guard.js';

/**
 * Webhooks, managed in the dashboard (Settings → Webhooks) or with
 * `helppuff webhooks`. Stored in D1 per site; delivered by `webhooks/deliver.ts`.
 */

export const webhookRoutes = new Hono<HonoEnv>();

const MAX_PER_SITE = 10;

const view = (row: WebhookRow) => ({
  id: row.id,
  url: row.url,
  description: row.description,
  events: eventsOf(row),
  enabled: Boolean(row.enabled),
  secret: row.secret,
  lastStatus: row.last_status,
  lastError: row.last_error,
  lastAt: row.last_at,
  createdAt: row.created_at,
});

/** Signed deliveries carry visitors' details: https only, and a real host. */
function validUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HelpPuffError('bad_request', { message: 'Enter the full address, starting with https://', detail: 'webhook_url' });
  }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || raw.length > 2000 || url.username || url.password) {
    throw new HelpPuffError('bad_request', { message: 'The address must start with https:// and name a real host.', detail: 'webhook_url' });
  }
  return url.toString();
}

function validEvents(value: unknown): string[] {
  if (value === undefined || value === null) return [ALL_WEBHOOK_EVENTS];
  if (!Array.isArray(value)) throw new HelpPuffError('bad_request', { message: 'Events must be a list.', detail: 'webhook_events' });
  const events = [...new Set(value.filter((e): e is string => typeof e === 'string'))];
  const unknown = events.filter((e) => e !== ALL_WEBHOOK_EVENTS && !isWebhookEvent(e));
  if (unknown.length) throw new HelpPuffError('bad_request', { message: `Unknown event: ${unknown.join(', ')}.`, detail: 'webhook_events' });
  if (!events.length) throw new HelpPuffError('bad_request', { message: 'Pick at least one event.', detail: 'webhook_events' });
  return events.includes(ALL_WEBHOOK_EVENTS) ? [ALL_WEBHOOK_EVENTS] : events;
}

const newSecret = () => `whsec_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

async function hookOf(c: Context<HonoEnv>, siteId: string): Promise<WebhookRow> {
  const row = await db(c).prepare('SELECT * FROM webhooks WHERE id = ? AND site_id = ?').bind(c.req.param('id'), siteId).first<WebhookRow>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such webhook.', detail: 'webhook_unknown' });
  return row;
}

webhookRoutes.get('/webhooks', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  await ensureSchema(db(c));
  const rows = (await db(c).prepare('SELECT * FROM webhooks WHERE site_id = ? ORDER BY created_at').bind(siteId).all<WebhookRow>()).results;
  return c.json({ webhooks: rows.map(view), events: Object.entries(WEBHOOK_EVENTS).map(([type, description]) => ({ type, description })) });
});

webhookRoutes.post('/webhooks', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const url = validUrl(body['url']);
  const events = validEvents(body['events']);
  const description = typeof body['description'] === 'string' ? body['description'].trim().slice(0, 200) || null : null;
  const d = db(c);
  await ensureSchema(d);
  const count = (await d.prepare('SELECT count(*) AS n FROM webhooks WHERE site_id = ?').bind(siteId).first<{ n: number }>())?.n ?? 0;
  if (count >= MAX_PER_SITE) throw new HelpPuffError('bad_request', { message: `Up to ${MAX_PER_SITE} webhooks per site.`, detail: 'webhook_limit' });
  const now = c.get('helppuff').platform.now();
  const id = `wh_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  await d
    .prepare('INSERT INTO webhooks (id, site_id, url, description, events, secret, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(id, siteId, url, description, JSON.stringify(events), newSecret(), now, now)
    .run();
  forgetWebhooks(siteId);
  const row = (await d.prepare('SELECT * FROM webhooks WHERE id = ?').bind(id).first<WebhookRow>())!;
  return c.json(view(row), 201);
});

webhookRoutes.patch('/webhooks/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site'] ?? c.req.query('site'));
  const row = await hookOf(c, siteId);
  const next = {
    url: body['url'] === undefined ? row.url : validUrl(body['url']),
    events: body['events'] === undefined ? row.events : JSON.stringify(validEvents(body['events'])),
    enabled: typeof body['enabled'] === 'boolean' ? (body['enabled'] ? 1 : 0) : row.enabled,
    description: typeof body['description'] === 'string' ? body['description'].trim().slice(0, 200) || null : row.description,
    secret: body['rotateSecret'] === true ? newSecret() : row.secret,
  };
  await db(c)
    .prepare('UPDATE webhooks SET url = ?, events = ?, enabled = ?, description = ?, secret = ?, updated_at = ? WHERE id = ?')
    .bind(next.url, next.events, next.enabled, next.description, next.secret, c.get('helppuff').platform.now(), row.id)
    .run();
  forgetWebhooks(siteId);
  return c.json(view({ ...row, ...next }));
});

webhookRoutes.delete('/webhooks/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const row = await hookOf(c, siteId);
  await db(c).batch([
    db(c).prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').bind(row.id),
    db(c).prepare('DELETE FROM webhooks WHERE id = ?').bind(row.id),
  ]);
  forgetWebhooks(siteId);
  return c.json({ deleted: true });
});

/** Send a `test.ping` now and say what came back: the quickest way to check an endpoint. */
webhookRoutes.post('/webhooks/:id/test', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site'] ?? c.req.query('site'));
  const row = await hookOf(c, siteId);
  const ctx = c.get('helppuff');
  const now = () => ctx.platform.now();
  const event = envelope(siteId, 'test.ping', { message: 'A test from your HelpPuff dashboard. Deliveries like this one are signed: check X-HelpPuff-Signature.' }, now());
  const result = await deliver(db(c), row, event, globalThis.fetch.bind(globalThis), now);
  return c.json({ ...result, eventId: event.id });
});

webhookRoutes.get('/webhooks/:id/deliveries', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const row = await hookOf(c, siteId);
  const rows = await db(c)
    .prepare(
      `SELECT id, event_id AS eventId, event, ok, http_status AS status, error, attempts, duration_ms AS durationMs, at
       FROM webhook_deliveries WHERE webhook_id = ? ORDER BY at DESC LIMIT 50`,
    )
    .bind(row.id)
    .all<Record<string, unknown>>();
  return c.json({ deliveries: rows.results.map((d) => ({ ...d, ok: Boolean(d['ok']) })) });
});
