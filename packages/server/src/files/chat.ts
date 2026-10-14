import { fileLine, isImageType, type FileRef } from '@helppuff/protocol';
import type { D1Like } from '@helppuff/rag';
import type { SiteConfig } from '../config/schema.js';
import { HelpPuffError } from '../core/errors.js';
import { dbFrom } from '../db/d1.js';
import { liveAvailable } from '../live/service.js';
import { replyOf, type AiRunner } from '../conversations/summary.js';
import { fileKey, filesBucket, type FileRow, type FilesBucket } from './store.js';

/**
 * Files in a conversation: whether this chat can send them, the files a
 * message names, and what the assistant is told about them. The assistant
 * never reads a file itself; with `aiSeesPhotos` a vision model describes
 * each photo once, and the assistant reads the description.
 */

/** When the widget may offer the paperclip (`capabilities.files`), or undefined. */
export function chatFilesMode(env: Record<string, unknown>, site: Pick<SiteConfig, 'files' | 'live'>, siteId: string): 'live' | 'always' | undefined {
  const mode = site.files.chat;
  if (mode === 'off' || !filesBucket(env) || !dbFrom(env)) return undefined;
  if (mode === 'live' && !liveAvailable(env, site, siteId)) return undefined;
  return mode;
}

/** The files a visitor's message carries: this conversation's own uploads, in the order named. */
export async function messageFiles(db: D1Like, conversationId: string, ids: readonly string[]): Promise<FileRow[]> {
  const unique = [...new Set(ids)];
  const rows = await db
    .prepare(`SELECT * FROM files WHERE conversation_id = ? AND scope = 'chat' AND id IN (${unique.map(() => '?').join(',')})`)
    .bind(conversationId, ...unique)
    .all<FileRow>();
  if (rows.results.length !== unique.length) {
    throw new HelpPuffError('bad_request', { message: 'That file is not part of this chat. Send it again.', detail: 'file_unknown' });
  }
  return unique.map((id) => rows.results.find((r) => r.id === id)!);
}

/** A file as the transcript keeps it: no link (links expire; they are signed again when read). */
export const fileRef = (row: FileRow): FileRef => ({ id: row.id, name: row.name, type: row.type, size: row.size });

/** What the visitor wrote and sent, as the transcript, the team and the assistant's history read it. */
export function visitorLine(text: string, rows: readonly FileRow[]): string {
  return [text, ...rows.map(fileLine)].filter(Boolean).join('\n');
}

/** The text the assistant gets: what the visitor wrote, then a bracketed note per file. */
export function assistantText(text: string, rows: readonly FileRow[]): string {
  const notes = rows.map((row) => {
    const kind = isImageType(row.type) || row.type.startsWith('image/') ? 'a photo' : row.type === 'application/pdf' ? 'a PDF' : 'a file';
    return row.description
      ? `[The visitor sent ${kind}, "${row.name}". It shows: ${row.description}]`
      : `[The visitor sent ${kind}, "${row.name}". You cannot see files; say the team will look at it.]`;
  });
  return [text, ...notes].filter(Boolean).join('\n');
}

const DESCRIBE =
  'Describe this photo for a business owner\'s assistant in 2-4 plain sentences: what it shows, any visible damage, measurements, product names, model numbers or text. No guesses beyond what is visible.';

/** Vision models take a photo inline; larger ones are left undescribed. */
const MAX_DESCRIBE_BYTES = 4 * 1024 * 1024;

function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/**
 * Describe the photos that have no description yet (once each: kept in the
 * row). A failure leaves the photo undescribed; the chat goes on. Returns the
 * rows with their descriptions, and the writes to make after the reply.
 */
export async function describePhotos(deps: { db: D1Like; bucket: FilesBucket; ai: AiRunner; model: string; log: (event: string, data?: object) => void }, rows: FileRow[]): Promise<{ rows: FileRow[]; save: () => Promise<unknown> }> {
  const described: FileRow[] = [];
  const updates: { id: string; description: string }[] = [];
  for (const row of rows) {
    if (row.description || !isImageType(row.type) || row.size > MAX_DESCRIBE_BYTES) {
      described.push(row);
      continue;
    }
    try {
      const object = await deps.bucket.get(fileKey(row));
      const bytes = object ? new Uint8Array(await new Response(object.body).arrayBuffer()) : null;
      if (!bytes) throw new Error('missing');
      const raw = await deps.ai.run(deps.model, {
        messages: [{ role: 'user', content: [{ type: 'text', text: DESCRIBE }, { type: 'image_url', image_url: { url: `data:${row.type};base64,${base64(bytes)}` } }] }],
        max_tokens: 300,
      });
      const description = replyOf(raw).text.trim().replace(/\s+/g, ' ').slice(0, 1200);
      if (!description) throw new Error('empty');
      described.push({ ...row, description });
      updates.push({ id: row.id, description });
    } catch {
      deps.log('file.describe_failed');
      described.push(row);
    }
  }
  return {
    rows: described,
    save: async () => {
      if (updates.length) await deps.db.batch(updates.map((u) => deps.db.prepare('UPDATE files SET description = ? WHERE id = ?').bind(u.description, u.id)));
    },
  };
}
