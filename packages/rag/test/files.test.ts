import { describe, expect, it } from 'vitest';
import { distill, fileKind, fileTitle, fileUrl, runFileJob, sections, uploadKey, type FileDeps, type FileParams } from '../src/files.js';
import { DEFAULT_RETRIEVAL, retrieve } from '../src/retrieve.js';
import { fakeAi, fakeVectors, inlineSteps, sqliteD1 } from './helpers.js';

describe('file names', () => {
  it('knows the four kinds by extension and nothing else', () => {
    expect(['a.pdf', 'B.DOCX', 'notes.md', 'notes.markdown', 'faq.txt', 'x.doc', 'sheet.xlsx', 'noext'].map(fileKind)).toEqual(['pdf', 'docx', 'md', 'md', 'txt', null, null, null]);
    expect(fileTitle('price-list_2026.pdf')).toBe('price list 2026');
  });
});

describe('distill', () => {
  it('drops running headers, footers and page numbers, and rejoins what the PDF wrapped', () => {
    const page = (n: number, body: string) => `Acme Plumbing — Service Guide\n\n${body}\n\nPage ${n} of 3\n`;
    const text = [
      page(1, 'Hot water\n\nWe install gas and electric sys-\ntems across the eastern\nsuburbs, usually within a day.'),
      page(2, 'Warranty\n\nAll work carries a five year\nwarranty on parts and labour.'),
      page(3, 'Contact\n\nCall 03 9000 0000.'),
    ].join('\f');
    expect(distill(text, 'pdf')).toBe(
      [
        '## Hot water',
        'We install gas and electric systems across the eastern suburbs, usually within a day.',
        '## Warranty',
        'All work carries a five year warranty on parts and labour.',
        '## Contact',
        'Call 03 9000 0000.',
      ].join('\n\n'),
    );
  });

  it('leaves Markdown structure alone', () => {
    const md = '# Prices\n\n| Job | Price |\n| --- | --- |\n| Call-out | $99 |\n| Call-out | $99 |\n| Call-out | $99 |\n\n- first\n- second';
    expect(distill(md, 'md')).toBe(md);
    expect(distill(md, 'pdf')).toContain('| Call-out | $99 |\n| Call-out | $99 |');
  });
});

describe('sections', () => {
  it('cuts at headings and carries the headings each section sits under', () => {
    const para = (n: number) => `Paragraph ${n} `.repeat(40).trim();
    const md = ['# Guide', '## Install', para(1), para(2), '### Gas', para(3), '## Warranty', para(4)].join('\n\n');
    const parts = sections(md, 800);
    expect(parts.length).toBe(4);
    for (const part of parts) expect(part.startsWith('# Guide')).toBe(true);
    expect(parts[2]!.startsWith('# Guide\n\n## Install\n\n### Gas')).toBe(true);
    const warranty = parts.find((p) => p.includes('## Warranty'))!;
    // A new section under "Warranty" does not drag in its sibling "Install".
    expect(warranty).not.toContain('## Install');
    expect(parts.join('\n')).toContain(para(4));
  });

  it('cuts a block longer than a section at line breaks', () => {
    const table = Array.from({ length: 200 }, (_, i) => `| row ${i} | ${'x'.repeat(40)} |`).join('\n');
    const parts = sections(table, 2000);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
  });
});

function world(options: { upload?: ArrayBuffer | null; converted?: string | Error } = {}) {
  const db = sqliteD1();
  const vectors = fakeVectors();
  const ai = fakeAi();
  const kv = new Map<string, ArrayBuffer>();
  const deps: FileDeps = {
    db,
    ai,
    vectors,
    uploads: {
      get: async (key) => kv.get(key) ?? null,
      delete: async (key) => void kv.delete(key),
    },
    toMarkdown: async (document) => {
      if (options.converted instanceof Error) return { name: document.name, format: 'error', error: options.converted.message };
      return { name: document.name, format: 'markdown', data: options.converted ?? '' };
    },
  };
  const add = (id: string, name: string, kind: string, body: string | null) => {
    db.raw.prepare("INSERT INTO knowledge_files (id, site_id, name, kind, size, created_at, updated_at) VALUES (?, 'acme', ?, ?, 1, 0, 0)").run(id, name, kind);
    if (body !== null) kv.set(uploadKey('acme', id), new TextEncoder().encode(body).buffer as ArrayBuffer);
  };
  const params = (fileId: string): FileParams => ({ kind: 'file', siteId: 'acme', fileId, options: { embeddingModel: DEFAULT_RETRIEVAL.embeddingModel } });
  const row = (id: string) => db.raw.prepare('SELECT status, error, chunks, markdown, embedding_model FROM knowledge_files WHERE id = ?').get(id) as Record<string, unknown>;
  return { db, vectors, ai, kv, deps, add, params, row };
}

describe('runFileJob', () => {
  it('reads, cleans and learns a PDF in the background, then it is found like a page', async () => {
    const w = world({ converted: 'Acme Guide\n\nWarranty\n\nAll installs carry a five year\nwarranty on parts and labour.\n\n1\n' });
    w.add('f1', 'Acme guide.pdf', 'pdf', 'pdf bytes');
    const steps = inlineSteps();
    expect(await runFileJob(steps, w.deps, w.params('f1'))).toEqual({ status: 'indexed', chunks: 1 });
    expect(steps.names).toEqual(['load', 'read', 'distill', 'plan', 'section:1', 'finish']);

    expect(w.row('f1')).toMatchObject({ status: 'indexed', error: null, chunks: 1, embedding_model: DEFAULT_RETRIEVAL.embeddingModel });
    expect(w.row('f1')['markdown']).toContain('All installs carry a five year warranty on parts and labour.');
    expect(w.kv.size).toBe(0);
    const page = w.db.raw.prepare("SELECT url, title, source FROM pages WHERE source = 'file'").get();
    expect(page).toEqual({ url: fileUrl('f1', 1), title: 'Acme guide', source: 'file' });

    const found = await retrieve({ db: w.db, ai: w.ai, vectors: w.vectors }, 'acme', 'warranty on parts', DEFAULT_RETRIEVAL);
    expect(found.chunks[0]?.url).toBe(fileUrl('f1', 1));
  });

  it('decodes text files itself, and re-embeds from the kept Markdown without the upload', async () => {
    const w = world();
    w.add('f2', 'faq.md', 'md', '# FAQ\n\n## Do you work weekends?\n\nYes, Saturdays until noon.');
    expect((await runFileJob(inlineSteps(), w.deps, w.params('f2'))).status).toBe('indexed');
    expect(w.kv.size).toBe(0);

    const again = inlineSteps();
    expect((await runFileJob(again, w.deps, { ...w.params('f2'), options: { embeddingModel: '@cf/qwen/qwen3-embedding-0.6b' } })).status).toBe('indexed');
    expect(again.names).toEqual(['load', 'plan', 'section:1', 'finish']);
    expect(w.row('f2')['embedding_model']).toBe('@cf/qwen/qwen3-embedding-0.6b');
    expect(w.db.raw.prepare("SELECT count(*) AS n FROM pages WHERE source = 'file'").get()).toEqual({ n: 1 });
  });

  it('waits for an upload KV has not shown yet, then gives up with a reason', async () => {
    const w = world();
    w.add('f3', 'late.txt', 'txt', null);
    const steps = inlineSteps();
    expect((await runFileJob(steps, w.deps, w.params('f3'))).status).toBe('error');
    expect(steps.sleeps).toBe(3);
    expect(w.row('f3')).toMatchObject({ status: 'error', error: 'The upload went missing before it was read. Upload it again.' });
  });

  it('says why a file has nothing to learn from', async () => {
    const scanned = world({ converted: '   ' });
    scanned.add('f4', 'scan.pdf', 'pdf', 'bytes');
    expect((await runFileJob(inlineSteps(), scanned.deps, scanned.params('f4'))).status).toBe('error');
    expect(scanned.row('f4')['error']).toMatch(/No readable text/);

    const broken = world({ converted: new Error('password protected') });
    broken.add('f5', 'locked.pdf', 'pdf', 'bytes');
    expect((await runFileJob(inlineSteps(), broken.deps, broken.params('f5'))).status).toBe('error');
    expect(broken.row('f5')['error']).toMatch(/password protected/);
  });
});
