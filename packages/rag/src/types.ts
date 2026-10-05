/**
 * The slices of Cloudflare's bindings the knowledge base uses, typed
 * structurally so the package runs (and is tested) without the Workers
 * runtime: a fake with the same shape is as good as the real thing.
 */

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

/** Workers AI: `env.AI`. */
export interface AiLike {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export type VectorMetadata = Record<string, string | number | boolean>;
export type VectorMatch = { id: string; score: number; metadata?: Record<string, unknown> };

/** Vectorize: `env.VECTORS`. */
export interface VectorIndexLike {
  upsert(vectors: { id: string; values: number[]; namespace?: string; metadata?: VectorMetadata }[]): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  query(
    vector: number[],
    options: { topK: number; namespace?: string; returnValues?: boolean; returnMetadata?: 'none' | 'indexed' | 'all'; filter?: Record<string, unknown> },
  ): Promise<{ matches: VectorMatch[] } | VectorMatch[]>;
}

/** Browser Rendering: `env.BROWSER`. Quick actions need no Puppeteer. */
export interface BrowserLike {
  quickAction(action: string, options: Record<string, unknown>): Promise<Response>;
}

export type Log = (event: string, data?: Record<string, unknown>) => void;

/** Tell the site's webhooks something happened (`knowledge.crawl.finished`…). Never throws. */
export type Notify = (type: 'knowledge.crawl.finished' | 'knowledge.file.processed', data: Record<string, unknown>) => Promise<void>;
