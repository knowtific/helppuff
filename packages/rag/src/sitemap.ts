/**
 * Sitemaps (sitemaps.org): a `<urlset>` of pages or a `<sitemapindex>` of
 * further sitemaps. Parsed with patterns rather than an XML parser — the
 * format is flat, real sitemaps are often slightly malformed, and Workers
 * have no DOMParser.
 */

export type SitemapEntry = { loc: string; lastmod?: string };
export type Sitemap = { kind: 'index' | 'urlset' | 'unknown'; entries: SitemapEntry[] };

const decode = (value: string) =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();

export function parseSitemap(xml: string): Sitemap {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? 'index' : /<urlset[\s>]/i.test(xml) ? 'urlset' : 'unknown';
  const entries: SitemapEntry[] = [];
  const blocks = xml.match(/<(url|sitemap)[\s>][\s\S]*?<\/\1\s*>/gi) ?? [];
  for (const block of blocks) {
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(block)?.[1];
    if (!loc) continue;
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(block)?.[1];
    entries.push({ loc: decode(loc), ...(lastmod ? { lastmod: decode(lastmod) } : {}) });
  }
  return { kind, entries };
}
