import { isSafeUrl } from '@murmur/protocol';

/**
 * The markdown subset from §4.4: paragraphs, line breaks, bold, italic, inline
 * code, links and `-` bullets. No headings, images, HTML or tables.
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

/**
 * Inline spans, applied to already-escaped text. Code is extracted first so
 * its contents are never treated as markup.
 */
function renderInline(escaped: string): string {
  const code: string[] = [];

  let out = escaped.replace(/`([^`]+)`/g, (_match, content: string) => {
    code.push(content);
    return `${SENTINEL}${code.length - 1}${SENTINEL}`;
  });

  out = out.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    // `href` is escaped text; unescape only to validate the scheme, never to emit.
    const candidate = href.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    if (!isSafeUrl(candidate)) return match;
    const text = label.trim() ? label : href;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
  });

  // Bold before italic, so `**x**` is not read as two italics.
  out = out.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>');

  return out.replace(
    new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'),
    (_match, index: string) => `<code>${code[Number(index)] ?? ''}</code>`,
  );
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
