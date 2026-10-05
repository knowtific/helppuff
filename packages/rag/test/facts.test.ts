import { describe, expect, it } from 'vitest';
import { detectFacts, factsFromText } from '../src/facts.js';
import { readFacts, writeFacts } from '../src/store.js';
import type { AiLike } from '../src/types.js';
import { site, sqliteD1 } from './helpers.js';

const PAGES = {
  '/': '<html><head><title>Acme Plumbing</title></head><body><main><h1>Acme Plumbing</h1><p>Plumbers for the Yarra Valley.</p><a href="/contact-us">Contact</a><a href="tel:0398765432">Call 03 9876 5432</a></main></body></html>',
  '/contact-us': '<html><head><title>Contact</title></head><body><main><h1>Contact us</h1><p>Find us at 1 Main St, Lilydale VIC 3140. Open Monday to Friday, 7am to 5pm.</p></main></body></html>',
};

function chatAi(reply: unknown): AiLike & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    run: async (_model, inputs) => {
      const messages = inputs['messages'] as { content: string }[];
      prompts.push(messages[1]!.content);
      return { choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] };
    },
  };
}

describe('business details', () => {
  it('takes structured data first and lets the model fill only the gaps', async () => {
    const db = sqliteD1();
    const ai = chatAi({ name: 'Acme Plumbing', phone: '9999 9999', email: 'not an email', address: '1 Main St, Lilydale VIC 3140', hours: ['Mon–Fri 7am–5pm'], serviceAreas: null });
    const result = await detectFacts({ db, ai, fetch: site(PAGES) }, { siteId: 'acme', website: 'https://acme.test/', model: '@cf/zai-org/glm-4.7-flash' });
    const facts = Object.fromEntries((await readFacts(db, 'acme')).map((f) => [f.key, f.value]));
    // The tel: link wins over whatever the model read; a bad email is dropped.
    expect(facts['phone']).toBe('03 9876 5432');
    expect(facts['email']).toBeUndefined();
    expect(facts['address']).toBe('1 Main St, Lilydale VIC 3140');
    expect(facts['hours']).toBe('Mon–Fri 7am–5pm');
    expect(facts['serviceAreas']).toBeUndefined();
    expect(ai.prompts[0]).toContain('1 Main St, Lilydale');
    expect(result.neurons).toBeGreaterThan(0);
  });

  it('never overwrites what the owner set', async () => {
    const db = sqliteD1();
    await writeFacts(db, 'acme', [{ key: 'address', value: 'PO Box 1', sourceUrl: 'owner' }], 1);
    await detectFacts({ db, ai: chatAi({ address: '1 Main St' }), fetch: site(PAGES) }, { siteId: 'acme', website: 'https://acme.test/', model: 'm' });
    expect((await readFacts(db, 'acme')).find((f) => f.key === 'address')?.value).toBe('PO Box 1');
  });

  it('survives a model that answers in prose', async () => {
    expect((await factsFromText(chatAi('Sorry, I cannot help.'), 'm', [{ url: 'u', markdown: 'text' }])).facts).toEqual([]);
  });
});
