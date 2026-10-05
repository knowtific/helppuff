import { describe, expect, it } from 'vitest';
import { chunkPage, embeddingText, estimateTokens } from '../src/chunk.js';

const meta = { title: 'Hot Water | Acme Plumbing', url: 'https://acme.com.au/hot-water', category: 'service' };
const words = (n: number, word = 'water') => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ') + '.';

describe('chunkPage', () => {
  it('makes one chunk per section, with its heading path and context', () => {
    const md = `# Hot water\n\n${words(200)}\n\n## Repairs\n\n${words(200, 'fix')}\n\n### Rinnai\n\n${words(200, 'rinnai')}`;
    const chunks = chunkPage(md, meta);
    expect(chunks.map((c) => c.headingPath.join(' › '))).toEqual([
      'Hot Water | Acme Plumbing',
      'Hot Water | Acme Plumbing › Repairs',
      'Hot Water | Acme Plumbing › Repairs › Rinnai',
    ]);
    expect(chunks[2]!.content.startsWith('### Rinnai')).toBe(true);
    expect(chunks[2]!.context).toBe(
      'Page: Hot Water | Acme Plumbing\nSection: Hot Water | Acme Plumbing › Repairs › Rinnai\nCategory: service\nURL: https://acme.com.au/hot-water\n---',
    );
    expect(embeddingText(chunks[2]!)).toBe(`${chunks[2]!.context}\n${chunks[2]!.content}`);
  });

  it('merges small sibling sections up to the target size', () => {
    const md = `## Gas\n\nWe do gas.\n\n## Water\n\nWe do water.\n\n## Drains\n\nWe do drains.`;
    const chunks = chunkPage(md, meta);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('## Gas\n\nWe do gas.\n\n## Water\n\nWe do water.\n\n## Drains\n\nWe do drains.');
    expect(chunks[0]!.headingPath).toEqual(['Hot Water | Acme Plumbing']);
  });

  it('splits a long section at paragraph boundaries, repeating its heading', () => {
    const md = `## Guide\n\n${Array.from({ length: 8 }, (_, i) => words(250, `p${i}w`)).join('\n\n')}`;
    const chunks = chunkPage(md, meta);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.startsWith('## Guide')).toBe(true);
      expect(chunk.tokens).toBeLessThanOrEqual(800);
    }
    // No paragraph is cut in half.
    expect(chunks.map((c) => c.content.replace('## Guide\n\n', '')).join('\n\n').split('\n\n')).toHaveLength(8);
  });

  it('splits a big table by rows and repeats the header row', () => {
    const rows = Array.from({ length: 120 }, (_, i) => `| Service number ${i} with a description | $${i}0 |`).join('\n');
    const md = `## Prices\n\n| Service | Price |\n| --- | --- |\n${rows}`;
    const chunks = chunkPage(md, meta);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content).toContain('| Service | Price |\n| --- | --- |');
      expect(chunk.content.split('\n').filter((l) => l.startsWith('| Service number')).every((l) => l.endsWith('0 |'))).toBe(true);
    }
  });

  it('keeps each FAQ question with its answer, alone', () => {
    const md = `## FAQ\n\n**Do you do emergencies?**\n\nYes, 24/7.\n\n**Do you service Lilydale?**\n\nYes, and all of the Yarra Valley.\n\n### How do I book?\n\nCall us.`;
    const chunks = chunkPage(md, meta);
    expect(chunks.map((c) => c.content)).toEqual([
      '**Do you do emergencies?**\n\nYes, 24/7.',
      '**Do you service Lilydale?**\n\nYes, and all of the Yarra Valley.',
      '### How do I book?\n\nCall us.',
    ]);
    expect(chunks[1]!.headingPath).toEqual(['Hot Water | Acme Plumbing', 'FAQ', 'Do you service Lilydale?']);
  });

  it('puts text before the first heading under the page title and drops empty headings', () => {
    const chunks = chunkPage(`Intro text about our family business.\n\n## Empty\n\n## Full\n\nContent here for real.`, meta);
    expect(chunks[0]!.headingPath).toEqual(['Hot Water | Acme Plumbing']);
    expect(chunks.some((c) => c.content === '## Empty')).toBe(false);
  });

  it('says the H1 once when it repeats the title', () => {
    const chunks = chunkPage(`# Hot Water\n\n${words(200)}`, meta);
    expect(chunks[0]!.headingPath).toEqual(['Hot Water | Acme Plumbing']);
  });

  it('estimates tokens as characters / 4', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
});
