import { describe, expect, it, vi } from 'vitest';
import { gapKey, listGaps, missingFromKnowledge, recordGaps } from '../src/knowledge/gaps.js';
import { runConversationJob } from '../src/conversations/complete.js';
import { chat, say, world } from './inbox-helpers.js';

/**
 * Questions to answer: what the assistant could not answer and the knowledge
 * base does not cover, kept once per question, after each conversation.
 */

const SITE = 'demo';
const reply = (content: unknown) => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] });

describe('questions to answer', () => {
  it('counts the same question once, whatever its case or punctuation', () => {
    expect(gapKey('Do you service PENRITH??')).toBe(gapKey('do you service penrith'));
    expect(gapKey('  Do  you service — Penrith? ')).toBe('do you service penrith');
  });

  it('keeps only what the knowledge base does not answer: nothing found, or found but judged no answer', async () => {
    const search = vi.fn(async (_site: string, q: string) =>
      q.includes('Penrith') ? [] : [{ title: 'Prices', content: q.includes('callout') ? 'Our callout fee is $99.' : 'We charge by the hour.', score: 0.6 }],
    );
    // The judge says question 1 (the callout fee) is answered by its passage; question 2 (weekend rates) is not.
    const ai = { run: vi.fn(async () => reply({ answered: [1] })) };
    const missing = await missingFromKnowledge({ search, ai, model: 'm' }, SITE, ['Do you service Penrith?', 'What is the callout fee?', 'Are weekends dearer?']);
    expect(missing).toEqual(['Do you service Penrith?', 'Are weekends dearer?']);
    expect(ai.run).toHaveBeenCalledTimes(1);

    // The judge failing keeps them: the summary already said they went unanswered.
    const broken = { run: vi.fn(async () => reply('not json')) };
    expect(await missingFromKnowledge({ search, ai: broken, model: 'm' }, SITE, ['What is the callout fee?'])).toEqual(['What is the callout fee?']);
    // No search (another knowledge source): every question is kept.
    expect(await missingFromKnowledge({}, SITE, ['Anything?'])).toEqual(['Anything?']);
  });

  it('records a question once and counts it again; dismissed stays dismissed, answered asked again reopens', async () => {
    const w = await world();
    const now = Date.now();
    const [first] = await recordGaps(w.db, SITE, 'c1', ['Do you service Penrith?'], now);
    expect(first).toMatchObject({ count: 1, status: 'open' });
    expect(await recordGaps(w.db, SITE, 'c2', ['do you service penrith'], now + 1)).toEqual([]);
    let { gaps } = await listGaps(w.db, SITE, 'open');
    expect(gaps).toMatchObject([{ id: first!.id, count: 2, conversation_id: 'c2' }]);

    w.db.raw.prepare("UPDATE knowledge_gaps SET status = 'dismissed' WHERE id = ?").run(first!.id);
    await recordGaps(w.db, SITE, 'c3', ['Do you service Penrith?'], now + 2);
    expect((await listGaps(w.db, SITE, 'dismissed')).gaps).toHaveLength(1);

    const [lpg] = await recordGaps(w.db, SITE, 'c4', ['Can you convert to LPG?'], now);
    w.db.raw.prepare("UPDATE knowledge_gaps SET status = 'answered' WHERE id = ?").run(lpg!.id);
    await recordGaps(w.db, SITE, 'c5', ['Can you convert to LPG?'], now + 3);
    ({ gaps } = await listGaps(w.db, SITE, 'open'));
    expect(gaps.map((g) => g.id)).toEqual([lpg!.id]);
  });

  it('after a conversation, adds what it could not answer and the knowledge base lacks, and tells the webhooks once', async () => {
    const w = await world();
    const deliveries: { type: string; data: Record<string, unknown> }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      deliveries.push(JSON.parse(String(init?.body)) as { type: string; data: Record<string, unknown> });
      return new Response('ok');
    });
    await w.owner.send('POST', '/webhooks', { url: 'https://hooks.example.com/in', events: ['knowledge.gap'] });

    const { id } = await chat(w.h, 'Do you convert cooktops to LPG?');
    const job = (instructions?: string) =>
      runConversationJob(
        { do: async (_name, run) => run(), sleep: async () => {} },
        {
          db: w.db,
          fetch: globalThis.fetch,
          now: () => Date.now() + 10 * 60_000,
          // The summary first, then the judge.
          ai: {
            run: vi
              .fn()
              .mockResolvedValueOnce(reply({ summary: 'Asked about LPG.', outcome: 'unanswered', unanswered: ['Do you convert cooktops to LPG?', 'What are your hours?'], topics: ['gas'] }))
              .mockResolvedValueOnce(reply({ answered: [1] })),
          },
          knowledge: async (_site, q) => (q.includes('hours') ? [{ title: 'Hours', content: 'We open 8am to 5pm, Monday to Friday.', score: 0.8 }] : []),
        },
        { kind: 'conversation', siteId: SITE, conversationId: id, model: 'm', budget: 0, idleMs: 0, knowledgeBase: true, ...(instructions ? { instructions } : {}) },
      );
    await job('Never quote prices.');
    const { gaps } = await listGaps(w.db, SITE, 'open');
    // The hours are in the knowledge base: only LPG is a question to answer.
    expect(gaps.map((g) => g.question)).toEqual(['Do you convert cooktops to LPG?']);
    expect(deliveries.filter((d) => d.type === 'knowledge.gap')).toMatchObject([{ data: { question: 'Do you convert cooktops to LPG?', count: 1, conversationId: id } }]);

    // The visitor comes back and asks again: counted, not announced again.
    await say(w.h, (await chat(w.h, 'hello')).token, { kind: 'text', text: 'again' });
    w.db.raw.prepare('UPDATE conversations SET completed_at = NULL WHERE id = ?').run(id);
    deliveries.length = 0;
    await job();
    expect((await listGaps(w.db, SITE, 'open')).gaps[0]).toMatchObject({ count: 2 });
    expect(deliveries.filter((d) => d.type === 'knowledge.gap')).toEqual([]);
    vi.restoreAllMocks();
  });

  it('keeps no questions for a site whose knowledge lives elsewhere: there is nowhere to put an answer', async () => {
    const w = await world();
    const { id } = await chat(w.h, 'Do you convert cooktops to LPG?');
    await runConversationJob(
      { do: async (_name, run) => run(), sleep: async () => {} },
      { db: w.db, fetch: globalThis.fetch, now: () => Date.now() + 10 * 60_000, ai: { run: vi.fn(async () => reply({ summary: 'LPG.', unanswered: ['Do you convert cooktops to LPG?'] })) } },
      { kind: 'conversation', siteId: SITE, conversationId: id, model: 'm', budget: 0, idleMs: 0, knowledgeBase: false },
    );
    expect((await listGaps(w.db, SITE, 'all')).gaps).toEqual([]);
  });

  it('tells the summary what the assistant was told, so what it declines on purpose is no question to answer', async () => {
    const w = await world();
    const { id } = await chat(w.h, 'How much for a new hot water system?');
    const ai = { run: vi.fn(async () => reply({ summary: 'Asked a price.', outcome: 'callback_requested', unanswered: [] })) };
    await runConversationJob(
      { do: async (_name, run) => run(), sleep: async () => {} },
      { db: w.db, fetch: globalThis.fetch, now: () => Date.now() + 10 * 60_000, ai },
      { kind: 'conversation', siteId: SITE, conversationId: id, model: 'm', budget: 0, idleMs: 0, instructions: 'Never quote prices: offer a free measure instead.' },
    );
    const system = (ai.run.mock.calls[0] as unknown as [string, { messages: { content: string }[] }])[1].messages[0]!.content;
    expect(system).toContain('<instructions>');
    expect(system).toContain('Never quote prices: offer a free measure instead.');
    expect(system).toContain('not ones it declined');
  });
});
