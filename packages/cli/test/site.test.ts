import { describe, expect, it } from 'vitest';
import { crawlSite, htmlToPage, inspectSite, nameFromTitle, originsFor, pageFileName, siteIdFor } from '../src/engine/site.js';
import { ACME_HOME, fakeFetch, html } from './helpers.js';

describe('inspectSite', () => {
  it('reads name, colour, logo, contacts and key pages from the home page', async () => {
    const { fetch } = fakeFetch([(url) => (url.pathname === '/' ? html(ACME_HOME) : undefined)]);
    const info = await inspectSite('acme.com.au', fetch);

    expect(info.reachable).toBe(true);
    expect(info.name).toBe('Acme Plumbing');
    expect(info.accent).toBe('#0EA5E9');
    expect(info.logo).toBe('https://acme.com.au/icon.png');
    expect(info.phone).toBe('+61290000000');
    expect(info.email).toBe('hello@acme.com.au');
    expect(info.description).toContain('plumbing');
    // The site's own link text, not a generic label.
    expect(info.pages.pricing).toEqual({ url: 'https://acme.com.au/pricing', label: 'Our prices' });
    expect(info.pages.contact?.url).toBe('https://acme.com.au/contact-us');
    expect(info.origins).toEqual(['https://acme.com.au', 'https://www.acme.com.au']);
  });

  it('still returns usable defaults when the site cannot be reached', async () => {
    const { fetch } = fakeFetch([() => new Response('down', { status: 503 })]);
    const info = await inspectSite('https://down.example.com', fetch);
    expect(info.reachable).toBe(false);
    expect(info.name).toBeNull();
    expect(info.origins).toContain('https://down.example.com');
  });

  it('ignores a near-white theme colour, which would make an invisible launcher', async () => {
    const { fetch } = fakeFetch([() => html('<html><head><meta name="theme-color" content="#ffffff"><title>X</title></head></html>')]);
    expect((await inspectSite('x.com', fetch)).accent).toBeNull();
  });
});

describe('helpers', () => {
  it('picks the brand out of a title', () => {
    expect(nameFromTitle('Home | Acme Plumbing — Sydney', 'acmeplumbing.com')).toBe('Acme Plumbing');
    expect(nameFromTitle('Welcome - Globex', 'globex.io')).toBe('Globex');
    expect(nameFromTitle('MYT - Software Development Consultancy in Australia', 'myt-pty-ltd.com')).toBe('MYT');
    expect(nameFromTitle('Web Design & Software Development Melbourne — Knowtific', 'www.knowtific.com.au')).toBe('Knowtific');
    expect(nameFromTitle('Best cakes in town | Crumbs', 'bakery-example.com')).toBe('Crumbs');
  });

  it('derives ids and twins', () => {
    expect(siteIdFor('https://www.acme-plumbing.com.au/x')).toBe('acme-plumbing');
    expect(originsFor('https://www.acme.com')).toEqual(['https://www.acme.com', 'https://acme.com']);
    expect(pageFileName('https://www.acme.com/services/drains/')).toBe('site__acme.com__services_drains.md');
    expect(pageFileName('https://acme.com/')).toBe('site__acme.com__index.md');
  });
});

describe('htmlToPage', () => {
  it('keeps the content and drops the chrome', () => {
    const page = htmlToPage(ACME_HOME, 'https://acme.com.au/');
    expect(page.markdown).toContain('# Plumbing, sorted.');
    expect(page.markdown).toContain('- Licensed and insured');
    expect(page.markdown).toContain('Source: https://acme.com.au/');
    expect(page.markdown).not.toContain('Our prices'); // nav
  });
});

describe('crawlSite', () => {
  it('uses the sitemap, skips assets and other hosts, and respects maxPages', async () => {
    const page = (title: string) => html(`<html><head><title>${title}</title></head><body><main><p>${title} ${'content '.repeat(40)}</p></main></body></html>`);
    const { fetch } = fakeFetch([
      (url) => (url.pathname === '/robots.txt' ? new Response('Sitemap: https://acme.com/sitemap.xml') : undefined),
      (url) =>
        url.pathname === '/sitemap.xml'
          ? new Response(
              '<urlset><url><loc>https://acme.com/pricing</loc></url><url><loc>https://acme.com/brochure.pdf</loc></url><url><loc>https://other.com/x</loc></url><url><loc>https://acme.com/blog/2019/a/b</loc></url></urlset>',
            )
          : undefined,
      (url) => page(url.pathname),
    ]);
    const pages = await crawlSite('acme.com', { maxPages: 2, fetch });
    expect(pages.map((p) => p.url)).toEqual(['https://acme.com/', 'https://acme.com/pricing']);
  });
});
