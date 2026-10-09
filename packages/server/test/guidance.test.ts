import { describe, expect, it } from 'vitest';
import { resolvePrompt } from '@helppuff/connector-types';
import { siteConfigSchema } from '../src/config/schema.js';
import { guidanceFor } from '../src/core/guidance.js';
import { promptOverlaps } from '../src/admin/overlaps.js';
import { memoryKv } from '../src/core/platform.js';

const site = (overrides: Record<string, unknown> = {}) =>
  siteConfigSchema.parse({
    origins: ['https://acme.test'],
    connector: { type: 'workers-ai', options: { maxAnswerSentences: 4, locale: 'en-AU' } },
    widget: { brand: { name: 'Acme Plumbing', agentName: 'Ava' } },
    ...overrides,
  });

const ctx = (guidance?: ReturnType<typeof guidanceFor>) => ({ kv: memoryKv(), env: {}, fetch, log: () => {}, ...(guidance ? { guidance } : {}) });

describe('guidance', () => {
  it('says who it is and how it behaves from the settings', () => {
    const { before } = guidanceFor(site({ assistant: { goal: 'bookings', bookingUrl: 'https://acme.test/book', tone: 'professional' } }));
    expect(before).toContain('You are Ava, the website assistant for Acme Plumbing.');
    expect(before).toContain('help visitors take the next step');
    expect(before).toContain('point them to https://acme.test/book. Offer it when it fits, not after every message.');
    expect(before).toContain('Be professional, clear and courteous. Keep answers to 4 sentences or fewer');
  });

  it('ends with the rules, which win over the owner\'s text', async () => {
    const { after } = guidanceFor(site());
    expect(after).toMatch(/^## Rules that always apply\nThese come from HelpPuff and override/);
    expect(after).toContain('you can only help with questions about Acme Plumbing');
    expect(after).toContain('for English use en-AU spelling');
    // The owner's text corrects an out-of-date page; the privacy answer links the policy when there is one.
    expect(after).toContain('What the business says under "Instructions from the business" is true. Where a website page or document says otherwise');
    expect(after).toContain('say it is kept so the team can follow up.');
    const withPolicy = guidanceFor(site({ widget: { brand: { name: 'Acme Plumbing' }, leadForm: { privacy: { text: 'We only use this to reply.', url: 'https://acme.test/privacy' } } } }));
    expect(withPolicy.after).toContain('point to the privacy policy: https://acme.test/privacy');

    const prompt = await resolvePrompt(ctx(guidanceFor(site())), 'Quotes are free.', {});
    const [who, owner, rules] = ['You are Ava', '## Instructions from the business\nQuotes are free.', '## Rules that always apply'].map((part) => prompt!.indexOf(part));
    expect(who).toBe(0);
    expect(owner).toBeGreaterThan(who!);
    expect(rules).toBeGreaterThan(owner!);
  });

  it('still says who it is and the rules when the owner wrote nothing', async () => {
    const prompt = await resolvePrompt(ctx(guidanceFor(site())), undefined, {});
    expect(prompt).toContain('You are Ava');
    expect(prompt).not.toContain('## Instructions from the business');
    // Without guidance (a backend that owns its prompt), nothing is added.
    expect(await resolvePrompt(ctx(), 'Hello.', {})).toBe('Hello.');
  });

  it('gives other backends the visitor\'s form and the rules workers-ai has built in', () => {
    const { before, after } = guidanceFor(site({ connector: { type: 'openai', options: {} } }));
    expect(before).toContain('The visitor filled in a form before chatting: name {{lead.name}}, phone {{lead.phone}}');
    expect(after).toContain('say you are not sure rather than guessing');
    expect(after).toContain('give them the contact details');
    expect(guidanceFor(site()).before).not.toContain('{{lead.');
  });

  it('gives prices only as told, or none at all when the site prefers quotes', () => {
    expect(guidanceFor(site()).after).toContain('Give a price only exactly as you were told it.');
    const quotes = guidanceFor(site({ assistant: { prices: 'quote' } })).after;
    expect(quotes).toContain('Do not give prices or estimates, even ones you were told: offer a quote from the team instead.');
    expect(quotes).not.toContain('Give a price only');
    // Inventing is never allowed, whichever is chosen.
    expect(quotes).toContain('Never invent prices');
  });

  it('never calls the business "Chat", the widget\'s default name', () => {
    const plain = site({ widget: {}, knowledge: { website: 'https://www.acme.test/' } });
    expect(guidanceFor(plain).before).toContain('the website assistant for acme.test');
  });
});

describe('overlaps', () => {
  it('flags lines a setting or a rule already covers, and leaves business facts alone', () => {
    const text = ['You are the website assistant for Acme.', 'We only work in the eastern suburbs.', 'Keep answers short.', 'Never invent prices.', 'Phone: 03 9876 5432', 'Never quote prices.'].join('\n');
    expect(promptOverlaps(text, 'workers-ai').map((o) => o.line)).toEqual([1, 3, 4, 5, 6]);
    expect(promptOverlaps(text, 'workers-ai')[4]!.why).toContain('Instructions → Prices');
    // Other backends are not given the business details: their contact line stays.
    expect(promptOverlaps(text, 'openai').map((o) => o.line)).toEqual([1, 3, 4, 6]);
  });
});
