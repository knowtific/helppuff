import { isImageType, type FileRef } from '@helppuff/protocol';
import type { D1Like } from '@helppuff/rag';
import { HelpPuffError } from '../core/errors.js';

/**
 * Files on R2: photos and documents visitors send in the chat, and the
 * team's attachments on jobs. One private bucket per deployment
 * (`HELPPUFF_FILES`, made by `helppuff deploy`), keyed `<site>/<scope>/<id>`;
 * the D1 `files` table lists them. Nobody reads the bucket directly: every
 * link is signed by the Worker and expires (`GET /v1/files/:id`).
 *
 * A file's type is read from its bytes, never taken from the browser, and
 * only the types below are kept. Images are shown inline; everything else
 * is served as a download, so an uploaded page can never run as the Worker.
 */

/** The slice of an R2 binding used here. */
export interface FilesBucket {
  put(key: string, value: ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string; contentDisposition?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string; contentDisposition?: string } } | null>;
  delete(keys: string | string[]): Promise<void>;
}

export const FILES_BINDING = 'HELPPUFF_FILES';

/** The deployment's bucket, or null when it has none (R2 off for the account, or a Worker older than files). */
export function filesBucket(env: Record<string, unknown>): FilesBucket | null {
  const bucket = env[FILES_BINDING] as Partial<FilesBucket> | undefined;
  return bucket && typeof bucket.put === 'function' && typeof bucket.get === 'function' ? (bucket as FilesBucket) : null;
}

export type FileScope = 'chat' | 'job';

/** What a visitor may send: photos and PDFs. */
const CHAT_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/avif', 'application/pdf']);

const OFFICE: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** What the team may attach to a job: the visitor's kinds, plus office documents, text, CSV and short videos. */
const JOB_TYPES = new Set([...CHAT_TYPES, ...Object.values(OFFICE), 'text/plain', 'text/csv', 'video/mp4', 'video/quicktime']);

export const allowedTypes = (scope: FileScope): Set<string> => (scope === 'chat' ? CHAT_TYPES : JOB_TYPES);

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
const extension = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? '';

/** The media type of these bytes, from their first bytes (and the name, for zips and text). Null: not a kind HelpPuff keeps. */
export function sniffType(bytes: Uint8Array, name: string): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (/^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic';
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  if (ascii(bytes, 0, 4) === 'PK\x03\x04') return OFFICE[extension(name)] ?? null;
  const ext = extension(name);
  if (ext === 'txt' || ext === 'csv' || ext === 'md') {
    const head = bytes.subarray(0, 4096);
    if (head.includes(0)) return null;
    try {
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(head.length === 4096 ? head.subarray(0, 4092) : head);
    } catch {
      return null;
    }
    return ext === 'csv' ? 'text/csv' : 'text/plain';
  }
  return null;
}

/** A name safe to store and show: no path, no control characters, at most 200 characters. */
export function cleanFileName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim().slice(-200);
  return cleaned || 'file';
}

export type FileRow = {
  id: string;
  site_id: string;
  scope: FileScope;
  conversation_id: string | null;
  job_id: string | null;
  name: string;
  type: string;
  size: number;
  uploaded_by: string;
  uploaded_by_name: string | null;
  description: string | null;
  created_at: number;
};

export const fileKey = (row: Pick<FileRow, 'site_id' | 'scope' | 'id'>) => `${row.site_id}/${row.scope}/${row.id}`;

const disposition = (type: string, name: string) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${isImageType(type) ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

/**
 * Check and keep one file: its size against `maxBytes`, its type against the
 * scope's list. The bytes go to R2 first, then the row, so a listed file is
 * always there to read.
 */
export async function saveFile(
  deps: { db: D1Like; bucket: FilesBucket; now: number },
  input: { siteId: string; scope: FileScope; conversationId?: string | null; jobId?: string | null; name: string; bytes: ArrayBuffer; maxBytes: number; by: { id: string; name: string | null } },
): Promise<FileRow> {
  const size = input.bytes.byteLength;
  if (!size) throw new HelpPuffError('bad_request', { message: 'The file is empty.', detail: 'file_empty' });
  if (size > input.maxBytes) {
    throw new HelpPuffError('bad_request', { message: `Files can be up to ${Math.floor(input.maxBytes / (1024 * 1024))} MB.`, detail: 'file_too_large' });
  }
  const name = cleanFileName(input.name);
  const type = sniffType(new Uint8Array(input.bytes, 0, Math.min(size, 4096)), name);
  if (!type || !allowedTypes(input.scope).has(type)) {
    throw new HelpPuffError('bad_request', {
      message: input.scope === 'chat' ? 'Send a photo (JPEG, PNG, WebP, GIF, HEIC) or a PDF.' : 'Attach a photo, PDF, Word, Excel or PowerPoint file, text, CSV or an MP4/MOV video.',
      detail: 'file_type',
    });
  }
  const row: FileRow = {
    id: `f_${deps.now.toString(36)}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    site_id: input.siteId,
    scope: input.scope,
    conversation_id: input.conversationId ?? null,
    job_id: input.jobId ?? null,
    name,
    type,
    size,
    uploaded_by: input.by.id,
    uploaded_by_name: input.by.name,
    description: null,
    created_at: deps.now,
  };
  await deps.bucket.put(fileKey(row), input.bytes, { httpMetadata: { contentType: type, contentDisposition: disposition(type, name) } });
  await deps.db
    .prepare(
      `INSERT INTO files (id, site_id, scope, conversation_id, job_id, name, type, size, uploaded_by, uploaded_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.site_id, row.scope, row.conversation_id, row.job_id, row.name, row.type, row.size, row.uploaded_by, row.uploaded_by_name, row.created_at)
    .run();
  return row;
}

/** Remove files: the bytes, then the rows. */
export async function deleteFiles(deps: { db: D1Like; bucket: FilesBucket | null }, rows: Pick<FileRow, 'id' | 'site_id' | 'scope'>[]): Promise<number> {
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    if (deps.bucket) await deps.bucket.delete(part.map(fileKey));
    await deps.db.prepare(`DELETE FROM files WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part.map((r) => r.id)).run();
  }
  return rows.length;
}

/** The files of a conversation or a job (also on delete: they go with it). */
export async function filesOf(db: D1Like, where: { conversationId?: string; jobId?: string }): Promise<FileRow[]> {
  const [column, value] = where.jobId ? ['job_id', where.jobId] : ['conversation_id', where.conversationId];
  const rows = await db.prepare(`SELECT * FROM files WHERE ${column} = ? ORDER BY created_at, id`).bind(value).all<FileRow>();
  return rows.results;
}

/** The cron: chat files older than each site's `keepChatDays` are deleted. Job files stay until someone removes them. */
export async function purgeOldChatFiles(deps: { db: D1Like; bucket: FilesBucket }, siteId: string, keepDays: number, now: number): Promise<number> {
  const rows = await deps.db
    .prepare("SELECT id, site_id, scope FROM files WHERE site_id = ? AND scope = 'chat' AND created_at < ? LIMIT 1000")
    .bind(siteId, now - keepDays * 86_400_000)
    .all<Pick<FileRow, 'id' | 'site_id' | 'scope'>>();
  return deleteFiles(deps, rows.results);
}

// ------------------------------------------------------------ signed links

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();
const hmacKey = (secret: string) => {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(`helppuff-file:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keys.set(secret, key);
  }
  return key;
};
const b64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function signature(secret: string, key: string, expires: number): Promise<string> {
  return b64(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${key}\n${expires}`))).slice(0, 27);
}

/** How long a link in a list (dashboard, API) works. A visitor's lasts as long as their chat. */
export const LINK_TTL_MS = 12 * 3_600_000;

/** `<origin>/v1/files/<site>/<scope>/<id>?e=<expiry>&s=<signature>`: anyone with it can read the file until it expires. */
export async function signedFileUrl(secret: string, origin: string, row: Pick<FileRow, 'id' | 'site_id' | 'scope'>, expires: number): Promise<string> {
  const key = fileKey(row);
  const e = Math.ceil(expires / 1000).toString(36);
  return `${origin}/v1/files/${encodeURIComponent(row.site_id)}/${row.scope}/${row.id}?e=${e}&s=${await signature(secret, key, parseInt(e, 36))}`;
}

/** The object key a signed link names, if it is genuine and not expired. */
export async function verifyFileUrl(secret: string, key: string, e: string | undefined, s: string | undefined, now: number): Promise<boolean> {
  if (!e || !s || e.length > 12 || s.length > 64 || !/^[^/]{1,64}\/(chat|job)\/f_[a-z0-9]{8,40}$/.test(key)) return false;
  const expires = parseInt(e, 36);
  if (!Number.isFinite(expires) || expires * 1000 < now) return false;
  const expected = await signature(secret, key, expires);
  let diff = expected.length ^ s.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (s.charCodeAt(i) || 0);
  return diff === 0;
}

/** A file as lists and messages carry it, with a link that works for `ttl`. */
export async function fileView(secret: string, origin: string, row: FileRow, now: number, ttl = LINK_TTL_MS) {
  const ref: Required<FileRef> = { id: row.id, name: row.name, type: row.type, size: row.size, url: await signedFileUrl(secret, origin, row, now + ttl) };
  return { ...ref, uploadedBy: row.uploaded_by, uploadedByName: row.uploaded_by_name, createdAt: row.created_at };
}
