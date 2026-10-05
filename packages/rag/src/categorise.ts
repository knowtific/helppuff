/**
 * One category per page, from its URL and title. Deterministic and
 * cheap: it runs on every discovered URL, before anything is fetched, so the
 * owner sees a sensible pre-ticked checklist straight away.
 *
 * The category decides three things: whether a page is crawled by default,
 * which pages a "what's your phone number" question leans towards, and the
 * Vectorize metadata a query can filter on.
 */

export const CATEGORIES = [
  'home',
  'service',
  'product',
  'location',
  'about',
  'contact',
  'faq',
  'pricing',
  'blog',
  'team',
  'testimonials',
  'booking',
  'legal',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Checked in order; the first match wins, so the specific comes before the general. */
const RULES: [Category, RegExp][] = [
  ['legal', /\b(privacy|terms|conditions|cookies?|disclaimer|legal|gdpr|accessibility-statement|refund-policy|returns-policy|shipping-policy|modern-slavery|sitemap)\b/],
  ['faq', /\b(faqs?|frequently-asked|questions|help-?cent(er|re)|support|knowledge-?base)\b/],
  ['pricing', /\b(pricing|prices?|plans|rates|fees|costs?|quote|packages)\b/],
  ['booking', /\b(book(ing)?s?|appointments?|schedule|reserv(e|ation)s?|calendar)\b/],
  ['contact', /\b(contact|contact-us|get-in-touch|enquir(e|y|ies)|inquir(e|y|ies)|find-us|visit-us)\b/],
  ['team', /\b(team|our-team|staff|people|practitioners|doctors|clinicians|meet-the|our-people|leadership)\b/],
  ['testimonials', /\b(testimonials?|reviews?|case-stud(y|ies)|success-stories|clients-say)\b/],
  ['location', /\b(locations?|areas?(-we-serve|-served)?|service-areas?|suburbs?|regions?|branches|clinics?|offices?)\b/],
  ['about', /\b(about|about-us|our-story|who-we-are|history|mission|company)\b/],
  ['blog', /\b(blog|news|articles?|posts?|insights|resources|stories|press|media|events?)\b/],
  ['product', /\b(products?|shop|store|collections?|catalog(ue)?|items?)\b/],
  ['service', /\b(services?|what-we-do|solutions|treatments?|therapy|therapies|repairs?|installations?|maintenance|offerings)\b/],
];

/** Pages nobody asks a chat assistant about, or that would only add noise. */
const LOW_VALUE_PATH = /\/(tag|tags|category|categories|author|page|feed|amp|print|attachment|wp-content|search|cart|checkout|account|login)(\/|$)|[?&](page|p|s|replytocom)=/i;

export function categorise(input: { url: string; title?: string | null; h1?: string | null }): Category {
  let path: string;
  try {
    const parsed = new URL(input.url);
    path = parsed.pathname.toLowerCase();
    if (path === '/' || path === '' || /^\/(index|home)(\.\w+)?$/.test(path)) return 'home';
  } catch {
    return 'other';
  }
  // The first segment says the most: `/blog/what-does-it-cost` is a blog post, not pricing.
  const segments = path.split('/').filter(Boolean);
  for (const text of [segments[0] ?? '', segments.join(' ')]) {
    const slug = text.replace(/[_.]+/g, ' ');
    for (const [category, pattern] of RULES) if (pattern.test(slug)) return category;
  }

  // The URL said nothing; the title often does ("Contact Us | Acme").
  const words = `${input.title ?? ''} ${input.h1 ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (words.replace(/-/g, '')) for (const [category, pattern] of RULES) if (pattern.test(words)) return category;
  return 'other';
}

/** Whether a page is ticked by default in the crawl checklist. */
export function suggested(url: string, category: Category): boolean {
  if (category === 'legal') return false;
  if (LOW_VALUE_PATH.test(url)) return false;
  // Deep blog archives rarely answer customer questions; recent posts can be ticked by hand.
  if (category === 'blog') {
    try {
      return new URL(url).pathname.split('/').filter(Boolean).length <= 1;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Categories a question leans towards, from words in it. Used to boost (not
 * filter) retrieval: "what's your number" should find the contact page even
 * when a service page happens to mention phones.
 */
export function intentCategories(query: string): Category[] {
  const q = query.toLowerCase();
  const out: Category[] = [];
  if (/\b(phone|call|number|email|e-mail|contact|reach|address|where are you|located|location|directions|open|hours|opening|close|closing)\b/.test(q)) {
    out.push('contact');
  }
  if (/\b(price|prices|pricing|cost|costs|how much|fee|fees|rate|rates|quote|charge|expensive|cheap)\b/.test(q)) out.push('pricing');
  if (/\b(service|servic(e|ing) (my|your)|area|areas|suburb|suburbs|near|travel|come to|cover)\b/.test(q)) out.push('location');
  if (/\b(book|booking|appointment|schedule|available|availability|reserve)\b/.test(q)) out.push('booking');
  return out;
}
