import { describe, expect, it } from 'vitest';
import { categorise, intentCategories, suggested } from '../src/categorise.js';

const cat = (path: string, title?: string) => categorise({ url: `https://acme.com.au${path}`, title: title ?? null });

describe('categorise', () => {
  it.each([
    ['/', 'home'],
    ['/services/hot-water-repairs', 'service'],
    ['/blocked-drains', 'other'],
    ['/contact-us', 'contact'],
    ['/faq', 'faq'],
    ['/pricing', 'pricing'],
    ['/about-us', 'about'],
    ['/blog/how-much-does-a-plumber-cost', 'blog'],
    ['/our-team', 'team'],
    ['/reviews', 'testimonials'],
    ['/book-online', 'booking'],
    ['/privacy-policy', 'legal'],
    ['/areas-we-service/lilydale', 'location'],
    ['/products/widget', 'product'],
  ])('%s → %s', (path, expected) => {
    expect(cat(path)).toBe(expected);
  });

  it('falls back to the title when the URL says nothing', () => {
    expect(cat('/p/123', 'Contact Us | Acme Plumbing')).toBe('contact');
  });
});

describe('suggested', () => {
  it('leaves legal pages, archives and deep blog posts unticked', () => {
    expect(suggested('https://acme.com/privacy', 'legal')).toBe(false);
    expect(suggested('https://acme.com/blog/page/3', 'blog')).toBe(false);
    expect(suggested('https://acme.com/blog/2019/old-post', 'blog')).toBe(false);
    expect(suggested('https://acme.com/blog', 'blog')).toBe(true);
    expect(suggested('https://acme.com/services/gas', 'service')).toBe(true);
  });
});

describe('intentCategories', () => {
  it('reads the leaning of a question', () => {
    expect(intentCategories("what's your phone number?")).toContain('contact');
    expect(intentCategories('how much is a hot water service?')).toContain('pricing');
    expect(intentCategories('do you service Lilydale?')).toContain('location');
    expect(intentCategories('can I book for Tuesday')).toContain('booking');
    expect(intentCategories('tell me about rinnai heaters')).toEqual([]);
  });
});
