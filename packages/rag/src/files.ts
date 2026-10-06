import { addUsage, type StepLike } from './crawl.js';
import { indexDocument, type IndexDeps } from './pipeline.js';
import { deletePageChunks, pageIdFor } from './store.js';
import type { D1Like, Notify, VectorIndexLike } from './types.js';

/**
 * Uploaded documents (PDF, Word, Markdown, text) into the knowledge base, as
 * a background job of durable steps, like the crawl:
 *
 *   read     the bytes from KV (where the upload left them) → Markdown.
 *            PDF and .docx go through Workers AI's `toMarkdown`, which is
 *            free for documents; text and Markdown are decoded as they are.
 *   distill  the Markdown cleaned for retrieval: running headers, footers
 *            and page numbers dropped, lines a PDF wrapped joined again,
 *            hyphenation undone, headings found in plain text.
 *   section  one step per ~16k characters: chunk, embed, store. Small steps
 *            keep each one inside the Workers Free CPU limit (10 ms a step).
 *
 * Each section is a page (`helppuff://file/<id>#<n>`, source `file`), so a
 * file's passages are found, shown and removed like any other. The cleaned
 * Markdown is kept, so a new embedding model re-embeds without a new upload.
 */

export const FILE_KINDS = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  txt: 'text/plain',
} as const;
export type FileKind = keyof typeof FILE_KINDS;

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** About 75k tokens, or 60–100 pages of prose. More is cut, and the file says so. */
export const MAX_FILE_CHARS = 300_000;
/** What `read` keeps before cleaning; D1 holds up to 2 MB a row. */
const MAX_RAW_CHARS = 500_000;
export const SECTION_CHARS = 16_000;

export type FileStatus = 'queued' | 'reading' | 'learning' | 'indexed' | 'error';

export const fileUrl = (id: string, section?: number) => `helppuff://file/${id}${section ? `#${section}` : ''}`;
export const uploadKey = (siteId: string, fileId: string) => `upload:${siteId}:${fileId}`;

/** `Price list.PDF` → `pdf`; null for anything else. */
export function fileKind(name: string): FileKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  if (ext === 'markdown') return 'md';
  return ext && ext in FILE_KINDS ? (ext as FileKind) : null;
}

/** The file's name without its extension, for titles: `price-list_2026.pdf` → `price list 2026`. */
export function fileTitle(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Document';
}

export type FileParams = { kind: 'file'; siteId: string; fileId: string; options: { embeddingModel: string; gateway?: string | null } };

/** `env.AI.toMarkdown`, for one document (developers.cloudflare.com/workers-ai/features/markdown-conversion). */
export type ToMarkdown = (
  document: { name: string; blob: Blob },
  options?: { conversionOptions?: Record<string, unknown> },
) => Promise<ConversionResult | ConversionResult[]>;
type ConversionResult = { name?: string; format: 'markdown' | 'text' | 'error'; data?: string; error?: string; tokens?: number };

export type FileDeps = IndexDeps & {
  /** Where the upload waits: KV in the Worker. */
  uploads: { get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>; delete(key: string): Promise<void> };
  toMarkdown?: ToMarkdown | undefined;
  notify?: Notify | undefined;
};

// ------------------------------------------------------------------ distill

const PAGE_NUMBER = /^(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
/** Lines that are Markdown structure: never joined, never treated as furniture. */
const STRUCTURE = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|---|\*\*\*)/;

/** Clean extracted text for retrieval. Markdown files are only tidied; extracted text is repaired. */
export function distill(text: string, kind: FileKind): string {
  let lines = text
    .replace(/\r\n?/g, '\n')
    // Control characters other than tab and newline, and non-breaking spaces.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));

  if (kind !== 'md') {
    // Running headers and footers: the same short line on page after page.
    const seen = new Map<string, number>();
    for (const line of lines) {
      const key = line.trim();
      if (key && key.length <= 80 && !STRUCTURE.test(key)) seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const furniture = new Set([...seen].filter(([, n]) => n >= 3).map(([key]) => key));
    lines = lines.filter((line) => {
      const key = line.trim();
      return !PAGE_NUMBER.test(key) && !furniture.has(key);
    });

    // Lines the PDF wrapped: join a line to the next when the sentence plainly carries on.
    const joined: string[] = [];
    for (const line of lines) {
      const previous = joined[joined.length - 1];
      const trimmed = line.trim();
      if (previous && trimmed && previous.trim() && !STRUCTURE.test(trimmed) && !STRUCTURE.test(previous.trim())) {
        if (/[a-z]-$/.test(previous) && /^[a-z]/.test(trimmed)) {
          joined[joined.length - 1] = previous.slice(0, -1) + trimmed;
          continue;
        }
        if (!/[.!?:;"”)]$/.test(previous) && /^[a-z(]/.test(trimmed)) {
          joined[joined.length - 1] = `${previous} ${trimmed}`;
          continue;
        }
      }
      joined.push(line);
    }
    lines = joined;

    // Plain text with no headings: a short title-like line between blank lines becomes one, so passages keep their context.
    if (!lines.some((line) => /^#{1,6}\s/.test(line))) {
      lines = lines.map((line, i) => {
        const trimmed = line.trim();
        const alone = !lines[i - 1]?.trim() && !lines[i + 1]?.trim();
        const titleLike = trimmed.length >= 3 && trimmed.length <= 60 && /^[A-Z0-9]/.test(trimmed) && !/[.,;:!?]$/.test(trimmed) && trimmed.split(/\s+/).length <= 8;
        return alone && titleLike && !STRUCTURE.test(trimmed) ? `## ${trimmed}` : line;
      });
    }
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ------------------------------------------------------------------ sections

/**
 * Split cleaned Markdown into sections of at most about `max` characters, at
 * paragraph boundaries and preferably at headings. Each section starts with
 * the headings it sits under, so its passages keep their context.
 */
export function sections(markdown: string, max = SECTION_CHARS): string[] {
  const blocks = markdown.split(/\n{2,}/).filter((b) => b.trim());
  const out: string[] = [];
  const trail: string[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = () => {
    if (current.some((b) => !/^#{1,6}\s/.test(b))) out.push(current.join('\n\n'));
    current = [];
    size = 0;
  };
  for (const raw of blocks) {
    // A block longer than a section on its own (a huge table, an unbroken page) is cut at lines.
    const pieces = raw.length > max ? cutLines(raw, max) : [raw];
    for (const block of pieces) {
      const heading = /^(#{1,6})\s/.exec(block);
      // A heading closes its siblings and anything below them before it opens.
      if (heading) {
        const level = heading[1]!.length;
        while (trail.length && (/^(#{1,6})\s/.exec(trail[trail.length - 1]!)?.[1]?.length ?? 0) >= level) trail.pop();
      }
      if (current.length && (size + block.length > max || (heading && size > max / 2))) {
        flush();
        current = [...trail];
        size = trail.join('\n\n').length;
      }
      if (heading) trail.push(block.split('\n')[0]!);
      current.push(block);
      size += block.length + 2;
    }
  }
  flush();
  return out;
}

function cutLines(block: string, max: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const line of block.split('\n')) {
    if (current && current.length + line.length + 1 > max) {
      out.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line.slice(0, max);
  }
  if (current) out.push(current);
  return out;
}

// ------------------------------------------------------------------ the job

type FileRow = { id: string; site_id: string; name: string; kind: FileKind; status: FileStatus; markdown: string | null };

async function fileRow(db: D1Like, fileId: string): Promise<FileRow | null> {
  return db.prepare('SELECT id, site_id, name, kind, status, markdown FROM knowledge_files WHERE id = ?').bind(fileId).first<FileRow>();
}

async function setStatus(deps: FileDeps, fileId: string, status: FileStatus, fields: { error?: string | null; chunks?: number } = {}): Promise<void> {
  await deps.db
    .prepare('UPDATE knowledge_files SET status = ?, error = ?, chunks = COALESCE(?, chunks), updated_at = ? WHERE id = ?')
    .bind(status, fields.error ?? null, fields.chunks ?? null, (deps.now ?? Date.now)(), fileId)
    .run();
}

class NotUploadedYet extends Error {}

/** Read the upload and turn it into Markdown. */
async function readUpload(deps: FileDeps, row: FileRow): Promise<string> {
  const bytes = await deps.uploads.get(uploadKey(row.site_id, row.id), 'arrayBuffer');
  if (!bytes) throw new NotUploadedYet('The upload is not readable yet.');
  if (row.kind === 'md' || row.kind === 'txt') return new TextDecoder().decode(bytes);
  if (!deps.toMarkdown) throw new Error('This Worker cannot read PDF or Word files (no Workers AI binding).');
  const converted = await deps.toMarkdown({ name: row.name, blob: new Blob([bytes], { type: FILE_KINDS[row.kind] }) }, { conversionOptions: { pdf: { metadata: false } } });
  const result = Array.isArray(converted) ? converted[0] : converted;
  if (!result || result.format === 'error') throw new Error(`Could not read the file: ${result?.error ?? 'no result'}`.slice(0, 300));
  return result.data ?? '';
}

/** Remove a file's passages (every section), e.g. before re-indexing it or when it is deleted. */
export async function deleteFileChunks(db: D1Like, vectors: VectorIndexLike, siteId: string, fileId: string): Promise<number> {
  // A prefix test, not LIKE: D1 refuses LIKE patterns over 50 bytes, and these are longer.
  const base = fileUrl(fileId);
  const ofFile = "site_id = ? AND source = 'file' AND (url = ? OR substr(url, 1, ?) = ?)";
  const args = [siteId, base, base.length + 1, `${base}#`];
  const pages = (await db.prepare(`SELECT id FROM pages WHERE ${ofFile}`).bind(...args).all<{ id: string }>()).results;
  let removed = 0;
  for (const page of pages) removed += await deletePageChunks(db, vectors, siteId, page.id);
  await db.prepare(`DELETE FROM pages WHERE ${ofFile}`).bind(...args).run();
  return removed;
}

/**
 * Run a file's job. With the Markdown already kept (a re-embed), `read` and
 * `distill` are skipped. A failure after retries marks the file `error` with
 * the reason, for the dashboard to show.
 */
export async function runFileJob(step: StepLike, deps: FileDeps, params: FileParams): Promise<{ status: FileStatus; chunks: number }> {
  const result = await runFile(step, deps, params);
  if (deps.notify) {
    await step.do('notify', async () => {
      const row = await deps.db.prepare('SELECT name, status, error, chunks, truncated FROM knowledge_files WHERE id = ?').bind(params.fileId).first<Record<string, unknown>>();
      if (!row) return false;
      await deps.notify!('knowledge.file.processed', {
        fileId: params.fileId,
        name: row['name'],
        status: row['status'],
        passages: row['chunks'] ?? 0,
        truncated: Boolean(row['truncated']),
        error: row['error'] ?? null,
      });
      return true;
    });
  }
  return result;
}

async function runFile(step: StepLike, deps: FileDeps, params: FileParams): Promise<{ status: FileStatus; chunks: number }> {
  const { siteId, fileId } = params;
  const known = await step.do('load', async () => {
    const row = await fileRow(deps.db, fileId);
    return row ? { exists: true, distilled: Boolean(row.markdown) } : { exists: false, distilled: false };
  });
  if (!known.exists) return { status: 'error', chunks: 0 };

  try {
    if (!known.distilled) {
      // KV is eventually consistent: a write can take a few seconds to reach where this runs.
      for (let attempt = 0; ; attempt++) {
        try {
          await step.do(attempt ? `read:${attempt}` : 'read', async () => {
            const row = (await fileRow(deps.db, fileId))!;
            await setStatus(deps, fileId, 'reading');
            const markdown = await readUpload(deps, row);
            await deps.db.prepare('UPDATE knowledge_files SET markdown = ? WHERE id = ?').bind(markdown.slice(0, MAX_RAW_CHARS), fileId).run();
            return markdown.length;
          });
          break;
        } catch (thrown) {
          if (attempt >= 3 || !(thrown instanceof NotUploadedYet || /not readable yet/.test(String((thrown as Error)?.message)))) throw thrown;
          await step.sleep(`wait:${attempt}`, 20_000);
        }
      }
      await step.do('distill', async () => {
        const row = (await fileRow(deps.db, fileId))!;
        const clean = distill(row.markdown ?? '', row.kind);
        const truncated = clean.length > MAX_FILE_CHARS;
        await deps.db
          .prepare('UPDATE knowledge_files SET markdown = ?, truncated = ? WHERE id = ?')
          .bind(truncated ? clean.slice(0, clean.lastIndexOf('\n\n', MAX_FILE_CHARS) > 0 ? clean.lastIndexOf('\n\n', MAX_FILE_CHARS) : MAX_FILE_CHARS) : clean, truncated ? 1 : 0, fileId)
          .run();
        await deps.uploads.delete(uploadKey(siteId, fileId));
        return clean.length;
      });
    }

    const count = await step.do('plan', async () => {
      const row = (await fileRow(deps.db, fileId))!;
      await setStatus(deps, fileId, 'learning');
      await deleteFileChunks(deps.db, deps.vectors, siteId, fileId);
      return sections(row.markdown ?? '').length;
    });
    if (!count) {
      await step.do('empty', async () => {
        await setStatus(deps, fileId, 'error', { error: 'No readable text in the file. A scanned PDF has none; try a text version.', chunks: 0 });
        return true;
      });
      return { status: 'error', chunks: 0 };
    }

    let chunks = 0;
    for (let i = 0; i < count; i++) {
      chunks += await step.do(`section:${i + 1}`, async () => {
        const row = (await fileRow(deps.db, fileId))!;
        const markdown = sections(row.markdown ?? '')[i];
        if (!markdown) return 0;
        const url = fileUrl(fileId, i + 1);
        const title = count > 1 ? `${fileTitle(row.name)} (part ${i + 1} of ${count})` : fileTitle(row.name);
        const pageId = await pageIdFor(siteId, url);
        await deps.db
          .prepare(
            `INSERT INTO pages (id, site_id, url, title, category, status, selected, source, crawled_at) VALUES (?, ?, ?, ?, 'general', 'indexed', 1, 'file', ?)
             ON CONFLICT (site_id, url) DO UPDATE SET title = excluded.title, status = 'indexed', crawled_at = excluded.crawled_at`,
          )
          .bind(pageId, siteId, url, title, (deps.now ?? Date.now)())
          .run();
        const indexed = await indexDocument(deps, { siteId, url, title: fileTitle(row.name), category: 'general', markdown }, params.options);
        await addUsage(deps, siteId, indexed.neurons);
        return indexed.chunks;
      });
    }

    await step.do('finish', async () => {
      await deps.db.prepare('UPDATE knowledge_files SET embedding_model = ? WHERE id = ?').bind(params.options.embeddingModel, fileId).run();
      await setStatus(deps, fileId, 'indexed', { chunks });
      return chunks;
    });
    return { status: 'indexed', chunks };
  } catch (thrown) {
    const message = String((thrown as Error)?.message ?? thrown).slice(0, 300);
    await step.do('failed', async () => {
      await setStatus(deps, fileId, 'error', { error: /not readable yet/.test(message) ? 'The upload went missing before it was read. Upload it again.' : message });
      return true;
    });
    return { status: 'error', chunks: 0 };
  }
}
