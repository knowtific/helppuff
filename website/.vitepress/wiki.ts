import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The docs are the wiki. `wiki/` is the only copy of every page: the GitHub
 * wiki publishes it as it is, and the website renders the same files through
 * this module, so the two can never disagree.
 *
 * `syncDocs` writes the translated pages to `website/docs/` (gitignored) when
 * the site is built or served, and again whenever a wiki page changes. They
 * are real files rather than dynamic routes because the built-in search
 * indexes only files on disk.
 *
 * GitHub-wiki Markdown differs from VitePress's in three ways, translated
 * here rather than in the pages:
 * - `[[Text|Page#anchor]]` links become ordinary links under `/docs/`;
 * - `_Sidebar.md` becomes the sidebar;
 * - VitePress compiles Markdown as a Vue template, so a `<placeholder>` or
 *   `{{` in prose (fine on GitHub) is escaped. Code is left alone;
 * - code blocks between `<!-- tabs -->` and `<!-- /tabs -->` (invisible on
 *   GitHub, where they show one after the other) become a code group: tabs
 *   titled by each block's `[title]` (the API reference's curl / TypeScript).
 */

export const WIKI_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../wiki');
export const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../docs');

/** Every page, by file name without `.md`: `Getting-Started`, `Home`… */
export function wikiPages(): string[] {
  return readdirSync(WIKI_DIR)
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .map((name) => name.slice(0, -3))
    .sort();
}

/** The file a page becomes under `docs/`: the wiki's `Home` is the docs index. */
export const routeFor = (page: string) => (page === 'Home' ? 'index' : page);

/** A page's site URL, without the base. */
export function linkFor(target: string): string {
  const [page = '', anchor] = target.trim().split('#');
  const path = page === 'Home' || page === '' ? '/docs/' : `/docs/${page.replace(/ /g, '-')}`;
  return anchor ? `${path}#${anchor}` : path;
}

/** `[[Text|Page]]` or `[[Page]]` → `[Text](/docs/Page)`. */
const wikiLinks = (text: string) =>
  text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, first: string, second?: string) => {
    const label = second ? first : first.split('#')[0]!.replace(/-/g, ' ');
    return `[${label}](${linkFor(second ?? first)})`;
  });

/** Real HTML a wiki page may use; any other `<word>` in prose is a placeholder like `<worker>`. */
const HTML_TAGS = 'a|b|br|details|div|em|i|img|kbd|p|picture|source|span|strong|sub|summary|sup';
const PLACEHOLDER = new RegExp(`<(?!/?(?:${HTML_TAGS})\\b[^>]*>)(?!(?:https?:|mailto:)[^>\\s]*>)(?=[A-Za-z/])`, 'g');

/** What Vue would otherwise read as a tag or an interpolation. Autolinks (`<https://…>`) stay. */
const escapeProse = (text: string) =>
  text
    .replace(PLACEHOLDER, '&lt;')
    .replace(/\{\{/g, '&#123;&#123;')
    .replace(/\}\}/g, '&#125;&#125;');

/** One page, as VitePress reads it. */
export const renderPage = (page: string): string => translate(readFileSync(join(WIKI_DIR, `${page}.md`), 'utf8'));

/**
 * Translate wiki Markdown. Links first, over the whole page, because a link's
 * label may hold code (`[[`http` backend|Provider-Your-Own-API]]`); then the
 * escaping, which skips fenced and inline code.
 */
export function translate(markdown: string): string {
  const source = wikiLinks(markdown).replace(/^<!-- tabs -->$/gm, '::: code-group').replace(/^<!-- \/tabs -->$/gm, ':::');
  const pieces: string[] = [];
  const code = /^```[^\n]*\n[\s\S]*?^```[^\n]*$|`[^`\n]+`/gm;
  let last = 0;
  for (const match of source.matchAll(code)) {
    pieces.push(escapeProse(source.slice(last, match.index)), match[0]);
    last = match.index + match[0].length;
  }
  pieces.push(escapeProse(source.slice(last)));
  return pieces.join('');
}

export type SidebarGroup = { text: string; collapsed?: boolean; items: { text: string; link: string }[] };

/** `_Sidebar.md`: `**Group**` headings, each followed by a list of wiki links. */
export function wikiSidebar(): SidebarGroup[] {
  const groups: SidebarGroup[] = [];
  for (const line of readFileSync(join(WIKI_DIR, '_Sidebar.md'), 'utf8').split('\n')) {
    const heading = /^\*\*([^*[]+)\*\*\s*$/.exec(line.trim());
    if (heading) {
      groups.push({ text: heading[1]!, items: [] });
      continue;
    }
    const item = /^-\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(line.trim());
    if (item && groups.length) {
      const [, first, second] = item;
      groups[groups.length - 1]!.items.push({ text: second ? first! : first!.replace(/-/g, ' '), link: linkFor(second ?? first!) });
    }
  }
  return groups;
}

/** Write every wiki page to `docs/`, replacing what was there. */
export function syncDocs(): void {
  rmSync(DOCS_DIR, { recursive: true, force: true });
  mkdirSync(DOCS_DIR, { recursive: true });
  for (const page of wikiPages()) {
    const notice = `<!-- Generated from wiki/${page}.md: edit that file, not this one. -->\n\n`;
    writeFileSync(join(DOCS_DIR, `${routeFor(page)}.md`), notice + renderPage(page));
  }
}
