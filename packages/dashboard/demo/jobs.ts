import type { Job, JobEvent, JobField, JobStage, JobTemplate, Note, Pipeline } from '../src/lib/api';
import { SITE, conversations, leads } from './data';

/**
 * Jobs in the demo: the pipeline the AI chose for a plumber (service quotes),
 * and jobs for some of the sample contacts, answered like `/admin/api/jobs*`.
 * Changes stick until the page is reloaded.
 */

const DAY = 86_400_000;
const NOW = Date.now();
const ME = { id: 'owner@harbourplumbing.example', name: 'Dan' };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const bad = (message: string) => json({ error: { code: 'bad_request', message } }, 400);
const notFound = () => json({ error: { code: 'not_found', message: 'Not in the demo.' } }, 404);

const stage = (id: string, name: string, color: string, position: number, kind: JobStage['kind'], rotDays: number | null): JobStage => ({ id, name, color, position, kind, rotDays });
const field = (name: string, label: string, type: JobField['type'], position: number, extra: Partial<JobField> = {}): JobField => ({
  id: `fld_${name}`,
  name,
  label,
  type,
  required: false,
  options: [],
  question: null,
  position,
  inQuote: false,
  quotePosition: null,
  archived: false,
  ...extra,
});

const TEMPLATES: JobTemplate[] = [
  { id: 'service-quote', name: 'Service quote', description: 'Trades and services that quote before the work.', stages: [], fields: [] },
  { id: 'projects', name: 'Projects', description: 'Bigger work in phases: design, build, handover.', stages: [], fields: [] },
  { id: 'support', name: 'Support tickets', description: 'Software and products: questions and problems to solve.', stages: [], fields: [] },
  { id: 'sales-demo', name: 'Sales demos', description: 'B2B: a demo, a trial, a deal.', stages: [], fields: [] },
  { id: 'bookings', name: 'Bookings', description: 'Appointments and reservations.', stages: [], fields: [] },
  { id: 'custom-orders', name: 'Custom orders', description: 'Made-to-order products.', stages: [], fields: [] },
  { id: 'basic', name: 'Basic', description: 'New, quote sent, in progress, done.', stages: [], fields: [] },
];

const pipeline: Pipeline = {
  siteId: SITE.id,
  template: 'service-quote',
  itemSingular: 'Job',
  itemPlural: 'Jobs',
  chosenBy: 'ai',
  reason: 'A plumbing business in Sydney’s inner west that quotes and books callouts: hot water, blocked drains, leaks and gas fitting.',
  assistantJobs: true,
  quote: { enabled: true, label: 'Get a quote', askContact: true },
  editedAt: null,
  stages: [
    stage('stg_new', 'New request', '#3b82f6', 0, 'open', 1),
    stage('stg_visit', 'Site visit', '#8b5cf6', 1, 'open', 3),
    stage('stg_quote', 'Quote sent', '#f59e0b', 2, 'open', 7),
    stage('stg_booked', 'Booked', '#14b8a6', 3, 'open', 14),
    stage('stg_work', 'In progress', '#6b7280', 4, 'open', 14),
    stage('stg_done', 'Done', '#16a34a', 5, 'won', null),
    stage('stg_lost', 'Lost', '#dc2626', 6, 'lost', null),
  ],
  fields: [
    field('service', 'Service', 'select', 0, { options: ['Hot water', 'Blocked drains', 'Leaks', 'Gas fitting', 'Bathroom renovation'], question: 'Which service do you need?', inQuote: true, quotePosition: 0 }),
    field('description', 'Description', 'textarea', 1, { required: true, question: 'What do you need? A sentence or two is plenty.', inQuote: true, quotePosition: 1 }),
    field('address', 'Address or suburb', 'text', 2, { required: true, question: 'Where is the job? An address or suburb.', inQuote: true, quotePosition: 2 }),
    field('urgency', 'Urgency', 'select', 3, { options: ['Emergency', 'This week', 'Within a month', 'Flexible'], question: 'How soon do you need it?', inQuote: true, quotePosition: 3 }),
    field('preferred_date', 'Preferred date', 'date', 4),
    field('property_type', 'Property type', 'select', 5, { options: ['House', 'Apartment', 'Commercial'] }),
  ],
  quotePreview: [],
};

function preview(): Pipeline['quotePreview'] {
  if (!pipeline.quote.enabled) return [];
  const steps = pipeline.fields
    .filter((f) => f.inQuote && !f.archived)
    .sort((a, b) => (a.quotePosition ?? a.position) - (b.quotePosition ?? b.position))
    .map((f) => ({ field: f.name, ask: f.question ?? `${f.label}?`, input: f.type === 'select' ? 'choice' : 'text', ...(f.type === 'select' ? { choices: f.options } : {}) }));
  if (pipeline.quote.askContact && steps.length) {
    steps.push({ field: 'contact_name', ask: 'What’s your name?', input: 'text' }, { field: 'contact_email', ask: 'And your email, so we can send it to you?', input: 'email' }, { field: 'contact_phone', ask: 'A phone number, if you’d like a call (or skip).', input: 'phone' });
  }
  return steps;
}
const view = () => ({ pipeline: { ...pipeline, quotePreview: preview() }, templates: TEMPLATES });

// --------------------------------------------------------------- the jobs

type Stored = Omit<Job, 'stage' | 'status' | 'stale' | 'contact' | 'value'> & { stageId: string; leadId: string | null; history: JobEvent[]; notes: Note[] };
const jobs: Stored[] = [];
let events = 0;
const event = (kind: string, at: number, data: Record<string, unknown>, actor = ME): JobEvent => ({ id: `evt_${++events}`, at, actor: actor.id, actorName: actor.name, kind, data });

{
  const SAMPLES: { service: string; description: string; suburb: string; urgency: string; stage: string; value: number | null; days: number; source: Job['source']; update?: string }[] = [
    { service: 'Hot water', description: 'Electric hot water system leaking from the base, about 12 years old.', suburb: 'Leichhardt', urgency: 'Emergency', stage: 'stg_new', value: null, days: 0.2, source: 'chat' },
    { service: 'Blocked drains', description: 'Kitchen sink drains slowly and gurgles.', suburb: 'Balmain', urgency: 'This week', stage: 'stg_new', value: null, days: 0.6, source: 'quote' },
    { service: 'Leaks', description: 'Water stain spreading on the bathroom ceiling below the shower.', suburb: 'Annandale', urgency: 'This week', stage: 'stg_new', value: null, days: 2, source: 'chat' },
    { service: 'Gas fitting', description: 'New gas cooktop to connect, existing bayonet in the kitchen.', suburb: 'Glebe', urgency: 'Within a month', stage: 'stg_visit', value: null, days: 3, source: 'quote', update: 'Visit booked Thursday 9am.' },
    { service: 'Bathroom renovation', description: 'Full bathroom: move the toilet, new shower and vanity.', suburb: 'Marrickville', urgency: 'Flexible', stage: 'stg_visit', value: null, days: 6, source: 'api' },
    { service: 'Hot water', description: 'Replace gas storage unit with continuous flow.', suburb: 'Petersham', urgency: 'Within a month', stage: 'stg_quote', value: 3450, days: 4, source: 'chat', update: 'Quote sent: Rinnai 26L, install and removal.' },
    { service: 'Blocked drains', description: 'Sewer line blocked by tree roots, CCTV needed.', suburb: 'Haberfield', urgency: 'This week', stage: 'stg_quote', value: 1280, days: 11, source: 'manual' },
    { service: 'Leaks', description: 'Burst pipe under the house, water turned off at the meter.', suburb: 'Lilyfield', urgency: 'Emergency', stage: 'stg_booked', value: 640, days: 1, source: 'callback' },
    { service: 'Gas fitting', description: 'Annual service of two gas heaters.', suburb: 'Stanmore', urgency: 'Flexible', stage: 'stg_booked', value: 380, days: 5, source: 'quote' },
    { service: 'Bathroom renovation', description: 'Ensuite rough-in and fit-off.', suburb: 'Dulwich Hill', urgency: 'Within a month', stage: 'stg_work', value: 8900, days: 9, source: 'manual', update: 'Rough-in done, waiting on tiler.' },
    { service: 'Hot water', description: 'Heat pump install, rebate paperwork.', suburb: 'Rozelle', urgency: 'Flexible', stage: 'stg_done', value: 4200, days: 20, source: 'chat' },
    { service: 'Blocked drains', description: 'Stormwater pit overflowing in heavy rain.', suburb: 'Ashfield', urgency: 'This week', stage: 'stg_lost', value: 900, days: 15, source: 'quote' },
  ];
  // A chat about the same thing, where there is one, and its person; else someone from the contacts.
  const KEYWORDS: Record<string, RegExp> = { 'Hot water': /hot water/i, 'Blocked drains': /drain|block/i, Leaks: /leak|burst|drip/i, 'Gas fitting': /gas/i, 'Bathroom renovation': /bathroom|renovat/i };
  const used = new Set<string>();
  const people = leads.filter((l) => l.name);
  SAMPLES.forEach((s, i) => {
    const conversation = conversations.find((c) => c.leadId && !used.has(c.leadId) && KEYWORDS[s.service]!.test(c.firstMessage ?? ''));
    const lead = (conversation && leads.find((l) => l.id === conversation.leadId)) ?? people.find((l) => !used.has(l.id)) ?? null;
    if (lead) used.add(lead.id);
    const created = NOW - s.days * DAY - 3600_000;
    const moved = s.stage === 'stg_new' ? created : created + Math.min(s.days * 0.6, 4) * DAY;
    const st = pipeline.stages.find((x) => x.id === s.stage)!;
    const history = [event('created', created, { source: s.source, stage: 'New request' }, s.source === 'chat' ? { id: 'assistant', name: 'The assistant' } : s.source === 'quote' ? { id: 'visitor', name: 'The visitor' } : ME)];
    if (s.stage !== 'stg_new') history.push(event('stage', moved, { from: 'New request', to: st.name }));
    if (s.update) history.push(event('update', moved + 3600_000, { text: s.update }));
    jobs.push({
      id: `job_${i + 1}`,
      number: 1001 + i,
      title: `${s.service} in ${s.suburb}`,
      details: s.description,
      stageId: s.stage,
      fields: { service: s.service, description: s.description, address: s.suburb, urgency: s.urgency },
      leadId: lead?.id ?? null,
      conversationId: s.source === 'chat' || s.source === 'quote' ? (conversation?.id ?? null) : null,
      source: s.source,
      valueCents: s.value === null ? null : s.value * 100,
      currency: s.value === null ? null : 'AUD',
      dueAt: s.stage === 'stg_booked' ? NOW + (i % 4) * DAY : null,
      assignedTo: i % 3 === 0 ? ME.id : null,
      assignedName: i % 3 === 0 ? ME.name : null,
      position: i,
      stageChangedAt: moved,
      closedAt: st.kind === 'open' ? null : moved,
      lostReason: st.kind === 'lost' ? 'Went with a cheaper quote' : null,
      createdAt: created,
      updatedAt: Math.max(...history.map((h) => h.at)),
      history,
      notes: [],
    });
  });
}

function toJob(j: Stored): Job {
  const st = pipeline.stages.find((s) => s.id === j.stageId) ?? null;
  const lead = j.leadId ? leads.find((l) => l.id === j.leadId) : undefined;
  const { stageId: _s, leadId: _l, history: _h, notes: _n, ...rest } = j;
  return {
    ...rest,
    stage: st && { id: st.id, name: st.name, kind: st.kind },
    status: st?.kind ?? 'open',
    stale: Boolean(st?.kind === 'open' && st.rotDays && NOW - j.stageChangedAt > st.rotDays * DAY),
    contact: lead ? { id: lead.id, name: lead.name, email: lead.email, phone: lead.phone } : null,
    value: j.valueCents === null ? null : j.valueCents / 100,
  };
}

function detail(j: Stored) {
  const conversation = j.conversationId ? conversations.find((c) => c.id === j.conversationId) : undefined;
  return { ...toJob(j), history: j.history, notes: j.notes, conversation: conversation ? { id: conversation.id, firstMessage: conversation.firstMessage, startedAt: conversation.startedAt } : null };
}

function moveTo(j: Stored, stageId: string, reason?: string) {
  const from = pipeline.stages.find((s) => s.id === j.stageId);
  const to = pipeline.stages.find((s) => s.id === stageId);
  if (!to || !from || to.id === from.id) return;
  j.stageId = to.id;
  j.stageChangedAt = Date.now();
  j.closedAt = to.kind === 'open' ? null : Date.now();
  j.lostReason = to.kind === 'lost' ? (reason ?? null) : null;
  j.history.push(event('stage', Date.now(), { from: from.name, to: to.name, ...(reason ? { reason } : {}) }));
}

/** `/jobs…` in the demo; null when the path is not a jobs one. */
export function jobsRoute(method: string, parts: string[], params: URLSearchParams, body: Record<string, unknown>): Response | null {
  if (parts[0] !== 'jobs') return null;
  const [, id, sub] = parts;

  if (id === 'pipeline') {
    if (sub === 'template' && method === 'POST') {
      pipeline.template = String(body['template'] ?? pipeline.template);
      pipeline.chosenBy = 'owner';
      pipeline.reason = null;
    } else if (method === 'PUT') {
      for (const key of ['itemSingular', 'itemPlural', 'assistantJobs'] as const) if (key in body) (pipeline as Record<string, unknown>)[key] = body[key];
      if ('quoteEnabled' in body) pipeline.quote.enabled = Boolean(body['quoteEnabled']);
      if (typeof body['quoteLabel'] === 'string') pipeline.quote.label = body['quoteLabel'];
      if ('quoteContact' in body) pipeline.quote.askContact = Boolean(body['quoteContact']);
      if (Array.isArray(body['stages'])) {
        const next = body['stages'] as Partial<JobStage>[];
        if (!next.some((s) => s.kind === 'open') || !next.some((s) => s.kind === 'won') || !next.some((s) => s.kind === 'lost')) return bad('Keep at least one open, one won and one lost stage.');
        pipeline.stages = next.map((s, i) => stage(s.id ?? `stg_${Date.now()}_${i}`, String(s.name || 'Stage'), s.color ?? '#6b7280', i, s.kind ?? 'open', s.rotDays ?? null));
        for (const j of jobs) if (!pipeline.stages.some((s) => s.id === j.stageId)) j.stageId = pipeline.stages[0]!.id;
      }
      if (Array.isArray(body['fields'])) {
        const next = body['fields'] as (Partial<JobField> & { label: string })[];
        const kept = next.map((f, i) => {
          const known = pipeline.fields.find((x) => x.id === f.id);
          const name = known?.name ?? (f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${i}`);
          return field(name, f.label, f.type ?? 'text', i, { ...(known ?? {}), id: known?.id ?? `fld_${name}`, label: f.label, type: f.type ?? 'text', required: Boolean(f.required), options: f.options ?? [], question: f.question ?? null, position: i, archived: false });
        });
        pipeline.fields = [...kept, ...pipeline.fields.filter((f) => !kept.some((k) => k.id === f.id)).map((f) => ({ ...f, archived: true, inQuote: false }))];
      }
      if (Array.isArray(body['quote'])) {
        const order = (body['quote'] as string[]).slice(0, 10);
        for (const f of pipeline.fields) {
          f.inQuote = order.includes(f.name) && !f.archived;
          f.quotePosition = f.inQuote ? order.indexOf(f.name) : null;
        }
      }
      pipeline.chosenBy = 'owner';
      pipeline.editedAt = Date.now();
    }
    return json(view());
  }
  if (id === 'setup' && method === 'POST') {
    pipeline.chosenBy = 'ai';
    pipeline.template = 'service-quote';
    return json({ template: 'service-quote', chosenBy: 'ai', applied: true, reason: 'A plumbing business that quotes before the work (the demo always chooses this).', pipeline: view().pipeline });
  }

  if (!id) {
    if (method === 'POST') {
      const lead = typeof body['contactId'] === 'string' ? leads.find((l) => l.id === body['contactId']) : undefined;
      const conversation = typeof body['conversationId'] === 'string' ? conversations.find((c) => c.id === body['conversationId']) : undefined;
      const fields = Object.fromEntries(Object.entries((body['fields'] as Record<string, string>) ?? {}).filter(([, v]) => v));
      const contact = body['contact'] as { name?: string } | undefined;
      const number = 1001 + jobs.length;
      const title = String(body['title'] || [fields['service'], fields['address']].filter(Boolean).join(' in ') || `Job from ${contact?.name ?? lead?.name ?? 'a visitor'}`);
      const job: Stored = {
        id: `job_${Date.now()}`,
        number,
        title,
        details: (body['details'] as string) ?? fields['description'] ?? null,
        stageId: pipeline.stages[0]!.id,
        fields,
        leadId: lead?.id ?? conversation?.leadId ?? null,
        conversationId: conversation?.id ?? null,
        source: typeof body['callbackId'] === 'string' ? 'callback' : 'manual',
        valueCents: typeof body['value'] === 'number' ? Math.round(body['value'] * 100) : null,
        currency: typeof body['value'] === 'number' ? 'AUD' : null,
        dueAt: null,
        assignedTo: null,
        assignedName: null,
        position: Math.min(0, ...jobs.map((j) => j.position)) - 1,
        stageChangedAt: Date.now(),
        closedAt: null,
        lostReason: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        history: [event('created', Date.now(), { source: 'manual', stage: pipeline.stages[0]!.name })],
        notes: [],
      };
      jobs.push(job);
      return json(toJob(job), 201);
    }
    const status = params.get('status') ?? 'open';
    const q = (params.get('q') ?? '').toLowerCase().replace(/^#/, '');
    const assigned = params.get('assigned');
    const items = jobs
      .map((j) => ({ j, job: toJob(j) }))
      .filter(({ j, job }) => (status === 'all' || job.status === status) && (!assigned || (assigned === 'me' ? j.assignedTo === ME.id : assigned === 'none' ? !j.assignedTo : j.assignedTo === assigned)))
      .filter(({ j }) => !params.get('contact') || j.leadId === params.get('contact'))
      .filter(({ j }) => !params.get('conversation') || j.conversationId === params.get('conversation'))
      .filter(({ job }) => !q || String(job.number) === q || `${job.title} ${job.details ?? ''} ${Object.values(job.fields).join(' ')} ${job.contact?.name ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.j.position - b.j.position || b.j.createdAt - a.j.createdAt)
      .map(({ job }) => job);
    const stages = pipeline.stages.map((s) => {
      const here = jobs.filter((j) => j.stageId === s.id);
      return { ...s, count: here.length, valueCents: here.reduce((sum, j) => sum + (j.valueCents ?? 0), 0) };
    });
    return json({ items, stages });
  }

  const at = jobs.findIndex((j) => j.id === id);
  const job = jobs[at];
  if (!job) return notFound();
  if (method === 'DELETE') {
    jobs.splice(at, 1);
    return json({ id, deleted: true });
  }
  if (sub === 'move') {
    if (typeof body['stageId'] === 'string') moveTo(job, body['stageId'], (body['lostReason'] as string) || undefined);
    if ('before' in body) {
      const before = jobs.find((j) => j.id === body['before']);
      job.position = before ? before.position - 0.5 : Math.max(0, ...jobs.map((j) => j.position)) + 1;
    }
    job.updatedAt = Date.now();
    return json(toJob(job));
  }
  if (sub === 'updates') {
    const e = event('update', Date.now(), { text: String(body['text'] ?? '') });
    job.history.push(e);
    return json(e, 201);
  }
  if (sub === 'notes') {
    const note: Note = { id: `note_job_${Date.now()}`, author: ME.id, authorName: ME.name, text: String(body['text'] ?? ''), createdAt: Date.now(), updatedAt: Date.now() };
    job.notes.push(note);
    return json(note, 201);
  }
  if (method === 'PATCH') {
    if (typeof body['title'] === 'string') {
      job.history.push(event('edited', Date.now(), { field: 'title', from: job.title, to: body['title'] }));
      job.title = body['title'];
    }
    if (body['fields'] && typeof body['fields'] === 'object') {
      for (const [name, value] of Object.entries(body['fields'] as Record<string, string | null>)) {
        const label = pipeline.fields.find((f) => f.name === name)?.label ?? name;
        job.history.push(event('field', Date.now(), { field: name, label, from: job.fields[name] ?? null, to: value }));
        if (value === null) delete job.fields[name];
        else job.fields[name] = value;
      }
    }
    if ('value' in body) {
      const cents = body['value'] === null ? null : Math.round(Number(body['value']) * 100);
      job.history.push(event('value', Date.now(), { from: job.valueCents, to: cents }));
      job.valueCents = cents;
      job.currency = cents === null ? null : 'AUD';
    }
    if ('dueAt' in body) {
      job.dueAt = body['dueAt'] ? Date.parse(String(body['dueAt'])) : null;
      job.history.push(event('edited', Date.now(), { field: 'due' }));
    }
    if ('assignedTo' in body) {
      job.assignedTo = (body['assignedTo'] as string | null) || null;
      job.assignedName = job.assignedTo === ME.id ? ME.name : job.assignedTo;
      job.history.push(event('assigned', Date.now(), { to: job.assignedTo, name: job.assignedName }));
    }
    job.updatedAt = Date.now();
    return json(toJob(job));
  }
  return json(detail(job));
}
