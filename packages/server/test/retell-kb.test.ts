import { describe, expect, it } from 'vitest';
import { indexDocument } from '@murmur/rag';
import { defineConfig } from '../src/config/load.js';
import { memoryKv } from '../src/core/platform.js';
import { verifyRetellSignature } from '../src/routes/retell.js';
import { harness, ORIGIN, SECRET } from './helpers.js';
import { fakeAi, fakeVectors, sqliteD1 } from '../../rag/test/helpers.js';

const KEY = 'key_retell_test';

/** Exactly retell-sdk's `sign`: `v=<ms>,d=<hex HMAC-SHA256(key, body + ms)>`. */
async function sign(body: string, key: string, stamp = Date.now()): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body + stamp));
  return `v=${stamp},d=${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function world(retrieval: 'murmur' | null = 'murmur') {
  const db = sqliteD1();
  const ai = fakeAi();
  const vectors = fakeVectors();
  await indexDocument({ db, ai, vectors }, { siteId: 'acme', url: 'https://acme.test/areas', title: 'Areas', category: 'location', markdown: '## Areas\n\nWe service Mooroolbark and Montrose.' }, { embeddingModel: 'm' });
  const config = defineConfig({
    sites: { acme: { origins: [ORIGIN], connector: { type: 'retell', options: { apiKey: { env: 'RETELL_API_KEY' }, agentId: 'agent_1', ...(retrieval ? { retrieval } : {}) } } } },
  });
  return harness(config, { MURMUR_SECRET: SECRET, MURMUR_KV: memoryKv(), MURMUR_DB: db, AI: ai, VECTORS: vectors, RETELL_API_KEY: KEY }, null);
}

const call = async (h: Awaited<ReturnType<typeof world>>, body: string, signature?: string) =>
  h.fetch('/v1/sites/acme/retell/kb', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Retell-Signature': signature } : {}) } });

describe('the Retell knowledge function', () => {
  it('answers a signed lookup with the matching passages', async () => {
    const h = await world();
    const body = JSON.stringify({ name: 'search_website', args: { query: 'Do you service Mooroolbark?' }, call: { call_id: 'c1' } });
    const response = await call(h, body, await sign(body, KEY));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('We service Mooroolbark and Montrose.');
  });

  it('accepts the args-only payload', async () => {
    const h = await world();
    const body = JSON.stringify({ query: 'Montrose' });
    expect(await (await call(h, body, await sign(body, KEY))).text()).toContain('Montrose');
  });

  it('refuses unsigned, wrongly signed and stale requests', async () => {
    const h = await world();
    const body = JSON.stringify({ args: { query: 'x' } });
    expect((await call(h, body)).status).toBe(401);
    expect((await call(h, body, await sign(body, 'other-key'))).status).toBe(401);
    expect((await call(h, body, await sign(body, KEY, Date.now() - 10 * 60_000))).status).toBe(401);
    expect(await verifyRetellSignature(`${body} `, KEY, await sign(body, KEY), Date.now())).toBe(false);
  });

  it('does not exist unless the site turned it on', async () => {
    const h = await world(null);
    const body = JSON.stringify({ args: { query: 'x' } });
    expect((await call(h, body, await sign(body, KEY))).status).toBe(404);
  });
});
