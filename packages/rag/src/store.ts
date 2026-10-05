import { sha1Hex } from './hash.js';
import type { Chunk } from './chunk.js';
import type { D1Like, VectorIndexLike, VectorMatch } from './types.js';

/**
 * Where the knowledge base lives: D1 holds the text (pages, chunks, the FTS5
 * index over them), Vectorize holds one vector per chunk, in the site's
 * namespace, under the chunk's id. The two are kept in step page by page.
 */

export type PageStatus = 'discovered' | 'queued' | 'fetched' | 'indexed' | 'unchanged' | 'skipped' | 'blocked' | 'error';

export type PageRow = {
  id: string;
  site_id: string;
  url: string;
  final_url: string | null;
  title: string | null;
  category: string | null;
  status: PageStatus;
  http_status: number | null;
  error: string | null;
  content_hash: string | null;
  selected: number;
  source: string | null;
  lastmod: string | null;
  run_id: string | null;
  crawled_at: number | null;
};

export type ChunkRow = {
  id: string;
  site_id: string;
  page_id: string;
  url: string;
  title: string | null;
  heading_path: string | null;
  category: string | null;
  ordinal: number;
  content: string;
  context: string | null;
  token_estimate: number | null;
};

export const pageIdFor = (siteId: string, url: string) => sha1Hex(`${siteId}\n${url}`);
/** 40 hex characters: under Vectorize's 64-byte id limit. */
export const chunkIdFor = (siteId: string, url: string, headingPath: string, ordinal: number) =>
  sha1Hex(`${siteId}\n${url}\n${headingPath}\n${ordinal}`);

export const HEADING_SEPARATOR = ' › ';

/** Vectorize indexed metadata values are cut at 64 bytes; keep them short and ASCII-safe. */
const short = (value: string, bytes = 60) => {
  const encoded = new TextEncoder().encode(value);
  return encoded.length <= bytes ? value : new TextDecoder().decode(encoded.slice(0, bytes)).replace(/�+$/, '');
};

// ------------------------------------------------------------------ pages

export async function getPage(db: D1Like, siteId: string, url: string): Promise<PageRow | null> {
  return db.prepare('SELECT * FROM pages WHERE site_id = ? AND url = ?').bind(siteId, url).first<PageRow>();
}

/** Insert discovered pages, keeping what an existing row already knows (status, hash, selection). */
export async function recordDiscovered(
  db: D1Like,
  siteId: string,
  pages: { url: string; category: string; source: string; lastmod?: string; suggested: boolean }[],
): Promise<void> {
  const statements = await Promise.all(
    pages.map(async (p) =>
      db
        .prepare(
          `INSERT INTO pages (id, site_id, url, category, status, selected, source, lastmod)
           VALUES (?, ?, ?, ?, 'discovered', ?, ?, ?)
           ON CONFLICT (site_id, url) DO UPDATE SET lastmod = excluded.lastmod, source = COALESCE(pages.source, excluded.source)`,
        )
        .bind(await pageIdFor(siteId, p.url), siteId, p.url, p.category, p.suggested ? 1 : 0, p.source, p.lastmod ?? null),
    ),
  );
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}

/** Mark exactly these URLs as selected (and every other page as not), queueing them for a run. */
export async function queueRun(db: D1Like, siteId: string, runId: string, urls: { url: string; category: string }[]): Promise<void> {
  await db.prepare('UPDATE pages SET selected = 0 WHERE site_id = ?').bind(siteId).run();
  const statements = await Promise.all(
    urls.map(async (p) =>
      db
        .prepare(
          `INSERT INTO pages (id, site_id, url, category, status, selected, source, run_id)
           VALUES (?, ?, ?, ?, 'queued', 1, 'manual', ?)
           ON CONFLICT (site_id, url) DO UPDATE SET selected = 1, status = 'queued', run_id = excluded.run_id, error = NULL`,
        )
        .bind(await pageIdFor(siteId, p.url), siteId, p.url, p.category, runId),
    ),
  );
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}

export async function nextQueued(db: D1Like, siteId: string, runId: string, limit: number): Promise<PageRow[]> {
  return (
    await db
      .prepare("SELECT * FROM pages WHERE site_id = ? AND run_id = ? AND status = 'queued' ORDER BY length(url), url LIMIT ?")
      .bind(siteId, runId, limit)
      .all<PageRow>()
  ).results;
}

export async function updatePage(db: D1Like, id: string, fields: Partial<Omit<PageRow, 'id' | 'site_id' | 'url'>>): Promise<void> {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return;
  await db
    .prepare(`UPDATE pages SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => fields[k] ?? null), id)
    .run();
}

// ------------------------------------------------------------------ chunks

/**
 * Replace a page's chunks: vectors first (upsert the new, delete the
 * stale), then the rows, so a reader never finds a row whose vector is gone
 * for long. Vectorize applies mutations asynchronously; a few seconds of
 * overlap is harmless.
 */
export async function replacePageChunks(
  db: D1Like,
  vectors: VectorIndexLike,
  input: { siteId: string; pageId: string; url: string; title: string; category: string; chunks: Chunk[]; embeddings: number[][] },
): Promise<string[]> {
  const ids = await Promise.all(input.chunks.map((c) => chunkIdFor(input.siteId, input.url, c.headingPath.join(HEADING_SEPARATOR), c.ordinal)));
  const old = (await db.prepare('SELECT id FROM chunks WHERE site_id = ? AND page_id = ?').bind(input.siteId, input.pageId).all<{ id: string }>()).results.map(
    (r) => r.id,
  );

  if (ids.length) {
    const records = input.chunks.map((chunk, i) => ({
      id: ids[i]!,
      values: input.embeddings[i]!,
      namespace: input.siteId,
      metadata: { category: short(input.category), page: input.pageId, url: input.url.slice(0, 500) },
    }));
    for (let i = 0; i < records.length; i += 500) await vectors.upsert(records.slice(i, i + 500));
  }
  const stale = old.filter((id) => !ids.includes(id));
  for (let i = 0; i < stale.length; i += 500) await vectors.deleteByIds(stale.slice(i, i + 500));

  const statements = [db.prepare('DELETE FROM chunks WHERE site_id = ? AND page_id = ?').bind(input.siteId, input.pageId)];
  input.chunks.forEach((chunk, i) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO chunks (id, site_id, page_id, url, title, heading_path, category, ordinal, content, context, token_estimate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(ids[i], input.siteId, input.pageId, input.url, input.title, chunk.headingPath.join(HEADING_SEPARATOR), input.category, chunk.ordinal, chunk.content, chunk.context, chunk.tokens),
    );
  });
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  return ids;
}

/** Remove a page's chunks and vectors, e.g. when it was unticked or disappeared. */
export async function deletePageChunks(db: D1Like, vectors: VectorIndexLike, siteId: string, pageId: string): Promise<number> {
  const ids = (await db.prepare('SELECT id FROM chunks WHERE site_id = ? AND page_id = ?').bind(siteId, pageId).all<{ id: string }>()).results.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) await vectors.deleteByIds(ids.slice(i, i + 500));
  await db.prepare('DELETE FROM chunks WHERE site_id = ? AND page_id = ?').bind(siteId, pageId).run();
  return ids.length;
}

export async function chunksByIds(db: D1Like, siteId: string, ids: string[]): Promise<ChunkRow[]> {
  if (!ids.length) return [];
  const rows: ChunkRow[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    rows.push(
      ...(
        await db
          .prepare(`SELECT * FROM chunks WHERE site_id = ? AND id IN (${slice.map(() => '?').join(',')})`)
          .bind(siteId, ...slice)
          .all<ChunkRow>()
      ).results,
    );
  }
  return rows;
}

// ------------------------------------------------------------------ search

const STOPWORDS = new Set(
  'a an and are as at be but by can could do does did for from had has have how i if in into is it its me my of on or our so than that the their them then there these they this to us was we were what when where which who why will with would you your yours hi hello please thanks thank'.split(
    ' ',
  ),
);

/**
 * A visitor's words as an FTS5 query: each term quoted (so no FTS syntax
 * from the visitor survives), longer terms prefix-matched, joined with OR so
 * BM25 ranks by how many terms match rather than requiring all of them.
 */
export function ftsQuery(text: string): string | null {
  const terms = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => (t.length > 1 || /\d/.test(t)) && !STOPWORDS.has(t)))].slice(0, 16);
  if (!terms.length) return null;
  return terms.map((t) => (t.length >= 4 ? `"${t}"*` : `"${t}"`)).join(' OR ');
}

export async function keywordSearch(db: D1Like, siteId: string, query: string, limit: number): Promise<{ id: string; score: number }[]> {
  const match = ftsQuery(query);
  if (!match) return [];
  // Titles and headings count for more than body text: weights follow the column order (content, title, heading_path).
  return (
    await db
      .prepare(
        `SELECT c.id AS id, bm25(chunks_fts, 1.0, 2.0, 1.5) AS score
         FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
         WHERE chunks_fts MATCH ? AND c.site_id = ?
         ORDER BY score LIMIT ?`,
      )
      .bind(match, siteId, limit)
      .all<{ id: string; score: number }>()
  ).results;
}

export async function vectorSearch(vectors: VectorIndexLike, siteId: string, vector: number[], limit: number): Promise<VectorMatch[]> {
  const result = await vectors.query(vector, { topK: limit, namespace: siteId, returnMetadata: 'none' });
  return Array.isArray(result) ? result : (result.matches ?? []);
}

// ------------------------------------------------------------------ facts

export type SiteFactRow = { key: string; value: string; source_url: string | null };

export async function readFacts(db: D1Like, siteId: string): Promise<SiteFactRow[]> {
  return (await db.prepare('SELECT key, value, source_url FROM site_facts WHERE site_id = ? ORDER BY key').bind(siteId).all<SiteFactRow>()).results;
}

export async function writeFacts(db: D1Like, siteId: string, facts: { key: string; value: string; sourceUrl?: string | null }[], now: number): Promise<void> {
  if (!facts.length) return;
  await db.batch(
    facts.map((f) =>
      db
        .prepare(
          `INSERT INTO site_facts (site_id, key, value, source_url, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (site_id, key) DO UPDATE SET value = excluded.value, source_url = excluded.source_url, updated_at = excluded.updated_at`,
        )
        .bind(siteId, f.key, f.value, f.sourceUrl ?? null, now),
    ),
  );
}
