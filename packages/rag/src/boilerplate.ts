import { fingerprint } from './hash.js';

/**
 * The cross-page boilerplate filter. Element-level cleaning misses
 * the furniture a theme puts inside the content area — a "Why choose us"
 * strip, a call-to-action, a testimonial carousel — and repeated on every
 * page it would crowd out the one page that actually answers a question.
 *
 * A block (a Markdown paragraph, list item or table) that appears on more
 * than half of a sample of pages is boilerplate. Headings are never removed:
 * they carry the structure the chunker needs.
 */

const normalise = (block: string) =>
  block
    .toLowerCase()
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function blocksOf(markdown: string): string[] {
  return markdown.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
}

const isHeading = (block: string) => /^#{1,6} /.test(block);

/** Fingerprints of blocks seen on more than `threshold` of the pages. Needs at least three pages to judge. */
export function boilerplateFrom(pages: readonly string[], threshold = 0.5): string[] {
  if (pages.length < 3) return [];
  const counts = new Map<string, number>();
  for (const markdown of pages) {
    const seen = new Set<string>();
    for (const block of blocksOf(markdown)) {
      if (isHeading(block)) continue;
      const text = normalise(block);
      if (text.length < 3) continue;
      seen.add(fingerprint(text));
    }
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n / pages.length > threshold).map(([key]) => key);
}

const CONTACT = /(\+?\d[\d\s().-]{7,}\d)|([^@\s]+@[^@\s]+\.[a-z]{2,})|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b.*\d/i;

/**
 * Remove boilerplate blocks. Removed blocks that carry contact details or
 * hours are returned, so they can be kept once, site-wide, instead of on
 * every page.
 */
export function stripBoilerplate(markdown: string, boilerplate: readonly string[]): { markdown: string; siteWide: string[] } {
  if (!boilerplate.length) return { markdown, siteWide: [] };
  const known = new Set(boilerplate);
  const kept: string[] = [];
  const siteWide: string[] = [];
  for (const block of blocksOf(markdown)) {
    if (!isHeading(block) && known.has(fingerprint(normalise(block)))) {
      if (CONTACT.test(block)) siteWide.push(block);
      continue;
    }
    kept.push(block);
  }
  // A heading left with nothing under it before the next heading of the same or higher level is noise.
  const pruned = kept.filter((block, i) => {
    const level = /^(#{1,6}) /.exec(block)?.[1]?.length;
    if (!level) return true;
    const next = kept[i + 1];
    if (next === undefined) return false;
    const nextLevel = /^(#{1,6}) /.exec(next)?.[1]?.length;
    return !nextLevel || nextLevel > level;
  });
  return { markdown: pruned.join('\n\n'), siteWide };
}
