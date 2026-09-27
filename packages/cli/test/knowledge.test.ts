import { describe, expect, it } from 'vitest';
import { CloudflareApi } from '../src/engine/cloudflare.js';
import { gatherDocs, syncKnowledge } from '../src/engine/knowledge.js';
import { parseProject } from '../src/engine/project.js';
import { cf, fakeFetch, html, tempProject } from './helpers.js';

const ACCOUNT = 'b'.repeat(32);

function project(backend: Record<string, unknown>, files: string[] = ['./docs'], website: string | undefined = undefined) {
  const dir = tempProject({
    'prompt.md': 'hi',
    'docs/pricing.md': '# Pricing\n$49',
    'docs/guide/setup.txt': 'Step one.',
    'docs/photo.png': 'binary',
  });
  const raw = {
    site: 'acme',
    name: 'Acme',
    ...(website ? { website } : {}),
    origins: ['https://acme.com'],
    backend,
    knowledge: { website: Boolean(website), files },
  };
  return { dir, file: `${dir}/murmur.json`, raw, project: parseProject(raw) };
}

describe('gatherDocs', () => {
  it('walks folders, keeps supported types and prefixes file names', async () => {
    const gathered = await gatherDocs(project({ type: 'cloudflare' }));
    expect(gathered.docs.map((d) => d.name).sort()).toEqual(['file__docs__guide__setup.txt', 'file__docs__pricing.md']);
    expect(gathered.skipped).toEqual(['docs/photo.png (unsupported type)']);
  });
});

describe('AI Search sync', () => {
  it('creates the instance, replaces changed items and removes only its own stale ones', async () => {
    const deleted: string[] = [];
    const uploaded: string[] = [];
    let created = false;
    let index = [
      { id: 'i1', key: 'file__docs__pricing.md' },
      { id: 'i2', key: 'file__docs__old.md' },
      { id: 'i3', key: 'uploaded-by-hand.pdf' },
    ];
    const { fetch } = fakeFetch([
      (url, init) => {
        const path = url.pathname;
        const base = `/client/v4/accounts/${ACCOUNT}/ai-search/namespaces/default/instances`;
        if (path === `${base}/knowtific-murmur-acme` && init.method === 'GET') return created ? cf({ id: 'knowtific-murmur-acme' }) : new Response('{}', { status: 404 });
        if (path === base && init.method === 'POST') {
          created = true;
          return cf({ id: 'knowtific-murmur-acme' });
        }
        if (path === `${base}/knowtific-murmur-acme/items` && init.method === 'GET') {
          return cf(index, { info: { total_count: index.length } });
        }
        if (path === `${base}/knowtific-murmur-acme/items` && init.method === 'POST') {
          const name = ((init.body as FormData).get('file') as File).name;
          uploaded.push(name);
          index.push({ id: `n${index.length}`, key: name });
          return cf({ id: 'new' });
        }
        if (path.startsWith(`${base}/knowtific-murmur-acme/items/`) && init.method === 'DELETE') {
          const id = path.split('/').pop()!;
          deleted.push(id);
          index = index.filter((item) => item.id !== id);
          return cf(null);
        }
        return undefined;
      },
    ]);
    const result = await syncKnowledge(project({ type: 'cloudflare' }), {
      cf: { api: new CloudflareApi('t', fetch), accountId: ACCOUNT },
      env: {},
    });
    expect(created).toBe(true);
    expect(uploaded.sort()).toEqual(['file__docs__guide__setup.txt', 'file__docs__pricing.md']);
    // i1 replaced, i2 stale; the hand-uploaded file is left alone.
    expect(deleted.sort()).toEqual(['i1', 'i2']);
    expect(result).toMatchObject({ uploaded: 2, removed: 1, files: 2 });
  });

  it('skips its own crawl when the instance already crawls the website', async () => {
    let crawled = false;
    const { fetch } = fakeFetch([
      (url) => {
        if (url.hostname === 'acme.com') {
          crawled = true;
          return html('<html></html>');
        }
        if (url.pathname.endsWith('/instances/site-crawler')) return cf({ id: 'site-crawler', type: 'web-crawler' });
        if (url.pathname.endsWith('/items')) return cf([]);
        return undefined;
      },
    ]);
    await syncKnowledge(project({ type: 'cloudflare', instance: 'site-crawler' }, [], 'https://acme.com'), {
      cf: { api: new CloudflareApi('t', fetch), accountId: ACCOUNT },
      env: {},
      fetch,
    });
    expect(crawled).toBe(false);
  });
});

describe('OpenAI sync', () => {
  it('fills a fresh vector store and reports its id for murmur.json', async () => {
    const { fetch, calls } = fakeFetch([
      (url, init) => {
        if (url.pathname === '/v1/vector_stores' && init.method === 'POST') return Response.json({ id: 'vs_new' });
        if (url.pathname === '/v1/files') return Response.json({ id: `file_${Math.random()}` });
        if (url.pathname === '/v1/vector_stores/vs_new/file_batches') return Response.json({ id: 'batch' });
        if (url.pathname === '/v1/vector_stores') {
          return Response.json({
            data: [
              { id: 'vs_new', name: 'knowtific-murmur-acme-3', created_at: 3 },
              { id: 'vs_prev', name: 'knowtific-murmur-acme-2', created_at: 2 },
              { id: 'vs_old', name: 'knowtific-murmur-acme-1', created_at: 1 },
              { id: 'vs_other', name: 'someone-else', created_at: 1 },
            ],
          });
        }
        if (init.method === 'DELETE') return Response.json({ deleted: true });
        return undefined;
      },
    ]);
    const result = await syncKnowledge(project({ type: 'openai' }), { env: { OPENAI_API_KEY: 'sk' }, fetch });
    expect(result.backendUpdate).toEqual({ vectorStoreId: 'vs_new' });
    // Keeps the previous store (still live until the config switches), deletes older ones.
    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletes).toEqual(['https://api.openai.com/v1/vector_stores/vs_old']);
  });

  it('asks for the key when it is missing', async () => {
    await expect(syncKnowledge(project({ type: 'openai' }), { env: {} })).rejects.toMatchObject({ code: 'missing_secret' });
  });
});
