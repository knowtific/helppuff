import type { Context } from 'hono';
import { resolveSite } from '../config/site.js';
import { bookingDeps } from '../bookings/deps.js';
import { bookingsOf, cancelAppointment } from '../bookings/service.js';
import type { AppointmentRow } from '../bookings/store.js';
import { reasonOf } from '../core/log.js';
import type { HonoEnv } from '../core/request.js';
import { deleteFiles, filesBucket, type FileRow } from '../files/store.js';
import type { Actor } from '../jobs/store.js';
import { deleteConversations } from './chat.js';
import { db, type Admin } from './guard.js';
import { actorOf } from './inbox.js';
import { displayName } from './live.js';

/**
 * Delete a contact and everything recorded about them: a person's "forget
 * me", and what deleting a contact always does. Their conversations (with
 * messages, chat files, labels, notes, callback requests and Telegram
 * threads), their callback requests, notes, tags, jobs (with their history,
 * notes and files) and appointments. An upcoming appointment is cancelled at
 * the synced calendar first, as deleting one does; a calendar that refuses
 * does not stop the rest. Questions to answer keep their (anonymous) text and
 * lose the link to the conversation.
 *
 * Irreversible: the dashboard and the CLI ask first.
 */

export type Erased = {
  conversations: number;
  callbacks: number;
  notes: number;
  jobs: number;
  appointments: number;
  files: number;
};

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const marks = (list: unknown[]) => list.map(() => '?').join(', ');

export async function eraseContact(c: Context<HonoEnv>, admin: Admin, lead: { id: string; site_id: string; email?: string | null }): Promise<Erased> {
  const d = db(c);
  const ctx = c.get('helppuff');
  const bucket = filesBucket(ctx.env);

  const conversations = ids((await d.prepare('SELECT id FROM conversations WHERE lead_id = ?').bind(lead.id).all<{ id: string }>()).results);
  const convMarks = marks(conversations);
  const jobs = ids(
    (
      await d
        .prepare(`SELECT id FROM jobs WHERE lead_id = ?${conversations.length ? ` OR conversation_id IN (${convMarks})` : ''}`)
        .bind(lead.id, ...conversations)
        .all<{ id: string }>()
    ).results,
  );
  const jobMarks = marks(jobs);
  const appointments = (
    await d
      .prepare(
        `SELECT * FROM appointments WHERE lead_id = ?${conversations.length ? ` OR conversation_id IN (${convMarks})` : ''}${jobs.length ? ` OR job_id IN (${jobMarks})` : ''}`,
      )
      .bind(lead.id, ...conversations, ...jobs)
      .all<AppointmentRow>()
  ).results;
  const [callbacks, notes, jobFiles, chatFiles] = await Promise.all([
    d.prepare(`SELECT COUNT(*) AS n FROM callbacks WHERE lead_id = ?${conversations.length ? ` OR conversation_id IN (${convMarks})` : ''}`).bind(lead.id, ...conversations).first<{ n: number }>(),
    d
      .prepare(`SELECT COUNT(*) AS n FROM notes WHERE lead_id = ?${conversations.length ? ` OR conversation_id IN (${convMarks})` : ''}${jobs.length ? ` OR job_id IN (${jobMarks})` : ''}`)
      .bind(lead.id, ...conversations, ...jobs)
      .first<{ n: number }>(),
    jobs.length ? d.prepare(`SELECT id, site_id, scope FROM files WHERE job_id IN (${jobMarks})`).bind(...jobs).all<Pick<FileRow, 'id' | 'site_id' | 'scope'>>() : Promise.resolve({ results: [] }),
    conversations.length
      ? d.prepare(`SELECT COUNT(*) AS n FROM files WHERE scope = 'chat' AND conversation_id IN (${convMarks})`).bind(...conversations).first<{ n: number }>()
      : Promise.resolve({ n: 0 }),
  ]);

  // Upcoming appointments are cancelled where they were booked, so the calendar does not keep them.
  const upcoming = appointments.filter((a) => a.status !== 'cancelled' && a.status !== 'busy' && a.starts_at > Date.now());
  if (upcoming.length) {
    const b = bookingsOf(await resolveSite(ctx, lead.site_id));
    const deps = bookingDeps(ctx, lead.site_id);
    const actor: Actor = { id: actorOf(admin), name: admin.via === 'session' ? displayName(admin) : admin.via === 'key' ? admin.name : 'CLI' };
    for (const row of upcoming) {
      await cancelAppointment(deps, b, row, actor, 'Contact deleted').catch((thrown) => ctx.platform.log('erase.appointment_cancel_failed', { reason: reasonOf(thrown) }));
    }
  }

  await deleteFiles({ db: d, bucket }, jobFiles.results);
  await deleteConversations(d, conversations, bucket);
  const appointmentIds = ids(appointments);
  await d.batch([
    ...(appointmentIds.length ? [d.prepare(`DELETE FROM appointments WHERE id IN (${marks(appointmentIds)})`).bind(...appointmentIds)] : []),
    ...(jobs.length
      ? [
          d.prepare(`DELETE FROM job_events WHERE job_id IN (${jobMarks})`).bind(...jobs),
          d.prepare(`DELETE FROM notes WHERE job_id IN (${jobMarks})`).bind(...jobs),
          d.prepare(`DELETE FROM jobs WHERE id IN (${jobMarks})`).bind(...jobs),
        ]
      : []),
    ...(conversations.length ? [d.prepare(`UPDATE knowledge_gaps SET conversation_id = NULL WHERE conversation_id IN (${convMarks})`).bind(...conversations)] : []),
    d.prepare('DELETE FROM callbacks WHERE lead_id = ?').bind(lead.id),
    d.prepare('DELETE FROM notes WHERE lead_id = ?').bind(lead.id),
    d.prepare('DELETE FROM lead_tags WHERE lead_id = ?').bind(lead.id),
    // The emails to them that no conversation holds any more (tests aside, every one has one; this catches a typed address).
    ...(lead.email ? [d.prepare('DELETE FROM customer_emails WHERE site_id = ? AND lower(to_email) = ?').bind(lead.site_id, lead.email.toLowerCase())] : []),
    d.prepare('DELETE FROM leads WHERE id = ?').bind(lead.id),
  ]);

  return {
    conversations: conversations.length,
    callbacks: callbacks?.n ?? 0,
    notes: notes?.n ?? 0,
    jobs: jobs.length,
    appointments: appointments.length,
    files: jobFiles.results.length + (chatFiles?.n ?? 0),
  };
}
