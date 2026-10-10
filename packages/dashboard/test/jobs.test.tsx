import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsSettings } from '../src/components/JobsSettings';
import { describeEvent, Jobs } from '../src/pages/Jobs';
import { concerns } from '../src/lib/attention';
import type { Job, JobField, JobStage, Pipeline, PipelineView } from '../src/lib/api';
import { button, byText, click, fakeApi, flush, me, mount, select, type, unmount } from './helpers';

/**
 * Jobs in the dashboard: the board (moving by the menu, a reason for a lost
 * one), the list view remembered, a job's panel with its history in words,
 * Settings → Jobs saving whole lists, and the alert for a new job.
 */

const stage = (id: string, name: string, position: number, kind: JobStage['kind'] = 'open'): JobStage => ({ id, name, color: '#3b82f6', position, kind, rotDays: null });
const STAGES = [stage('s_new', 'New request', 0), stage('s_visit', 'Site visit', 1), stage('s_won', 'Done', 2, 'won'), stage('s_lost', 'Lost', 3, 'lost')];
const field = (name: string, label: string, extra: Partial<JobField> = {}): JobField => ({ id: `f_${name}`, name, label, type: 'text', required: false, options: [], question: null, position: 0, inQuote: false, quotePosition: null, archived: false, ...extra });
const PIPELINE: Pipeline = {
  siteId: 'acme',
  template: 'service-quote',
  itemSingular: 'Job',
  itemPlural: 'Jobs',
  chosenBy: 'ai',
  reason: 'A plumber.',
  assistantJobs: true,
  quote: { enabled: true, label: 'Get a quote', askContact: true },
  editedAt: null,
  stages: STAGES,
  fields: [field('service', 'Service', { type: 'select', options: ['Hot water', 'Drains'], inQuote: true, quotePosition: 0, question: 'Which service?' }), field('address', 'Address', { required: true, inQuote: true, quotePosition: 1 })],
  quotePreview: [{ field: 'service', ask: 'Which service?', input: 'choice', choices: ['Hot water', 'Drains'] }],
};
const VIEW: PipelineView = { pipeline: PIPELINE, templates: [{ id: 'service-quote', name: 'Service quote', description: 'Trades.', stages: [], fields: [] }, { id: 'basic', name: 'Basic', description: 'Simple.', stages: [], fields: [] }] };

const job = (id: string, number: number, stageId: string, extra: Partial<Job> = {}): Job => {
  const s = STAGES.find((x) => x.id === stageId)!;
  return {
    id,
    number,
    title: `Job ${number}`,
    details: null,
    stage: { id: s.id, name: s.name, kind: s.kind },
    status: s.kind,
    fields: { service: 'Hot water', address: 'Glebe' },
    contact: { id: 'l1', name: 'Ada', email: 'ada@example.com', phone: null },
    conversationId: null,
    source: 'chat',
    value: null,
    valueCents: null,
    currency: null,
    dueAt: null,
    assignedTo: null,
    assignedName: null,
    position: number,
    stale: false,
    stageChangedAt: Date.now(),
    closedAt: null,
    lostReason: null,
    createdAt: Date.now() - 3 * 86_400_000,
    updatedAt: Date.now(),
    ...extra,
  };
};
const LIST = { items: [job('j1', 1001, 's_new'), job('j2', 1002, 's_visit', { stale: true, valueCents: 45000, currency: 'AUD' })], stages: STAGES.map((s) => ({ ...s, count: s.kind === 'open' ? 1 : 0, valueCents: s.id === 's_visit' ? 45000 : 0 })) };

class NoSocket {
  readyState = 0;
  send() {}
  close() {}
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoSocket);
  localStorage.clear();
  window.location.hash = '#/jobs';
});
afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the board', () => {
  it('shows a column per open stage, then how a job ends, and moves a job from its menu', async () => {
    const calls = fakeApi({ 'GET /jobs/pipeline': VIEW, 'GET /jobs': LIST, 'POST /jobs/j1/move': job('j1', 1001, 's_visit') });
    const page = await mount(<Jobs me={me('owner')} />);
    const columns = [...page.querySelectorAll('section[aria-label]')].map((s) => s.getAttribute('aria-label'));
    expect(columns).toEqual(['New request', 'Site visit', 'Done', 'Lost']);
    expect(page.querySelector('section[aria-label="Site visit"]')!.textContent).toMatch(/\$450/);
    expect(byText(page, 'Stale')).toBeTruthy();
    await select(page.querySelector('select[aria-label="Move Job 1001 to"]'), 's_visit');
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/jobs/j1/move', body: { stageId: 's_visit' } });
  });

  it('asks why when a job is lost, and sends the reason', async () => {
    const calls = fakeApi({ 'GET /jobs/pipeline': VIEW, 'GET /jobs': LIST, 'POST /jobs/j2/move': {} });
    vi.spyOn(window, 'prompt').mockReturnValue('Too expensive');
    const page = await mount(<Jobs me={me('owner')} />);
    await select(page.querySelector('select[aria-label="Move Job 1002 to"]'), 's_lost');
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/jobs/j2/move', body: { stageId: 's_lost', lostReason: 'Too expensive' } });
  });

  it('remembers the list view, and asks the server for every status there', async () => {
    const calls = fakeApi({ 'GET /jobs/pipeline': VIEW, 'GET /jobs': LIST });
    const page = await mount(<Jobs me={me('member')} />);
    await click(button(page, 'List'));
    expect(localStorage.getItem('hp-jobs-view')).toContain('list');
    await select(page.querySelector('select[aria-label="Show"]'), 'all');
    await flush();
    expect(calls.some((c) => c.path.startsWith('/jobs?status=all'))).toBe(true);
    expect(page.querySelector('table')!.textContent).toContain('Job 1002');
  });
});

describe('a job', () => {
  it('shows its history in words and adds an update', async () => {
    const detail = {
      ...job('j1', 1001, 's_visit'),
      history: [
        { id: 'e1', at: 1, actor: 'visitor', actorName: 'The visitor', kind: 'created', data: { source: 'quote', stage: 'New request' } },
        { id: 'e2', at: 2, actor: 'owner@acme.test', actorName: 'Olivia', kind: 'stage', data: { from: 'New request', to: 'Site visit' } },
      ],
      notes: [],
      conversation: null,
    };
    const calls = fakeApi({ 'GET /jobs/pipeline': VIEW, 'GET /jobs': LIST, 'GET /jobs/j1': detail, 'POST /jobs/j1/updates': {} });
    const page = await mount(<Jobs id="j1" me={me('owner')} />);
    expect(page.textContent).toContain('Created from the quote questions, in New request');
    expect(page.textContent).toContain('Moved from New request to Site visit');
    await type(page.querySelector('textarea[aria-label="Update"]'), 'Parts ordered.');
    await click(button(page, 'Add to history'));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/jobs/j1/updates', body: { text: 'Parts ordered.' } });
  });

  it('describes every kind of event', () => {
    const e = (kind: string, data: Record<string, unknown>) => describeEvent({ id: 'x', at: 0, actor: 'a', actorName: null, kind, data });
    expect(e('field', { label: 'Urgency', from: null, to: 'Emergency' })).toBe('Urgency: empty → Emergency');
    expect(e('stage', { from: 'Quote sent', to: 'Lost', reason: 'Too far' })).toBe('Moved from Quote sent to Lost: Too far');
    expect(e('assigned', { to: null })).toBe('Unassigned');
    expect(e('update', { text: 'Booked.' })).toBe('Booked.');
  });
});

describe('Settings → Jobs', () => {
  it('saves the stages as a whole list, ids kept, and refuses to lose the last won stage', async () => {
    const calls = fakeApi({ 'GET /jobs/pipeline': VIEW, 'PUT /jobs/pipeline': VIEW });
    const page = await mount(<JobsSettings />);
    const stages = page.querySelector('[aria-label="Stages"]')!;
    await type(stages.querySelectorAll('input[aria-label="Stage name"]')[1]!, 'Inspection');
    await click(button(stages, 'Save'));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect((put.body as { stages: { id?: string; name: string }[] }).stages.map((s) => [s.id, s.name])).toEqual([
      ['s_new', 'New request'],
      ['s_visit', 'Inspection'],
      ['s_won', 'Done'],
      ['s_lost', 'Lost'],
    ]);
    await click(button(stages, 'Remove Done'));
    expect(stages.textContent).toContain('Keep at least one won stage.');
  });

  it('adds a field and orders the quote questions', async () => {
    const calls = fakeApi({ 'GET /jobs/pipeline': VIEW, 'PUT /jobs/pipeline': VIEW });
    const page = await mount(<JobsSettings />);
    const fields = page.querySelector('[aria-label="Fields"]')!;
    await click(button(fields, 'Add a field'));
    const labels = fields.querySelectorAll('input[aria-label="Field label"]');
    await type(labels[labels.length - 1]!, 'Gate code');
    await click(button(fields, 'Save'));
    expect((calls.find((c) => c.method === 'PUT')!.body as { fields: { label: string; id?: string }[] }).fields.at(-1)).toMatchObject({ label: 'Gate code', type: 'text', required: false });

    const quote = page.querySelector('[aria-label="Quote questions"]')!;
    await click(button(quote, 'Move Address up'));
    await click(button(quote, 'Save'));
    expect(calls.filter((c) => c.method === 'PUT').at(-1)!.body).toMatchObject({ quote: ['address', 'service'], quoteEnabled: true, quoteContact: true });
  });
});

describe('alerts', () => {
  it('tells everyone about a new job from the chat, the quote questions or the API, not one added by hand', () => {
    window.location.hash = '#/home';
    const event = { t: 'job', jobId: 'j9', number: 1009, title: 'Hot water in Glebe', who: 'Ada', source: 'quote' };
    expect(concerns(event, 'owner@acme.test', false)).toMatchObject({ kind: 'job', link: '#/jobs/j9', title: 'New request #1009 from the quote questions', body: 'Ada: Hot water in Glebe' });
    expect(concerns({ ...event, source: 'manual' }, 'owner@acme.test', true)).toBeNull();
    window.location.hash = '#/jobs/j9';
    expect(concerns(event, 'owner@acme.test', true)).toBeNull();
  });
});
