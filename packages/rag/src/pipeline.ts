import { embedDocuments, type AiOptions } from './ai.js';
import { chunkPage, embeddingText, type ChunkOptions } from './chunk.js';
import { sha256Hex } from './hash.js';
import { pageIdFor, replacePageChunks, type SiteFactRow } from './store.js';
import type { AiLike, D1Like, VectorIndexLike } from './types.js';

/**
 * One document into the knowledge base: chunk, embed, store. The same path
 * for a crawled page, a hand-written Q&A and the site-facts summary, so
 * they are all found the same way.
 */

export type IndexDeps = { db: D1Like; ai: AiLike; vectors: VectorIndexLike; now?: () => number };
export type IndexOptions = AiOptions & { embeddingModel: string; chunking?: ChunkOptions };

export type IndexDocument = {
  siteId: string;
  url: string;
  title: string;
  category: string;
  markdown: string;
};

export type Indexed = { pageId: string; chunks: number; neurons: number; contentHash: string };

export async function indexDocument(deps: IndexDeps, doc: IndexDocument, options: IndexOptions): Promise<Indexed> {
  const pageId = await pageIdFor(doc.siteId, doc.url);
  const contentHash = await sha256Hex(doc.markdown);
  const chunks = chunkPage(doc.markdown, { title: doc.title, url: doc.url, category: doc.category }, options.chunking);
  const { vectors, neurons } = chunks.length
    ? await embedDocuments(deps.ai, options.embeddingModel, chunks.map(embeddingText), options)
    : { vectors: [], neurons: 0 };
  await replacePageChunks(deps.db, deps.vectors, { siteId: doc.siteId, pageId, url: doc.url, title: doc.title, category: doc.category, chunks, embeddings: vectors });
  return { pageId, chunks: chunks.length, neurons, contentHash };
}

/** Pseudo-URLs for documents that are not web pages. Never shown as links. */
export const FACTS_URL = 'murmur://facts';
export const manualUrl = (id: string) => `murmur://manual/${id}`;
export const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

const FACT_LABELS: Record<string, string> = {
  name: 'Business name',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  hours: 'Opening hours',
  serviceAreas: 'Service areas',
  priceRange: 'Price range',
  description: 'About',
  footer: 'Shown on every page',
};

/** Site facts as one Markdown document, so "what's your number" always has a passage to hit. */
export function factsMarkdown(facts: readonly Pick<SiteFactRow, 'key' | 'value'>[]): string {
  const lines = facts
    .filter((f) => f.value.trim())
    .sort((a, b) => Object.keys(FACT_LABELS).indexOf(a.key) - Object.keys(FACT_LABELS).indexOf(b.key))
    .map((f) => (f.key === 'footer' ? `${FACT_LABELS[f.key]}:\n\n${f.value}` : `- ${FACT_LABELS[f.key] ?? f.key}: ${f.value}`));
  return lines.length ? `## Contact details and business information\n\n${lines.join('\n')}` : '';
}
