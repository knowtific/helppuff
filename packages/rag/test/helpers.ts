import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../../server/src/db/migrations.js';
import type { AiLike, D1Like, D1Statement, VectorIndexLike, VectorMatch, VectorMetadata } from '../src/types.js';
import type { StepLike } from '../src/crawl.js';

/** D1 is SQLite: a real database, with the production schema. */
export function sqliteD1(): D1Like & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) for (const sql of migration.statements) raw.exec(sql);
  const statement = (sql: string, values: unknown[] = []): D1Statement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    // Shaped like D1's result, so code that reads `meta.changes` is tested as it runs.
    run: async () => {
      const r = raw.prepare(sql).run(...(values as never[]));
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    all: async <T,>() => ({ results: raw.prepare(sql).all(...(values as never[])) as T[] }),
    first: async <T,>() => (raw.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
  });
  return {
    raw,
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      const out: unknown[] = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
  };
}

const DIMS = 128;
const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** A bag-of-words embedding: texts sharing words are close, which is all retrieval tests need. */
function embed(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const w of words(text)) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[h % DIMS]! += 1;
  }
  const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function fakeAi(options: { failRerank?: boolean } = {}): AiLike & { calls: { model: string; inputs: Record<string, unknown> }[] } {
  const calls: { model: string; inputs: Record<string, unknown> }[] = [];
  return {
    calls,
    async run(model, inputs) {
      calls.push({ model, inputs });
      if ('documents' in inputs || 'queries' in inputs || 'text' in inputs) {
        const texts = (inputs['documents'] ?? inputs['queries'] ?? inputs['text']) as string[];
        return { data: texts.map(embed), shape: [texts.length, DIMS] };
      }
      if ('contexts' in inputs) {
        if (options.failRerank) throw new Error('reranker down');
        const q = new Set(words(String(inputs['query'])).filter((w) => w.length > 2));
        const contexts = inputs['contexts'] as { text: string }[];
        return {
          response: contexts.map((c, id) => {
            const have = new Set(words(c.text));
            const hits = [...q].filter((w) => have.has(w)).length;
            return { id, score: q.size ? hits / q.size : 0 };
          }),
        };
      }
      throw new Error(`unexpected model call ${model}`);
    },
  };
}

export function fakeVectors(): VectorIndexLike & { store: Map<string, { values: number[]; namespace?: string; metadata?: VectorMetadata }> } {
  const store = new Map<string, { values: number[]; namespace?: string; metadata?: VectorMetadata }>();
  return {
    store,
    async upsert(vectors) {
      for (const v of vectors) store.set(v.id, { values: v.values, ...(v.namespace ? { namespace: v.namespace } : {}), ...(v.metadata ? { metadata: v.metadata } : {}) });
      return { mutationId: 'm' };
    },
    async deleteByIds(ids) {
      for (const id of ids) store.delete(id);
      return { mutationId: 'm' };
    },
    async query(vector, options) {
      const matches: VectorMatch[] = [];
      for (const [id, v] of store) {
        if (options.namespace && v.namespace !== options.namespace) continue;
        matches.push({ id, score: v.values.reduce((n, x, i) => n + x * (vector[i] ?? 0), 0) });
      }
      return { matches: matches.sort((a, b) => b.score - a.score).slice(0, options.topK) };
    },
  };
}

/** Steps run inline, with Workflows' semantics that matter here: a throw propagates after retries. */
export function inlineSteps(): StepLike & { names: string[]; sleeps: number } {
  const names: string[] = [];
  const self = {
    names,
    sleeps: 0,
    async do<T>(name: string, run: () => Promise<T>): Promise<T> {
      names.push(name);
      return run();
    },
    async sleep() {
      self.sleeps++;
    },
  };
  return self;
}

/** A fake website: path → HTML (or a status). */
export function site(pages: Record<string, string | number>, origin = 'https://acme.test'): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const key = `${url.pathname}${url.search}`;
    const page = pages[key] ?? pages[url.pathname];
    if (page === undefined) return new Response('not found', { status: 404 });
    if (typeof page === 'number') return new Response('nope', { status: page });
    const type = key.endsWith('.xml') ? 'application/xml' : key.endsWith('.txt') ? 'text/plain' : 'text/html; charset=utf-8';
    const response = new Response(page, { status: 200, headers: { 'content-type': type } });
    Object.defineProperty(response, 'url', { value: `${origin}${key}` });
    return response;
  }) as typeof fetch;
}
