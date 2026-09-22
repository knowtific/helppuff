import { describe, expect, it } from 'vitest';
import { renderMarkdown, stripMarkdown } from '../src/lib/markdown.js';

describe('renderMarkdown — the supported subset', () => {
  it('wraps a paragraph', () => {
    expect(renderMarkdown('Hello there')).toBe('<p>Hello there</p>');
  });

  it('joins lines in a block with breaks and splits blocks into paragraphs', () => {
    expect(renderMarkdown('One\nTwo\n\nThree')).toBe('<p>One<br>Two</p><p>Three</p>');
  });

  it('renders bold, italic and code', () => {
    expect(renderMarkdown('**b** and *i* and `c`')).toBe(
      '<p><strong>b</strong> and <em>i</em> and <code>c</code></p>',
    );
  });

  it('does not read **x** as two italics', () => {
    expect(renderMarkdown('**both**')).toBe('<p><strong>both</strong></p>');
  });

  it('renders a bullet list', () => {
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('renders text followed by a list', () => {
    expect(renderMarkdown('We offer:\n- one\n- two')).toBe(
      '<p>We offer:</p><ul><li>one</li><li>two</li></ul>',
    );
  });

  it('renders a safe link with the required rel', () => {
    expect(renderMarkdown('[docs](https://example.com)')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">docs</a></p>',
    );
  });

  it.each(['mailto:a@b.co', 'tel:+61400000000', 'http://example.com'])('allows the %s scheme', (url) => {
    expect(renderMarkdown(`[x](${url})`)).toContain(`href="${url}"`);
  });

  it('normalises CRLF', () => {
    expect(renderMarkdown('a\r\nb')).toBe('<p>a<br>b</p>');
  });

  it('returns nothing for empty or non-string input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(undefined as unknown as string)).toBe('');
    expect(renderMarkdown(42 as unknown as string)).toBe('');
  });
});

describe('renderMarkdown — XSS', () => {
  const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'code', 'ul', 'li', 'a']);

  /**
   * Escaped text may legitimately contain the characters of an attack (a
   * visitor can ask "what does <script> mean?"), so substring matching proves
   * nothing. What matters is the markup that actually results: only
   * allowlisted tags, no event handlers inside a real tag, and no `<a>` whose
   * href carries an unsafe scheme.
   */
  const noScript = (html: string) => {
    for (const tag of html.match(/<[^>]*>/g) ?? []) {
      const name = /^<\/?([a-z0-9]+)/i.exec(tag)?.[1]?.toLowerCase();
      expect(name, `unexpected markup: ${tag}`).toBeDefined();
      expect(ALLOWED_TAGS.has(name as string), `tag not allowlisted: ${tag}`).toBe(true);
      expect(tag, `event handler in: ${tag}`).not.toMatch(/\son\w+\s*=/i);
      if (name === 'a' && !tag.startsWith('</')) {
        const href = /href="([^"]*)"/.exec(tag)?.[1] ?? '';
        expect(href, `unsafe href in: ${tag}`).toMatch(/^(https?:|mailto:|tel:)/i);
      }
    }
  };

  it.each([
    ['a script tag', '<script>alert(1)</script>'],
    ['an img onerror', '<img src=x onerror=alert(1)>'],
    ['an svg onload', '<svg onload=alert(1)>'],
    ['an iframe', '<iframe src="https://evil.example"></iframe>'],
    ['a closing tag injection', '</p><script>alert(1)</script><p>'],
    ['an attribute break-out', '" onmouseover="alert(1)'],
    ['a single-quote break-out', "' onmouseover='alert(1)"],
    ['an encoded script', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['a style tag', '<style>body{display:none}</style>'],
    ['an html comment', '<!-- -->'],
  ])('neutralises %s', (_name, input) => {
    noScript(renderMarkdown(input));
  });

  it.each([
    ['javascript:', '[x](javascript:alert(1))'],
    ['uppercase JavaScript:', '[x](JavaScript:alert(1))'],
    ['data:', '[x](data:text/html,<script>alert(1)</script>)'],
    ['vbscript:', '[x](vbscript:msgbox)'],
    ['a relative path', '[x](/admin)'],
    ['a protocol-relative url', '[x](//evil.example)'],
    ['a blob url', '[x](blob:https://a.co/x)'],
    ['a file url', '[x](file:///etc/passwd)'],
  ])('refuses to link %s and leaves it as text', (_name, input) => {
    const html = renderMarkdown(input);
    expect(html).not.toContain('<a ');
    noScript(html);
  });

  it('escapes a javascript: url that survives as plain text', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
  });

  it('does not let a link label carry markup', () => {
    const html = renderMarkdown('[<script>alert(1)</script>](https://example.com)');
    noScript(html);
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not let code spans smuggle tags', () => {
    const html = renderMarkdown('`<script>alert(1)</script>`');
    noScript(html);
    expect(html).toBe('<p><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></p>');
  });

  it('does not let a url carry a quote break-out', () => {
    const html = renderMarkdown('[x](https://a.co" onload="alert(1))');
    noScript(html);
  });

  it('strips the placeholder sentinel from input so it cannot forge a code span', () => {
    const html = renderMarkdown('\u00000\u0000 `real`');
    expect(html).toBe('<p>0 <code>real</code></p>');
  });

  it('handles nested brackets without producing a tag', () => {
    noScript(renderMarkdown('[[x]](https://a.co)'));
  });

  it('survives a long adversarial string without hanging', () => {
    const input = `${'['.repeat(500)}x${']('.repeat(500)}https://a.co)`;
    expect(() => renderMarkdown(input)).not.toThrow();
  });
});

describe('stripMarkdown', () => {
  it('reduces markup to plain text for previews', () => {
    expect(stripMarkdown('**Bold** and [a link](https://a.co) and `code`')).toBe(
      'Bold and a link and code',
    );
  });

  it('collapses whitespace and bullets', () => {
    expect(stripMarkdown('- one\n- two')).toBe('one two');
  });

  it('tolerates non-string input', () => {
    expect(stripMarkdown(null as unknown as string)).toBe('');
  });
});
