import { describe, expect, it } from 'vitest';
import { extractPage, mergeFacts } from '../src/extract.js';
import { boilerplateFrom, stripBoilerplate } from '../src/boilerplate.js';

const page = (body: string, head = '') => `<!doctype html><html lang="en-AU"><head><title>Hot Water | Acme Plumbing</title>
<meta name="description" content="Hot water repairs in Melbourne.">${head}</head><body>
<header><nav><a href="/">Home</a><a href="/services">Services</a></nav></header>
<div class="cookie-banner">We use cookies. <button>Accept</button></div>
${body}
<footer>© Acme <a href="tel:0398765432">03 9876 5432</a> <a href="mailto:hi@acme.com.au">hi@acme.com.au</a></footer>
<script>window.x = 1</script></body></html>`;

describe('extractPage', () => {
  it('keeps the main content as Markdown and drops the chrome', () => {
    const out = extractPage(
      page(`<main><h1>Hot water repairs</h1><p>We fix <strong>Rinnai</strong> and <a href="/brands/rheem?utm_source=x">Rheem</a> systems.</p>
      <h2>What we fix</h2><ul><li>Leaks</li><li>No hot water<ul><li>Gas</li></ul></li></ul>
      <table><tr><th>Job</th><th>From</th></tr><tr><td>Service call</td><td>$99</td></tr></table></main>`),
      'https://acme.com.au/hot-water',
    );
    expect(out.title).toBe('Hot Water | Acme Plumbing');
    expect(out.h1).toBe('Hot water repairs');
    expect(out.lang).toBe('en-AU');
    expect(out.markdown).toContain('# Hot water repairs');
    expect(out.markdown).toContain('We fix Rinnai and [Rheem](https://acme.com.au/brands/rheem) systems.');
    expect(out.markdown).toContain('## What we fix\n\n- Leaks\n\n- No hot water\n\n  - Gas');
    expect(out.markdown).toContain('| Job | From |\n| --- | --- |\n| Service call | $99 |');
    expect(out.markdown).not.toMatch(/cookies|Services|window\.x|©/);
    expect(out.links).toContain('https://acme.com.au/services');
  });

  it('finds facts in links and structured data', () => {
    const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Plumber","name":"Acme Plumbing",
      "telephone":"+61 3 9876 5432","address":{"streetAddress":"1 Main St","addressLocality":"Lilydale","addressRegion":"VIC","postalCode":"3140"},
      "openingHoursSpecification":[{"dayOfWeek":["Monday","Tuesday"],"opens":"07:00:00","closes":"17:00:00"}],
      "areaServed":[{"@type":"City","name":"Lilydale"},"Mooroolbark"]},
      {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Do you do emergencies?","acceptedAnswer":{"@type":"Answer","text":"<p>Yes, 24/7.</p>"}}]}]}</script>`;
    const out = extractPage(page('<main><p>Plenty of text about plumbing services in the eastern suburbs of Melbourne.</p></main>', ld), 'https://acme.com.au/');
    const facts = Object.fromEntries(mergeFacts([{ url: 'https://acme.com.au/', facts: out.facts }]).map((f) => [f.key, f.value]));
    expect(facts['name']).toBe('Acme Plumbing');
    expect(facts['phone']).toBe('+61 3 9876 5432, 03 9876 5432');
    expect(facts['email']).toBe('hi@acme.com.au');
    expect(facts['address']).toBe('1 Main St, Lilydale, VIC, 3140');
    expect(facts['hours']).toBe('Monday, Tuesday: 07:00–17:00');
    expect(facts['serviceAreas']).toBe('Lilydale, Mooroolbark');
    expect(out.markdown).toContain('### Do you do emergencies?\n\nYes, 24/7.');
  });

  it('turns accordion questions into bold questions', () => {
    const out = extractPage(page('<main><h2>FAQ</h2><details><summary>How fast can you come?</summary><p>Usually within the hour.</p></details></main>'), 'https://acme.com.au/faq');
    expect(out.markdown).toContain('**How fast can you come?**\n\nUsually within the hour.');
  });

  it('notices a page drawn by JavaScript', () => {
    const html = '<html><head><title>App</title><script src="a.js"></script><script src="b.js"></script></head><body><div id="root"></div></body></html>';
    expect(extractPage(html, 'https://acme.com.au/').looksRendered).toBe(true);
  });
});

describe('boilerplate', () => {
  const cta = 'Call us today for a free quote on 03 9876 5432.';
  const pages = [
    `# Hot water\n\nRinnai repairs.\n\n${cta}`,
    `# Gas\n\nGas fitting.\n\n${cta}`,
    `# Drains\n\nBlocked drains.\n\n${cta}`,
    `# About\n\nFamily owned since 1990.`,
  ];

  it('finds blocks on most pages and removes them, keeping contact ones aside', () => {
    const known = boilerplateFrom(pages);
    expect(known).toHaveLength(1);
    const out = stripBoilerplate(pages[0]!, known);
    expect(out.markdown).toBe('# Hot water\n\nRinnai repairs.');
    expect(out.siteWide).toEqual([cta]);
  });

  it('needs at least three pages to judge', () => {
    expect(boilerplateFrom(pages.slice(0, 2))).toEqual([]);
  });
});
