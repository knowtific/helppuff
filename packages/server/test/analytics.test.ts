import { describe, expect, it } from 'vitest';
import { world } from './inbox-helpers.js';

/**
 * Analytics (`GET /overview`): how much the assistant handles alone, where it
 * needs help, what it brings in and what is broken, read from what HelpPuff
 * records anyway. Real SQLite, so the JSON queries over summaries run as on D1.
 */

const SITE = 'demo';
const MIN = 60_000;

type Seed = { db: { raw: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } } } };

function seed(w: Seed, now: number) {
  const run = (sql: string, ...args: unknown[]) => w.db.raw.prepare(sql).run(...args);
  const conversation = (id: string, opts: { at: number; minutes: number; messages: number; summary?: Record<string, unknown>; handover?: number; assigned?: string; visitor?: string }) =>
    run(
      'INSERT INTO conversations (id, site_id, started_at, last_at, message_count, summary, summarized_at, handover_at, assigned_name, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      SITE,
      opts.at,
      opts.at + opts.minutes * MIN,
      opts.messages,
      opts.summary ? JSON.stringify(opts.summary) : null,
      opts.summary ? opts.at + 10 * MIN : null,
      opts.handover ?? null,
      opts.assigned ?? null,
      opts.visitor ?? null,
    );
  const message = (conversationId: string, role: string, ts: number, extra: { type?: string; payload?: unknown; author?: string; feedback?: number } = {}) =>
    run(
      'INSERT INTO messages (id, conversation_id, role, type, text, payload, ts, author, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      `${conversationId}:${role}${ts}`,
      conversationId,
      role,
      extra.type ?? 'text',
      'hi',
      extra.payload === undefined ? null : JSON.stringify(extra.payload),
      ts,
      extra.author ?? null,
      extra.feedback ?? null,
    );

  const day = now - 2 * 86_400_000;
  // Answered alone, rated up, a returning visitor (they chatted before the period too).
  conversation('c_old', { at: now - 60 * 86_400_000, minutes: 2, messages: 2, visitor: 'v1' });
  conversation('c_1', { at: day, minutes: 4, messages: 4, visitor: 'v1', summary: { outcome: 'answered', sentiment: 'positive', leadQuality: 'warm', topics: ['Pricing'], unanswered: [] } });
  message('c_1', 'user', day + 1);
  message('c_1', 'agent', day + 2, { feedback: 1 });
  message('c_1', 'user', day + 3);
  // Could not answer the same question twice (in different words of case).
  conversation('c_2', { at: day + MIN, minutes: 1, messages: 2, summary: { outcome: 'unanswered', sentiment: 'negative', leadQuality: 'cold', topics: ['pricing'], unanswered: ['Do you service Penrith?'] } });
  message('c_2', 'user', day + MIN + 1);
  message('c_2', 'agent', day + MIN + 2, { feedback: -1 });
  conversation('c_3', { at: day + 2 * MIN, minutes: 1, messages: 2, summary: { outcome: 'unanswered', sentiment: 'neutral', leadQuality: 'none', topics: [], unanswered: ['do you service penrith?'] } });
  message('c_3', 'user', day + 2 * MIN + 1);
  // Handed to a person: taken by Sam 90 s later.
  conversation('c_4', { at: day + 3 * MIN, minutes: 12, messages: 8, handover: day + 4 * MIN, assigned: 'Sam', summary: { outcome: 'lead_captured', sentiment: 'positive', leadQuality: 'hot', topics: ['Emergency'], unanswered: [] } });
  message('c_4', 'user', day + 3 * MIN + 1);
  message('c_4', 'user', day + 3 * MIN + 2);
  message('c_4', 'system', day + 4 * MIN, { type: 'handover', payload: { status: 'waiting' } });
  message('c_4', 'agent', day + 4 * MIN + 90_000, { author: 'sam@acme.com' });
  // Asked for a person; nobody came.
  conversation('c_5', { at: day + 5 * MIN, minutes: 3, messages: 3, handover: day + 5 * MIN + 1 });
  message('c_5', 'user', day + 5 * MIN + 1);
  message('c_5', 'system', day + 5 * MIN + 120_000, { type: 'handover', payload: { status: 'missed' } });

  run("INSERT INTO callbacks (id, site_id, conversation_id, status, requested_at, closed_at) VALUES ('cb1', ?, 'c_5', 'done', ?, ?)", SITE, day + 6 * MIN, day + 6 * MIN + 3 * 3_600_000);
  run("INSERT INTO callbacks (id, site_id, conversation_id, status, requested_at) VALUES ('cb2', ?, 'c_2', 'open', ?)", SITE, day + 7 * MIN);

  run("INSERT INTO pipeline_stages (id, site_id, name, color, position, kind) VALUES ('st_new', ?, 'New', '#999', 0, 'open'), ('st_won', ?, 'Won', '#0a0', 1, 'won')", SITE, SITE);
  run("INSERT INTO jobs (id, site_id, number, stage_id, title, source, position, stage_changed_at, created_at, updated_at, value_cents, currency, closed_at) VALUES ('j1', ?, 1, 'st_won', 'Drain', 'chat', 0, ?, ?, ?, 48000, 'AUD', ?)", SITE, day, day, day, day + MIN);
  run("INSERT INTO jobs (id, site_id, number, stage_id, title, source, position, stage_changed_at, created_at, updated_at) VALUES ('j2', ?, 2, 'st_new', 'Tap', 'dashboard', 1, ?, ?, ?)", SITE, day, day, day);

  run(
    "INSERT INTO appointments (id, site_id, title, starts_at, ends_at, timezone, status, source, created_at, updated_at) VALUES ('a1', ?, 'Visit', ?, ?, 'UTC', 'completed', 'chat', ?, ?), ('a2', ?, 'Visit', ?, ?, 'UTC', 'no_show', 'dashboard', ?, ?)",
    SITE, day, day + 3_600_000, day, day, SITE, day, day + 3_600_000, day, day,
  );

  run("INSERT INTO webhooks (id, site_id, url, description, events, secret, enabled, last_status, last_error, created_at, updated_at) VALUES ('wh1', ?, 'https://crm.example.com/in', 'CRM', '[\"*\"]', 's', 1, 'failed', 'HTTP 500', ?, ?)", SITE, day, day);
  run('INSERT INTO usage_daily (day, site_id, neurons_est, messages, exhausted_at) VALUES (?, ?, 10000, 300, ?)', '2026-10-10', SITE, day);
}

describe('analytics', () => {
  it('says how much the assistant handled alone, what it could not answer, what went to the team and what it brought in', async () => {
    const w = await world();
    const now = Date.now();
    seed(w as unknown as Seed, now);
    const response = await w.owner.get(`/overview?days=30&site=${SITE}`);
    expect(response.status).toBe(200);
    const o = (await response.json()) as Record<string, any>;

    // c_4 and c_5 went to a person; c_2 asked for a callback too.
    expect(o.headline.current).toEqual({ summarized: 4, resolved: 1, escalated: 2, needsPerson: 3, unanswered: 2, ratedUp: 1, ratedDown: 1, callbacks: 2 });
    expect(o.insights.outcomes).toMatchObject({ answered: 1, unanswered: 2, lead_captured: 1, pending: 1 });
    expect(o.insights.sentiment).toEqual({ positive: 2, neutral: 1, negative: 1 });
    expect(o.insights.leadQuality).toMatchObject({ hot: 1, warm: 1, cold: 1, none: 1 });
    // The same question, asked twice in different case, is one line.
    expect(o.insights.unansweredQuestions).toEqual([{ text: expect.stringMatching(/penrith\?$/i), count: 2, conversationId: expect.any(String) }]);
    expect(o.insights.topics[0]).toMatchObject({ count: 2 });
    expect(o.insights.engagement).toMatchObject({ oneMessage: 3, returningVisitors: 1 });
    expect(o.insights.engagement.medianSeconds).toBe(180);
    expect(o.insights.hours).toHaveLength(24);
    expect(o.insights.live).toEqual({ requested: 2, answered: 1, missed: 1, medianWaitSeconds: 90, byPerson: [{ name: 'Sam', count: 1 }] });
    expect(o.insights.callbacks).toEqual({ requested: 2, done: 1, dismissed: 0, open: 1, medianHoursToDone: 3 });
    expect(o.insights.jobs).toEqual({ created: 2, fromChat: 1, won: 1, lost: 0, wonValue: 480, currency: 'AUD' });
    expect(o.insights.appointments).toEqual({ booked: 2, fromChat: 1, completed: 1, noShow: 1, cancelled: 0 });

    const kinds = (o.health as { kind: string; page: string }[]).map((h) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(['webhook', 'budget']));
    expect(o.health.find((h: { kind: string }) => h.kind === 'webhook')).toMatchObject({ title: expect.stringContaining('CRM'), detail: 'HTTP 500', page: '#/settings/webhooks' });
  });

  it('answers zeros, not errors, for a site that has used nothing yet', async () => {
    const w = await world();
    const o = (await (await w.owner.get(`/overview?days=7&site=${SITE}`)).json()) as Record<string, any>;
    expect(o.headline.current).toEqual({ summarized: 0, resolved: 0, escalated: 0, needsPerson: 0, unanswered: 0, ratedUp: 0, ratedDown: 0, callbacks: 0 });
    expect(o.insights.engagement.medianSeconds).toBeNull();
    expect(o.insights.live.medianWaitSeconds).toBeNull();
    expect(o.health).toEqual([]);
  });
});
