import type { AiLike, BrowserLike, CrawlParams, D1Like, FileParams, ToMarkdown, VectorIndexLike } from '@helppuff/rag';
import { DEFAULT_RETRIEVAL } from '@helppuff/rag';
import type { SiteConfig } from '../config/schema.js';
import { HelpPuffError } from '../core/errors.js';
import { dbFrom } from '../db/d1.js';
import { knowledgeOf, workersAiModelOf } from '../core/assistant.js';

/**
 * The bindings the knowledge base runs on, as `helppuff deploy` names them:
 *
 *   AI              Workers AI          embeddings, rerank, answers
 *   VECTORS         Vectorize           one vector per chunk, namespace = site
 *   HELPPUFF_DB       D1                  pages, chunks, FTS5, facts, runs, usage
 *   CRAWL_WORKFLOW  Workflows           the background crawl, and uploaded files
 *   BROWSER         Browser Rendering   optional: pages drawn by JavaScript
 *   HELPPUFF_KV       KV                  an uploaded file, until the Workflow reads it
 */

/** The slice of a Workflow binding used here. */
export interface WorkflowLike {
  create(options: { id?: string; params: CrawlParams | FileParams }): Promise<unknown>;
}

/** The slice of KV an upload needs. */
export interface UploadStore {
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  put(key: string, value: ArrayBuffer, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export type KnowledgeEnv = {
  db: D1Like;
  ai: AiLike;
  vectors: VectorIndexLike;
  workflow: WorkflowLike | null;
  browser: BrowserLike | undefined;
  uploads: UploadStore | null;
  /** Workers AI's document converter (PDF, .docx → Markdown). */
  toMarkdown: ToMarkdown | undefined;
};

const has = (value: unknown, method: string): boolean =>
  Boolean(value) && typeof (value as Record<string, unknown>)[method] === 'function';

export function knowledgeEnv(env: Record<string, unknown>): KnowledgeEnv | null {
  const db = dbFrom(env);
  if (!db || !has(env['AI'], 'run') || !has(env['VECTORS'], 'query')) return null;
  return {
    db,
    ai: env['AI'] as AiLike,
    vectors: env['VECTORS'] as VectorIndexLike,
    workflow: has(env['CRAWL_WORKFLOW'], 'create') ? (env['CRAWL_WORKFLOW'] as WorkflowLike) : null,
    browser: has(env['BROWSER'], 'quickAction') ? (env['BROWSER'] as BrowserLike) : undefined,
    uploads: has(env['HELPPUFF_KV'], 'get') ? (env['HELPPUFF_KV'] as UploadStore) : null,
    toMarkdown: has(env['AI'], 'toMarkdown') ? (document, options) => (env['AI'] as { toMarkdown: ToMarkdown }).toMarkdown(document, options) : undefined,
  };
}

export function requireKnowledgeEnv(env: Record<string, unknown>): KnowledgeEnv {
  const found = knowledgeEnv(env);
  if (!found) {
    throw new HelpPuffError('not_found', {
      message: 'This deployment has no knowledge base. Deploy with the workers-ai backend (`helppuff deploy`).',
      detail: 'knowledge_not_configured',
    });
  }
  return found;
}

/** The models and gateway the site's connector reads with, so the crawl writes compatible vectors. */
export const DEFAULT_CHAT_MODEL = '@cf/zai-org/glm-4.7-flash';

export function aiSettingsFor(site: SiteConfig): { embeddingModel: string; chatModel: string; gateway: string | null } {
  const options = (site.connector.options ?? {}) as { retrieval?: { embeddingModel?: unknown }; gateway?: unknown; model?: unknown };
  const model = options.retrieval?.embeddingModel;
  // Other backends' models are not Workers AI models; the free default reads facts for them.
  // Helper calls (facts, summaries, suggestions) run on Workers AI: the site's model when Workers AI writes its answers too.
  const chat = workersAiModelOf(site) ?? DEFAULT_CHAT_MODEL;
  return {
    embeddingModel: typeof model === 'string' && model ? model : DEFAULT_RETRIEVAL.embeddingModel,
    chatModel: chat,
    gateway: typeof options.gateway === 'string' ? options.gateway : null,
  };
}

/** Where the crawl starts: the configured website, else the first real allowed origin. */
export function websiteFor(site: SiteConfig): string | null {
  if (site.knowledge.website) return site.knowledge.website;
  return site.origins.find((o) => /^https:\/\//.test(o) && !/localhost|127\.0\.0\.1|workers\.dev/.test(o)) ?? null;
}

/** The site answers from HelpPuff's own knowledge base: the assistant with `helppuff` knowledge, or a whole backend with `retrieval: "helppuff"`. */
export function ownsKnowledge(site: SiteConfig): boolean {
  return knowledgeOf(site) === 'helppuff' || (site.connector.options as { retrieval?: unknown } | undefined)?.retrieval === 'helppuff';
}
