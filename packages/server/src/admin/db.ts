/**
 * The dashboard's store: Cloudflare D1, bound as `MURMUR_DB`.
 *
 * Optional. With no binding, nothing is recorded and the Worker behaves
 * exactly as before — no lead data, no transcripts. With one, every
 * conversation, message and lead lands here so the owner can read them in
 * `/admin`. The schema is applied by `murmur deploy` and, as a fallback,
 * once per isolate on first write, so a Worker never writes to a table that
 * does not exist.
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

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    page_url TEXT,
    page_title TEXT,
    referrer TEXT,
    utm TEXT,
    locale TEXT,
    country TEXT,
    first_message TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    lead_id TEXT,
    summary TEXT,
    intent TEXT,
    summarized_at INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS conversations_site_last ON conversations (site_id, last_at DESC)',
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    type TEXT NOT NULL,
    text TEXT,
    payload TEXT,
    ts INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, ts)',
  `CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    conversation_id TEXT,
    name TEXT,
    email TEXT,
    phone TEXT,
    fields TEXT,
    source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS leads_site_created ON leads (site_id, created_at DESC)',
  'CREATE UNIQUE INDEX IF NOT EXISTS leads_conversation ON leads (conversation_id)',
  `CREATE TABLE IF NOT EXISTS admins (
    email TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  )`,
  // Every published system prompt, append-only. A restore is a new version
  // carrying an old text, so history never loses anything. The primary key
  // is also the lock: two publishes racing for the same number cannot both win.
  `CREATE TABLE IF NOT EXISTS prompt_versions (
    site_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    text TEXT NOT NULL,
    hash TEXT NOT NULL,
    source TEXT NOT NULL,
    author TEXT,
    note TEXT,
    restored_from INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (site_id, version)
  )`,
];

let applied: WeakSet<object> = new WeakSet();

/** Apply the schema once per isolate per binding. Idempotent. */
export async function ensureSchema(db: D1Like): Promise<void> {
  if (applied.has(db)) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  applied.add(db);
}

/** Tests reset the memo between fake databases. */
export function resetSchemaMemo(): void {
  applied = new WeakSet();
}

export function dbFrom(env: Record<string, unknown>): D1Like | null {
  const db = env['MURMUR_DB'] as Partial<D1Like> | undefined;
  return db && typeof db.prepare === 'function' && typeof db.batch === 'function' ? (db as D1Like) : null;
}
