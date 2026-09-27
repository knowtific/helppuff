import { parse, type HTMLElement, type Node } from 'node-html-parser';
import { CliError } from '../errors.js';

/**
 * Everything setup can learn from a website, so it does not have to ask.
 *
 * One fetch of the home page gives the name, brand colour, logo, contact
 * details and the pages worth linking; the crawl later turns pages into
 * Markdown for the knowledge base. Every field is best-effort — a site that
 * blocks the fetch still gets set up, with defaults.
 */

export type SiteInfo = {
  url: string;
  origin: string;
  origins: string[];
  name: string | null;
  description: string | null;
  accent: string | null;
  logo: string | null;
  phone: string | null;
  email: string | null;
  lang: string | null;
  /** Key pages, by what they are for. */
  pages: Partial<Record<KeyPage, { url: string; label: string }>>;
  reachable: boolean;
};

export type KeyPage = 'pricing' | 'contact' | 'faq' | 'booking' | 'services' | 'about';

export type CrawledPage = { url: string; title: string; markdown: string };

const USER_AGENT = 'MurmurSetup/1.0 (+https://github.com/murmur; setting up a chat assistant for this site)';

const KEY_PAGES: [KeyPage, RegExp, string][] = [
  ['pricing', /\b(pricing|prices|plans|rates|cost)\b/i, 'Pricing'],
  ['booking', /\b(book|booking|appointments?|schedule|reserve)\b/i, 'Book'],
  ['contact', /\b(contact|get in touch|enquir|inquir)\w*/i, 'Contact'],
  ['faq', /\b(faqs?|questions|help|support)\b/i, 'FAQ'],
  ['services', /\b(services|what we do|solutions|products)\b/i, 'Services'],
  ['about', /\b(about|our story|who we are|team)\b/i, 'About'],
];

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new CliError('invalid_url', `"${input}" is not a website address.`, { hint: 'Use something like acme.com or https://acme.com' });
  }
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
    throw new CliError('invalid_url', `"${input}" is not a website address.`, { hint: 'Use something like acme.com or https://acme.com' });
  }
  url.hash = '';
  return url.toString();
}

/** The origin plus its www / apex twin — visitors arrive on both. */
export function originsFor(url: string): string[] {
  const parsed = new URL(url);
  const origins = [parsed.origin];
  if (parsed.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname)) return origins;
  const twin = parsed.hostname.startsWith('www.') ? parsed.hostname.slice(4) : `www.${parsed.hostname}`;
  if (twin.split('.').length >= 2) origins.push(`${parsed.protocol}//${twin}${parsed.port ? `:${parsed.port}` : ''}`);
  return origins;
}

/** A site id from a domain: `www.acme-plumbing.com.au` → `acme-plumbing`. */
export function siteIdFor(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const label = host.split('.')[0] ?? 'site';
  const id = label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return id || 'site';
}

async function get(doFetch: typeof fetch, url: string, timeoutMs = 10_000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: controller.signal,
    });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Near-white and near-black make a launcher that disappears. */
function usableAccent(value: string | undefined | null): string | null {
  if (!value || !HEX.test(value.trim())) return null;
  let hex = value.trim().slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luminance > 0.92 || luminance < 0.06) return null;
  return `#${hex.toUpperCase()}`;
}

function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Pick the brand out of a title — `Home | Acme Plumbing — Sydney's best`,
 * `MYT - Software Development Consultancy`. The part that matches the domain
 * wins (`myt` in myt-pty-ltd.com); otherwise the shortest non-generic part,
 * since taglines run long and brands do not.
 */
export function nameFromTitle(title: string, host: string): string | null {
  const parts = title
    .split(/\s[|\-–—:·•]\s/)
    .map((part) => part.trim())
    .filter((part) => part && part.length <= 60 && !/^(home|homepage|welcome|index)$/i.test(part));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  const root = host.replace(/^www\./, '').split('.')[0]?.replace(/[-_]/g, '').toLowerCase() ?? '';
  const squash = (part: string) => part.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matching = parts.find((part) => {
    const s = squash(part);
    return s.length >= 2 && (s.includes(root) || root.startsWith(s) || root.includes(s));
  });
  if (matching) return matching;
  return [...parts].sort((x, y) => x.split(/\s+/).length - y.split(/\s+/).length)[0] ?? null;
}

function meta(root: HTMLElement, key: string): string | undefined {
  const node =
    root.querySelector(`meta[property="${key}"]`) ?? root.querySelector(`meta[name="${key}"]`);
  const value = node?.getAttribute('content')?.trim();
  return value || undefined;
}

/** Whether the site publishes a sitemap AI Search's `sitemap` crawl can read. */
export async function hasSitemap(url: string, doFetch: typeof fetch = fetch): Promise<boolean> {
  const origin = new URL(url).origin;
  const robots = await (await get(doFetch, `${origin}/robots.txt`, 5000))?.text().catch(() => '');
  const listed = [...(robots ?? '').matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!);
  for (const candidate of listed.length ? listed : [`${origin}/sitemap.xml`]) {
    const xml = await (await get(doFetch, candidate, 5000))?.text().catch(() => '');
    if (xml && /<(urlset|sitemapindex)/i.test(xml)) return true;
  }
  return false;
}

/**
 * A page whose content is drawn by JavaScript: little text in the HTML
 * served, and scripts doing the work. A crawler needs a headless browser to
 * see what a visitor sees.
 */
export function looksRendered(html: string): boolean {
  const text = htmlToPage(html, 'https://x.invalid/').markdown.replace(/^# .*$|^Source: .*$/gm, '').trim();
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  return text.length < 400 && scripts >= 2;
}

export async function inspectSite(input: string, doFetch: typeof fetch = fetch): Promise<SiteInfo> {
  const url = normalizeUrl(input);
  const response = await get(doFetch, url);
  const finalUrl = response?.url || url;
  const origin = new URL(finalUrl).origin;
  const info: SiteInfo = {
    url: finalUrl,
    origin,
    origins: [...new Set([...originsFor(finalUrl), ...originsFor(url)])],
    name: null,
    description: null,
    accent: null,
    logo: null,
    phone: null,
    email: null,
    lang: null,
    pages: {},
    reachable: Boolean(response),
  };
  if (!response) return info;

  const html = await response.text().catch(() => '');
  const root = parse(html, { comment: false });
  const host = new URL(finalUrl).hostname;

  const title = root.querySelector('title')?.text.trim() ?? '';
  info.name =
    meta(root, 'og:site_name') ?? meta(root, 'application-name') ?? (title ? nameFromTitle(title, host) : null);
  if (info.name) info.name = info.name.slice(0, 60);
  info.description = (meta(root, 'description') ?? meta(root, 'og:description') ?? null)?.slice(0, 240) ?? null;
  info.lang = root.querySelector('html')?.getAttribute('lang')?.split('-')[0] ?? null;

  info.accent = usableAccent(meta(root, 'theme-color')) ?? usableAccent(meta(root, 'msapplication-TileColor'));
  if (!info.accent) {
    const manifest = absolute(root.querySelector('link[rel="manifest"]')?.getAttribute('href'), finalUrl);
    if (manifest) {
      const body = await (await get(doFetch, manifest, 5000))?.json().catch(() => null);
      info.accent = usableAccent((body as { theme_color?: string } | null)?.theme_color);
    }
  }

  const icon =
    root.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ??
    root.querySelector('link[rel="icon"][sizes]')?.getAttribute('href') ??
    meta(root, 'og:image');
  info.logo = absolute(icon, finalUrl);

  for (const link of root.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    if (!info.phone && href.startsWith('tel:')) {
      info.phone = decodeURIComponent(href.slice(4)).replace(/[^\d+]/g, '').slice(0, 20) || null;
    } else if (!info.email && href.startsWith('mailto:')) {
      const email = decodeURIComponent(href.slice(7).split('?')[0] ?? '').trim();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) info.email = email.slice(0, 200);
    } else {
      const target = absolute(href, finalUrl);
      if (!target || !sameSite(target, finalUrl) || new URL(target).pathname === '/') continue;
      const text = `${link.text} ${new URL(target).pathname}`.replace(/\s+/g, ' ');
      const own = link.text.replace(/\s+/g, ' ').trim();
      for (const [kind, pattern, label] of KEY_PAGES) {
        if (!info.pages[kind] && pattern.test(text)) {
          // The site's own words beat ours: "Start free" over "Book".
          info.pages[kind] = { url: target.split('#')[0]!, label: own.length >= 2 && own.length <= 40 ? own : label };
          break;
        }
      }
    }
  }
  return info;
}

function sameSite(a: string, b: string): boolean {
  const host = (url: string) => new URL(url).hostname.replace(/^www\./, '');
  return host(a) === host(b);
}

function canonical(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|zip|mp4|mp3|mov|woff2?|ttf|docx?|xlsx?)$/i;
const SKIP_PATHS = /\/(wp-admin|wp-json|cart|checkout|account|login|signin|signup|register|search|tag|feed|cdn-cgi)(\/|$)/i;

async function sitemapUrls(doFetch: typeof fetch, base: string): Promise<string[]> {
  const origin = new URL(base).origin;
  const robots = await (await get(doFetch, `${origin}/robots.txt`, 5000))?.text().catch(() => '');
  const listed = [...(robots ?? '').matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!);
  const queue = listed.length ? listed : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seen = new Set<string>();
  const pages: string[] = [];

  while (queue.length && seen.size < 12) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const xml = await (await get(doFetch, next, 8000))?.text().catch(() => '');
    if (!xml) continue;
    const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)].map((m) => m[1]!.replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(xml)) queue.push(...locs);
    else pages.push(...locs);
  }
  return pages;
}

function linksIn(html: string, base: string): string[] {
  const root = parse(html, { comment: false });
  return root
    .querySelectorAll('a[href]')
    .map((a) => absolute(a.getAttribute('href'), base))
    .filter((u): u is string => u !== null);
}

/**
 * Crawl up to `maxPages` pages of the site, sitemap first, links second.
 * Shallow pages come first: `/pricing` matters more than `/blog/2019/…`.
 */
export async function crawlSite(
  input: string,
  options: { maxPages: number; include?: string[]; exclude?: string[]; fetch?: typeof fetch; onPage?: (url: string) => void },
): Promise<CrawledPage[]> {
  const doFetch = options.fetch ?? fetch;
  const start = normalizeUrl(input);
  const allowed = (url: string) => {
    if (!sameSite(url, start)) return false;
    const path = new URL(url).pathname;
    if (SKIP_EXTENSIONS.test(path) || SKIP_PATHS.test(path)) return false;
    if (options.include?.length && !options.include.some((part) => url.includes(part))) return false;
    if (options.exclude?.some((part) => url.includes(part))) return false;
    return true;
  };
  const depth = (url: string) => new URL(url).pathname.split('/').filter(Boolean).length;

  const fromSitemap = (await sitemapUrls(doFetch, start)).filter(allowed).map(canonical);
  const candidates = [...new Set([canonical(start), ...fromSitemap])].sort((a, b) => depth(a) - depth(b));

  const pages: CrawledPage[] = [];
  const visited = new Set<string>();
  const queue = [...candidates];
  const useLinks = fromSitemap.length === 0;

  while (queue.length && pages.length < options.maxPages) {
    const batch = queue.splice(0, 4).filter((url) => !visited.has(url));
    batch.forEach((url) => visited.add(url));
    const results = await Promise.all(
      batch.map(async (url) => {
        const response = await get(doFetch, url);
        if (!response || !(response.headers.get('content-type') ?? 'text/html').includes('html')) return null;
        const html = await response.text().catch(() => '');
        return { url, html };
      }),
    );
    for (const result of results) {
      if (!result || pages.length >= options.maxPages) continue;
      const page = htmlToPage(result.html, result.url);
      if (page.markdown.length >= 200) {
        pages.push(page);
        options.onPage?.(result.url);
      }
      if (useLinks && depth(result.url) < 2) {
        const found = linksIn(result.html, result.url).filter(allowed).map(canonical);
        for (const link of found) if (!visited.has(link) && !queue.includes(link)) queue.push(link);
        queue.sort((a, b) => depth(a) - depth(b));
      }
    }
  }
  return pages;
}

const DROP = 'script,style,noscript,svg,iframe,template,nav,footer,header,form,aside,button,select,[aria-hidden="true"],[hidden]';
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'FIGURE', 'DL', 'PRE']);

/** A page as Markdown: headings, paragraphs, lists, links and table rows. Chrome is dropped. */
export function htmlToPage(html: string, url: string): CrawledPage {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const title =
    (meta(root, 'og:title') ?? root.querySelector('title')?.text ?? root.querySelector('h1')?.text ?? url)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  for (const node of root.querySelectorAll(DROP)) node.remove();
  const main =
    root.querySelector('main') ?? root.querySelector('[role="main"]') ?? root.querySelector('article') ?? root.querySelector('body') ?? root;

  const lines: string[] = [];
  let current = '';
  const flush = () => {
    const text = current.replace(/[ \t\u00a0]+/g, ' ').trim();
    if (text) lines.push(text);
    current = '';
  };

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      current += node.text;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      flush();
      current = `${'#'.repeat(Number(tag[1]))} ${el.text.replace(/\s+/g, ' ').trim()}`;
      flush();
      return;
    }
    if (tag === 'LI') {
      flush();
      current = '- ';
      el.childNodes.forEach(walk);
      flush();
      return;
    }
    if (tag === 'TR') {
      flush();
      current = el.querySelectorAll('th,td').map((cell) => cell.text.replace(/\s+/g, ' ').trim()).join(' | ');
      flush();
      return;
    }
    if (tag === 'BR') {
      flush();
      return;
    }
    if (tag === 'A') {
      const text = el.text.replace(/\s+/g, ' ').trim();
      const href = absolute(el.getAttribute('href'), url);
      current += href && text && !href.startsWith(`${url}#`) ? `[${text}](${href})` : text;
      return;
    }
    if (tag === 'IMG') {
      const alt = el.getAttribute('alt')?.trim();
      if (alt) current += ` ${alt} `;
      return;
    }
    const block = BLOCK.has(tag);
    if (block) flush();
    el.childNodes.forEach(walk);
    if (block) flush();
  };
  main.childNodes.forEach(walk);
  flush();

  const deduped = lines.filter((line, index) => index === 0 || line !== lines[index - 1]);
  const body = deduped.join('\n\n').slice(0, 100_000);
  return { url, title, markdown: `# ${title}\n\nSource: ${url}\n\n${body}\n` };
}

/**
 * A flat file name for a crawled page: `site__acme.com__pricing.md`. The
 * `site__` prefix marks it as ours, so a re-sync can remove pages that
 * disappeared without touching anything else in a shared index.
 */
export const PAGE_PREFIX = 'site__';

export function pageFileName(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'index';
  const name = `${PAGE_PREFIX}${parsed.hostname.replace(/^www\./, '')}__${path}`;
  return `${name.slice(0, 120)}.md`;
}
