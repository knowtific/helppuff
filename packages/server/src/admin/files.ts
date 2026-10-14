import { Hono, type Context } from 'hono';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { jobRow, recordJobEvent, type JobRow } from '../jobs/store.js';
import { deleteFiles, filesBucket, filesOf, fileView, saveFile, type FileRow } from '../files/store.js';
import { assertSameOrigin, assertSiteAccess, currentAdmin, db, type Admin } from './guard.js';
import { actorOf } from './inbox.js';
import { displayName } from './live.js';

/**
 * Files on jobs (`files.jobs`): installation photos, plans, quotes. People
 * in the dashboard (members too), API keys and the CLI attach them; the
 * photos and files the visitor sent in the job's conversation are listed
 * with them. Every link is signed and expires (`files/store.ts`).
 */

export const fileAdminRoutes = new Hono<HonoEnv>();

const MB = 1024 * 1024;

async function ownJob(c: Context<HonoEnv>): Promise<JobRow> {
  const row = await jobRow(db(c), c.req.param('id') ?? '');
  assertSiteAccess(c, row.site_id, 'job');
  return row;
}

const who = (admin: Admin) => ({ id: actorOf(admin), name: admin.name ?? (admin.via === 'session' ? displayName(admin) : admin.via === 'key' ? admin.name : 'CLI') });

/** The job's files, and the ones its conversation brought. */
fileAdminRoutes.get('/jobs/:id/files', async (c) => {
  await currentAdmin(c);
  const row = await ownJob(c);
  const ctx = c.get('helppuff');
  const site = await resolveSite(ctx, row.site_id);
  const bucket = filesBucket(ctx.env);
  const d = db(c);
  const [own, chat] = await Promise.all([filesOf(d, { jobId: row.id }), row.conversation_id ? filesOf(d, { conversationId: row.conversation_id }) : Promise.resolve([])]);
  const now = ctx.platform.now();
  const view = (r: FileRow) => fileView(requireSecret(ctx), new URL(c.req.url).origin, r, now);
  return c.json({
    enabled: site.files.jobs,
    storage: Boolean(bucket),
    maxMb: site.files.maxJobMb,
    files: await Promise.all(own.map(view)),
    fromChat: await Promise.all(chat.map(view)),
  });
});

/** Attach a file: the raw bytes as the body, its name as `?name=`. */
fileAdminRoutes.post('/jobs/:id/files', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const row = await ownJob(c);
  const ctx = c.get('helppuff');
  const site = await resolveSite(ctx, row.site_id);
  if (!site.files.jobs) {
    throw new HelpPuffError('bad_request', { message: 'Files on jobs are off. Turn them on in Settings → Advanced, or with `helppuff files jobs on`.', detail: 'files_off' });
  }
  const bucket = filesBucket(ctx.env);
  if (!bucket) {
    throw new HelpPuffError('not_found', {
      message: 'This deployment has no file storage yet. Turn on R2 in the Cloudflare dashboard (once per account), then run `helppuff deploy`.',
      detail: 'files_no_storage',
    });
  }
  const maxBytes = Math.round(site.files.maxJobMb * MB);
  if (Number(c.req.header('Content-Length') ?? 0) > maxBytes) {
    throw new HelpPuffError('bad_request', { message: `Files can be up to ${site.files.maxJobMb} MB.`, detail: 'file_too_large' });
  }
  const now = ctx.platform.now();
  const by = who(admin);
  const saved = await saveFile({ db: db(c), bucket, now }, { siteId: row.site_id, scope: 'job', jobId: row.id, name: c.req.query('name') ?? '', bytes: await c.req.arrayBuffer(), maxBytes, by });
  await recordJobEvent(db(c), row.id, now, by, 'file', { name: saved.name });
  ctx.platform.log('file.uploaded', { siteId: row.site_id, scope: 'job', size: saved.size });
  return c.json(await fileView(requireSecret(ctx), new URL(c.req.url).origin, saved, now), 201);
});

/** Remove a file from a job: an admin, or the person who attached it. */
fileAdminRoutes.delete('/jobs/:id/files/:fileId', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const row = await ownJob(c);
  const d = db(c);
  const file = await d.prepare("SELECT * FROM files WHERE id = ? AND job_id = ? AND scope = 'job'").bind(c.req.param('fileId'), row.id).first<FileRow>();
  if (!file) throw new HelpPuffError('not_found', { message: 'No such file on this job.', detail: 'file_missing' });
  if (admin.role === 'member' && file.uploaded_by !== actorOf(admin)) {
    throw new HelpPuffError('forbidden', { message: 'Only an admin, or whoever attached it, can remove this file.', detail: 'admin_role_member' });
  }
  await deleteFiles({ db: d, bucket: filesBucket(c.get('helppuff').env) }, [file]);
  await recordJobEvent(d, row.id, c.get('helppuff').platform.now(), who(admin), 'file_removed', { name: file.name });
  return c.json({ id: file.id, deleted: true });
});
