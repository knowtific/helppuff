import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi, type AdminApi } from '../engine/admin-api.js';
import { chat } from '../engine/chat.js';
import { cloudflareSession } from '../engine/credentials.js';
import { startCrawlFromCli, type CrawlRequest } from '../engine/deploy.js';
import { loadEnv } from '../engine/env.js';
import { indexingStatus, syncKnowledge } from '../engine/knowledge.js';
import { aiSearchInstanceFor, loadProject, updateProject, usesMurmurKnowledge, type LoadedProject } from '../engine/project.js';
import { describeIndexing } from './setup.js';
import type { Ctx } from './context.js';

/**
 * The knowledge base from the terminal (workers-ai): the same admin API the
 * dashboard's onboarding and Knowledge page use.
 *
 *   murmur discover                       pages found, by category, pre-ticked or not
 *   murmur crawl [--all|--urls|--file|--include] [--wait]
 *   murmur ask "<question>"               the answer, plus the passages it came from
 *   murmur knowledge status|sync|add|list|remove|pages|facts
 */

function requireWorkersAi(loaded: LoadedProject, command: string): void {
  if (!usesMurmurKnowledge(loaded.project)) {
    throw new CliError('not_workers_ai', `\`murmur ${command}\` works with Murmur's own knowledge base; this project's ${loaded.project.backend.type} backend keeps its own.`, {
      hint: 'Use the workers-ai backend, or set `backend.retrieval` to "murmur" (openai, gemini, anthropic), then `murmur deploy`. Or use `murmur knowledge sync`.',
      exitCode: EXIT.usage,
    });
  }
}

type DiscoveredUrl = { url: string; category: string; suggested: boolean; selected: boolean; status: string; source: string; title: string | null; error: string | null };
type Discovery = { origin: string; reachable: boolean; sitemaps: string[]; warnings: string[]; urls: DiscoveredUrl[] };

export async function discoverCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, [], 'discover');
  const loaded = loadProject(ctx.cwd);
  requireWorkersAi(loaded, 'discover');
  ctx.out.progress('Reading the home page, robots.txt and sitemaps…');
  const found = await adminApi(loaded).send<Discovery>('POST', '/admin/api/knowledge/discover', {});
  const selected = found.urls.filter((u) => u.selected).length;
  ctx.out.result(
    { ...found, total: found.urls.length, selected, next: ['murmur crawl --json   (crawls the selected pages)', 'murmur crawl --urls <a,b> --json'] },
    () => {
      const groups = new Map<string, DiscoveredUrl[]>();
      for (const u of found.urls) groups.set(u.category, [...(groups.get(u.category) ?? []), u]);
      for (const [category, urls] of groups) {
        process.stdout.write(`\n${c.bold(category)} ${c.dim(`(${urls.length})`)}\n`);
        for (const u of urls.slice(0, 40)) process.stdout.write(`  ${u.selected ? c.green('✔') : c.dim('·')} ${u.url}${u.status !== 'discovered' ? c.dim(`  ${u.status}`) : ''}\n`);
        if (urls.length > 40) process.stdout.write(c.dim(`  … ${urls.length - 40} more\n`));
      }
      for (const warning of found.warnings) ctx.out.warn(warning);
      process.stdout.write(`\n${selected} of ${found.urls.length} page(s) selected. Next: ${c.cyan('murmur crawl --wait')}\n`);
    },
  );
  return 0;
}

function crawlRequest(ctx: Ctx): CrawlRequest | null {
  const urls = str(ctx.flags, 'urls');
  const file = str(ctx.flags, 'file');
  const include = str(ctx.flags, 'include');
  if (file) {
    const path = resolve(ctx.cwd, file);
    if (!existsSync(path)) throw new CliError('usage', `No such file: ${file}`, { exitCode: EXIT.usage });
    const list = readFileSync(path, 'utf8').split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
    return { mode: 'urls', urls: list };
  }
  if (urls) return { mode: 'urls', urls: urls.split(',').map((u) => u.trim()).filter(Boolean) };
  if (include) return { mode: 'match', include: include.split(',').map((g) => g.trim()).filter(Boolean) };
  if (ctx.flags['all']) return { mode: 'all' };
  return null;
}

type Status = {
  run: { id: string; status: string; total: number; done: number; failed: number; chunks: number; error: string | null } | null;
  pages: Record<string, number>;
  chunks: number;
  usage: { neurons: number; budget: number; messages: number; messagesLeft: number; state: string };
};

export async function waitForCrawl(api: AdminApi, runId: string, onProgress: (status: Status) => void, timeoutMs = 30 * 60_000): Promise<Status> {
  const start = Date.now();
  for (;;) {
    const status = await api.get<Status>('/admin/api/knowledge/status');
    onProgress(status);
    if (!status.run || status.run.id !== runId || !['queued', 'running'].includes(status.run.status)) return status;
    if (Date.now() - start > timeoutMs) {
      throw new CliError('crawl_timeout', 'The crawl is still running; it continues in the background.', { hint: 'murmur knowledge status' });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export async function crawlCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['urls', 'file', 'all', 'include', 'wait'], 'crawl');
  const loaded = loadProject(ctx.cwd);
  requireWorkersAi(loaded, 'crawl');
  const api = adminApi(loaded);
  const request = crawlRequest(ctx);
  // No choice given: the pages already selected (or, the first time, the suggested ones).
  const started = request
    ? await startCrawlFromCli(api, request, ctx.out.progress)
    : await api.send<{ runId: string; total: number }>('POST', '/admin/api/knowledge/crawl', {});
  if (!ctx.flags['wait']) {
    ctx.out.result({ ...started, status: 'started', next: ['murmur knowledge status --json', `murmur crawl --wait`] }, () =>
      ctx.out.success(`Crawling ${started.total} page(s) in the background on Cloudflare. Check with ${c.cyan('murmur knowledge status')}.`),
    );
    return 0;
  }
  let last = '';
  const final = await waitForCrawl(api, started.runId, (s) => {
    const line = s.run ? `${s.run.done + s.run.failed}/${s.run.total} pages · ${s.chunks} passages` : 'starting…';
    if (line !== last) ctx.out.progress(line);
    last = line;
  });
  ctx.out.result({ ...started, status: final.run?.status ?? 'unknown', run: final.run, pages: final.pages, chunks: final.chunks }, () => {
    ctx.out.success(`Crawl ${final.run?.status}: ${final.run?.done ?? 0} page(s) indexed, ${final.run?.failed ?? 0} skipped or failed, ${final.chunks} passages.`);
    if (final.run?.failed) ctx.out.info(`See why: ${c.cyan('murmur knowledge pages --status error')}`);
  });
  return final.run?.status === 'done' ? 0 : 1;
}

type Search = { chunks: { url: string; title: string; headingPath: string; score: number; content: string }[]; query: string; trace: Record<string, unknown> };

export async function askCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['session', 'url', 'timing'], 'ask');
  const loaded = loadProject(ctx.cwd);
  const question = ctx.positionals.join(' ').trim();
  if (!question) throw new CliError('usage', 'Ask something: murmur ask "Do you service Lilydale?"', { exitCode: EXIT.usage });
  const url = str(ctx.flags, 'url') ?? loaded.project.cloudflare.url;
  if (!url) throw new CliError('not_deployed', 'Deploy first.', { hint: 'murmur deploy' });
  const env = loadEnv(loaded.dir);
  const [turn, search] = await Promise.all([
    chat({ url, site: loaded.project.site, origin: new URL(url).origin, message: question, session: str(ctx.flags, 'session'), secret: env['MURMUR_SECRET'] }),
    usesMurmurKnowledge(loaded.project) ? adminApi(loaded, { url }).send<Search>('POST', '/admin/api/knowledge/search', { query: question }).catch(() => null) : Promise.resolve(null),
  ]);
  const sources = (search?.chunks ?? []).map((ch) => ({ url: ch.url, section: ch.headingPath, score: Math.round(ch.score * 1000) / 1000, excerpt: ch.content.slice(0, 240) }));
  ctx.out.result({ reply: turn.reply, sources, session: turn.session, retrieval: search?.trace ?? null, timing: { ...turn.timing, roundTrip: turn.elapsedMs }, messages: turn.messages }, () => {
    process.stdout.write(`${turn.reply || c.dim('(no reply)')}\n`);
    if (ctx.flags['timing']) {
      process.stdout.write(`\n${c.bold('Timing')} ${c.dim('(server stages, ms)')}\n`);
      for (const [stage, ms] of Object.entries(turn.timing)) process.stdout.write(`  ${stage.padEnd(18)} ${String(ms).padStart(6)}\n`);
      process.stdout.write(`  ${'round trip'.padEnd(18)} ${String(turn.elapsedMs).padStart(6)}\n`);
    }
    if (sources.length) {
      process.stdout.write(`\n${c.bold('Sources')}\n`);
      for (const s of sources) process.stdout.write(`  ${c.dim(s.score.toFixed(2))} ${s.section}\n       ${c.cyan(s.url)}\n`);
    } else if (search) {
      process.stdout.write(c.dim('\nNo passage passed the relevance threshold — the assistant should have said it is not sure.\n'));
    }
  });
  return 0;
}

type KnowledgeFile = { id: string; name: string; status: string; error: string | null; chunks: number; size: number; truncated: number };
const DOCUMENTS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
};
const busyFile = (f: KnowledgeFile) => f.status === 'queued' || f.status === 'reading' || f.status === 'learning';

/** Upload documents for the Worker to read and learn in the background; `wait` follows them to the end. */
async function uploadDocuments(ctx: Ctx, api: AdminApi, dir: string, paths: string[], wait: boolean): Promise<number> {
  const ids: string[] = [];
  for (const given of paths) {
    const path = resolve(dir, given);
    if (!existsSync(path)) throw new CliError('usage', `No such file: ${given}`, { exitCode: EXIT.usage });
    const type = DOCUMENTS[extname(path).toLowerCase()];
    if (!type) throw new CliError('usage', `${given}: upload a PDF, Word (.docx), Markdown or text file.`, { exitCode: EXIT.usage });
    const added = await api.upload<{ id: string }>('/admin/api/knowledge/files', { name: basename(path) }, readFileSync(path), type);
    ids.push(added.id);
    if (!ctx.flags['json']) ctx.out.success(`Uploaded ${basename(path)} — it is read and learned on Cloudflare in the background.`);
  }
  let files = (await api.get<{ files: KnowledgeFile[] }>('/admin/api/knowledge/files')).files.filter((f) => ids.includes(f.id));
  for (let waited = 0; wait && files.some(busyFile) && waited < 600_000; waited += 3000) {
    await new Promise((r) => setTimeout(r, 3000));
    files = (await api.get<{ files: KnowledgeFile[] }>('/admin/api/knowledge/files')).files.filter((f) => ids.includes(f.id));
  }
  ctx.out.result({ files, next: files.some(busyFile) ? ['murmur knowledge files --json'] : ['murmur ask "<a question the file answers>" --json'] }, () => {
    for (const f of files) process.stdout.write(`${fileLine(f)}\n`);
    if (files.some(busyFile)) process.stdout.write(c.dim('Follow it with `murmur knowledge files`.\n'));
  });
  return files.some((f) => f.status === 'error') ? EXIT.error : 0;
}

const fileLine = (f: KnowledgeFile) => {
  const tone = f.status === 'indexed' ? c.green : f.status === 'error' ? c.yellow : c.dim;
  return `${tone(f.status.padEnd(9))} ${String(f.chunks).padStart(4)}  ${f.name}  ${c.dim(f.id)}${f.truncated ? c.dim('  (long: only the first part learned)') : ''}${f.error ? c.dim(`  — ${f.error}`) : ''}`;
};

export async function knowledgeCommand(ctx: Ctx): Promise<number> {
  const [sub, ...rest] = ctx.positionals;
  const loaded = loadProject(ctx.cwd);
  if (!usesMurmurKnowledge(loaded.project)) return legacyKnowledge(ctx, loaded, sub);
  const api = adminApi(loaded);

  switch (sub) {
    case 'status': {
      assertKnown(ctx.flags, [], 'knowledge');
      const status = await api.get<Status & Record<string, unknown>>('/admin/api/knowledge/status');
      ctx.out.result(status, () => {
        const run = status.run;
        process.stdout.write(
          [
            `${c.bold('Passages')}  ${status.chunks}`,
            `${c.bold('Pages')}     ${Object.entries(status.pages).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none yet'}`,
            run ? `${c.bold('Last crawl')} ${run.status} — ${run.done}/${run.total} indexed${run.failed ? `, ${run.failed} failed` : ''}` : `${c.bold('Last crawl')} never — run ${c.cyan('murmur crawl')}`,
            `${c.bold('Today')}     ${status.usage.messages} answer(s), ${status.usage.neurons} of ${status.usage.budget} neurons (${status.usage.state}) · ~${status.usage.messagesLeft} answers left`,
          ].join('\n') + '\n',
        );
      });
      return 0;
    }
    case 'sync': {
      assertKnown(ctx.flags, ['wait'], 'knowledge');
      return crawlCommand(ctx);
    }
    case 'upload': {
      assertKnown(ctx.flags, ['wait'], 'knowledge');
      if (!rest.length) throw new CliError('usage', 'Usage: murmur knowledge upload <file…> [--wait]', { exitCode: EXIT.usage });
      return uploadDocuments(ctx, api, loaded.dir, rest, ctx.flags['wait'] === true);
    }
    case 'files': {
      assertKnown(ctx.flags, [], 'knowledge');
      if (rest[0] === 'remove') {
        const id = rest[1];
        if (!id) throw new CliError('usage', 'Usage: murmur knowledge files remove <id>', { exitCode: EXIT.usage });
        const removed = await api.send<{ chunks: number }>('DELETE', `/admin/api/knowledge/files/${encodeURIComponent(id)}`);
        ctx.out.result({ id, removed: true, chunks: removed.chunks }, () => ctx.out.success(`Removed ${id} (${removed.chunks} passage(s)).`));
        return 0;
      }
      const { files } = await api.get<{ files: KnowledgeFile[] }>('/admin/api/knowledge/files');
      ctx.out.result({ files }, () => {
        if (!files.length) process.stdout.write(c.dim('No files yet. Upload one with `murmur knowledge upload price-list.pdf`.\n'));
        for (const f of files) process.stdout.write(`${fileLine(f)}\n`);
      });
      return 0;
    }
    case 'add': {
      assertKnown(ctx.flags, ['file', 'title', 'text', 'id', 'wait'], 'knowledge');
      const file = str(ctx.flags, 'file');
      // Documents are read on the Worker, in the background.
      if (file && /\.(pdf|docx)$/i.test(file)) return uploadDocuments(ctx, api, loaded.dir, [file], ctx.flags['wait'] === true);
      let content = str(ctx.flags, 'text') ?? '';
      let title = str(ctx.flags, 'title');
      if (file) {
        const path = resolve(loaded.dir, file);
        if (!existsSync(path)) throw new CliError('usage', `No such file: ${file}`, { exitCode: EXIT.usage });
        if (!/\.(md|mdx|txt|csv|json|html?)$/i.test(path)) {
          throw new CliError('usage', 'Text (Markdown, text, CSV, JSON, HTML), PDF or Word (.docx) files only.', { exitCode: EXIT.usage });
        }
        content = readFileSync(path, 'utf8');
        title ??= (/^#\s+(.+)$/m.exec(content)?.[1] ?? basename(path)).trim();
      }
      if (!title || !content.trim()) {
        throw new CliError('usage', 'Usage: murmur knowledge add --file faq.md  |  --title "Warranty" --text "…"', { exitCode: EXIT.usage });
      }
      const id = str(ctx.flags, 'id');
      const added = await api.send<{ id: string; chunks: number }>('POST', '/admin/api/knowledge/manual', { title, content, ...(id ? { id } : {}) });
      ctx.out.result(added, () => ctx.out.success(`Added "${title}" (${added.chunks} passage(s)), id ${added.id}. Live now.`));
      return 0;
    }
    case 'list': {
      assertKnown(ctx.flags, [], 'knowledge');
      const { entries } = await api.get<{ entries: { id: string; title: string; updatedAt: number }[] }>('/admin/api/knowledge/manual');
      ctx.out.result({ entries }, () => {
        if (!entries.length) process.stdout.write(c.dim('No hand-written entries. Add one with `murmur knowledge add --file faq.md`.\n'));
        for (const e of entries) process.stdout.write(`${e.id.padEnd(38)} ${e.title}\n`);
      });
      return 0;
    }
    case 'remove': {
      assertKnown(ctx.flags, [], 'knowledge');
      const id = rest[0];
      if (!id) throw new CliError('usage', 'Usage: murmur knowledge remove <id>', { exitCode: EXIT.usage });
      await api.send('DELETE', `/admin/api/knowledge/manual/${encodeURIComponent(id)}`);
      ctx.out.result({ id, removed: true }, () => ctx.out.success(`Removed ${id}.`));
      return 0;
    }
    case 'pages': {
      assertKnown(ctx.flags, ['status'], 'knowledge');
      const { pages } = await api.get<{ pages: { url: string; status: string; category: string; chunks: number; error: string | null; selected: number }[] }>(
        '/admin/api/knowledge/pages',
        { status: str(ctx.flags, 'status') },
      );
      ctx.out.result({ pages }, () => {
        for (const p of pages) {
          const tone = p.status === 'indexed' || p.status === 'unchanged' ? c.green : p.status === 'discovered' ? c.dim : c.yellow;
          process.stdout.write(`${tone(p.status.padEnd(10))} ${String(p.chunks).padStart(3)}  ${p.url}${p.error ? c.dim(`  — ${p.error}`) : ''}\n`);
        }
      });
      return 0;
    }
    case 'suggest': {
      assertKnown(ctx.flags, ['apply'], 'knowledge');
      const { questions, source } = await api.send<{ questions: string[]; source: string }>('POST', '/admin/api/knowledge/suggest-questions', {});
      if (ctx.flags['apply']) await api.send('PUT', '/admin/api/settings', { settings: { starterQuestions: questions } });
      ctx.out.result({ questions, source, applied: Boolean(ctx.flags['apply']), ...(ctx.flags['apply'] ? { next: ['murmur config pull --json'] } : {}) }, () => {
        for (const q of questions) process.stdout.write(`  • ${q}\n`);
        process.stdout.write(
          c.dim(ctx.flags['apply'] ? 'Live now as the suggested questions. Run `murmur config pull` to keep them in murmur.json.\n' : 'Add --apply to show them in the widget.\n'),
        );
      });
      return 0;
    }
    case 'facts': {
      assertKnown(ctx.flags, [], 'knowledge');
      if (rest[0] === 'set') {
        const facts: Record<string, string> = {};
        for (const pair of rest.slice(1)) {
          const [key, ...value] = pair.split('=');
          if (!key || !value.length) throw new CliError('usage', 'Usage: murmur knowledge facts set phone="03 9876 5432" hours="Mon-Fri 8am-5pm"', { exitCode: EXIT.usage });
          facts[key] = value.join('=');
        }
        const saved = await api.send<{ facts: unknown[] }>('PUT', '/admin/api/knowledge/facts', { facts });
        ctx.out.result(saved, () => ctx.out.success(`Saved ${Object.keys(facts).join(', ')}. The assistant uses them from now on.`));
        return 0;
      }
      const { facts } = await api.get<{ facts: { key: string; value: string; source: string | null }[] }>('/admin/api/knowledge/facts');
      ctx.out.result({ facts }, () => {
        if (!facts.length) process.stdout.write(c.dim('No facts yet: they are learned from the crawl, or set with `murmur knowledge facts set key=value`.\n'));
        for (const f of facts) process.stdout.write(`${f.key.padEnd(14)} ${f.value}${f.source === 'owner' ? c.dim('  (you)') : ''}\n`);
      });
      return 0;
    }
    default:
      throw new CliError('usage', 'Usage: murmur knowledge status | sync | add | list | remove <id> | pages | facts [set k=v …] | suggest [--apply]', {
        exitCode: EXIT.usage,
        hint: 'murmur knowledge --help',
      });
  }
}

/** The AI Search / OpenAI / Gemini knowledge flows, unchanged. */
async function legacyKnowledge(ctx: Ctx, loaded: LoadedProject, sub: string | undefined): Promise<number> {
  assertKnown(ctx.flags, [], 'knowledge');
  if (sub === 'status') {
    const cf = await cloudflareSession(loadEnv(loaded.dir));
    const status = await indexingStatus(cf.api, cf.accountId, loaded.project);
    ctx.out.result({ indexing: status }, () =>
      process.stdout.write(`${status ? describeIndexing(status) : 'This backend has no AI Search index; see `murmur status`.'}\n`),
    );
    return 0;
  }
  if (sub !== 'sync') throw new CliError('usage', 'Usage: murmur knowledge sync | status', { exitCode: EXIT.usage, hint: 'murmur knowledge --help' });
  const env = loadEnv(loaded.dir);
  const cf = aiSearchInstanceFor(loaded.project) ? await cloudflareSession(env) : undefined;
  const result = await syncKnowledge(loaded, { env, progress: ctx.out.progress, ...(cf ? { cf } : {}) });
  if (result.backendUpdate) updateProject(loaded, (raw) => Object.assign(raw['backend'] as object, result.backendUpdate));
  const next = result.backendUpdate ? ['murmur deploy --json   (publishes the new store id)'] : [];
  ctx.out.result({ ...result, next }, () => {
    ctx.out.success(
      result.target === 'none'
        ? 'Nothing to sync: this backend has no knowledge base, or there is no website or files configured.'
        : `${result.uploaded} document(s) → ${result.target} (${result.pages} page(s), ${result.files} file(s)${result.removed ? `, ${result.removed} removed` : ''})`,
    );
    for (const skipped of result.skipped) ctx.out.warn(`Skipped ${skipped}`);
    if (next.length) ctx.out.info(`Run ${c.cyan('murmur deploy')} to switch the assistant to the new knowledge.`);
  });
  return 0;
}
