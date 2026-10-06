import { Hono } from 'hono';
import { MurmurError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import { ensureSchema } from '../db/d1.js';
import { emit } from '../webhooks/deliver.js';
import { assertSameOrigin, currentAdmin, db, jsonBody, siteParam } from './guard.js';

/**
 * Callback requests as tasks: the Callbacks page, the labels on contacts and
 * conversations, and `murmur callbacks`. A request is made when the assistant
 * requests a callback or the visitor sends the callback form
 * (`admin/record.ts`); the team marks it done (with a note) or dismissed.
 */

export const CALLBACK_STATUSES = ['open', 'done', 'dismissed'] as const;
export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

type Row = {
  id: string;
  conversation_id: string;
  lead_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  reason: string | null;
  status: CallbackStatus;
  note: string | null;
  requested_at: number;
  closed_at: number | null;
  closed_by: string | null;
  page_url?: string | null;
};

export const callbackView = (row: Row) => ({
  id: row.id,
  conversationId: row.conversation_id,
  leadId: row.lead_id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  reason: row.reason,
  status: row.status,
  note: row.note,
  requestedAt: row.requested_at,
  closedAt: row.closed_at,
  closedBy: row.closed_by,
  pageUrl: row.page_url ?? null,
});

/** Columns as the list and the webhook show them: the contact is the conversation's current one (leads merge by email). */
const COLUMNS = `cb.id, cb.conversation_id, COALESCE(cv.lead_id, cb.lead_id) AS lead_id, cb.name, cb.phone, cb.email, cb.reason, cb.status, cb.note,
                cb.requested_at, cb.closed_at, cb.closed_by, cv.page_url`;

export const callbackRoutes = new Hono<HonoEnv>();

callbackRoutes.get('/admin/api/callbacks', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const d = db(c);
  await ensureSchema(d);
  const status = c.req.query('status') ?? 'open';
  if (status !== 'all' && !CALLBACK_STATUSES.includes(status as CallbackStatus)) {
    throw new MurmurError('bad_request', { message: 'Status is open, done, dismissed or all.', detail: 'callback_status' });
  }
  const [rows, counts] = await Promise.all([
    d
      .prepare(
        `SELECT ${COLUMNS} FROM callbacks cb LEFT JOIN conversations cv ON cv.id = cb.conversation_id
         WHERE cb.site_id = ? ${status === 'all' ? '' : 'AND cb.status = ?'}
         ORDER BY ${status === 'open' ? 'cb.requested_at ASC' : 'COALESCE(cb.closed_at, cb.requested_at) DESC'} LIMIT 500`,
      )
      .bind(...(status === 'all' ? [siteId] : [siteId, status]))
      .all<Row>(),
    d.prepare('SELECT status, COUNT(*) AS n FROM callbacks WHERE site_id = ? GROUP BY status').bind(siteId).all<{ status: string; n: number }>(),
  ]);
  return c.json({
    items: rows.results.map(callbackView),
    counts: Object.fromEntries(CALLBACK_STATUSES.map((s) => [s, counts.results.find((r) => r.status === s)?.n ?? 0])),
  });
});

callbackRoutes.patch('/admin/api/callbacks/:id', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const status = body['status'];
  if (status !== undefined && !CALLBACK_STATUSES.includes(status as CallbackStatus)) {
    throw new MurmurError('bad_request', { message: 'Status is open, done or dismissed.', detail: 'callback_status' });
  }
  const note = body['note'] === undefined ? undefined : typeof body['note'] === 'string' ? body['note'].trim().slice(0, 2000) || null : null;
  const d = db(c);
  await ensureSchema(d);
  const current = await d.prepare('SELECT * FROM callbacks WHERE id = ? AND site_id = ?').bind(c.req.param('id'), siteId).first<Row>();
  if (!current) throw new MurmurError('not_found', { message: 'No such callback request.', detail: 'callback_unknown' });
  const next = (status as CallbackStatus | undefined) ?? current.status;
  if (next === 'open' && current.status !== 'open') {
    // Only one open request per conversation: reopening a closed one while another is open would break that.
    const other = await d.prepare("SELECT id FROM callbacks WHERE conversation_id = ? AND status = 'open'").bind(current.conversation_id).first<{ id: string }>();
    if (other) throw new MurmurError('bad_request', { message: 'This conversation already has an open callback request.', detail: 'callback_open_exists' });
  }
  const now = c.get('mm').platform.now();
  const closing = next !== 'open';
  await d
    .prepare('UPDATE callbacks SET status = ?, note = ?, closed_at = ?, closed_by = ? WHERE id = ?')
    .bind(next, note === undefined ? current.note : note, closing ? (current.status === next ? current.closed_at : now) : null, closing ? (current.status === next ? current.closed_by : admin.via === 'api-key' ? 'cli' : admin.email) : null, current.id)
    .run();
  const row = (await d.prepare(`SELECT ${COLUMNS} FROM callbacks cb LEFT JOIN conversations cv ON cv.id = cb.conversation_id WHERE cb.id = ?`).bind(current.id).first<Row>())!;
  const view = callbackView(row);
  if (row.status !== current.status || row.note !== current.note) emit(c.get('mm'), siteId, 'callback.updated', { callback: view, previousStatus: current.status });
  return c.json(view);
});
