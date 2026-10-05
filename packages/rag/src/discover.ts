import { categorise, suggested, type Category } from './categorise.js';
import { extractPage } from './extract.js';
import { DEFAULT_USER_AGENT, fetchPage, fetchText } from './fetch.js';
import { EMPTY_ROBOTS, parseRobots, robotsAllows, type Robots } from './robots.js';
import { parseSitemap } from './sitemap.js';
import { canonicalUrl, depth, isLikelyPage, sameSite } from './url.js';

/**
 * Discovery: every page of the site we can find without crawling it
 * — the home page's links, robots.txt's sitemaps, the conventional sitemap
 * locations and nested sitemap indexes — each with a category and whether
 * it is ticked by default.
 *
 * Bounded so it fits one Worker request on the free plan (50 external
 * fetches): the home page, robots.txt and at most `maxSitemaps` sitemaps.
 */

export type DiscoveredUrl = {
  url: string;
  source: 'home' | 'sitemap' | 'link';
  lastmod?: string;
  category: Category;
  suggested: boolean;
};

export type Discovery = {
  /** Where the site really lives after redirects (www vs apex, http → https). */
  origin: string;
  homepage: string;
  reachable: boolean;
  robots: Robots;
  sitemaps: string[];
  urls: DiscoveredUrl[];
  warnings: string[];
};

export type DiscoverOptions = {
  fetch?: typeof fetch;
  userAgent?: string;
  maxUrls?: number;
  maxSitemaps?: number;
};

export async function discover(siteUrl: string, options: DiscoverOptions = {}): Promise<Discovery> {
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const io = { userAgent, ...(options.fetch ? { fetch: options.fetch } : {}) };
  const maxUrls = options.maxUrls ?? 1000;
  const maxSitemaps = options.maxSitemaps ?? 25;
  const warnings: string[] = [];

  const start = canonicalUrl(siteUrl);
  if (!start) throw new Error(`"${siteUrl}" is not a website address.`);
  const home = await fetchPage(start, io);
  const homepage = canonicalUrl(home.finalUrl) ?? start;
  const origin = new URL(homepage).origin;
  if (!home.ok) {
    warnings.push(
      home.blocked
        ? `The home page refused our crawler (${home.error}). Bot protection may block crawling; allow "${userAgent.split(' ')[0]}" or add pages by hand.`
        : `Could not read the home page: ${home.error}.`,
    );
  }

  const robotsText = await fetchText(`${origin}/robots.txt`, io);
  const robots = robotsText ? parseRobots(robotsText, userAgent) : EMPTY_ROBOTS;
  if (robots.rules.some((r) => !r.allow && r.path === '/')) warnings.push('robots.txt disallows crawling this site; only pages it allows are listed.');

  const found = new Map<string, DiscoveredUrl>();
  const add = (raw: string, source: DiscoveredUrl['source'], lastmod?: string) => {
    if (found.size >= maxUrls) return;
    const url = canonicalUrl(raw, homepage);
    if (!url || found.has(url) || !sameSite(url, homepage) || !isLikelyPage(url) || !robotsAllows(robots, url)) return;
    const category = categorise({ url });
    found.set(url, { url, source, ...(lastmod ? { lastmod } : {}), category, suggested: suggested(url, category) });
  };
  add(homepage, 'home');

  // Sitemaps first: they list pages the navigation does not link.
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  const read = new Set<string>();
  const sitemaps: string[] = [];
  while (queue.length && read.size < maxSitemaps && found.size < maxUrls) {
    const next = queue.shift()!;
    if (read.has(next)) continue;
    read.add(next);
    const xml = await fetchText(next, io);
    if (!xml) continue;
    const parsed = parseSitemap(xml);
    if (parsed.kind === 'unknown') continue;
    sitemaps.push(next);
    if (parsed.kind === 'index') {
      // Post sitemaps last: pages and services matter more than the blog.
      const children = parsed.entries.map((e) => e.loc).sort((a, b) => Number(/post|blog|news|tag|author|categor/i.test(a)) - Number(/post|blog|news|tag|author|categor/i.test(b)));
      queue.push(...children);
    } else {
      for (const entry of parsed.entries) add(entry.loc, 'sitemap', entry.lastmod);
    }
  }
  if (!sitemaps.length) warnings.push('No sitemap found; pages were found from the home page links only.');

  if (home.ok) {
    for (const link of extractPage(home.html, homepage).links) add(link, 'link');
  }

  const urls = [...found.values()].sort((a, b) => {
    if (a.source === 'home') return -1;
    if (b.source === 'home') return 1;
    return depth(a.url) - depth(b.url) || a.url.localeCompare(b.url);
  });
  return { origin, homepage, reachable: home.ok, robots, sitemaps, urls, warnings };
}
