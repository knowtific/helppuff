// The booking eval (wiki: AI-Booking-Tests). Plays a visitor through booking scenarios
// against the eval Worker, one site per model, and checks every tool call.
//
//   pnpm --filter @helppuff/server exec wrangler dev --config ../../scripts/booking-eval/wrangler.toml --port 8790
//   node scripts/booking-eval/run.mjs glm47,qwen3 [happy,perth,…]
//
// It calls real Workers AI on the account wrangler is logged in to: about 150 neurons a
// scenario on GLM-4.7 Flash, several times that on the larger models. Results are written
// next to this file (results-*.md, gitignored).
import { writeFileSync } from 'node:fs';

const BASE = process.env.EVAL_URL ?? 'http://localhost:8790';
const ORIGIN = 'http://localhost:8790';
const ADMIN = 'booking-eval-only-admin-key-not-for-any-deployment-01';
const sites = (process.argv[2] ?? 'glm47').split(',');
const only = process.argv[3]?.split(',');

const admin = (method, path, body) =>
  fetch(`${BASE}/admin/api${path}`, { method, headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const TOOLS = [
  {
    name: 'find_times',
    description: 'Free consultation times in a date range, labelled in the visitor’s time zone. Each has an id to book it with.',
    method: 'GET',
    url: 'https://cal.test/times?from={{args.from}}&to={{args.to}}&part={{args.part}}&tz={{args.timezone}}&conv={{conversation.id}}',
    parameters: [
      { name: 'from', description: 'First day, YYYY-MM-DD, in the visitor’s time zone.', required: true },
      { name: 'to', description: 'Last day, YYYY-MM-DD (the same as from for one day).', required: false },
      { name: 'part', description: 'morning, afternoon or any.', required: false },
      { name: 'timezone', description: 'The visitor’s IANA time zone, like Australia/Perth.', required: true },
    ],
  },
  {
    name: 'book_time',
    description: 'Book one time find_times offered. Only after the visitor confirmed the time, their name and email.',
    method: 'POST',
    url: 'https://cal.test/book?conv={{conversation.id}}',
    body: '{"slot": "{{args.slot_id}}", "name": "{{args.name}}", "email": "{{args.email}}", "tz": "{{args.timezone}}"}',
    parameters: [
      { name: 'slot_id', description: 'The id of the time, from find_times.', required: true },
      { name: 'name', description: 'The visitor’s name.', required: true },
      { name: 'email', description: 'The visitor’s email.', required: true },
      { name: 'timezone', description: 'The visitor’s IANA time zone.', required: true },
    ],
  },
];

async function setUp(site) {
  const existing = (await admin('GET', `/tools?site=${site}`)).json?.tools ?? [];
  for (const tool of TOOLS) {
    if (existing.some((t) => t.name === tool.name)) continue;
    const r = await admin('POST', '/tools', { site, ...tool });
    if (r.status !== 201) throw new Error(`${site}: ${tool.name}: ${JSON.stringify(r.json)}`);
  }
}

const textOf = (messages) => messages.filter((m) => m.type === 'text').map((m) => m.text).join('\n');
const optionsOf = (messages) => messages.filter((m) => m.type === 'options').flatMap((m) => m.options.map((o) => o.label));

async function conversation(site, timezone, first) {
  const turns = [];
  const start = await fetch(`${BASE}/v1/sites/${site}/sessions`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { pageUrl: `${ORIGIN}/eval`, timezone }, firstMessage: first }),
  });
  const body = await start.json();
  if (!start.ok) throw new Error(`${site}: start ${start.status} ${JSON.stringify(body)}`);
  const id = body.sessionId;
  const token = body.sessionToken;
  let seen = 0;
  const record = async (visitor, messages) => {
    const calls = await (await fetch(`${BASE}/eval/calls?conv=${id}`)).json();
    turns.push({ visitor, reply: textOf(messages), options: optionsOf(messages), calls: calls.slice(seen) });
    seen = calls.length;
    return turns.at(-1);
  };
  let last = await record(first, body.messages ?? []);
  const say = async (text) => {
    const r = await fetch(`${BASE}/v1/sessions/messages`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'text', text, clientId: `c${Math.random()}` }),
    });
    const json = await r.json();
    last = await record(text, r.ok ? json.messages ?? [] : [{ type: 'text', text: `[error ${r.status}: ${JSON.stringify(json.error ?? json)}]` }]);
    return last;
  };
  return { turns, say, get last() { return last; } };
}

const asks = (t, re) => re.test(t.reply);
const pick = (t, fallback) => t.options[0] ?? fallback;
const bookCalls = (turns) => turns.flatMap((t) => t.calls.filter((c) => c.tool === 'book_time'));
const findCalls = (turns) => turns.flatMap((t) => t.calls.filter((c) => c.tool === 'find_times'));
const offeredOk = (turns) => turns.every((t) => t.options.every((o) => turns.some((u) => u.calls.some((c) => c.tool === 'find_times' && c.returned.length)) || !/\d/.test(o)));

const DETAILS = 'Ada Lovelace, ada@example.com';

/** The slot id whose label the visitor picked (a button, or "the first one" = the first time offered). */
function pickedSlot(turns, pickText) {
  const labels = Object.assign({}, ...turns.flatMap((t) => t.calls.filter((c) => c.tool === 'find_times').map((c) => c.labels ?? {})));
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = Object.entries(labels).find(([, l]) => norm(l) === norm(pickText));
  if (exact) return exact[0];
  // "The first one": the first time the assistant listed in its reply.
  const reply = turns.find((t) => t.calls.some((c) => c.tool === 'find_times'))?.reply ?? '';
  let best = null;
  let at = Infinity;
  for (const [id, l] of Object.entries(labels)) {
    const time = l.split(',').pop().trim();
    const i = reply.toLowerCase().indexOf(time.toLowerCase());
    if (i >= 0 && i < at) [best, at] = [id, i];
  }
  return best;
}
const bookedRight = (turns, pickText) => {
  const want = pickedSlot(turns, pickText);
  const booked = bookCalls(turns).filter((b) => b.returned.booked);
  return booked.length === 1 && booked[0].args.slot === want;
};

const SCENARIOS = {
  happy: {
    title: 'Happy path: a day and part of day, pick, details, confirm',
    timezone: 'Australia/Melbourne',
    async run(c) {
      let t = await c.say('Hi! I’d like to book a free consultation next Wednesday afternoon.');
      const choice = pick(t, 'The first one please');
      t = await c.say(choice);
      if (asks(t, /name|email/i)) t = await c.say(DETAILS);
      const beforeYes = bookCalls(c.turns).length;
      t = await c.say('Yes, please book it.');
      if (!bookCalls(c.turns).length && asks(t, /confirm|shall|should|would you like|correct/i)) t = await c.say('Yes');
      return {
        'searched Wed 14 Oct': findCalls(c.turns).some((f) => f.args.from === '2026-10-14'),
        'offered times as options': c.turns.some((u) => u.options.length > 0),
        'no booking before the yes': beforeYes === 0,
        'booked exactly the time picked': bookedRight(c.turns, choice),
        'confirmed with the reference': /BK-\d+/.test(c.last.reply),
      };
    },
  },
  fullday: {
    title: 'The day asked for is fully booked: it should look further and offer times',
    timezone: 'Australia/Melbourne',
    async run(c) {
      const t = await c.say('Can I book a consultation next Tuesday?');
      const finds = findCalls(c.turns);
      return {
        'searched Tue 13 Oct': finds.some((f) => f.args.from === '2026-10-13'),
        'looked further when empty': finds.some((f) => f.returned.length > 0),
        'offered other times': t.options.length > 0 || /\d{1,2}(:\d\d)?\s?(am|pm)/i.test(t.reply),
        'did not book': bookCalls(c.turns).length === 0,
      };
    },
  },
  perth: {
    title: 'Complex: visitor in Perth, Thursday before 10 am their time, or Friday around lunch',
    timezone: 'Australia/Perth',
    async run(c) {
      let t = await c.say('I’m in Perth. I need a 30 minute call on Thursday, but it has to be before 10am my time, or otherwise Friday around lunchtime.');
      const offered = [...t.options];
      const choice = pick(t, 'The first one');
      t = await c.say(choice);
      if (asks(t, /name|email/i)) t = await c.say(DETAILS);
      const beforeYes = bookCalls(c.turns).length;
      t = await c.say('Yes, confirmed.');
      if (!bookCalls(c.turns).length && asks(t, /confirm|shall|should|would you like|correct/i)) t = await c.say('Yes');
      const finds = findCalls(c.turns);
      const okTime = (o) => /thu/i.test(o) ? /\b([6-9]):\d\d\s?am|\b([6-9])\s?am/i.test(o) : /fri/i.test(o) ? /\b(11|12|1)(:\d\d)?\s?(am|pm)/i.test(o) : false;
      return {
        'used Perth time': finds.some((f) => f.args.tz === 'Australia/Perth'),
        'searched Thu 15 Oct': finds.some((f) => f.args.from === '2026-10-15'),
        'offered only fitting times': (offered.length ? offered : [...c.turns.find((u) => u.calls.some((x) => x.tool === 'find_times'))?.reply.matchAll(/(Thu|Fri)[a-z]*,? \d+ Oct,? \d{1,2}(:\d\d)?\s?(am|pm)/gi) ?? []].map((m) => m[0])).every(okTime),
        'no booking before the yes': beforeYes === 0,
        'booked exactly the time picked': bookedRight(c.turns, choice),
      };
    },
  },
  race: {
    title: 'The time is taken at the moment of booking: apologise, offer others, book nothing else',
    timezone: 'Australia/Melbourne',
    async run(c) {
      let t = await c.say('Please book me in for next Wednesday at 2:30pm.');
      if (asks(t, /name|email/i)) t = await c.say(DETAILS);
      else if (t.options.length) {
        t = await c.say(t.options.find((o) => /2:30/.test(o)) ?? t.options[0]);
        if (asks(t, /name|email/i)) t = await c.say(DETAILS);
      }
      t = await c.say('Yes, book it.');
      if (!bookCalls(c.turns).length && asks(t, /confirm|shall|should|would you like|correct/i)) t = await c.say('Yes');
      const books = bookCalls(c.turns);
      return {
        'tried 2:30 pm': books.some((b) => b.args.slot === 's20261014T1430'),
        'did not book another by itself': books.filter((b) => b.returned.booked).length === 0,
        'offered alternatives': c.last.options.length > 0 || /\d{1,2}(:\d\d)?\s?(am|pm)/i.test(c.last.reply),
        'said it was taken': /taken|no longer|just been|unavailable|gone|booked by/i.test(c.last.reply),
      };
    },
  },
  pushy: {
    title: '“Just book the earliest Monday”: still confirms the exact time first',
    timezone: 'Australia/Melbourne',
    async run(c) {
      const t1 = await c.say('Just book me the earliest time on Monday, whatever works. I’m Sam, sam@example.com.');
      const early = bookCalls(c.turns).length;
      let t = t1;
      if (!early) t = await c.say('Yes, that’s fine, book it.');
      if (!bookCalls(c.turns).some((b) => b.returned.booked) && asks(t, /confirm|shall|should|would you like|correct/i)) t = await c.say('Yes');
      return {
        'asked before booking': early === 0,
        'booked the earliest Monday time': bookCalls(c.turns).some((b) => b.returned.booked && b.args.slot === 's20261012T0900'),
      };
    },
  },
  change: {
    title: 'Changes their mind after picking: searches the new day, books nothing',
    timezone: 'Australia/Melbourne',
    async run(c) {
      let t = await c.say('Do you have anything Thursday morning?');
      t = await c.say(pick(t, 'The first one'));
      t = await c.say('Actually, can we do Friday afternoon instead?');
      return {
        'searched Friday 16 Oct': findCalls(c.turns).some((f) => f.args.from === '2026-10-16'),
        'offered Friday times': t.options.some((o) => /fri/i.test(o)) || /fri/i.test(t.reply),
        'booked nothing': bookCalls(c.turns).length === 0,
      };
    },
  },
};

const results = [];
let md = `# Booking eval\n\n`;
for (const site of sites) {
  await setUp(site);
  for (const [key, s] of Object.entries(SCENARIOS)) {
    if (only && !only.includes(key)) continue;
    let checks;
    let turns = [];
    try {
      const c = await conversation(site, s.timezone, 'Hello');
      checks = await s.run(c);
      turns = c.turns;
    } catch (thrown) {
      checks = { 'ran without error': false };
      turns = [{ visitor: '(error)', reply: String(thrown?.message ?? thrown), options: [], calls: [] }];
    }
    const passed = Object.values(checks).filter(Boolean).length;
    results.push({ site, scenario: key, passed, total: Object.keys(checks).length, checks });
    process.stdout.write(`${site.padEnd(7)} ${key.padEnd(8)} ${passed}/${Object.keys(checks).length}\n`);
    md += `## ${site} · ${key}: ${s.title} (${passed}/${Object.keys(checks).length})\n\n`;
    for (const [name, ok] of Object.entries(checks)) md += `- ${ok ? '✔' : '✖'} ${name}\n`;
    md += '\n';
    for (const t of turns) {
      md += `**Visitor:** ${t.visitor}\n\n`;
      for (const call of t.calls) md += `> \`${call.tool}\` ${JSON.stringify(call.args)} → ${JSON.stringify(call.returned).slice(0, 300)}\n\n`;
      md += `**Assistant:** ${t.reply.replace(/\n/g, ' ')}${t.options.length ? `  \n_Options:_ ${t.options.join(' | ')}` : ''}\n\n`;
    }
  }
}
const usage = await (await fetch(`${BASE}/eval/usage`)).json();
md += `## Neurons used\n\n\`\`\`json\n${JSON.stringify(usage, null, 2)}\n\`\`\`\n`;
writeFileSync(new URL(`./results-${sites.join('-')}.md`, import.meta.url), md);
writeFileSync(new URL(`./results-${sites.join('-')}.json`, import.meta.url), JSON.stringify({ results, usage }, null, 2));
process.stdout.write(`usage: ${JSON.stringify(usage)}\n`);
