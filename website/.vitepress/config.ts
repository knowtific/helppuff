import { defineConfig } from 'vitepress';
import { WIKI_DIR, syncDocs, wikiSidebar } from './wiki';

/**
 * The HelpPuff website: a landing page, the docs (rendered from `wiki/`, see
 * `wiki.ts`) and the widget playground, published to GitHub Pages by
 * `.github/workflows/website.yml`.
 */

const REPO = 'https://github.com/knowtific/helppuff';
const BASE = '/helppuff/';
const SITE = `https://knowtific.github.io${BASE}`;
const DESCRIPTION =
  'An open-source AI chat assistant for your website: it learns your content, answers visitors, captures leads and gives you a CRM, all in your own Cloudflare account, on the free plan.';

// The docs pages are the wiki's, written to docs/ before anything reads them.
syncDocs();

export default defineConfig({
  title: 'HelpPuff',
  titleTemplate: ':title · HelpPuff',
  description: DESCRIPTION,
  base: BASE,
  cleanUrls: true,
  // Contributing links to the local dev servers on purpose.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  lang: 'en',
  srcExclude: ['scripts/**', 'README.md'],

  vite: {
    plugins: [
      {
        // Edit a wiki page and the dev server shows it.
        name: 'helppuff-wiki',
        configureServer(server) {
          server.watcher.add(WIKI_DIR);
          server.watcher.on('all', (_event, file) => {
            if (file.startsWith(WIKI_DIR)) syncDocs();
          });
        },
      },
    ],
  },

  markdown: {
    config(md) {
      // Pages are compiled as Vue templates, and the docs show template
      // placeholders like `{{business.name}}` in inline code. Code blocks are
      // already exempt; make inline code exempt too.
      const inline = md.renderer.rules.code_inline!;
      md.renderer.rules.code_inline = (tokens, idx, options, env, self) =>
        inline(tokens, idx, options, env, self).replace(/^<code/, '<code v-pre');
    },
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#5B5BF7' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'HelpPuff: your website’s AI assistant, owned by you' }],
    ['meta', { property: 'og:description', content: DESCRIPTION }],
    ['meta', { property: 'og:image', content: `${SITE}og.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'HelpPuff',

    nav: [
      { text: 'Docs', link: '/docs/Getting-Started', activeMatch: '^/docs/' },
      // The playground is its own static app beside the site: `target` keeps the router out of it.
      { text: 'Playground', link: '/playground/', target: '_self' },
      { text: 'Providers', link: '/docs/Providers' },
      { text: 'Changelog', link: `${REPO}/blob/main/CHANGELOG.md` },
    ],

    sidebar: {
      '/docs/': [{ text: 'Overview', items: [{ text: 'Welcome', link: '/docs/' }] }, ...wikiSidebar()],
    },

    // Full-text search over every page, built into the site: no service, no key.
    search: {
      provider: 'local',
      options: { detailedView: true },
    },

    outline: { level: [2, 3] },

    socialLinks: [
      { icon: 'github', link: REPO },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@knowtific/helppuff' },
    ],

    editLink: {
      // Every docs page is a wiki page: edit the source, not the site. The
      // function runs in the browser, so it can use nothing from this file.
      pattern: ({ relativePath }) => {
        const page = relativePath.replace(/^docs\//, '').replace(/\.md$/, '');
        return `https://github.com/knowtific/helppuff/edit/main/wiki/${page === 'index' ? 'Home' : page}.md`;
      },
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'MIT licensed. Runs in your own Cloudflare account.',
      copyright: 'HelpPuff by Knowtific',
    },
  },
});
