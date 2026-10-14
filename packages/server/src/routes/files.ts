import { Hono } from 'hono';
import { HelpPuffError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import { requireSecret } from '../core/request.js';
import { hitMemory, quotaExceeded, rateLimited } from '../core/ratelimit.js';
import { visitorStanding } from '../core/visitor.js';
import { dbFrom } from '../db/d1.js';
import { isLive, readLiveState } from '../live/service.js';
import { authenticate } from './messages.js';
import { fileKey, filesBucket, fileView, saveFile, verifyFileUrl, type FileScope } from '../files/store.js';

/**
 * Files in the chat (`files.chat`). The visitor's upload, on the chat's
 * session token, and the one way anyone reads a file: a signed link that
 * expires (`files/store.ts`). The upload is the one write a visitor waits
 * for: the message that carries the file follows it, as usual.
 */

export const fileRoutes = new Hono<HonoEnv>();

const MB = 1024 * 1024;

fileRoutes.post('/v1/sessions/files', async (c) => {
  const ctx = c.get('helppuff');
  const session = await authenticate(ctx, c.req.header('Authorization'));
  const { site, payload } = session;
  const { siteId, sessionId } = payload;
  const db = dbFrom(ctx.env);
  const bucket = filesBucket(ctx.env);
  if (site.files.chat === 'off' || !db || !bucket) {
    throw new HelpPuffError('not_found', { message: 'Sending files is not on for this chat.', detail: 'files_off' });
  }
  const now = ctx.platform.now();
  const [live, count] = await Promise.all([
    site.files.chat === 'live' ? readLiveState(db, sessionId) : null,
    db.prepare('SELECT COUNT(*) AS n FROM files WHERE conversation_id = ?').bind(sessionId).first<{ n: number }>(),
  ]);
  if (site.files.chat === 'live' && !(site.live.enabled && isLive(live, site.live, now))) {
    throw new HelpPuffError('forbidden', { message: 'You can send photos and files once someone from the team has joined the chat.', detail: 'files_live_only' });
  }
  if ((await visitorStanding(ctx, site.security)) === 'limited') {
    const verdict = hitMemory('upload', `${siteId}:${await ctx.ipKey()}`, site.security.limits.uploadsPerIpPerHour, 3600, now);
    if (!verdict.allowed) throw rateLimited(verdict, 'uploads_per_ip');
  }
  if ((count?.n ?? 0) >= site.files.perConversation) throw quotaExceeded('files_per_conversation', 'This chat cannot take more files.');
  const maxBytes = Math.round(site.files.maxChatMb * MB);
  if (Number(c.req.header('Content-Length') ?? 0) > maxBytes) {
    throw new HelpPuffError('bad_request', { message: `Files can be up to ${site.files.maxChatMb} MB.`, detail: 'file_too_large' });
  }
  const row = await saveFile(
    { db, bucket, now },
    { siteId, scope: 'chat', conversationId: sessionId, name: c.req.query('name') ?? '', bytes: await c.req.arrayBuffer(), maxBytes, by: { id: 'visitor', name: null } },
  );
  ctx.platform.log('file.uploaded', { siteId, scope: 'chat', size: row.size });
  // The visitor's link lasts as long as their chat does.
  const view = await fileView(requireSecret(ctx), new URL(c.req.url).origin, row, now, Math.max(payload.exp - now, 60_000));
  return c.json({ id: view.id, name: view.name, type: view.type, size: view.size, url: view.url }, 201);
});

/** A file, for whoever holds a link the Worker signed (the widget, the dashboard, Telegram, an API client). */
fileRoutes.get('/v1/files/:site/:scope/:id', async (c) => {
  const ctx = c.get('helppuff');
  const bucket = filesBucket(ctx.env);
  const scope = c.req.param('scope');
  const key = fileKey({ site_id: c.req.param('site'), scope: scope as FileScope, id: c.req.param('id') });
  if (!bucket || !(await verifyFileUrl(requireSecret(ctx), key, c.req.query('e'), c.req.query('s'), ctx.platform.now()))) {
    throw new HelpPuffError('not_found', { message: 'This link has expired. Open the file again from where you found it.', detail: 'file_link_invalid' });
  }
  const object = await bucket.get(key);
  if (!object) throw new HelpPuffError('not_found', { message: 'This file was removed.', detail: 'file_missing' });
  const headers = new Headers({
    'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'Content-Disposition': object.httpMetadata?.contentDisposition ?? 'attachment',
    'Content-Length': String(object.size),
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    // Nothing in a file runs as this Worker, even opened on its own.
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    // The widget shows the visitor's photos on the host page.
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Referrer-Policy': 'no-referrer',
  });
  return new Response(object.body, { headers });
});
