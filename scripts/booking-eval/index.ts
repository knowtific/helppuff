import { createWorker } from '../../packages/server/src/worker.js';
import config from './config.js';

export { CrawlWorkflow } from '../../packages/server/src/workflows/crawl.js';

const worker = createWorker(config);

/**
 * The fake calendar at https://cal.test: Mon–Fri, 30-minute slots at 09:00, 10:00,
 * 11:30, 13:00, 14:30 and 16:00 Melbourne time (AEDT, UTC+11, in October 2026).
 * Tuesday 13 Oct is fully booked; Wednesday 14 Oct 2:30 pm is taken at the moment
 * of booking (it was offered, then someone else got it).
 */
const SLOTS = ['09:00', '10:00', '11:30', '13:00', '14:30', '16:00'];
const FULL_DAYS = new Set(['2026-10-13']);
const RACE = new Set(['s20261014T1430']);
const calls: Record<string, unknown>[] = [];
let ref = 1040;

const melbToUtc = (day: string, hm: string) => new Date(`${day}T${hm}:00+11:00`);
const label = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(/,(?=[^,]*$)/, ',');
const localParts = (d: Date, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
};

function slotsBetween(fromDay: string, toDay: string, part: string, tz: string) {
  const out: { id: string; label: string; start: string }[] = [];
  for (let t = Date.parse('2026-10-12T00:00:00+11:00'); t < Date.parse('2026-11-01T00:00:00+11:00'); t += 86_400_000) {
    const day = new Date(t + 11 * 3600_000).toISOString().slice(0, 10);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6 || FULL_DAYS.has(day)) continue;
    for (const hm of SLOTS) {
      const start = melbToUtc(day, hm);
      const local = localParts(start, tz);
      if (local.day < fromDay || local.day > toDay) continue;
      if (part === 'morning' && local.hour >= 12) continue;
      if (part === 'afternoon' && local.hour < 12) continue;
      out.push({ id: `s${day.replace(/-/g, '')}T${hm.replace(':', '')}`, label: label(start, tz), start: start.toISOString() });
    }
  }
  return out;
}

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname !== 'cal.test') return realFetch(input, init);
  const conv = url.searchParams.get('conv') ?? '';
  if (url.pathname === '/times') {
    const tz = url.searchParams.get('tz') || 'Australia/Melbourne';
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') || from;
    const part = url.searchParams.get('part') || 'any';
    let valid = true;
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      valid = false;
    }
    const slots = valid && /^\d{4}-\d{2}-\d{2}$/.test(from) ? slotsBetween(from, /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : from, part, tz).slice(0, 6) : [];
    const answer = { timezone: tz, slots, ...(slots.length ? {} : { note: 'Nothing free in that range.' }) };
    calls.push({ conv, tool: 'find_times', args: { from, to, part, tz }, returned: slots.map((s) => s.id), labels: Object.fromEntries(slots.map((s) => [s.id, s.label])) });
    return Response.json(answer);
  }
  if (url.pathname === '/book' && request.method === 'POST') {
    const body = (await request.json()) as { slot?: string; name?: string; email?: string; tz?: string };
    const slot = String(body.slot ?? '');
    const m = /^s(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/.exec(slot);
    const tz = body.tz || 'Australia/Melbourne';
    let answer: Record<string, unknown>;
    if (!m) answer = { booked: false, reason: 'unknown_slot' };
    else if (RACE.has(slot)) {
      const day = `${m[1]}-${m[2]}-${m[3]}`;
      answer = { booked: false, reason: 'taken', next: slotsBetween(day, '2026-10-17', 'any', tz).filter((s) => s.id !== slot).slice(0, 3) };
    } else if (!body.name || !body.email) answer = { booked: false, reason: 'missing_details' };
    else answer = { booked: true, reference: `BK-${++ref}`, time: label(melbToUtc(`${m[1]}-${m[2]}-${m[3]}`, `${m[4]}:${m[5]}`), tz), name: body.name, email: body.email };
    calls.push({ conv, tool: 'book_time', args: body, returned: answer });
    return Response.json(answer);
  }
  return Response.json({ error: 'not found' }, { status: 404 });
}) as typeof fetch;

export default {
  ...worker,
  async fetch(request: Request, env: Record<string, unknown>, ctx: Parameters<typeof worker.fetch>[2]) {
    const url = new URL(request.url);
    if (url.pathname === '/eval/calls') return Response.json(calls.filter((c) => !url.searchParams.get('conv') || c['conv'] === url.searchParams.get('conv')));
    if (url.pathname === '/eval/usage') {
      const db = env['HELPPUFF_DB'] as { prepare: (s: string) => { all: () => Promise<{ results: unknown[] }> } };
      return Response.json((await db.prepare('SELECT site_id, neurons_est, messages FROM usage_daily').all()).results);
    }
    return worker.fetch(request, env, ctx);
  },
};
