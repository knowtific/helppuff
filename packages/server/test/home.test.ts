import { describe, expect, it } from 'vitest';
import { shortTitle, suggestAfterLearning, suggestLinks, withSuggestedHome, type SuggestedHome } from '../src/home/suggest.js';
import { world } from './inbox-helpers.js';

/**
 * The widget's home screen: set up in the settings (shortcuts of every kind,
 * the links list), and suggested from the website until the owner does it.
 */

type Json = Record<string, any>;
const json = async (response: Response) => (await response.json()) as Json;
const reply = (content: unknown) => ({ run: async () => ({ response: JSON.stringify(content) }) });

function learn(w: Awaited<ReturnType<typeof world>>) {
  const add = w.db.raw.prepare("INSERT INTO pages (id, site_id, url, title, category, status) VALUES (?, 'demo', ?, ?, ?, 'indexed')");
  add.run('p1', 'https://acme.example/prices', 'Prices | Acme Plumbing', 'pricing');
  add.run('p2', 'https://acme.example/services/hot-water', 'Hot water repairs – Acme Plumbing', 'service');
  add.run('p3', 'https://acme.example/services/drains', 'Blocked drains', 'service');
  add.run('p4', 'https://acme.example/blog/tips', 'Ten tips', 'blog');
  add.run('p5', 'https://acme.example/book', null, 'booking');
}

describe('suggestions from the website', () => {
  it('lets the AI pick and word the links, but only pages the site has', async () => {
    const w = await world();
    learn(w);
    const ai = reply([
      { url: 'https://acme.example/prices', label: 'Our prices', description: 'Callouts from $99' },
      { url: 'https://evil.example/phish', label: 'Free money' },
      { url: 'https://acme.example/book', label: 'Book a plumber' },
      { url: 'https://acme.example/prices', label: 'Twice' },
    ]);
    const { links, source } = await suggestLinks({ db: w.db, ai, model: 'm' }, 'demo', 'Acme');
    expect(source).toBe('model');
    expect(links!.items).toEqual([
      { label: 'Our prices', url: 'https://acme.example/prices', description: 'Callouts from $99' },
      { label: 'Book a plumber', url: 'https://acme.example/book' },
    ]);
  });

  it('without the AI: one page of each useful kind, best first, titles without the site name', async () => {
    const w = await world();
    learn(w);
    const { links } = await suggestLinks({ db: w.db, model: 'm' }, 'demo', 'Acme');
    expect(links!.items.map((i) => [i.label, i.url])).toEqual([
      ['Prices', 'https://acme.example/prices'],
      ['Blocked drains', 'https://acme.example/services/drains'],
      ['Book', 'https://acme.example/book'],
    ]);
    expect(shortTitle('Hot water repairs – Acme Plumbing', 'https://acme.example/x')).toBe('Hot water repairs');
    expect(shortTitle(null, 'https://acme.example/emergency-callouts/')).toBe('Emergency callouts');
  });

  it('suggests once when the site is learned, and stops once the owner sets the home screen up', async () => {
    const w = await world();
    const kv = w.env['HELPPUFF_KV'] as never;
    const deps = { db: w.db, kv, model: 'm', now: Date.now, ai: reply([{ url: 'https://acme.example/prices', label: 'Prices' }, { url: 'https://acme.example/book', label: 'Book' }]) };
    expect(await suggestAfterLearning(deps, 'demo', 'Acme')).toBeNull(); // nothing learned yet
    learn(w);
    expect((await suggestAfterLearning(deps, 'demo', 'Acme'))!.links!.items).toHaveLength(2);
    expect(await suggestAfterLearning(deps, 'demo', 'Acme')).toBeNull(); // once

    // The widget shows them, and the dashboard says so.
    const config = (await json(await w.h.fetch('/v1/sites/demo/config')))['widget'];
    expect(config.home.links.items.map((i: Json) => i.label)).toEqual(['Prices', 'Book']);
    expect((await json(await w.owner.get('/settings')))['suggestedHome']).toMatchObject({ links: { items: [{ label: 'Prices' }, { label: 'Book' }] } });

    // The owner removes the list: the suggestions are gone for good.
    await w.owner.send('PUT', '/settings', { settings: { home: { links: null } } });
    expect((await json(await w.h.fetch('/v1/sites/demo/config')))['widget'].home.links).toBeUndefined();
    expect((await json(await w.owner.get('/settings')))['suggestedHome']).toBeNull();
  });

  it("fills in only what the site lacks: its own links and questions win", () => {
    const suggested: SuggestedHome = { at: 1, questions: ['Do you do gas?'], links: { title: 'Useful pages', items: [{ label: 'Prices', url: 'https://a.example/p' }] } };
    const base = { home: { title: 'Hi', subtitle: '', shortcuts: [{ id: 'call', label: 'Call', action: { id: 'call', kind: 'tel', label: 'Call', phone: '1' } }] } } as never;
    const merged = withSuggestedHome(base, suggested);
    expect(merged.home.shortcuts!.map((s) => s.id)).toEqual(['ask-1', 'call']);
    expect(merged.home.links!.items[0]!.label).toBe('Prices');
    const own = { home: { title: 'Hi', subtitle: '', links: { title: 'Ours', items: [{ label: 'Ours', url: 'https://a.example/o' }] }, shortcuts: [{ id: 'q', label: 'Q?', action: { id: 'q', kind: 'reply', label: 'Q?', value: 'Q?' } }] } } as never;
    expect(withSuggestedHome(own, suggested)).toBe(own);
    expect(withSuggestedHome(base, { ...suggested, dismissed: true })).toBe(base);
  });
});

describe('the home screen in the settings', () => {
  it('saves every kind of shortcut and the links, keeps the quote button out, and serves them to the widget', async () => {
    const w = await world();
    const home = {
      title: 'G’day',
      subtitle: 'How can we help?',
      shortcuts: [
        { id: 'ask-1', label: 'Do you do gas?', icon: 'chat', action: { id: 'ask-1', kind: 'reply', label: 'Do you do gas?', value: 'Do you do gas?' } },
        { id: 'call', label: 'Call us', icon: 'phone', action: { id: 'call', kind: 'tel', label: 'Call us', phone: '02 9000 0000' } },
        { id: 'prices', label: 'Prices', icon: 'external', action: { id: 'prices', kind: 'url', label: 'Prices', url: 'https://acme.example/prices', newTab: true } },
        { id: 'job-quote', label: 'Get a quote', action: { id: 'job-quote', kind: 'flow', label: 'Get a quote', flowId: 'job-quote' } },
      ],
      links: { title: 'Useful pages', items: [{ label: 'Book', url: 'https://acme.example/book', description: 'Pick a time' }] },
    };
    const saved = await json(await w.owner.send('PUT', '/settings', { settings: { home } }));
    expect(saved['settings']['home']['shortcuts'].map((s: Json) => s.id)).toEqual(['ask-1', 'call', 'prices']);
    expect(saved['settings']['starterQuestions']).toEqual(['Do you do gas?']);
    const widget = (await json(await w.h.fetch('/v1/sites/demo/config')))['widget'];
    expect(widget.home).toMatchObject({ title: 'G’day', subtitle: 'How can we help?', links: { items: [{ label: 'Book' }] } });

    // Older callers that send only the questions keep the other buttons.
    const questions = await json(await w.owner.send('PUT', '/settings', { settings: { starterQuestions: ['Are you open Sundays?'] } }));
    expect(questions['settings']['home']['shortcuts'].map((s: Json) => s.label)).toEqual(['Are you open Sundays?', 'Call us', 'Prices']);

    // A shortcut that is not one: refused with where.
    const bad = await w.owner.send('PUT', '/settings', { settings: { home: { shortcuts: [{ id: 'x', label: 'X', action: { id: 'x', kind: 'url', label: 'X', url: 'javascript:alert(1)' } }] } } });
    expect(bad.status).toBe(400);
  });

  it('suggests a whole home screen for the editor, saving nothing', async () => {
    const w = await world();
    learn(w);
    w.db.raw.prepare("INSERT INTO site_facts (site_id, key, value) VALUES ('demo', 'phone', '02 9000 0000'), ('demo', 'email', 'hi@acme.example')").run();
    const suggestion = await json(await w.owner.send('POST', '/home/suggest', {}));
    expect(suggestion['links']['items'].length).toBeGreaterThan(0);
    expect(suggestion['contact'].map((s: Json) => s.action.kind)).toEqual(['tel', 'email']);
    expect(suggestion['questions']).toHaveLength(4);
    expect((await json(await w.owner.get('/settings')))['settings']['home']['links']).toBeNull();
  });
});
