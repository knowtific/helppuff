import { isSafeUrl } from '@murmur/protocol';

/**
 * The markdown subset of the protocol: paragraphs, line breaks, bold, italic, inline
 * code, links and `-` bullets. No headings, images, HTML or tables. Urls,
 * emails and phone numbers written as plain text are linked too.
 *
 * The output is the only HTML the widget ever injects. It is built from text
 * that has already been entity-escaped, so a tag can only appear where this
 * module put one. Nothing here ever passes input through unescaped.
 */

/** Placeholders use a control character, which is stripped from input first. */
const SENTINEL = '\u0000';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const anchor = (href: string, text: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;

/** Undo the escaping, only ever to validate a url — never to emit it. */
const unescapeForCheck = (escaped: string) =>
  escaped.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

const emphasis = (text: string) =>
  // Bold before italic, so `**x**` is not read as two italics.
  text
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>');

/**
 * Things worth linking that an agent writes as plain text — a voice agent
 * says "visit knowtific.com.au/pricing", not `[pricing](…)`. Each needs the
 * character before it to not be part of a word, address or path, so a domain
 * inside an email or a url is not linked a second time.
 *
 * Bare domains are limited to common endings: without that, every
 * "Node.js" or "e.g." would become a link.
 */
const AUTOLINK = new RegExp(
  [
    // Not after `:` either, so `blob:https://…` does not yield an inner url.
    '(^|[^\\w@/.:\\-])(?:',
    // 1: an explicit url, or one starting www.
    '((?:https?:\\/\\/|www\\.)[^\\s]+)',
    // 2: an email address
    '|([\\w.%+\\-]+@[a-z0-9\\-]+(?:\\.[a-z0-9\\-]+)*\\.[a-z]{2,})',
    // 3: a bare domain with a familiar ending, and an optional path
    '|((?:[a-z0-9](?:[a-z0-9\\-]*[a-z0-9])?\\.)+(?:com|net|org|io|co|ai|app|dev|biz|info|au|nz|uk)(?:\\.(?:au|nz|uk))?(?![\\w\\-])(?:\\/[^\\s]*)?)',
    // 4: a phone number — international, or an Australian local format
    '|(\\+\\d{1,3}[\\s\\-]?(?:\\(0?\\d{1,4}\\)|\\d{1,4})(?:[\\s\\-]?\\d{2,4}){2,3}',
    '|\\(0\\d\\)[\\s\\-]?\\d{4}[\\s\\-]?\\d{4}',
    '|0[2-478][\\s\\-]?\\d{4}[\\s\\-]?\\d{4}',
    '|04\\d{2}[\\s\\-]?\\d{3}[\\s\\-]?\\d{3}',
    '|1[38]00[\\s\\-]?\\d{3}[\\s\\-]?\\d{3})(?!\\d)',
    ')',
  ].join(''),
  'gi',
);

/**
 * Where a url written in prose ends. The match is greedy up to whitespace,
 * so it gives back an escaped quote or angle bracket (`<https://…>`), and
 * trailing punctuation that belongs to the sentence — keeping a `)` only
 * when the url opened one, as Wikipedia links do.
 */
function trimUrl(raw: string): string {
  let url = raw;
  const entity = /&(?:lt|gt|quot|#39);/.exec(url);
  if (entity) url = url.slice(0, entity.index);
  // Counted once, not per character, so a run of `)` stays linear.
  let unopened = (url.match(/\)/g) ?? []).length - (url.match(/\(/g) ?? []).length;
  for (;;) {
    const last = url.slice(-1);
    if (/[.,:!?*_\]]/.test(last) || (last === ';' && !/&amp;$/.test(url))) {
      url = url.slice(0, -1);
    } else if (last === ')' && unopened > 0) {
      url = url.slice(0, -1);
      unopened -= 1;
    } else {
      return url;
    }
  }
}

/**
 * Link urls, emails and phone numbers found in escaped text. Each link is
 * handed to `stash`, which swaps it for a placeholder so nothing after this
 * can reach inside it.
 */
function autolink(escaped: string, stash: (html: string) => string): string {
  return escaped.replace(
    AUTOLINK,
    (match, before: string, url?: string, email?: string, domain?: string, phone?: string) => {
      if (phone) return before + stash(anchor(`tel:${phone.replace(/[^\d+]/g, '')}`, phone));

      if (email) {
        const href = `mailto:${email}`;
        return isSafeUrl(unescapeForCheck(href)) ? before + stash(anchor(href, email)) : match;
      }

      const raw = url ?? domain ?? '';
      const text = trimUrl(raw);
      if (!/[a-z0-9]\.[a-z]/i.test(text)) return match;
      const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      if (!isSafeUrl(unescapeForCheck(href))) return match;
      return before + stash(anchor(href, text)) + raw.slice(text.length);
    },
  );
}

/**
 * Inline spans, applied to already-escaped text. Code and links are set
 * aside as placeholders first, so a code span's contents are never treated
 * as markup, and neither emphasis nor the autolinker can reach inside a link.
 */
function renderInline(escaped: string): string {
  const held: string[] = [];
  const stash = (html: string) => {
    held.push(html);
    return `${SENTINEL}${held.length - 1}${SENTINEL}`;
  };

  let out = escaped.replace(/`([^`]+)`/g, (_match, content: string) => stash(`<code>${content}</code>`));

  out = out.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    if (!isSafeUrl(unescapeForCheck(href))) return match;
    return stash(anchor(href, label.trim() ? emphasis(label) : href));
  });

  out = emphasis(autolink(out, stash));

  return out.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'), (_match, index: string) => held[Number(index)] ?? '');
}

const isBullet = (line: string) => /^\s*[-*]\s+\S/.test(line);
const bulletText = (line: string) => line.replace(/^\s*[-*]\s+/, '');

/** Render the markdown subset to an HTML string safe to inject. */
export function renderMarkdown(input: string): string {
  if (typeof input !== 'string' || !input) return '';

  const escaped = escapeHtml(input.replace(/\0/g, '').replace(/\r\n?/g, '\n'));
  const blocks = escaped.split(/\n{2,}/);
  const html: string[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;

    if (lines.every(isBullet)) {
      const items = lines.map((line) => `<li>${renderInline(bulletText(line))}</li>`).join('');
      html.push(`<ul>${items}</ul>`);
      continue;
    }

    // A list that starts partway through a block still renders as a list.
    const firstBullet = lines.findIndex(isBullet);
    if (firstBullet > 0 && lines.slice(firstBullet).every(isBullet)) {
      html.push(`<p>${lines.slice(0, firstBullet).map(renderInline).join('<br>')}</p>`);
      const items = lines.slice(firstBullet).map((line) => `<li>${renderInline(bulletText(line))}</li>`);
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    html.push(`<p>${lines.map(renderInline).join('<br>')}</p>`);
  }

  return html.join('');
}

/** Plain-text fallback, for the unread preview and screen-reader summaries. */
export function stripMarkdown(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
