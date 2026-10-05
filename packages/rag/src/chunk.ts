/**
 * Chunking by structure, not characters.
 *
 * A page is a tree of headings. Each section — a heading and its body up to
 * the next heading of the same or higher level — is the natural unit of
 * meaning, so a chunk is a section, merged with its siblings when too small
 * to stand alone and split at block boundaries when too large. Blocks are
 * Markdown paragraphs, list items and tables: never split inside one, except
 * an oversized paragraph (at sentences) or table (at rows, repeating the
 * header row).
 *
 * FAQs are the exception to merging: each question and its answer is one
 * chunk, because that is exactly the shape of the question a visitor asks.
 *
 * Every chunk carries its heading path and a context prefix (page, section,
 * category, URL) that is embedded with it but never shown.
 */

export type ChunkMeta = { title: string; url: string; category: string };

export type Chunk = {
  ordinal: number;
  /** `Page Title › H2 › H3` as a list. */
  headingPath: string[];
  /** What is stored, searched by keyword and shown as the source passage. */
  content: string;
  /** The prefix embedded with the content. */
  context: string;
  tokens: number;
};

export type ChunkOptions = { minTokens?: number; maxTokens?: number };

/** Close enough for budgeting and sizing; exact counts would need the model's tokenizer. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

type Block = { kind: 'heading'; level: number; text: string } | { kind: 'question'; text: string } | { kind: 'table'; text: string } | { kind: 'text'; text: string };

type Unit = {
  path: string[];
  /** Markdown, starting with its own heading when it has one. */
  blocks: string[];
  /** FAQ pairs stay alone. */
  alone: boolean;
};

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const raw = markdown.replace(/\r\n/g, '\n');
  // Fenced code stays whole even when it contains blank lines.
  const parts = raw.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (part.startsWith('```')) {
      blocks.push({ kind: 'text', text: part.trim() });
      continue;
    }
    for (const piece of part.split(/\n{2,}/)) {
      const text = piece.trim();
      if (!text) continue;
      const heading = /^(#{1,6})\s+(.+)$/.exec(text);
      if (heading && !text.includes('\n')) blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() });
      else if (/^\*\*[^*]+\?\*\*$/.test(text)) blocks.push({ kind: 'question', text: text.slice(2, -2).trim() });
      else if (/^\|.*\|$/m.test(text) && text.split('\n').every((l) => l.trim().startsWith('|'))) blocks.push({ kind: 'table', text });
      else blocks.push({ kind: 'text', text });
    }
  }
  return blocks;
}

/** Sections in document order, FAQ pairs split out. */
function units(blocks: Block[]): Unit[] {
  const out: Unit[] = [];
  const stack: { level: number; text: string }[] = [];
  let current: Unit = { path: [], blocks: [], alone: false };
  const push = () => {
    if (current.blocks.some((b) => !b.startsWith('#'))) out.push(current);
  };

  for (const block of blocks) {
    if (block.kind === 'heading') {
      push();
      while (stack.length && stack[stack.length - 1]!.level >= block.level) stack.pop();
      stack.push({ level: block.level, text: block.text });
      const path = stack.map((s) => s.text);
      current = { path, blocks: [`${'#'.repeat(block.level)} ${block.text}`], alone: /\?$/.test(block.text) };
      continue;
    }
    if (block.kind === 'question') {
      push();
      current = { path: [...stack.map((s) => s.text), block.text], blocks: [`**${block.text}**`], alone: true };
      continue;
    }
    current.blocks.push(block.text);
  }
  push();
  return out;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=["'([]?[A-Z0-9])/).filter(Boolean);
}

/** Pieces of one oversized block, each under `max` tokens where the structure allows. */
function splitBlock(block: string, max: number): string[] {
  if (estimateTokens(block) <= max) return [block];
  const lines = block.split('\n');
  if (lines.length > 2 && lines.every((l) => l.trim().startsWith('|'))) {
    const header = lines.slice(0, 2).join('\n');
    const pieces: string[] = [];
    let rows: string[] = [];
    for (const row of lines.slice(2)) {
      if (rows.length && estimateTokens(`${header}\n${[...rows, row].join('\n')}`) > max) {
        pieces.push(`${header}\n${rows.join('\n')}`);
        rows = [];
      }
      rows.push(row);
    }
    if (rows.length) pieces.push(`${header}\n${rows.join('\n')}`);
    return pieces;
  }
  const sentences = lines.length > 1 ? lines : splitSentences(block);
  const joiner = lines.length > 1 ? '\n' : ' ';
  const pieces: string[] = [];
  let acc = '';
  for (const sentence of sentences) {
    if (acc && estimateTokens(`${acc}${joiner}${sentence}`) > max) {
      pieces.push(acc);
      acc = '';
    }
    // A single sentence longer than the limit is cut; there is no better boundary.
    if (estimateTokens(sentence) > max) {
      for (let i = 0; i < sentence.length; i += max * 4) pieces.push(sentence.slice(i, i + max * 4));
      continue;
    }
    acc = acc ? `${acc}${joiner}${sentence}` : sentence;
  }
  if (acc) pieces.push(acc);
  return pieces;
}

const commonPrefix = (a: string[], b: string[]) => {
  const out: string[] = [];
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) out.push(a[i]!);
  return out;
};

/** Whether b sits under a's parent (a sibling) or under a itself (a child). */
const related = (a: string[], b: string[]) => commonPrefix(a, b).length >= Math.max(0, a.length - 1);

export function chunkPage(markdown: string, meta: ChunkMeta, options: ChunkOptions = {}): Chunk[] {
  const min = options.minTokens ?? 150;
  const max = options.maxTokens ?? 800;
  const sections = units(parseBlocks(markdown));

  // Merge small sections forward into their siblings or children.
  type Draft = { path: string[]; text: string; alone: boolean };
  const drafts: Draft[] = [];
  for (const unit of sections) {
    const text = unit.blocks.join('\n\n');
    const last = drafts[drafts.length - 1];
    if (
      last &&
      !last.alone &&
      !unit.alone &&
      estimateTokens(last.text) < min &&
      estimateTokens(`${last.text}\n\n${text}`) <= max &&
      related(last.path, unit.path)
    ) {
      last.text = `${last.text}\n\n${text}`;
      last.path = commonPrefix(last.path, unit.path);
      continue;
    }
    drafts.push({ path: unit.path, text, alone: unit.alone });
  }

  // Split large ones at block boundaries; the section heading repeats in each part.
  const pieces: { path: string[]; text: string }[] = [];
  for (const draft of drafts) {
    if (estimateTokens(draft.text) <= max) {
      pieces.push({ path: draft.path, text: draft.text });
      continue;
    }
    const blocks = draft.text.split(/\n{2,}/);
    const heading = /^#{1,6} /.test(blocks[0] ?? '') ? blocks.shift()! : null;
    const budget = max - (heading ? estimateTokens(heading) + 1 : 0);
    let acc: string[] = [];
    const emit = () => {
      if (acc.length) pieces.push({ path: draft.path, text: [heading, ...acc].filter(Boolean).join('\n\n') });
      acc = [];
    };
    for (const block of blocks.flatMap((b) => splitBlock(b, budget))) {
      if (acc.length && estimateTokens([...acc, block].join('\n\n')) > budget) emit();
      acc.push(block);
    }
    emit();
  }

  const category = meta.category;
  return pieces
    .filter((p) => p.text.replace(/[#*|\-\s]/g, '').length >= 12)
    .map((piece, ordinal) => {
      // The page's H1 usually repeats its title ("Hot Water" in "Hot Water | Acme"); say it once.
      const first = piece.path[0]?.toLowerCase();
      const rest = first && meta.title.toLowerCase().includes(first) ? piece.path.slice(1) : piece.path;
      const headingPath = [meta.title, ...rest];
      const context = [
        `Page: ${meta.title}`,
        `Section: ${headingPath.join(' › ')}`,
        `Category: ${category}`,
        `URL: ${meta.url}`,
        '---',
      ].join('\n');
      return { ordinal, headingPath, content: piece.text, context, tokens: estimateTokens(piece.text) };
    });
}

/** The text that is embedded: context prefix, then the passage. */
export const embeddingText = (chunk: Pick<Chunk, 'context' | 'content'>) => `${chunk.context}\n${chunk.content}`;
