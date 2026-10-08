import { describe, expect, it, vi } from 'vitest';
import { JOB_FORM_PREFIX } from '@helppuff/protocol';
import { awaitingSetup, customise, setupAfterLearning, setupJobs } from '../src/jobs/setup.js';
import { TEMPLATES } from '../src/jobs/templates.js';
import { validateTemplate } from '../src/jobs/store.js';
import { jobsHandle } from '../src/jobs/chat.js';
import { forgetPipeline, quoteActionId, withQuote } from '../src/jobs/widget.js';
import { chat, say, world } from './inbox-helpers.js';
import { withForms } from './helpers.js';

/**
 * Jobs: the templates, the pipeline the owner edits, jobs and their history,
 * the AI choosing a template from the website, and jobs from the chat (the
 * assistant's tool and the widget's quote questions).
 */

type Json = Record<string, any>;
const json = async (response: Response) => (await response.json()) as Json;

describe('templates', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s is a valid pipeline with a question for every field', (_id, template) => {
    expect(() => validateTemplate(template)).not.toThrow();
    for (const field of template.fields) expect(field.question.length).toBeGreaterThan(3);
  });
});

describe('the pipeline', () => {
  it('starts from the basic template, and the owner edits stages, fields and the quote questions', async () => {
    const w = await world();
    const first = await json(await w.owner.get('/jobs/pipeline'));
    expect(first['pipeline']).toMatchObject({ template: 'basic', chosenBy: 'default', itemPlural: 'Jobs' });
    expect(first['templates'].map((t: Json) => t.id)).toContain('service-quote');

    const chosen = await json(await w.owner.send('POST', '/jobs/pipeline/template', { template: 'service-quote' }));
    const stages = chosen['pipeline'].stages as Json[];
    expect(stages.map((s) => s.name)).toEqual(['New request', 'Site visit', 'Quote sent', 'Booked', 'In progress', 'Done', 'Lost']);

    // Remove "Site visit", rename "Quote sent", add "Deposit paid".
    const next = stages.filter((s) => s.name !== 'Site visit').map((s) => (s.name === 'Quote sent' ? { ...s, name: 'Quoted' } : s));
    next.splice(3, 0, { name: 'Deposit paid', kind: 'open', color: '#14b8a6' });
    const fields = (chosen['pipeline'].fields as Json[]).filter((f) => f.name !== 'property_type');
    fields.push({ label: 'Gate code', type: 'text', question: 'Is there a gate code?' });
    const saved = await json(await w.owner.send('PUT', '/jobs/pipeline', { stages: next, fields, quote: ['description', 'service', 'gate_code'], quoteLabel: 'Get a free quote' }));
    expect(saved['pipeline'].stages.map((s: Json) => s.name)).toEqual(['New request', 'Quoted', 'Booked', 'Deposit paid', 'In progress', 'Done', 'Lost']);
    expect(saved['pipeline'].fields.find((f: Json) => f.name === 'property_type')).toMatchObject({ archived: true });
    expect(saved['pipeline'].quotePreview.map((s: Json) => s.field)).toEqual(['description', 'service', 'gate_code', 'contact_name', 'contact_email', 'contact_phone']);
    expect(saved['pipeline']).toMatchObject({ chosenBy: 'owner', quote: { label: 'Get a free quote' } });

    // A pipeline always keeps an open, a won and a lost stage.
    const noWon = await w.owner.send('PUT', '/jobs/pipeline', { stages: next.filter((s) => s.kind !== 'won') });
    expect(noWon.status).toBe(400);
  });

  it('puts the quote questions in the widget, under their own key (a deploy never drops them)', async () => {
    const w = await world();
    await w.owner.send('POST', '/jobs/pipeline/template', { template: 'service-quote' });
    const config = (await json(await w.h.fetch('/v1/sites/demo/config')))['widget'];
    const flow = (config.flows as Json[]).find((f) => f.id === 'job-quote');
    expect(flow).toMatchObject({ submit: { as: 'job' } });
    expect(flow!.steps[0]).toMatchObject({ field: 'service' });
    expect(config.home.shortcuts[0]).toMatchObject({ id: 'job-quote', label: 'Get a quote', action: { kind: 'flow', flowId: 'job-quote' } });
    await w.owner.send('PUT', '/jobs/pipeline', { quoteEnabled: false });
    const off = (await json(await w.h.fetch('/v1/sites/demo/config')))['widget'];
    expect((off.flows ?? []).some((f: Json) => f.id === 'job-quote')).toBe(false);
  });

  it("replaces the site's own shortcut with the same label, so the home screen has one", () => {
    const quote = { flow: { id: 'job-quote', steps: [], submit: { as: 'job' } }, shortcut: { id: 'job-quote', label: 'Get a quote', action: { id: 'job-quote', kind: 'flow', label: 'Get a quote', flowId: 'job-quote' } } } as unknown as Parameters<typeof withQuote>[1];
    const own = { home: { shortcuts: [{ id: 'quote', label: 'Get a Quote ', action: { id: 'q', kind: 'flow', label: 'x', flowId: 'quote' } }, { id: 'call', label: 'Call us', action: { id: 'c', kind: 'tel', label: 'Call', phone: '1' } }] } } as unknown as Parameters<typeof withQuote>[0];
    expect(withQuote(own, quote).home.shortcuts!.map((s) => s.id)).toEqual(['job-quote', 'call']);
  });
});

describe('jobs', () => {
  it('creates jobs from the API with their contact, numbers them, and checks fields', async () => {
    const w = await world();
    await w.owner.send('POST', '/jobs/pipeline/template', { template: 'service-quote' });
    const created = await w.owner.send('POST', '/jobs', { details: 'Kitchen sink gurgles', fields: { service: 'Blocked drains', urgency: 'this week', address: 'Balmain' }, contact: { name: 'Ada Lovelace', email: 'Ada@Example.com' }, value: 450 });
    expect(created.status).toBe(201);
    const job = await json(created);
    expect(job).toMatchObject({ number: 1001, status: 'open', stage: { name: 'New request' }, fields: { urgency: 'This week' }, contact: { name: 'Ada Lovelace', email: 'ada@example.com' }, value: 450, source: 'manual' });
    expect(job['title']).toBe('Blocked drains for Ada Lovelace');
    // Same email: the same contact; numbers go on.
    const second = await json(await w.owner.send('POST', '/jobs', { contact: { email: 'ada@example.com', phone: '0400 111 222' }, fields: { description: 'Hot water is cold' } }));
    expect(second).toMatchObject({ number: 1002, contact: { id: job['contact'].id, phone: '0400 111 222' } });
    expect((await w.owner.send('POST', '/jobs', { fields: { colour: 'red' } })).status).toBe(400);
    expect((await w.owner.send('POST', '/jobs', { fields: { urgency: 'Yesterday' } })).status).toBe(400);
    const contact = await json(await w.owner.get(`/leads/${job['contact'].id}`));
    expect(contact['email']).toBe('ada@example.com');
  });

  it('keeps a history of every change, moves through stages, and a won job makes the contact won', async () => {
    const w = await world();
    await w.owner.send('POST', '/jobs/pipeline/template', { template: 'service-quote' });
    const pipeline = (await json(await w.owner.get('/jobs/pipeline')))['pipeline'];
    const stage = (name: string) => (pipeline.stages as Json[]).find((s) => s.name === name)!.id;
    const job = await json(await w.owner.send('POST', '/jobs', { contact: { name: 'Bo', email: 'bo@example.com' }, fields: { description: 'Leaking tap', address: 'Rozelle' } }));
    const other = await json(await w.owner.send('POST', '/jobs', { fields: { description: 'Second', address: 'Glebe' } }));

    await w.owner.send('PATCH', `/jobs/${job['id']}`, { fields: { address: '12 Darling St, Rozelle', urgency: null }, value: 300, assignedTo: 'me' });
    await w.owner.send('POST', `/jobs/${job['id']}/updates`, { text: 'Parts ordered, back Thursday.' });
    await w.owner.send('POST', `/jobs/${job['id']}/notes`, { text: 'Gate code 4471' });
    await w.owner.send('POST', `/jobs/${job['id']}/move`, { stageId: stage('Quote sent') });
    // Reorder within a column: above the other job.
    await w.owner.send('POST', `/jobs/${other['id']}/move`, { stageId: stage('Quote sent') });
    const top = await json(await w.owner.send('POST', `/jobs/${other['id']}/move`, { before: job['id'] }));
    const column = (await json(await w.owner.get(`/jobs?stage=${stage('Quote sent')}`)))['items'] as Json[];
    expect(column.map((j) => j.id)).toEqual([top['id'], job['id']]);

    const won = await json(await w.owner.send('POST', `/jobs/${job['id']}/move`, { stageId: stage('Done') }));
    expect(won).toMatchObject({ status: 'won', closedAt: expect.any(Number) });
    expect((await json(await w.owner.get(`/leads/${job['contact'].id}`)))['status']).toBe('won');
    expect(((await json(await w.owner.get('/jobs')))['items'] as Json[]).some((j) => j.id === job['id'])).toBe(false);
    expect(((await json(await w.owner.get('/jobs?status=won')))['items'] as Json[]).map((j) => j.id)).toEqual([job['id']]);

    const detail = await json(await w.owner.get(`/jobs/${job['id']}`));
    expect((detail['history'] as Json[]).map((e) => e.kind)).toEqual(['created', 'field', 'value', 'assigned', 'update', 'stage', 'stage']);
    expect((detail['history'] as Json[]).find((e) => e.kind === 'field')!.data).toMatchObject({ field: 'address', from: 'Rozelle', to: '12 Darling St, Rozelle' });
    expect((detail['history'] as Json[]).at(-1)!.data).toMatchObject({ from: 'Quote sent', to: 'Done', kind: 'won' });
    expect(detail['notes'][0]).toMatchObject({ text: 'Gate code 4471' });

    const lost = await json(await w.owner.send('POST', `/jobs/${other['id']}/move`, { stageId: stage('Lost'), lostReason: 'Went with another quote' }));
    expect(lost).toMatchObject({ status: 'lost', lostReason: 'Went with another quote' });
  });

  it('lets members work jobs but not configure them or delete them', async () => {
    const w = await world();
    const mo = await w.member();
    const job = await json(await mo.send('POST', '/jobs', { fields: { description: 'From a member' } }));
    expect(job['number']).toBe(1001);
    expect((await mo.get('/jobs/pipeline')).status).toBe(200);
    expect((await mo.send('PUT', '/jobs/pipeline', { quoteEnabled: false })).status).toBe(403);
    expect((await mo.send('POST', '/jobs/setup')).status).toBe(403);
    expect((await mo.send('DELETE', `/jobs/${job['id']}`)).status).toBe(403);
    expect((await mo.send('PATCH', `/jobs/${job['id']}`, { assignedTo: 'owner@acme.com' })).status).toBe(403);
    expect(await json(await mo.send('PATCH', `/jobs/${job['id']}`, { assignedTo: 'me' }))).toMatchObject({ assignedTo: 'mo@acme.com' });
    expect((await w.owner.send('DELETE', `/jobs/${job['id']}`)).status).toBe(200);
  });

  it('turns a callback request into a job with its contact and conversation', async () => {
    const w = await world();
    const { id } = await chat(w.h, 'Please call me about a leak');
    await w.settle();
    w.db.raw.prepare("INSERT INTO callbacks (id, site_id, conversation_id, name, reason, status, requested_at) VALUES ('cb1', 'demo', ?, 'Ada', 'A leak under the sink', 'open', 1)").run(id);
    const job = await json(await w.owner.send('POST', '/jobs', { callbackId: 'cb1' }));
    expect(job).toMatchObject({ source: 'callback', conversationId: id, details: 'A leak under the sink' });
  });
});

describe('the AI setting it up', () => {
  const reply = (content: object) => ({ run: async () => ({ response: JSON.stringify(content) }) });

  it('customises within limits, and falls back to basic when unsure', () => {
    const plumbing = customise({
      template: 'service-quote',
      confidence: 0.9,
      reason: 'A plumber with free on-site quotes.',
      services: ['Blocked drains', 'Hot water', 'Gas fitting'],
      renameStages: { 'Site visit': 'Free inspection' },
      addStages: [{ name: 'Deposit paid', after: 'Booked' }],
      addFields: [{ label: 'Roof access', type: 'select', options: ['Yes', 'No'], question: 'Is there roof access?' }],
    });
    expect(plumbing.confident).toBe(true);
    expect(plumbing.template.stages.map((s) => s.name)).toEqual(['New request', 'Free inspection', 'Quote sent', 'Booked', 'Deposit paid', 'In progress', 'Done', 'Lost']);
    expect(plumbing.template.fields.find((f) => f.name === 'service')?.options).toEqual(['Blocked drains', 'Hot water', 'Gas fitting']);
    expect(plumbing.template.fields.at(-1)).toMatchObject({ name: 'roof_access', type: 'select', options: ['Yes', 'No'] });
    expect(customise({ template: 'service-quote', confidence: 0.3 }).template.id).toBe('basic');
    expect(customise({ template: 'nonsense', confidence: 1 }).template.id).toBe('basic');
    expect(customise(null).template.id).toBe('basic');
    // A select field the site gave no options for becomes text.
    expect(customise({ template: 'projects', confidence: 0.8 }).template.fields.find((f) => f.name === 'project_type')?.type).toBe('text');
  });

  it("reads the website, saves the choice, and never replaces the owner's pipeline unless asked", async () => {
    const w = await world();
    const ai = reply({ template: 'support', confidence: 0.8, reason: 'A SaaS product with a help centre.', services: ['Billing', 'Integrations'] });
    const first = await setupJobs({ db: w.db, ai, model: 'm', now: Date.now }, 'demo', 'Acme is a project management app. Help centre. Pricing per seat.');
    expect(first).toMatchObject({ template: 'support', chosenBy: 'ai', applied: true });
    const pipeline = await json(await w.owner.get('/jobs/pipeline'));
    expect(pipeline['pipeline']).toMatchObject({ template: 'support', reason: 'A SaaS product with a help centre.' });
    expect((pipeline['pipeline'].fields as Json[]).find((f) => f.name === 'product_area')!.options).toEqual(['Billing', 'Integrations']);

    await w.owner.send('PUT', '/jobs/pipeline', { itemSingular: 'Ticket', itemPlural: 'Tickets' });
    const again = await setupJobs({ db: w.db, ai: reply({ template: 'bookings', confidence: 0.9 }), model: 'm', now: Date.now }, 'demo', 'text');
    expect(again.applied).toBe(false);
    const forced = await setupJobs({ db: w.db, ai: reply({ template: 'bookings', confidence: 0.9 }), model: 'm', now: Date.now }, 'demo', 'text', { force: true });
    expect(forced).toMatchObject({ template: 'bookings', applied: true });
  });

  it('sets itself up once the website is learned (the crawl\'s end), once, and publishes the quote questions', async () => {
    const w = await world();
    const kv = w.env['HELPPUFF_KV'] as { get: (key: string) => Promise<string | null> };
    const deps = { db: w.db, ai: reply({ template: 'service-quote', confidence: 0.9, reason: 'A plumber.', services: ['Hot water'] }), kv: w.env['HELPPUFF_KV'] as never, now: Date.now };
    // Nothing learned yet: nothing to read, nothing done.
    expect(await setupAfterLearning(deps, 'demo')).toBeNull();
    w.db.raw.prepare("INSERT INTO site_facts (site_id, key, value) VALUES ('demo', 'services', 'Hot water, blocked drains')").run();
    expect(await setupAfterLearning(deps, 'demo')).toMatchObject({ template: 'service-quote', chosenBy: 'ai', applied: true });
    expect(JSON.parse((await kv.get('quote:demo'))!)).toMatchObject({ shortcut: { label: 'Get a quote' } });
    // Once: a later crawl leaves it alone, and so does one after the owner's edits.
    expect(await setupAfterLearning({ ...deps, ai: reply({ template: 'support', confidence: 0.9 }) }, 'demo')).toBeNull();
  });

  it('after a deploy (force: false): the pipeline at once, the AI choice when there is something to read, never twice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('offline', { status: 503 })));
    try {
      // HelpPuff's own knowledge base, still learning: the pipeline exists (the assistant can make jobs), the choice waits.
      const learning = await world({ connector: { type: 'workers-ai', options: {} } } as never);
      const waiting = await json(await learning.owner.send('POST', '/jobs/setup', { force: false }));
      expect(waiting).toMatchObject({ status: 'waiting', pipeline: { template: 'basic', chosenBy: 'default' } });
      expect(await awaitingSetup(learning.db, 'demo')).toBe(true);

      // Another backend: the home page now (unreachable here: the basic template, with its reason).
      const w = await world();
      expect(await json(await w.owner.send('POST', '/jobs/setup', { force: false }))).toMatchObject({ status: 'done', template: 'basic', applied: true });
      await w.owner.send('PUT', '/jobs/pipeline', { itemSingular: 'Quote' });
      expect(await json(await w.owner.send('POST', '/jobs/setup', { force: false }))).toMatchObject({ status: 'kept', pipeline: { itemSingular: 'Quote' } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the basic template without an AI or without anything to read', async () => {
    const w = await world();
    expect(await setupJobs({ db: w.db, model: 'm', now: Date.now }, 'demo', '')).toMatchObject({ template: 'basic', chosenBy: 'default' });
  });
});

describe('jobs from the chat', () => {
  it("saves the quote questions' answers as a job, with the contact, and confirms its number", async () => {
    const w = await world();
    await w.owner.send('POST', '/jobs/pipeline/template', { template: 'service-quote' });
    const { token, id } = await chat(w.h);
    await w.settle();
    const answers = { service: 'Hot water', description: 'No hot water since this morning', address: 'Glebe', urgency: 'Emergency', contact_name: 'Grace Hopper', contact_email: 'grace@example.com', contact_phone: '0400 333 444' };
    const response = await json(await say(w.h, token, { kind: 'action', actionId: quoteActionId, value: JSON.stringify(answers), label: 'Get a quote: Hot water' }));
    expect(response['messages'][0].text).toBe('Thanks Grace! Your request is **#1001**. The team will be in touch soon.');
    const jobs = (await json(await w.owner.get('/jobs')))['items'] as Json[];
    expect(jobs[0]).toMatchObject({ number: 1001, source: 'quote', conversationId: id, fields: { service: 'Hot water', urgency: 'Emergency', address: 'Glebe' }, contact: { name: 'Grace Hopper', email: 'grace@example.com' } });
    expect(jobs[0]!['fields']['contact_name']).toBeUndefined();
  });

  it("fills in the chat's own contact (from the lead form) instead of making a second one", async () => {
    const w = await world();
    await w.owner.send('POST', '/jobs/pipeline/template', { template: 'service-quote' });
    const { token, id } = await chat(w.h);
    await w.settle();
    // The lead form gave a name and phone, no email.
    await w.db.prepare("INSERT INTO leads (id, site_id, conversation_id, name, phone, source, status, created_at, updated_at) VALUES ('lead_q', 'demo', ?, 'Quinn', '0400 123 456', 'form', 'new', 1, 1)").bind(id).run();
    await w.db.prepare("UPDATE conversations SET lead_id = 'lead_q' WHERE id = ?").bind(id).run();
    const answers = { description: 'Leaking tank', address: 'Glebe', contact_name: 'Quinn Q', contact_email: 'quinn@example.com' };
    const response = await say(w.h, token, { kind: 'action', actionId: quoteActionId, value: JSON.stringify(answers), label: 'Get a quote' });
    expect(response.status).toBe(200);
    await w.settle();
    const leads = await w.db.prepare('SELECT id, name, email, phone FROM leads').all<Json>();
    expect(leads.results).toEqual([{ id: 'lead_q', name: 'Quinn', email: 'quinn@example.com', phone: '0400 123 456' }]);
    const job = ((await json(await w.owner.get('/jobs')))['items'] as Json[])[0]!;
    expect(job['contact']).toMatchObject({ id: 'lead_q', email: 'quinn@example.com' });
  });

  it('refuses quote answers when the site has no quote questions', async () => {
    const w = await world();
    await w.owner.send('POST', '/jobs/pipeline/template', { template: 'service-quote' });
    await w.owner.send('PUT', '/jobs/pipeline', { quoteEnabled: false });
    const { token } = await chat(w.h);
    expect((await say(w.h, token, { kind: 'action', actionId: quoteActionId, value: '{"service":"x"}', label: 'Quote' })).status).toBe(400);
  });

  it("gives the assistant a create_job handle, and its form for missing details completes that job", async () => {
    const w = await world();
    await w.owner.send('POST', '/jobs/pipeline/template', { template: 'service-quote' });
    forgetPipeline();
    const { token, id } = await chat(w.h, 'My drain is blocked, can I get a quote?');
    await w.settle();
    const added: Json[] = [];
    const ctx = { env: w.env, secret: 'x', config: {}, platform: { now: Date.now, waitUntil: () => {}, log: () => {}, kv: w.env['HELPPUFF_KV'] } } as never;
    const jobs = await jobsHandle(ctx, 'demo', id, added as never);
    expect(jobs?.fields.map((f) => f.name)).toContain('service');
    const saved = await jobs!.create({ title: 'Blocked drain', summary: 'Kitchen drain blocked since Monday.', fields: { service: 'Blocked drains' } });
    expect(saved).toEqual({ number: 1001, missing: ['Description', 'Address or suburb'] });
    // Once per turn.
    expect(await jobs!.create({ fields: {} })).toBeNull();
    const form = added[0]!;
    expect(form).toMatchObject({ type: 'form', id: expect.stringMatching(new RegExp(`^${JOB_FORM_PREFIX}`)) });
    expect((form['fields'] as Json[]).map((f) => f.name)).toEqual(['description', 'address']);

    // The visitor fills it in (the form was shown in this chat, so the token carries it).
    const withForm = await withForms(token, [form['id']]);
    const answered = await json(await say(w.h, withForm, { kind: 'action', actionId: form['id'], value: JSON.stringify({ description: 'Kitchen drain, slow for a week', address: 'Annandale' }), label: 'Send' }));
    expect(answered['messages'][0].text).toContain('#1001');
    const job = (await json(await w.owner.get('/jobs')))['items'][0] as Json;
    expect(job).toMatchObject({ title: 'Blocked drain', source: 'chat', conversationId: id, fields: { service: 'Blocked drains', address: 'Annandale', description: 'Kitchen drain, slow for a week' } });
    const history = (await json(await w.owner.get(`/jobs/${job['id']}`)))['history'] as Json[];
    expect(history.filter((e) => e.kind === 'field' && e.actor === 'visitor')).toHaveLength(2);
  });

  it('gives no handle when the owner turned the assistant off', async () => {
    const w = await world();
    await w.owner.send('PUT', '/jobs/pipeline', { assistantJobs: false });
    forgetPipeline();
    const ctx = { env: w.env, secret: 'x', config: {}, platform: { now: Date.now, waitUntil: () => {}, log: () => {}, kv: w.env['HELPPUFF_KV'] } } as never;
    expect(await jobsHandle(ctx, 'demo', 'c1', [])).toBeUndefined();
  });
});
