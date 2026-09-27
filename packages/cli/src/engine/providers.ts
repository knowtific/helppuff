import Anthropic from '@anthropic-ai/sdk';
import { CliError } from '../errors.js';
import { resourceName } from './project.js';

/**
 * The provider calls setup makes from this machine: checking a key before it
 * is deployed, and filling OpenAI / Gemini knowledge stores. Runtime calls
 * live in the connectors, inside the Worker; nothing here runs there.
 */

export type KeyCheck = { ok: true } | { ok: false; reason: string } | { ok: 'unknown'; reason: string };

async function status(doFetch: typeof fetch, url: string, init: RequestInit): Promise<number | null> {
  try {
    return (await doFetch(url, init)).status;
  } catch {
    return null;
  }
}

function judge(code: number | null, what: string): KeyCheck {
  if (code === null) return { ok: 'unknown', reason: `could not reach ${what} to check the key` };
  if (code >= 200 && code < 300) return { ok: true };
  if (code === 401 || code === 403) return { ok: false, reason: `${what} rejected the key (HTTP ${code})` };
  return { ok: 'unknown', reason: `${what} answered HTTP ${code}` };
}

export async function checkKey(
  provider: 'openai' | 'gemini' | 'anthropic' | 'retell',
  key: string,
  extra: { agentId?: string; baseUrl?: string } = {},
  doFetch: typeof fetch = fetch,
): Promise<KeyCheck> {
  switch (provider) {
    case 'openai':
      return judge(
        await status(doFetch, `${extra.baseUrl ?? 'https://api.openai.com/v1'}/models`, {
          headers: { Authorization: `Bearer ${key}` },
        }),
        'OpenAI',
      );
    case 'gemini':
      return judge(
        await status(doFetch, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
          headers: { 'x-goog-api-key': key },
        }),
        'Gemini',
      );
    case 'anthropic': {
      try {
        await new Anthropic({ apiKey: key, fetch: doFetch, maxRetries: 0, timeout: 15_000 }).models.list({ limit: 1 });
        return { ok: true };
      } catch (thrown) {
        if (thrown instanceof Anthropic.AuthenticationError || thrown instanceof Anthropic.PermissionDeniedError) {
          return { ok: false, reason: 'Anthropic rejected the key' };
        }
        return { ok: 'unknown', reason: `could not check the Anthropic key: ${(thrown as Error).message}` };
      }
    }
    case 'retell':
      return judge(
        await status(doFetch, `https://api.retellai.com/get-agent/${encodeURIComponent(extra.agentId ?? '')}`, {
          headers: { Authorization: `Bearer ${key}` },
        }),
        'Retell',
      );
  }
}

export type UploadDoc = { name: string; data: Uint8Array; type: string };

async function json<T>(doFetch: typeof fetch, url: string, init: RequestInit, what: string): Promise<T> {
  let response: Response;
  try {
    response = await doFetch(url, init);
  } catch (thrown) {
    throw new CliError('network', `Could not reach ${what}: ${(thrown as Error).message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new CliError(
      response.status === 401 || response.status === 403 ? 'provider_auth' : 'provider_error',
      `${what} failed (HTTP ${response.status}): ${text.slice(0, 300)}`,
      response.status === 401 ? { hint: 'Check the API key: `murmur secret set <NAME>`.' } : {},
    );
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function blob(doc: UploadDoc): Blob {
  return new Blob([doc.data as BlobPart], { type: doc.type });
}

// -------------------------------------------------------------------- OpenAI

/**
 * A fresh vector store per sync, swapped in atomically: a half-finished sync
 * never serves, and nothing has to diff files by name. Older stores for the
 * site are removed, keeping the previous one until the new config is live.
 */
export async function syncOpenAiStore(
  opts: { key: string; site: string; docs: UploadDoc[]; baseUrl?: string; onProgress?: (done: number) => void },
  doFetch: typeof fetch = fetch,
): Promise<{ vectorStoreId: string; removed: string[] }> {
  const base = opts.baseUrl ?? 'https://api.openai.com/v1';
  const auth = { Authorization: `Bearer ${opts.key}` };
  const prefix = `${resourceName(opts.site)}-`;

  const store = await json<{ id: string }>(
    doFetch,
    `${base}/vector_stores`,
    { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${prefix}${Date.now()}` }) },
    'OpenAI (create vector store)',
  );

  const fileIds: string[] = [];
  let done = 0;
  await pool(opts.docs, 4, async (doc) => {
    const form = new FormData();
    form.set('purpose', 'assistants');
    form.set('file', blob(doc), doc.name);
    const file = await json<{ id: string }>(doFetch, `${base}/files`, { method: 'POST', headers: auth, body: form }, `OpenAI (upload ${doc.name})`);
    fileIds.push(file.id);
    opts.onProgress?.(++done);
  });

  for (let i = 0; i < fileIds.length; i += 500) {
    await json(
      doFetch,
      `${base}/vector_stores/${store.id}/file_batches`,
      {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: fileIds.slice(i, i + 500) }),
      },
      'OpenAI (attach files)',
    );
  }

  const list = await json<{ data: { id: string; name: string | null; created_at: number }[] }>(
    doFetch,
    `${base}/vector_stores?limit=100`,
    { headers: auth },
    'OpenAI (list vector stores)',
  );
  const stale = list.data
    .filter((s) => s.name?.startsWith(prefix) && s.id !== store.id)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(1);
  for (const old of stale) {
    await json(doFetch, `${base}/vector_stores/${old.id}`, { method: 'DELETE', headers: auth }, 'OpenAI (delete old store)').catch(() => {});
  }
  return { vectorStoreId: store.id, removed: stale.map((s) => s.id) };
}

// -------------------------------------------------------------------- Gemini

const GEMINI = 'https://generativelanguage.googleapis.com';

export async function syncGeminiStore(
  opts: { key: string; site: string; docs: UploadDoc[]; onProgress?: (done: number) => void },
  doFetch: typeof fetch = fetch,
): Promise<{ fileSearchStore: string; removed: string[] }> {
  const auth = { 'x-goog-api-key': opts.key };
  const prefix = `${resourceName(opts.site)}-`;

  const store = await json<{ name: string }>(
    doFetch,
    `${GEMINI}/v1beta/fileSearchStores`,
    { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: `${prefix}${Date.now()}` }) },
    'Gemini (create File Search store)',
  );

  let done = 0;
  await pool(opts.docs, 4, async (doc) => {
    // Multipart upload: JSON metadata, then the bytes.
    const boundary = `murmur${Math.random().toString(36).slice(2)}`;
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ displayName: doc.name, mimeType: doc.type })}\r\n--${boundary}\r\nContent-Type: ${doc.type}\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const body = new Blob([head, doc.data as BlobPart, tail]);
    await json(
      doFetch,
      `${GEMINI}/upload/v1beta/${store.name}:uploadToFileSearchStore`,
      {
        method: 'POST',
        headers: { ...auth, 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
      `Gemini (upload ${doc.name})`,
    );
    opts.onProgress?.(++done);
  });

  const list = await json<{ fileSearchStores?: { name: string; displayName?: string; createTime?: string }[] }>(
    doFetch,
    `${GEMINI}/v1beta/fileSearchStores?pageSize=20`,
    { headers: auth },
    'Gemini (list stores)',
  );
  const stale = (list.fileSearchStores ?? [])
    .filter((s) => s.displayName?.startsWith(prefix) && s.name !== store.name)
    .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)))
    .slice(1);
  for (const old of stale) {
    await json(doFetch, `${GEMINI}/v1beta/${old.name}?force=true`, { method: 'DELETE', headers: auth }, 'Gemini (delete old store)').catch(
      () => {},
    );
  }
  return { fileSearchStore: store.name, removed: stale.map((s) => s.name) };
}

/** Run `task` over `items`, `limit` at a time. */
export async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++]!);
  });
  await Promise.all(workers);
}
