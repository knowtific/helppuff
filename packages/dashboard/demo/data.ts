import type { Callback, ConversationRow, Label, Lead, LeadStatus, Note, StoredMessage, Summary } from '../src/lib/api';

/**
 * Sample data for the dashboard demo: a made-up plumbing business with a few
 * months of chats. Seeded, so the website's screenshots are the same on every
 * run, and dated relative to now, so the demo never looks stale.
 */

export const SITE = {
  id: 'harbour',
  name: 'Harbour Plumbing',
  accent: '#5B5BF7',
  avatar: null,
  embed: '<script src="https://knowtific-helppuff-harbour.example.workers.dev/loader.js" data-site="harbour" async></script>',
  connector: 'workers-ai',
  knowledge: true,
  prompt: true,
  website: 'https://harbourplumbing.example',
  production: { turnstile: false, hostnames: ['harbourplumbing.example', 'www.harbourplumbing.example', 'knowtific-helppuff-harbour.example.workers.dev'], dailyCap: 500 },
  // No live socket in the demo (nothing to connect to); live chats still show and can be answered.
  live: false,
};

export const LABELS: Label[] = [
  { id: 'lbl_urgent', name: 'Urgent', color: '#ef4444', description: 'Water or gas leaking now, or no hot water', ai: true },
  { id: 'lbl_quote', name: 'Quote', color: '#3b82f6', description: 'Wants a price for a job', ai: true },
  { id: 'lbl_repeat', name: 'Repeat customer', color: '#22c55e', description: 'Has used us before', ai: true },
  { id: 'lbl_complaint', name: 'Complaint', color: '#f97316', description: 'Unhappy with a job or a visit', ai: false },
];

export const notes: Note[] = [];

const DAY = 86_400_000;
const NOW = Date.now();

/** Mulberry32: small, seeded, good enough for sample data. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261007);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

type Turn = { role: 'user' | 'agent'; text: string };
type Scenario = {
  page: string;
  turns: Turn[];
  summary: Summary;
  /** Whether this kind of chat usually ends with contact details. */
  leadChance: number;
  callbackReason?: string;
};

const SCENARIOS: Scenario[] = [
  {
    page: '/services/blocked-drains',
    turns: [
      { role: 'user', text: 'How much do you charge for a blocked drain?' },
      { role: 'agent', text: 'A standard blocked-drain visit is **$180 + GST**. That covers the callout, up to 30 minutes on site and a camera inspection if needed. If it needs jetting, we quote that before any work starts.' },
      { role: 'user', text: 'Ok. Can someone come tomorrow morning? It’s the kitchen sink.' },
      { role: 'agent', text: 'Tomorrow morning works. I’ve passed your details to the team and they’ll text you within 15 minutes to confirm a time.' },
    ],
    summary: { summary: 'Asked the price of a blocked kitchen drain and booked a visit for tomorrow morning.', intent: 'booking', sentiment: 'positive', followUp: 'Confirm the morning slot by text.', leadQuality: 'hot', outcome: 'lead_captured', topics: ['blocked drain', 'pricing', 'booking'], unanswered: [] },
    leadChance: 0.5,
  },
  {
    page: '/emergency',
    turns: [
      { role: 'user', text: 'Burst pipe under the house, water everywhere. Can someone come now?' },
      { role: 'agent', text: 'Turn the water off at the meter first, usually near the front boundary. We run **24/7 emergency callouts** and a plumber is usually there within **60 minutes**. Want me to have someone call you right now?' },
      { role: 'user', text: 'Yes please call me' },
      { role: 'agent', text: 'Done: a plumber will call you in the next few minutes on the number you gave.' },
    ],
    summary: { summary: 'Burst pipe under the house; turned the water off and asked for an urgent call back.', intent: 'emergency', sentiment: 'negative', followUp: 'Call back immediately.', leadQuality: 'hot', outcome: 'callback_requested', topics: ['burst pipe', 'emergency'], unanswered: [] },
    leadChance: 0.7,
    callbackReason: 'Burst pipe under the house, needs someone now',
  },
  {
    page: '/services/hot-water',
    turns: [
      { role: 'user', text: 'Our hot water system is 15 years old and leaking. Do you replace them?' },
      { role: 'agent', text: 'We do, usually on the same day. Most families go for a 250 L gas or heat-pump system; supplied and installed from **$2,400**. A plumber can check yours and give a fixed quote.' },
      { role: 'user', text: 'Heat pump sounds good. Are there rebates?' },
      { role: 'agent', text: 'Often, yes: state rebates can take $500–$1,000 off a heat pump. We handle the paperwork when we install.' },
    ],
    summary: { summary: 'Wants to replace a leaking 15-year-old hot water system with a heat pump; asked about rebates.', intent: 'quote', sentiment: 'neutral', followUp: 'Send a heat-pump quote with the rebate estimate.', leadQuality: 'warm', outcome: 'lead_captured', topics: ['hot water', 'heat pump', 'rebates'], unanswered: [] },
    leadChance: 0.4,
  },
  {
    page: '/',
    turns: [
      { role: 'user', text: 'Do you cover Balmain?' },
      { role: 'agent', text: 'Yes: we cover the inner west and inner north, including Balmain, Rozelle and Leichhardt. Same-day visits are usually available.' },
    ],
    summary: { summary: 'Checked that Balmain is in the service area.', intent: 'information', sentiment: 'neutral', followUp: null, leadQuality: 'cold', outcome: 'answered', topics: ['service area'], unanswered: [] },
    leadChance: 0.05,
  },
  {
    page: '/pricing',
    turns: [
      { role: 'user', text: 'What are your hourly rates on a Sunday?' },
      { role: 'agent', text: 'Our rates are the same every day of the week, including Sundays and public holidays: **$180 + GST** for the first 30 minutes, then $45 per 15 minutes.' },
    ],
    summary: { summary: 'Asked about weekend rates; told they are the same every day.', intent: 'pricing', sentiment: 'positive', followUp: null, leadQuality: 'warm', outcome: 'answered', topics: ['pricing', 'weekend'], unanswered: [] },
    leadChance: 0.15,
  },
  {
    page: '/services/gas',
    turns: [
      { role: 'user', text: 'Can you convert my cooktop from natural gas to LPG?' },
      { role: 'agent', text: 'I’m not sure we do gas conversions for cooktops. I can have a licensed gas fitter from the team call you to check.' },
      { role: 'user', text: 'Sure' },
    ],
    summary: { summary: 'Asked about converting a cooktop from natural gas to LPG; the assistant was not sure and offered a call.', intent: 'quote', sentiment: 'neutral', followUp: 'Gas fitter to confirm whether conversions are offered.', leadQuality: 'warm', outcome: 'callback_requested', topics: ['gas', 'cooktop'], unanswered: ['Do you convert cooktops from natural gas to LPG?'] },
    leadChance: 0.6,
    callbackReason: 'Cooktop gas conversion: is it something we do?',
  },
  {
    page: '/contact',
    turns: [
      { role: 'user', text: 'What time do you open on Saturday?' },
      { role: 'agent', text: 'The office is open 7am–5pm on Saturdays, and emergency callouts run around the clock.' },
    ],
    summary: { summary: 'Asked Saturday opening hours.', intent: 'information', sentiment: 'neutral', followUp: null, leadQuality: 'none', outcome: 'answered', topics: ['opening hours'], unanswered: [] },
    leadChance: 0,
  },
  {
    page: '/services/leaks',
    turns: [
      { role: 'user', text: 'Tap in the bathroom keeps dripping. Is that a big job?' },
      { role: 'agent', text: 'Usually not: most dripping taps are a washer or cartridge, fixed in one visit for the standard **$180 + GST** callout. Would you like a time this week?' },
    ],
    summary: { summary: 'Dripping bathroom tap; told it is usually a one-visit fix and offered a booking.', intent: 'booking', sentiment: 'neutral', followUp: 'Offer a time this week.', leadQuality: 'warm', outcome: 'abandoned', topics: ['leaking tap'], unanswered: [] },
    leadChance: 0.25,
  },
];

const FIRST = ['Olivia', 'Jack', 'Amelia', 'Noah', 'Isla', 'Liam', 'Charlotte', 'William', 'Mia', 'Henry', 'Ava', 'Lucas', 'Grace', 'Leo', 'Zoe', 'Thomas', 'Chloe', 'Oscar', 'Ruby', 'Max', 'Sophie', 'Ethan', 'Harper', 'James', 'Priya', 'Mateo', 'Hannah', 'Kai'];
const LAST = ['Chen', 'Thompson', 'Nguyen', 'Williams', 'Patel', 'O’Brien', 'Kim', 'Rossi', 'Hernández', 'Walker', 'Singh', 'Martin', 'Wilson', 'Papadopoulos', 'Murphy', 'Lee', 'Taylor', 'Brown', 'Anderson', 'Kowalski', 'Dubois', 'Clarke', 'Scott', 'Okafor'];

/** A new, made-up person: every email is on example.com and every number a fictional 04xx 555 one. */
function newPerson(n: number) {
  // Walks first × last names without repeating a pair for hundreds of people.
  const first = FIRST[(n * 5) % FIRST.length]!;
  const last = LAST[(n * 7 + Math.floor(n / FIRST.length)) % LAST.length]!;
  const email = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[^a-z.]/g, '') + '@example.com';
  const phone = `04${String(10 + (n % 89)).padStart(2, '0')} 555 ${String(100 + ((n * 37) % 899)).padStart(3, '0')}`;
  return { name: `${first} ${last}`, email, phone };
}

const COUNTRIES = ['AU', 'AU', 'AU', 'AU', 'AU', 'AU', 'AU', 'NZ', 'GB', 'US'];
const STATUSES: LeadStatus[] = ['new', 'new', 'contacted', 'contacted', 'qualified', 'won', 'lost'];
const NOTES = [
  'Booked for Thursday 9am.',
  'Sent heat-pump quote, $2,650 after rebate.',
  'Prefers text over calls.',
  'Repeat customer: did their hot water in 2025.',
  'Went with another quote.',
  null,
  null,
  null,
];

export type DemoConversation = ConversationRow & { messages: StoredMessage[]; leadId: string | null; summaryJson: string | null; referrer: string | null; locale: string; data?: Record<string, unknown> };

export const conversations: DemoConversation[] = [];
export const leads: Lead[] = [];
export const callbacks: Callback[] = [];

{
  // 120 days, busier recently: about one chat a day four months ago, four a day now.
  let id = 0;
  let person = 0;
  for (let day = 120; day >= 0; day--) {
    const perDay = Math.round(1 + (3 * (120 - day)) / 120 + (random() - 0.5) * 2);
    for (let n = 0; n < Math.max(0, perDay); n++) {
      const scenario = pick(SCENARIOS);
      const start = NOW - day * DAY - Math.floor(random() * 10 * 3600_000) - (day === 0 ? 0 : 6 * 3600_000);
      if (start > NOW - 5 * 60_000) continue;
      const cid = `c_${(++id).toString().padStart(4, '0')}`;
      const messages: StoredMessage[] = scenario.turns.map((turn, i) => ({
        id: `${cid}_m${i}`,
        role: turn.role,
        type: 'text',
        // The dashboard shows stored text as it is, without Markdown.
        text: turn.text.replace(/\*\*/g, ''),
        payload: null,
        ts: start + i * 45_000,
        feedback: turn.role === 'agent' && i === scenario.turns.length - 1 && random() < 0.35 ? (random() < 0.85 ? 1 : -1) : null,
      }));
      let leadId: string | null = null;
      if (random() < scenario.leadChance) {
        // About one in six leads is someone coming back.
        const repeat = leads.length > 4 && random() < 0.16 ? pick(leads) : null;
        if (repeat) {
          leadId = repeat.id;
          repeat.conversations = (repeat.conversations ?? 1) + 1;
          repeat.lastConversationId = cid;
          repeat.updatedAt = start;
        } else {
          const { name, email, phone } = newPerson(person++);
          leadId = `l_${leads.length + 1}`;
          const recent = day < 3;
          leads.push({
            id: leadId,
            site: SITE.id,
            conversationId: cid,
            name,
            email,
            phone,
            fields: JSON.stringify({ suburb: pick(['Balmain', 'Rozelle', 'Leichhardt', 'Glebe', 'Newtown', 'Annandale']) }),
            source: pick(['form', 'form', 'chat', 'ai'] as const),
            // Older leads have moved further through the pipeline.
            status: recent ? 'new' : day < 10 ? pick(['new', 'contacted', 'contacted', 'qualified'] as const) : pick(STATUSES),
            notes: recent ? null : pick(NOTES),
            createdAt: start,
            updatedAt: start,
            conversations: 1,
            lastConversationId: cid,
            openCallbacks: 0,
          });
        }
      }
      // Most who leave a number on these chats ask to be called; not all.
      if (scenario.callbackReason && leadId && random() < 0.6) {
        const lead = leads.find((l) => l.id === leadId)!;
        const status = day < 4 ? 'open' : day < 20 ? pick(['done', 'done', 'dismissed'] as const) : 'done';
        callbacks.push({
          id: `cb_${callbacks.length + 1}`,
          conversationId: cid,
          leadId,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          reason: scenario.callbackReason,
          status,
          note: status === 'done' ? pick(['Called back, booked a visit.', 'Sorted over the phone.', 'Booked for the next morning.']) : null,
          requestedAt: start + 120_000,
          closedAt: status === 'open' ? null : start + 3600_000,
          closedBy: status === 'open' ? null : 'owner@harbourplumbing.example',
          pageUrl: `${SITE.website}${scenario.page}`,
        });
        if (status === 'open') lead.openCallbacks = (lead.openCallbacks ?? 0) + 1;
      }
      const lead = leads.find((l) => l.id === leadId) ?? null;
      // The latest chats have not gone quiet long enough to be summarised.
      const summarised = start < NOW - 30 * 60_000;
      const cb = callbacks.filter((c) => c.conversationId === cid);
      conversations.push({
        id: cid,
        site: SITE.id,
        startedAt: start,
        lastAt: messages.at(-1)!.ts,
        pageUrl: `${SITE.website}${scenario.page}`,
        country: pick(COUNTRIES),
        firstMessage: scenario.turns[0]!.text,
        messageCount: messages.length,
        summary: summarised ? scenario.summary.summary : null,
        summaryJson: summarised ? JSON.stringify(scenario.summary) : null,
        intent: summarised ? scenario.summary.intent : null,
        leadName: lead?.name ?? null,
        leadEmail: lead?.email ?? null,
        leadPhone: lead?.phone ?? null,
        leadStatus: lead?.status ?? null,
        callback: cb.find((c) => c.status === 'open')?.status ?? cb[0]?.status ?? null,
        messages,
        leadId,
        referrer: pick([null, 'https://www.google.com/', 'https://www.google.com/', 'https://www.facebook.com/']),
        locale: 'en-AU',
      });
    }
  }
  conversations.sort((a, b) => b.lastAt - a.lastAt);
  leads.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  callbacks.sort((a, b) => b.requestedAt - a.requestedAt);

  // A few are always waiting, whatever the dice did: an empty to-do list shows nothing.
  for (const cb of callbacks.slice(0, 3)) {
    cb.status = 'open';
    cb.note = null;
    cb.closedAt = null;
    cb.closedBy = null;
  }
  for (const lead of leads) lead.openCallbacks = callbacks.filter((cb) => cb.leadId === lead.id && cb.status === 'open').length;
  for (const c of conversations) {
    const own = callbacks.filter((cb) => cb.conversationId === c.id);
    c.callback = own.find((cb) => cb.status === 'open')?.status ?? own[0]?.status ?? null;
    // Quiet for an hour: closed. Labels the AI put on, from what the chat was about.
    c.status = c.lastAt < NOW - 3600_000 ? 'closed' : 'bot';
    const text = `${c.firstMessage} ${c.summary ?? ''}`.toLowerCase();
    c.labels = LABELS.filter(
      (l) =>
        (l.id === 'lbl_urgent' && /leak|burst|no hot water|emergency|flood/.test(text)) ||
        (l.id === 'lbl_quote' && /how much|price|cost|quote/.test(text)) ||
        (l.id === 'lbl_repeat' && leads.find((x) => x.id === c.leadId)?.conversations !== undefined && (leads.find((x) => x.id === c.leadId)?.conversations ?? 1) > 1),
    ).map(({ id, name, color }) => ({ id, name, color }));
    c.attributes = {};
  }
  // Two live chats: one waiting for someone to take it, one Priya is answering.
  const [waiting, answering] = conversations;
  if (waiting) {
    waiting.status = 'live';
    waiting.assignedTo = null;
    waiting.assignedName = null;
    waiting.waitingSince = NOW - 2 * 60_000;
    waiting.lastAt = NOW - 2 * 60_000;
    waiting.messages.push(
      { id: `${waiting.id}_ask`, role: 'user', type: 'text', text: 'Can I talk to a real person please?', payload: null, ts: NOW - 3 * 60_000, author: null },
      { id: `${waiting.id}_ho`, role: 'system', type: 'handover', text: 'Connecting you with someone from the team. They’ll reply right here.', payload: { status: 'waiting' }, ts: NOW - 3 * 60_000 + 1, author: null },
      { id: `${waiting.id}_more`, role: 'user', type: 'text', text: 'It’s leaking under the sink, quite a lot.', payload: null, ts: NOW - 2 * 60_000, author: null },
    );
    waiting.messageCount = waiting.messages.length;
  }
  if (answering) {
    answering.status = 'live';
    answering.assignedTo = 'office@harbourplumbing.example';
    answering.assignedName = 'Priya';
    answering.waitingSince = null;
    answering.lastAt = NOW - 6 * 60_000;
    answering.messages.push(
      { id: `${answering.id}_ho`, role: 'system', type: 'handover', text: 'Priya joined the chat.', payload: { status: 'joined' }, ts: NOW - 8 * 60_000, author: null },
      { id: `${answering.id}_h1`, role: 'agent', type: 'text', text: 'Hi, Priya here from the office. I can book Dan for tomorrow at 8am — does that suit?', payload: { meta: { human: true, agentName: 'Priya' } }, ts: NOW - 7 * 60_000, author: 'office@harbourplumbing.example' },
      { id: `${answering.id}_u2`, role: 'user', type: 'text', text: 'Perfect, thank you!', payload: null, ts: NOW - 6 * 60_000, author: null },
    );
    answering.messageCount = answering.messages.length;
    answering.attributes = { job_number: 'HP-2041' };
    answering.data = { customer_lookup: { jobs: 3, since: '2021' }, job_number: { job_number: 'HP-2041' }, job_status: { status: 'Booked', date: 'Tomorrow, 8am', plumber: 'Dan' } };
  }
  for (const lead of leads.slice(0, 6)) lead.attributes = { suburb: JSON.parse(lead.fields ?? '{}').suburb ?? 'Balmain', ...(lead.status === 'won' ? { lifetimeValue: '$640' } : {}) };
  const first = leads[0];
  if (first) {
    first.company = 'Rozelle Cafe';
    notes.push({ id: 'note_1', leadId: first.id, conversationId: null, author: 'owner@harbourplumbing.example', authorName: 'Dan', text: 'Owns the cafe on Darling St: commercial kitchen, so book mornings before 7.', createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY });
  }
}

export const PROMPT_TEXT = `Harbour Plumbing is a family-run plumbing business in Sydney's inner west, licensed since 1998.

- Quote the standard callout ($180 + GST, first 30 minutes) when asked about prices.
- For gas work, offer a call from Dan, our licensed gas fitter.
- We do not do roofing or guttering: suggest a roofer.
- Returning customers ({{customer_lookup.jobs}} past jobs) get priority booking.
- When someone asks about a booked job, ask for the job number, save it with {{job_number}}, then check it with {{job_status}}.`;

export const PAGES = [
  ['/', 'Harbour Plumbing: plumbers in the inner west', 'home', 6],
  ['/services/blocked-drains', 'Blocked drains', 'services', 9],
  ['/services/hot-water', 'Hot water systems', 'services', 11],
  ['/services/leaks', 'Leaks and dripping taps', 'services', 7],
  ['/services/gas', 'Gas fitting', 'services', 6],
  ['/emergency', '24/7 emergency plumbing', 'services', 5],
  ['/pricing', 'Pricing', 'pricing', 8],
  ['/areas', 'Service areas', 'about', 4],
  ['/about', 'About us', 'about', 5],
  ['/contact', 'Contact', 'contact', 3],
  ['/faq', 'Frequently asked questions', 'faq', 14],
  ['/blog/heat-pump-rebates', 'Heat pump rebates explained', 'blog', 10],
] as const;

export const FACTS = [
  { key: 'name', value: 'Harbour Plumbing', source: 'crawl', sourceUrl: `${SITE.website}/` },
  { key: 'phone', value: '02 9555 0100', source: 'crawl', sourceUrl: `${SITE.website}/contact` },
  { key: 'email', value: 'hello@harbourplumbing.example', source: 'crawl', sourceUrl: `${SITE.website}/contact` },
  { key: 'address', value: '12 Wharf St, Balmain NSW 2041', source: 'crawl', sourceUrl: `${SITE.website}/contact` },
  { key: 'hours', value: 'Mon–Fri 7am–6pm, Sat 7am–5pm; emergencies 24/7', source: 'owner', sourceUrl: null },
  { key: 'serviceAreas', value: 'Balmain, Rozelle, Leichhardt, Glebe, Newtown, Annandale', source: 'crawl', sourceUrl: `${SITE.website}/areas` },
] as const;
