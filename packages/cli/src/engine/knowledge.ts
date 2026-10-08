import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { CliError } from '../errors.js';
import type { AdminApi } from './admin-api.js';
import { readState, writeState, type State } from './state.js';
import type { CloudflareApi, CrawlerSource } from './cloudflare.js';
import { PAGE_PREFIX, crawlSite, hasSitemap, looksRendered, pageFileName } from './site.js';
import { pool, syncGeminiStore, syncOpenAiStore, type UploadDoc } from './providers.js';
import { aiSearchInstanceFor, hasKnowledge, modelOf, retrievalOf, usesHelpPuffKnowledge, type LoadedProject, type Project } from './project.js';

/** The AI Search public endpoint a project answers from, if it uses one instead of an instance it manages. */
const aiSearchEndpoint = (project: Project): string | undefined => {
  const retrieval = retrievalOf(project);
  if (retrieval?.type === 'ai-search') return retrieval.endpoint;
  const backend = project.backend;
  return backend.type === 'cloudflare' || backend.type === 'anthropic' ? backend.endpoint : undefined;
};

/**
 * The knowledge base: the website's pages plus any files the project lists,
 * uploaded to wherever the backend reads from.
 *
 *  - cloudflare / anthropic → an AI Search instance's built-in storage
 *  - openai                 → a vector store, for the file_search tool
 *  - gemini                 → a File Search store
 *
 * `http` and `retell` backends own their knowledge, so there is nothing to
 * sync for them.
 */

const TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.csv': 'text/csv',
  '.json': 'application/json',
};
/** AI Search's per-file limit, and a sensible one for the others. */
const MAX_BYTES = 4 * 1024 * 1024;
export const FILE_PREFIX = 'file__';

export type Progress = (message: string) => void;

export type GatheredDocs = { docs: UploadDoc[]; pages: number; files: number; skipped: string[] };

export async function gatherDocs(
  loaded: LoadedProject,
  options: { fetch?: typeof fetch; progress?: Progress; skipWebsite?: boolean } = {},
): Promise<GatheredDocs> {
  const { project, dir } = loaded;
  const docs: UploadDoc[] = [];
  const skipped: string[] = [];
  let pages = 0;

  const website = project.knowledge.website;
  if (website !== false && project.website && !options.skipWebsite) {
    const settings = typeof website === 'object' ? { ...website, maxPages: website.maxPages ?? 50 } : { maxPages: 50 };
    options.progress?.(`Reading ${project.website} (up to ${settings.maxPages} pages)…`);
    const crawled = await crawlSite(project.website, {
      maxPages: settings.maxPages,
      ...('include' in settings && settings.include ? { include: settings.include } : {}),
      ...('exclude' in settings && settings.exclude ? { exclude: settings.exclude } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      onPage: (url) => options.progress?.(`  read ${url}`),
    });
    const names = new Set<string>();
    for (const page of crawled) {
      let name = pageFileName(page.url);
      for (let n = 2; names.has(name); n++) name = name.replace(/(-\d+)?\.md$/, `-${n}.md`);
      names.add(name);
      docs.push({ name, data: new TextEncoder().encode(page.markdown), type: 'text/markdown' });
    }
    pages = crawled.length;
  }

  let files = 0;
  for (const entry of project.knowledge.files) {
    const path = resolve(dir, entry);
    if (!existsSync(path)) {
      skipped.push(`${entry} (not found)`);
      continue;
    }
    for (const file of walk(path)) {
      const type = TYPES[extname(file).toLowerCase()];
      const rel = relative(dir, file);
      if (!type) {
        skipped.push(`${rel} (unsupported type)`);
        continue;
      }
      const size = statSync(file).size;
      if (size > MAX_BYTES) {
        skipped.push(`${rel} (over 4 MB)`);
        continue;
      }
      const name = `${FILE_PREFIX}${rel.replace(/[\\/]+/g, '__').replace(/[^a-zA-Z0-9._-]+/g, '_')}`.slice(0, 128);
      docs.push({ name, data: readFileSync(file), type });
      files++;
    }
  }
  return { docs, pages, files, skipped };
}

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .flatMap((entry) => walk(join(path, entry.name)));
}

export type SyncResult = {
  target: string;
  uploaded: number;
  removed: number;
  pages: number;
  files: number;
  skipped: string[];
  /** Fields to write back into helppuff.json's `backend`. */
  backendUpdate?: Record<string, unknown>;
};

/**
 * How a new instance should learn the website: Cloudflare's own crawler when
 * the domain is a zone on this account (it re-syncs on a schedule, renders
 * JavaScript if needed, and runs in the background), else null — helppuff
 * crawls and uploads the pages itself.
 */
export async function crawlerFor(
  cf: CloudflareApi,
  project: Project,
  doFetch: typeof fetch = fetch,
): Promise<CrawlerSource | null> {
  if (!project.website || project.knowledge.website === false) return null;
  const host = new URL(project.website).hostname;
  if (!(await cf.findZone(host))) return null;
  const settings = typeof project.knowledge.website === 'object' ? project.knowledge.website : null;
  const [sitemap, home] = await Promise.all([
    hasSitemap(project.website, doFetch),
    doFetch(project.website, { headers: { 'User-Agent': 'HelpPuffSetup/1.0' } }).then((r) => r.text()).catch(() => ''),
  ]);
  return {
    host,
    parseType: sitemap ? 'sitemap' : 'discover',
    limit: settings?.maxPages ?? 200,
    rendered: home ? looksRendered(home) : false,
  };
}

/** Make sure the AI Search instance exists, creating it if not. */
export async function ensureAiSearchInstance(
  cf: CloudflareApi,
  accountId: string,
  project: Project,
  progress?: Progress,
  doFetch: typeof fetch = fetch,
): Promise<{ id: string; created: boolean; crawlsWebsite: boolean } | null> {
  const id = aiSearchInstanceFor(project);
  if (!id) return null;
  const existing = await cf.aiSearchInstance(accountId, id);
  if (existing) return { id, created: false, crawlsWebsite: existing.type === 'web-crawler' };
  const model = project.backend.type === 'cloudflare' ? project.backend.model : modelOf(project)?.provider === 'workers-ai' ? (modelOf(project) as { model?: string }).model : undefined;
  const crawler = await crawlerFor(cf, project, doFetch);
  progress?.(
    crawler
      ? `Creating AI Search instance "${id}" — Cloudflare will crawl ${crawler.host} (${crawler.parseType}${crawler.rendered ? ', rendered' : ''}) in the background…`
      : `Creating AI Search instance "${id}"…`,
  );
  await cf.createAiSearchInstance(accountId, id, { model, crawler: crawler ?? undefined });
  return { id, created: true, crawlsWebsite: Boolean(crawler) };
}

export type IndexingStatus = {
  instance: string;
  crawler: string | null;
  indexed: number;
  pending: number;
  failed: number;
  done: boolean;
};

/** Where indexing has got to. Answers improve as `pending` falls to zero; nothing waits on it. */
export async function indexingStatus(cf: CloudflareApi, accountId: string, project: Project): Promise<IndexingStatus | null> {
  const id = aiSearchInstanceFor(project);
  if (!id) return null;
  const [instance, stats] = await Promise.all([
    cf.aiSearchInstance(accountId, id),
    cf.aiSearchStats(accountId, id).catch(() => ({}) as Record<string, unknown>),
  ]);
  if (!instance) return null;
  const n = (key: string) => Number(stats[key] ?? 0) || 0;
  const pending = n('queued') + n('running') + n('outdated');
  return {
    instance: id,
    crawler: instance.type === 'web-crawler' ? String(instance.source ?? '') : null,
    indexed: n('completed'),
    pending,
    failed: n('error'),
    done: pending === 0 && n('completed') > 0,
  };
}

export async function syncKnowledge(
  loaded: LoadedProject,
  deps: {
    cf?: { api: CloudflareApi; accountId: string };
    env: Record<string, string>;
    fetch?: typeof fetch;
    progress?: Progress;
  },
): Promise<SyncResult> {
  const { project } = loaded;
  const backend = project.backend;
  const progress = deps.progress;

  // HelpPuff's knowledge base: the Worker crawls the site itself, and files go up through the admin API (`uploadFilesToWorker`).
  // A knowledge base of the site's own (`http`, `custom`, an OpenAI vector store, none) is filled where it lives.
  const retrieval = retrievalOf(project);
  if (!hasKnowledge(project) || usesHelpPuffKnowledge(project) || (retrieval && retrieval.type !== 'ai-search')) {
    return { target: 'none', uploaded: 0, removed: 0, pages: 0, files: 0, skipped: [] };
  }

  if (backend.type === 'cloudflare' || backend.type === 'anthropic' || retrieval?.type === 'ai-search') {
    if (aiSearchEndpoint(project)) {
      throw new CliError(
        'knowledge_external',
        'This project answers from an AI Search public endpoint, so its content is managed where that instance lives.',
        { hint: 'Add content in the Cloudflare dashboard (AI Search → your instance → Items), or remove `endpoint` to let helppuff manage an instance.' },
      );
    }
    if (!deps.cf) throw new CliError('no_cloudflare', 'Cloudflare credentials are needed to sync knowledge.');
    const { api, accountId } = deps.cf;
    const instance = await ensureAiSearchInstance(api, accountId, project, progress, deps.fetch);
    if (!instance) return { target: 'none', uploaded: 0, removed: 0, pages: 0, files: 0, skipped: [] };

    // An instance that crawls the site itself does not need our copy of it.
    const gathered = await gatherDocs(loaded, {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(progress ? { progress } : {}),
      skipWebsite: instance.crawlsWebsite,
    });
    // A new crawler instance's first sync drops files uploaded while it runs
    // (observed 2026-09-25; later syncs keep them). Wait it out first.
    if (instance.crawlsWebsite && gathered.docs.length > 0) {
      await waitForFirstCrawl(api, accountId, instance.id, progress);
    }
    const existing = await api.aiSearchItems(accountId, instance.id);
    const byKey = new Map(existing.map((item) => [item.key, item]));
    const wanted = new Set(gathered.docs.map((doc) => doc.name));

    const stale = existing.filter(
      (item) => (item.key.startsWith(PAGE_PREFIX) || item.key.startsWith(FILE_PREFIX)) && !wanted.has(item.key),
    );
    progress?.(`Uploading ${gathered.docs.length} document(s) to AI Search "${instance.id}"…`);
    let uploaded = 0;
    await pool(gathered.docs, 4, async (doc) => {
      const current = byKey.get(doc.name);
      if (current) await api.deleteAiSearchItem(accountId, instance.id, current.id);
      await api.uploadAiSearchItem(accountId, instance.id, doc.name, new Blob([doc.data as BlobPart], { type: doc.type }));
      uploaded++;
    });
    await pool(stale, 4, (item) => api.deleteAiSearchItem(accountId, instance.id, item.id));

    // Trust, but verify: every upload should now be listed. Re-send any that are not.
    const listed = new Set((await api.aiSearchItems(accountId, instance.id)).map((item) => item.key));
    const lost = gathered.docs.filter((doc) => !listed.has(doc.name));
    if (lost.length) {
      progress?.(`Re-sending ${lost.length} document(s) the index did not keep…`);
      await pool(lost, 4, (doc) =>
        api.uploadAiSearchItem(accountId, instance.id, doc.name, new Blob([doc.data as BlobPart], { type: doc.type })).then(() => {}),
      );
    }
    return {
      target: `AI Search instance "${instance.id}"`,
      uploaded,
      removed: stale.length,
      pages: gathered.pages,
      files: gathered.files,
      skipped: gathered.skipped,
    };
  }

  if (backend.type === 'openai' || backend.type === 'gemini') {
    const keyName = backend.apiKey.env;
    const key = deps.env[keyName];
    if (!key) {
      throw new CliError('missing_secret', `${keyName} is not set, so knowledge cannot be uploaded.`, {
        hint: `helppuff secret set ${keyName}`,
      });
    }
    const gathered = await gatherDocs(loaded, { ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(progress ? { progress } : {}) });
    if (gathered.docs.length === 0) {
      return { target: 'none', uploaded: 0, removed: 0, pages: 0, files: 0, skipped: gathered.skipped };
    }
    const total = gathered.docs.length;
    const onProgress = (done: number) => {
      if (done === total || done % 10 === 0) progress?.(`  uploaded ${done}/${total}`);
    };
    if (backend.type === 'openai') {
      progress?.(`Uploading ${total} document(s) to a new OpenAI vector store…`);
      const result = await syncOpenAiStore(
        { key, site: project.site, docs: gathered.docs, onProgress, ...(backend.baseUrl ? { baseUrl: backend.baseUrl } : {}) },
        deps.fetch,
      );
      return {
        target: `OpenAI vector store ${result.vectorStoreId}`,
        uploaded: total,
        removed: result.removed.length,
        pages: gathered.pages,
        files: gathered.files,
        skipped: gathered.skipped,
        backendUpdate: { vectorStoreId: result.vectorStoreId },
      };
    }
    progress?.(`Uploading ${total} document(s) to a new Gemini File Search store…`);
    const result = await syncGeminiStore({ key, site: project.site, docs: gathered.docs, onProgress }, deps.fetch);
    return {
      target: `Gemini store ${result.fileSearchStore}`,
      uploaded: total,
      removed: result.removed.length,
      pages: gathered.pages,
      files: gathered.files,
      skipped: gathered.skipped,
      backendUpdate: { fileSearchStore: result.fileSearchStore },
    };
  }

  return { target: 'none', uploaded: 0, removed: 0, pages: 0, files: 0, skipped: [] };
}

/** Wait (up to `limitMs`) for an instance's first sync job to finish. */
export async function waitForFirstCrawl(
  api: CloudflareApi,
  accountId: string,
  id: string,
  progress?: Progress,
  limitMs = 10 * 60_000,
): Promise<void> {
  const start = Date.now();
  let told = false;
  while (Date.now() - start < limitMs) {
    const jobs = await api.aiSearchJobs(accountId, id).catch(() => []);
    const finished = jobs.some((job) => job.ended_at);
    const running = jobs.some((job) => !job.ended_at);
    if (finished && !running) return;
    if (!told) {
      progress?.('Waiting for Cloudflare to finish its first crawl before adding your files (your assistant is already live)…');
      told = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

/** Whether the backend's knowledge store looks empty or unset — i.e. a first deploy. */
export async function knowledgeMissing(
  project: Project,
  cf: { api: CloudflareApi; accountId: string } | null,
): Promise<boolean> {
  if (!hasKnowledge(project)) return false;
  const backend = project.backend;
  if (usesHelpPuffKnowledge(project)) return false;
  if (retrievalOf(project) && retrievalOf(project)!.type !== 'ai-search') return false;
  if (backend.type === 'openai') return !backend.vectorStoreId;
  if (backend.type === 'gemini') return !backend.fileSearchStore;
  const instance = aiSearchInstanceFor(project);
  if (!instance || !cf) return false;
  const found = await cf.api.aiSearchInstance(cf.accountId, instance);
  if (!found) return true;
  const items = await cf.api.aiSearchItems(cf.accountId, instance).catch(() => []);
  // Our own uploads are what can be missing: pages when helppuff crawls, and files either way.
  const ours = (prefix: string) => items.some((item) => item.key.startsWith(prefix));
  if (project.knowledge.files.length > 0 && !ours(FILE_PREFIX)) return true;
  if (found.type === 'web-crawler') return false;
  return project.website !== undefined && project.knowledge.website !== false && !ours(PAGE_PREFIX);
}

const TEXT_TYPES = new Set(['text/markdown', 'text/plain', 'text/html', 'text/csv', 'application/json']);
/** Read on the Worker (Workers AI's document converter), in the background. */
const DOCUMENT_TYPES = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

export type FilesSynced = { uploaded: number; unchanged: number; removed: number; skipped: string[] };

/**
 * workers-ai: bring the knowledge base in line with `knowledge.files`.
 *
 *  - Text formats become hand-written entries, indexed at once.
 *  - PDF and Word documents are uploaded; the Worker reads, cleans and
 *    learns them in the background (`helppuff knowledge files` shows progress).
 *  - A file whose bytes have not changed since the last deploy is left alone
 *    (`.helppuff/state.json` remembers each one's hash and id), and one taken
 *    out of `knowledge.files` is removed from the knowledge base.
 */
export async function uploadFilesToWorker(loaded: LoadedProject, api: Pick<AdminApi, 'send' | 'upload'>, progress?: Progress): Promise<FilesSynced> {
  const gathered = await gatherDocs(loaded, { skipWebsite: true, ...(progress ? { progress } : {}) });
  const skipped = [...gathered.skipped];
  const state = readState(loaded.dir);
  const before = state.files ?? {};
  const after: NonNullable<State['files']> = {};
  let uploaded = 0;
  let unchanged = 0;
  for (const doc of gathered.docs) {
    const path = doc.name.replace(FILE_PREFIX, '').replace(/__/g, '/');
    const hash = createHash('sha256').update(doc.data).digest('hex').slice(0, 32);
    const previous = before[path];
    if (previous?.hash === hash) {
      after[path] = previous;
      unchanged++;
      continue;
    }
    if (DOCUMENT_TYPES.has(doc.type)) {
      progress?.(`  ${path}`);
      if (previous?.kind === 'file') await api.send('DELETE', `/admin/api/knowledge/files/${encodeURIComponent(previous.id)}`).catch(() => null);
      const added = await api.upload<{ id: string }>('/admin/api/knowledge/files', { name: basename(path) }, doc.data, doc.type);
      after[path] = { hash, id: added.id, kind: 'file' };
      uploaded++;
      continue;
    }
    if (!TEXT_TYPES.has(doc.type)) {
      skipped.push(`${path} (unsupported type)`);
      continue;
    }
    const id = `file-${path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`.slice(0, 64);
    let content = new TextDecoder().decode(doc.data);
    if (doc.type === 'text/html') content = content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
    progress?.(`  ${path}`);
    await api.send('POST', '/admin/api/knowledge/manual', { id, title: path, content });
    after[path] = { hash, id, kind: 'manual' };
    uploaded++;
  }
  let removed = 0;
  for (const [path, gone] of Object.entries(before)) {
    if (after[path]) continue;
    // Still listed but unreadable this time (too big, say): keep what was learned.
    if (skipped.some((s) => s.startsWith(`${path} `))) {
      after[path] = gone;
      continue;
    }
    const route = gone.kind === 'file' ? 'files' : 'manual';
    await api.send('DELETE', `/admin/api/knowledge/${route}/${encodeURIComponent(gone.id)}`).catch(() => null);
    removed++;
  }
  writeState(loaded.dir, { ...readState(loaded.dir), files: after });
  return { uploaded, unchanged, removed, skipped };
}
