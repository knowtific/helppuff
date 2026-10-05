/**
 * URLs as the crawler sees them: one canonical spelling per page, so the
 * same page reached from a sitemap, a link and a tracking campaign is
 * crawled, stored and cited once.
 */

/** Query parameters that never change what a page says. */
const TRACKING = /^(utm_[a-z_]+|gclid|gbraid|wbraid|fbclid|msclkid|dclid|yclid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|hsctatracking|ref|ref_src|igshid|si)$/i;

const SKIP_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|json|xml|rss|atom|txt|zip|gz|rar|7z|mp4|m4v|webm|mov|avi|mp3|wav|ogg|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|csv|ics|vcf|apk|exe|dmg)$/i;
const SKIP_PATHS = /\/(wp-admin|wp-json|wp-login\.php|xmlrpc\.php|cart|basket|checkout|my-account|account|login|log-in|signin|sign-in|signup|sign-up|register|logout|search|feed|cdn-cgi|_next\/static)(\/|$)/i;

/** A page URL with no fragment, no tracking, a lowercase host and no trailing slash. Null when it is not http(s). */
export function canonicalUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(input, base) : new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.search = url.searchParams.size ? `?${url.searchParams.toString()}` : '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

/** Whether two URLs belong to the same site; `www.` and the apex are one site. */
export function sameSite(a: string, b: string): boolean {
  try {
    const host = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host(a) === host(b);
  } catch {
    return false;
  }
}

/** Not a page worth reading: a file, an asset, or a login/cart/search screen. */
export function isLikelyPage(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return !SKIP_EXTENSIONS.test(pathname) && !SKIP_PATHS.test(pathname);
  } catch {
    return false;
  }
}

/** Path depth: `/` is 0, `/services/hot-water` is 2. Shallow pages matter more. */
export function depth(url: string): number {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length;
  } catch {
    return 99;
  }
}

/**
 * A glob over the whole URL: `*` stays within one path segment, `**` crosses
 * segments, and a trailing `/**` also matches the folder page itself, so
 * `**\/faq/**` matches `/faq` and everything under it. A pattern with no
 * wildcard matches as a substring, which is what people usually mean by
 * "exclude privacy".
 */
export function globMatch(pattern: string, url: string): boolean {
  if (!/[*]/.test(pattern)) return url.toLowerCase().includes(pattern.toLowerCase());
  const escape = (piece: string) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  let source = pattern
    .split('**')
    .map((part) => part.split('*').map(escape).join('[^/]*'))
    .join('.*');
  if (source.endsWith('/.*')) source = `${source.slice(0, -3)}(?:/.*)?`;
  const prefix = source.startsWith('.*') ? '' : '.*';
  const suffix = source.endsWith('.*') || source.endsWith('(?:/.*)?') ? '' : '(?:[?#].*)?';
  return new RegExp(`^${prefix}${source}${suffix}$`, 'i').test(url);
}

/** Include/exclude filtering with globs. An empty include list includes everything. */
export function selectedBy(url: string, include: readonly string[] = [], exclude: readonly string[] = []): boolean {
  if (include.length && !include.some((p) => globMatch(p, url))) return false;
  return !exclude.some((p) => globMatch(p, url));
}
