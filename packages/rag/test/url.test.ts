import { describe, expect, it } from 'vitest';
import { canonicalUrl, globMatch, isLikelyPage, sameSite, selectedBy } from '../src/url.js';
import { parseRobots, robotsAllows } from '../src/robots.js';
import { parseSitemap } from '../src/sitemap.js';

describe('canonicalUrl', () => {
  it('strips fragments, tracking parameters and trailing slashes', () => {
    expect(canonicalUrl('https://Acme.com.au/Services/?utm_source=x&gclid=1&page=2#top')).toBe('https://acme.com.au/Services?page=2');
    expect(canonicalUrl('https://acme.com.au/')).toBe('https://acme.com.au/');
    expect(canonicalUrl('/faq/', 'https://acme.com.au/about')).toBe('https://acme.com.au/faq');
    expect(canonicalUrl('https://acme.com.au/a?fbclid=z')).toBe('https://acme.com.au/a');
  });

  it('refuses anything that is not a web page address', () => {
    expect(canonicalUrl('mailto:hi@acme.com')).toBeNull();
    expect(canonicalUrl('javascript:void(0)')).toBeNull();
    expect(canonicalUrl('not a url')).toBeNull();
  });

  it('treats www and the apex as one site', () => {
    expect(sameSite('https://www.acme.com/a', 'https://acme.com/')).toBe(true);
    expect(sameSite('https://shop.acme.com/', 'https://acme.com/')).toBe(false);
  });

  it('skips files and account screens', () => {
    expect(isLikelyPage('https://acme.com/brochure.pdf')).toBe(false);
    expect(isLikelyPage('https://acme.com/cart')).toBe(false);
    expect(isLikelyPage('https://acme.com/wp-admin/edit.php')).toBe(false);
    expect(isLikelyPage('https://acme.com/services/hot-water')).toBe(true);
  });
});

describe('globMatch', () => {
  it('matches the plan’s default exclusions', () => {
    expect(globMatch('**/privacy**', 'https://acme.com/privacy-policy')).toBe(true);
    expect(globMatch('**/tag/**', 'https://acme.com/blog/tag/plumbing')).toBe(true);
    expect(globMatch('**/page/*', 'https://acme.com/blog/page/2')).toBe(true);
    expect(globMatch('**/page/*', 'https://acme.com/pages')).toBe(false);
  });

  it('treats a trailing /** as the folder and everything in it', () => {
    expect(globMatch('**/services/**', 'https://acme.com/services')).toBe(true);
    expect(globMatch('**/services/**', 'https://acme.com/services/hot-water')).toBe(true);
    expect(globMatch('**/services/**', 'https://acme.com/our-services')).toBe(false);
  });

  it('matches a plain word as a substring', () => {
    expect(globMatch('privacy', 'https://acme.com/legal/privacy')).toBe(true);
    expect(selectedBy('https://acme.com/faq', ['**/faq/**'], [])).toBe(true);
    expect(selectedBy('https://acme.com/about', ['**/faq/**'], [])).toBe(false);
    expect(selectedBy('https://acme.com/terms', [], ['**/terms**'])).toBe(false);
  });
});

describe('robots.txt', () => {
  const text = `
User-agent: *
Disallow: /private/
Allow: /private/open$
Crawl-delay: 2
Sitemap: https://acme.com/sitemap_index.xml

User-agent: helppuff-crawler
Disallow: /no-bots
`;

  it('uses our own group when there is one', () => {
    const robots = parseRobots(text, 'helppuff-crawler/0.1 (+https://x)');
    expect(robotsAllows(robots, 'https://acme.com/no-bots/x')).toBe(false);
    expect(robotsAllows(robots, 'https://acme.com/private/a')).toBe(true);
    expect(robots.sitemaps).toEqual(['https://acme.com/sitemap_index.xml']);
  });

  it('falls back to *, longest rule wins, Allow wins ties and $ anchors', () => {
    const robots = parseRobots(text, 'OtherBot/1.0');
    expect(robotsAllows(robots, 'https://acme.com/private/a')).toBe(false);
    expect(robotsAllows(robots, 'https://acme.com/private/open')).toBe(true);
    expect(robotsAllows(robots, 'https://acme.com/private/open/more')).toBe(false);
    expect(robots.crawlDelay).toBe(2);
  });

  it('allows everything when robots.txt says nothing', () => {
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow:', 'x'), 'https://acme.com/a')).toBe(true);
  });
});

describe('sitemaps', () => {
  it('reads a url set with lastmod and entities', () => {
    const map = parseSitemap(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://acme.com/a?x=1&amp;y=2</loc><lastmod>2026-01-02</lastmod></url>
      <url><loc><![CDATA[https://acme.com/b]]></loc></url></urlset>`);
    expect(map.kind).toBe('urlset');
    expect(map.entries).toEqual([{ loc: 'https://acme.com/a?x=1&y=2', lastmod: '2026-01-02' }, { loc: 'https://acme.com/b' }]);
  });

  it('recognises an index', () => {
    const map = parseSitemap('<sitemapindex><sitemap><loc>https://acme.com/page-sitemap.xml</loc></sitemap></sitemapindex>');
    expect(map).toEqual({ kind: 'index', entries: [{ loc: 'https://acme.com/page-sitemap.xml' }] });
  });

  it('returns nothing for an HTML error page', () => {
    expect(parseSitemap('<html><body>Not found</body></html>').kind).toBe('unknown');
  });
});
