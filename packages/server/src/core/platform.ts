import type { KvStore } from '@murmur/connector-types';

/**
 * Everything the core needs from its host. Keeping Worker-only APIs behind
 * this interface is what makes a Node or Vercel adapter a small file rather
 * than a rewrite (§7.3).
 */
export interface Platform {
  kv: KvStore;
  waitUntil: (promise: Promise<unknown>) => void;
  /** Visitor IP, already extracted from the platform's own header. */
  ip: string | null;
  now: () => number;
  /** Structured logging. Never receives lead data or message text (§7.2). */
  log: (event: string, data?: object) => void;
}

/** In-memory KV for tests and the Node adapter's dev mode. */
export function memoryKv(): KvStore & { size: () => number } {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  return {
    async get(key) {
      return live(key)?.value ?? null;
    },
    async put(key, value, options) {
      const ttl = options?.expirationTtl;
      store.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : null });
    },
    async delete(key) {
      store.delete(key);
    },
    size() {
      return store.size;
    },
  };
}

/**
 * A KV binding that is missing or broken must never take the site down: reads
 * return null and writes are dropped. Rate limits degrade open, which is the
 * documented tradeoff — KV is for abuse bounds, never for billing (§7.2).
 */
export function resilientKv(kv: KvStore | undefined, log: Platform['log']): KvStore {
  if (!kv) {
    return {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
    };
  }
  return {
    async get(key) {
      try {
        return await kv.get(key);
      } catch {
        log('kv.get_failed');
        return null;
      }
    },
    async put(key, value, options) {
      try {
        await kv.put(key, value, options);
      } catch {
        log('kv.put_failed');
      }
    },
    async delete(key) {
      try {
        await kv.delete(key);
      } catch {
        log('kv.delete_failed');
      }
    },
  };
}

/** SHA-256 of the IP with a secret salt. Raw IPs never enter a key or a log (§7.2). */
export async function hashIp(ip: string | null, salt: string): Promise<string> {
  if (!ip) return 'noip';
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
