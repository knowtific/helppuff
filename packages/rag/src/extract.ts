import { parse, type HTMLElement, type Node } from 'node-html-parser';
import { canonicalUrl } from './url.js';

/**
 * One fetched page → what the knowledge base keeps: the main content
 * as Markdown with its structure intact (headings, lists, tables), plus the
 * facts and links found around it.
 *
 * Chrome is dropped by element (nav, header, footer, aside, forms, cookie
 * banners, modals); what is left of the site-wide furniture is caught later
 * by the cross-page filter in `boilerplate.ts`.
 */

export type Fact = { key: FactKey; value: string };
export type FactKey = 'name' | 'phone' | 'email' | 'address' | 'hours' | 'serviceAreas' | 'priceRange' | 'description';

export type ExtractedPage = {
  url: string;
  title: string;
  h1: string | null;
  description: string | null;
  lang: string | null;
  /** The main content as Markdown. Headings start at whatever level the page used. */
  markdown: string;
  /** Every http(s) link on the page, canonical, before chrome was removed (for discovery). */
  links: string[];
  facts: Fact[];
  /** Characters of readable text in the main content. */
  textLength: number;
  /** Little text and several scripts: the content is probably drawn by JavaScript. */
  looksRendered: boolean;
  themeColor: string | null;
};

const DROP = [
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'iframe',
  'template',
  'object',
  'video',
  'audio',
  'map',
  'nav',
  'aside',
  'form',
  'select',
  'input',
  'textarea',
  'dialog',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[aria-hidden="true"]',
  '[hidden]',
].join(',');

/** Cookie banners, consent managers, popups: matched loosely, so never allowed to take the page with them. */
const NOISE = '[class*="cookie"],[id*="cookie"],[class*="consent"],[id*="consent"],[class*="gdpr"],[class*="newsletter-popup"],[class*="modal"],[id*="modal"],[class*="popup"],[class*="skip-link"],[class*="screen-reader"],[class*="sr-only"],[class*="visually-hidden"]';
const NEVER_NOISE = new Set(['HTML', 'BODY', 'MAIN', 'ARTICLE']);

const BLOCK = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'UL', 'OL', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'DL', 'ADDRESS', 'DETAILS', 'CENTER', 'HR',
]);

const clean = (text: string) => text.replace(/[\s\u00a0\u200b]+/g, ' ').trim();

function meta(root: HTMLElement, key: string): string | null {
  const node = root.querySelector(`meta[property="${key}"]`) ?? root.querySelector(`meta[name="${key}"]`);
  const value = node?.getAttribute('content')?.trim();
  return value || null;
}

function absolute(href: string | undefined, base: string): string | null {
  if (!href || /^(javascript|data|tel|mailto|sms):/i.test(href.trim())) return null;
  return canonicalUrl(href.trim(), base);
}

export function extractPage(html: string, url: string): ExtractedPage {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: false, noscript: false, pre: true } });

  const facts = [...jsonLdFacts(root), ...linkFacts(root)];
  const faqs = jsonLdFaqs(root);
  const description = meta(root, 'description') ?? meta(root, 'og:description');
  if (description) facts.push({ key: 'description', value: description.slice(0, 500) });
  const scripts = root.querySelectorAll('script').length;
  const links = [
    ...new Set(
      root
        .querySelectorAll('a[href]')
        .map((a) => absolute(a.getAttribute('href'), url))
        .filter((u): u is string => u !== null),
    ),
  ];

  const rawTitle = clean(meta(root, 'og:title') ?? root.querySelector('title')?.text ?? '');
  const h1 = clean(root.querySelector('h1')?.text ?? '') || null;
  const title = (rawTitle || h1 || url).slice(0, 200);
  const lang = root.querySelector('html')?.getAttribute('lang')?.trim() || null;
  const themeColor = meta(root, 'theme-color');

  for (const node of root.querySelectorAll(DROP)) node.remove();
  // A page's own <header> often holds its H1; only the site-wide ones go.
  for (const node of root.querySelectorAll('header,footer')) if (!node.closest('main,article,[role="main"]')) node.remove();
  for (const node of root.querySelectorAll(NOISE)) {
    if (!NEVER_NOISE.has(node.tagName) && !node.querySelector('main,article,h1')) node.remove();
  }
  const main =
    root.querySelector('main') ??
    root.querySelector('[role="main"]') ??
    root.querySelector('article') ??
    root.querySelector('body') ??
    root;

  let markdown = toMarkdown(main, url);
  if (faqs.length) {
    // FAQ structured data often sits behind accordions the HTML does not
    // show; add the pairs the page text does not already contain.
    const missing = faqs.filter((f) => !markdown.includes(f.q.slice(0, 40)));
    if (missing.length) {
      markdown += `\n\n## Frequently asked questions\n\n${missing.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n')}`;
    }
  }
  const textLength = markdown.replace(/[#*|>`_-]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim().length;

  return {
    url,
    title,
    h1,
    description,
    lang,
    markdown,
    links,
    facts: dedupeFacts(facts),
    textLength,
    looksRendered: textLength < 300 && (scripts >= 2 || /id=["'](root|app|__next|__nuxt)["']/i.test(html)),
    themeColor,
  };
}

/** Main content → Markdown. Tables become pipe tables; a question in bold stays bold, for the FAQ chunker. */
function toMarkdown(main: HTMLElement, url: string): string {
  const blocks: string[] = [];
  let current = '';
  const flush = () => {
    // Keep a nested list item's indentation; collapse every other run of space.
    const indent = /^( +)- /.exec(current)?.[1] ?? '';
    const text = current.replace(/[ \t\u00a0\u200b]+/g, ' ').trim();
    if (text && text !== '-' && text !== '**') blocks.push(`${indent}${text}`);
    current = '';
  };

  const inline = (el: HTMLElement): string => {
    let out = '';
    for (const child of el.childNodes) {
      if (child.nodeType === 3) out += child.text;
      else if (child.nodeType === 1) {
        const c = child as HTMLElement;
        if (c.tagName === 'BR') out += ' ';
        else if (c.tagName === 'A') out += link(c);
        else out += inline(c);
      }
    }
    return out;
  };

  const link = (el: HTMLElement): string => {
    const text = clean(el.text);
    const href = absolute(el.getAttribute('href'), url);
    if (!text) return '';
    if (!href || href.split('#')[0] === url.split('#')[0]) return text;
    return `[${text.replace(/[[\]]/g, '')}](${href})`;
  };

  const table = (el: HTMLElement) => {
    const rows = el
      .querySelectorAll('tr')
      .map((tr) => tr.querySelectorAll('th,td').map((cell) => clean(inline(cell)).replace(/\|/g, '/')))
      .filter((cells) => cells.some(Boolean));
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (cells: string[]) => [...cells, ...Array<string>(width - cells.length).fill('')];
    const lines = [`| ${pad(rows[0]!).join(' | ')} |`, `|${' --- |'.repeat(width)}`, ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`)];
    blocks.push(lines.join('\n'));
  };

  const walk = (node: Node, listDepth: number) => {
    if (node.nodeType === 3) {
      current += node.text;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      flush();
      const text = clean(inline(el));
      if (text) blocks.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
      return;
    }
    switch (tag) {
      case 'LI': {
        flush();
        const nested = el.querySelectorAll('ul,ol');
        for (const n of nested) n.remove();
        current = `${'  '.repeat(listDepth)}- `;
        el.childNodes.forEach((c) => walk(c, listDepth));
        flush();
        for (const n of nested) walk(n, listDepth + 1);
        return;
      }
      case 'TABLE':
        flush();
        table(el);
        return;
      case 'BR':
        flush();
        return;
      case 'A':
        current += link(el);
        return;
      case 'IMG': {
        const alt = el.getAttribute('alt')?.trim();
        if (alt && alt.length > 3) current += ` ${alt} `;
        return;
      }
      case 'PRE':
        flush();
        blocks.push(`\`\`\`\n${el.text.trim()}\n\`\`\``);
        return;
      case 'STRONG':
      case 'B':
      case 'DT':
      case 'SUMMARY':
      case 'BUTTON': {
        const text = clean(inline(el));
        // Accordion and definition-list questions become bold paragraphs
        // the FAQ chunker can pair with their answers. Other buttons are UI.
        if (/\?$/.test(text)) {
          flush();
          blocks.push(`**${text}**`);
        } else if (tag !== 'BUTTON') {
          if (tag === 'DT' || tag === 'SUMMARY') flush();
          current += text;
          if (tag === 'DT' || tag === 'SUMMARY') flush();
        }
        return;
      }
      default: {
        const block = BLOCK.has(tag) || tag === 'DD';
        if (block) flush();
        el.childNodes.forEach((c) => walk(c, tag === 'UL' || tag === 'OL' ? listDepth : listDepth));
        if (block) flush();
      }
    }
  };

  main.childNodes.forEach((c) => walk(c, 0));
  flush();
  return blocks.filter((block, i) => i === 0 || block !== blocks[i - 1]).join('\n\n').slice(0, 200_000);
}

// ---------------------------------------------------------------- facts

type Json = Record<string, unknown>;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? clean(value) : null);

function jsonLdNodes(root: HTMLElement): Json[] {
  const nodes: Json[] = [];
  const visit = (value: unknown) => {
    for (const item of asArray(value)) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Json;
      nodes.push(obj);
      if (obj['@graph']) visit(obj['@graph']);
    }
  };
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.text.trim()));
    } catch {
      // Broken JSON-LD is common; it only costs us a fact.
    }
  }
  return nodes;
}

const types = (node: Json) => asArray(node['@type']).map(String);
const BUSINESS = /Organization|Business|Store|Restaurant|Dentist|Physician|Clinic|MedicalBusiness|Service|Contractor|Plumber|Electrician|Locksmith|Agent|Attorney|Hotel|Practice|Office|Center|Centre|Shop/i;

function address(value: unknown): string | null {
  if (typeof value === 'string') return str(value);
  if (!value || typeof value !== 'object') return null;
  const a = value as Json;
  const parts = [a['streetAddress'], a['addressLocality'], a['addressRegion'], a['postalCode']].map(str).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function hours(node: Json): string[] {
  const out: string[] = [];
  for (const spec of asArray(node['openingHours'])) if (typeof spec === 'string') out.push(clean(spec));
  for (const spec of asArray(node['openingHoursSpecification'])) {
    if (!spec || typeof spec !== 'object') continue;
    const s = spec as Json;
    const days = asArray(s['dayOfWeek'])
      .map((d) => String(d).replace(/^https?:\/\/schema\.org\//, ''))
      .join(', ');
    const opens = str(s['opens']);
    const closes = str(s['closes']);
    if (days && opens && closes) out.push(`${days}: ${opens.slice(0, 5)}–${closes.slice(0, 5)}`);
  }
  return out;
}

function areas(value: unknown): string[] {
  return asArray(value)
    .map((a) => (typeof a === 'string' ? a : a && typeof a === 'object' ? str((a as Json)['name']) : null))
    .filter((a): a is string => Boolean(a));
}

function jsonLdFacts(root: HTMLElement): Fact[] {
  const facts: Fact[] = [];
  for (const node of jsonLdNodes(root)) {
    if (!types(node).some((t) => BUSINESS.test(t))) continue;
    const push = (key: FactKey, value: string | null) => value && facts.push({ key, value: value.slice(0, 500) });
    push('name', str(node['name']));
    push('phone', str(node['telephone']));
    push('email', str(node['email'])?.replace(/^mailto:/i, '') ?? null);
    push('address', address(node['address']));
    const h = hours(node);
    if (h.length) push('hours', h.join('; '));
    const served = areas(node['areaServed']);
    if (served.length) push('serviceAreas', served.join(', '));
    push('priceRange', str(node['priceRange']));
  }
  return facts;
}

function jsonLdFaqs(root: HTMLElement): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  for (const node of jsonLdNodes(root)) {
    if (!types(node).includes('FAQPage')) continue;
    for (const entity of asArray(node['mainEntity'])) {
      if (!entity || typeof entity !== 'object') continue;
      const q = str((entity as Json)['name']);
      const answer = (entity as Json)['acceptedAnswer'];
      const a = str(answer && typeof answer === 'object' ? (asArray(answer)[0] as Json)?.['text'] : null);
      if (q && a) out.push({ q, a: a.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
    }
  }
  return out;
}

function linkFacts(root: HTMLElement): Fact[] {
  const facts: Fact[] = [];
  for (const a of root.querySelectorAll('a[href^="tel:"],a[href^="mailto:"]')) {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('tel:')) {
      const phone = decodeSafe(href.slice(4)).replace(/[^\d+() -]/g, '').trim();
      // The site's own formatting ("03 9876 5432") reads better than the href; only the number, never "Call us on".
      const shown = /\+?\d[\d\s().-]{5,}\d/.exec(clean(a.text))?.[0];
      if (phone.replace(/\D/g, '').length >= 6) facts.push({ key: 'phone', value: shown && shown.replace(/\D/g, '').length >= 6 ? shown : phone });
    } else {
      const email = decodeSafe(href.slice(7).split('?')[0] ?? '').trim();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) facts.push({ key: 'email', value: email });
    }
  }
  return facts;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function dedupeFacts(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const key = `${f.key}:${f.value.toLowerCase().replace(/\s+/g, '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Merge facts from many pages into one value per key. Structured data and
 * the first page that states a fact win; phones and emails keep up to three
 * distinct values, since businesses often list a mobile and a landline.
 */
export function mergeFacts(perPage: { url: string; facts: Fact[] }[]): { key: FactKey; value: string; sourceUrl: string }[] {
  const multi: FactKey[] = ['phone', 'email'];
  const collected = new Map<FactKey, { values: string[]; sourceUrl: string }>();
  for (const page of perPage) {
    for (const fact of page.facts) {
      if (fact.key === 'description' && collected.has('description')) continue;
      const entry = collected.get(fact.key);
      if (!entry) collected.set(fact.key, { values: [fact.value], sourceUrl: page.url });
      else if (multi.includes(fact.key) && entry.values.length < 3) {
        const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9@.+]/g, '');
        if (!entry.values.some((v) => norm(v) === norm(fact.value))) entry.values.push(fact.value);
      }
    }
  }
  return [...collected].map(([key, entry]) => ({ key, value: entry.values.join(', '), sourceUrl: entry.sourceUrl }));
}
