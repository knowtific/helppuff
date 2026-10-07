import { describe, expect, it } from 'vitest';
import { renderPage, translate, wikiPages, wikiSidebar } from '../.vitepress/wiki';

/**
 * The website renders `wiki/` as it is. These pin the translation from
 * GitHub-wiki Markdown, and check the real pages still go through it.
 */
describe('wiki → website', () => {
  it('turns wiki links into docs links, with labels and anchors', () => {
    expect(translate('See [[Webhooks]] and [[Leads and callbacks|Leads#callbacks]].')).toBe(
      'See [Webhooks](/docs/Webhooks) and [Leads and callbacks](/docs/Leads#callbacks).',
    );
    expect(translate('[[Getting-Started]] or [[Home]]')).toBe('[Getting Started](/docs/Getting-Started) or [Home](/docs/)');
  });

  it('escapes placeholders and interpolation in prose, not in code', () => {
    const page = 'Open https://<your worker>/ and say {{name}}.\n\n`<worker>` and `{{name}}`\n\n```html\n<script src="x"></script>\n```\n';
    expect(translate(page)).toBe(
      'Open https://&lt;your worker>/ and say &#123;&#123;name&#125;&#125;.\n\n`<worker>` and `{{name}}`\n\n```html\n<script src="x"></script>\n```\n',
    );
  });

  it('keeps real HTML and autolinks', () => {
    expect(translate('<details><summary>More</summary>text</details> <https://example.com>')).toBe(
      '<details><summary>More</summary>text</details> <https://example.com>',
    );
  });

  it('builds the sidebar from _Sidebar.md, linking only to pages that exist', () => {
    const pages = new Set(wikiPages());
    const groups = wikiSidebar();
    expect(groups.map((g) => g.text)).toContain('Providers');
    for (const item of groups.flatMap((g) => g.items)) {
      const page = item.link.replace('/docs/', '').split('#')[0]!;
      expect(pages.has(page || 'Home'), item.link).toBe(true);
    }
  });

  it('leaves no wiki link and no stray interpolation in any page', () => {
    for (const page of wikiPages()) {
      const out = renderPage(page).replace(/```[\s\S]*?```|`[^`\n]+`/g, '');
      expect(out, page).not.toMatch(/\[\[|\{\{/);
    }
  });
});
