import { reasoningInputs, runOptions, type AiOptions } from './ai.js';
import { categorise } from './categorise.js';
import { extractPage, mergeFacts, type Fact, type FactKey } from './extract.js';
import { fetchPage } from './fetch.js';
import { neurons } from './pricing.js';
import { readFacts, writeFacts } from './store.js';
import type { AiLike, D1Like } from './types.js';
import { canonicalUrl, sameSite } from './url.js';

/**
 * The business's details — name, phone, email, address, hours, areas served —
 * found on its own site, so onboarding can show them pre-filled and the
 * assistant always has them.
 *
 *  1. Structured data first: JSON-LD (`LocalBusiness` and kin), `tel:` and
 *     `mailto:` links. Exact when present.
 *  2. Then the site's own model reads the home and contact pages for what is
 *     still missing — hours in a footer, an address in a paragraph. It is told
 *     to leave out anything not written there, and its answers are checked.
 *
 * Facts the owner set (`source_url = 'owner'`) are never touched.
 */

const KEYS: FactKey[] = ['name', 'phone', 'email', 'address', 'hours', 'serviceAreas'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

function clean(key: FactKey, value: unknown): string | null {
  if (Array.isArray(value)) value = value.filter((v) => typeof v === 'string' && v.trim()).join(key === 'hours' ? '; ' : ', ');
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text || /^(null|none|n\/a|unknown|not (stated|given|provided))$/i.test(text)) return null;
  if (key === 'email' && !EMAIL.test(text)) return null;
  if (key === 'phone' && text.replace(/\D/g, '').length < 6) return null;
  return text;
}

/** The model's reading of some pages, as facts. Empty on any failure. */
export async function factsFromText(
  ai: AiLike,
  model: string,
  pages: { url: string; markdown: string }[],
  options: AiOptions = {},
): Promise<{ facts: Fact[]; neurons: number }> {
  const text = pages.map((p) => `### ${p.url}\n${p.markdown.slice(0, 5000)}`).join('\n\n').slice(0, 12_000);
  if (!text.trim()) return { facts: [], neurons: 0 };
  try {
    const result = (await ai.run(
      model,
      {
        messages: [
          {
            role: 'system',
            content:
              'Extract the business contact details stated on these web pages. Reply with only a JSON object with the keys name, phone, email, address, hours (an array like "Mon–Fri 8am–5pm"), serviceAreas (an array of suburbs, towns or regions). Use null for anything not written on the pages. Never guess or invent.',
          },
          { role: 'user', content: text },
        ],
        max_tokens: 400,
        temperature: 0,
        ...reasoningInputs(model, 'off'),
      },
      runOptions(options),
    )) as { choices?: { message?: { content?: string } }[]; response?: unknown };
    const raw = result.choices?.[0]?.message?.content ?? result.response;
    const json = typeof raw === 'object' && raw !== null ? raw : JSON.parse(/\{[\s\S]*\}/.exec(String(raw ?? ''))?.[0] ?? '{}');
    const facts = KEYS.flatMap((key) => {
      const value = clean(key, (json as Record<string, unknown>)[key]);
      return value ? [{ key, value }] : [];
    });
    return { facts, neurons: neurons(model, Math.ceil(text.length / 4) + 150, 200) };
  } catch {
    return { facts: [], neurons: 0 };
  }
}

/** Store facts, leaving alone any key the owner set. Returns the keys written. */
export async function storeFacts(db: D1Like, siteId: string, facts: { key: string; value: string; sourceUrl: string }[], now: number): Promise<string[]> {
  const owned = new Set((await readFacts(db, siteId)).filter((f) => f.source_url === 'owner').map((f) => f.key));
  const fresh = facts.filter((f) => !owned.has(f.key));
  await writeFacts(db, siteId, fresh, now);
  return fresh.map((f) => f.key);
}

/**
 * Read the home page and the contact page now, and store what they say.
 * What onboarding calls first, so the details form is filled in seconds
 * rather than when the crawl ends.
 */
export async function detectFacts(
  deps: { db: D1Like; ai: AiLike; fetch?: typeof fetch; now?: () => number },
  input: { siteId: string; website: string; model: string; userAgent?: string; contactUrl?: string | null } & AiOptions,
): Promise<{ found: string[]; neurons: number }> {
  const io = { ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(input.userAgent ? { userAgent: input.userAgent } : {}) };
  const home = await fetchPage(input.website, io);
  const pages: { url: string; markdown: string; facts: Fact[] }[] = [];
  let contactUrl = input.contactUrl ?? null;
  if (home.ok) {
    const page = extractPage(home.html, home.finalUrl);
    pages.push({ url: home.finalUrl, markdown: page.markdown, facts: page.facts });
    contactUrl ??=
      page.links.find((link) => sameSite(link, home.finalUrl) && categorise({ url: link }) === 'contact') ??
      canonicalUrl('/contact', home.finalUrl);
  }
  if (contactUrl && !pages.some((p) => p.url === contactUrl)) {
    const contact = await fetchPage(contactUrl, io);
    if (contact.ok) {
      const page = extractPage(contact.html, contact.finalUrl);
      pages.push({ url: contact.finalUrl, markdown: page.markdown, facts: page.facts });
    }
  }
  if (!pages.length) return { found: [], neurons: 0 };

  const structured = mergeFacts(pages);
  const missing = KEYS.filter((key) => !structured.some((f) => f.key === key));
  let spent = 0;
  const read: { key: FactKey; value: string; sourceUrl: string }[] = [];
  if (missing.length) {
    const ai = await factsFromText(deps.ai, input.model, pages, input);
    spent = ai.neurons;
    for (const fact of ai.facts) if (missing.includes(fact.key)) read.push({ ...fact, sourceUrl: contactUrl ?? pages[0]!.url });
  }
  const all = [...structured.filter((f) => f.key !== 'description'), ...read];
  const found = await storeFacts(deps.db, input.siteId, all, (deps.now ?? Date.now)());
  return { found, neurons: spent };
}
