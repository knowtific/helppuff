import { migrate } from './migrations.js';

/**
 * Cloudflare D1, bound as `HELPPUFF_DB`: the dashboard's store (conversations,
 * messages, leads) and the knowledge base's text side (pages, chunks, FTS).
 *
 * Optional for the dashboard. With no binding, nothing is recorded and the
 * Worker behaves exactly as before — no lead data, no transcripts. The schema
 * (see `migrations.ts`) is applied by `helppuff deploy` and, as a fallback,
 * once per isolate on first use.
 */

/** The subset of the D1 binding used here, so tests can pass a fake. */
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

let applied: WeakSet<object> = new WeakSet();

/** Statements through a binding, in the shape the migration runner takes. */
export function d1Runner(db: D1Like) {
  return async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> =>
    (await db.prepare(sql).bind(...params).all()).results;
}

/** Apply pending migrations once per isolate per binding. Idempotent. */
export async function ensureSchema(db: D1Like): Promise<void> {
  if (applied.has(db)) return;
  await migrate(d1Runner(db));
  applied.add(db);
}

/** Tests reset the memo between fake databases. */
export function resetSchemaMemo(): void {
  applied = new WeakSet();
}

export function dbFrom(env: Record<string, unknown>): D1Like | null {
  const db = env['HELPPUFF_DB'] as Partial<D1Like> | undefined;
  return db && typeof db.prepare === 'function' && typeof db.batch === 'function' ? (db as D1Like) : null;
}
