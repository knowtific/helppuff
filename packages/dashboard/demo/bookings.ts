import type { Appointment, BookingsSettings, IntegrationView } from '../src/lib/api';
import { leads } from './data';
import { demoJobs } from './jobs';

/**
 * Appointments in the demo: the date picker on, synced with nothing (HelpPuff
 * keeps them), a fortnight of sample appointments on the sample jobs, and
 * the routes the Calendar, Settings → Bookings and Settings → Integrations
 * call. Nothing leaves the browser.
 */

const DAY = 86_400_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ZONE = 'Australia/Sydney';

export const bookingsSettings: BookingsSettings = {
  mode: 'picker',
  label: 'Book a time',
  sync: 'none',
  title: 'Site visit',
  duration: 60,
  hours: { mon: ['08:00-16:00'], tue: ['08:00-16:00'], wed: ['08:00-16:00'], thu: ['08:00-16:00'], fri: ['08:00-14:00'], sat: [], sun: [] },
  buffer: 30,
  notice: 240,
  daysAhead: 21,
  timezone: ZONE,
  phone: 'required',
  syncMinutes: 15,
};

/** Today at `hour` in the viewer's time zone, `days` from now. */
const at = (days: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
};

const appointments: Appointment[] = [];
{
  const plan: [number, number, string][] = [
    [-6, 9, 'completed'],
    [-3, 13, 'no_show'],
    [-1, 10, 'completed'],
    [0, 15, 'confirmed'],
    [1, 8, 'confirmed'],
    [1, 11, 'confirmed'],
    [2, 9, 'confirmed'],
    [3, 14, 'confirmed'],
    [6, 10, 'confirmed'],
    [8, 12, 'confirmed'],
  ];
  const jobs = demoJobs();
  plan.forEach(([days, hour, status], i) => {
    const job = jobs[i % jobs.length]!;
    const lead = job.leadId ? leads.find((l) => l.id === job.leadId) : undefined;
    const start = at(days, hour);
    appointments.push({
      id: `apt_demo_${i + 1}`,
      title: 'Site visit',
      start,
      end: start + 60 * 60_000,
      startIso: new Date(start).toISOString(),
      endIso: new Date(start + 3_600_000).toISOString(),
      timezone: ZONE,
      status: status as Appointment['status'],
      source: i % 3 === 0 ? 'dashboard' : 'chat',
      provider: 'none',
      externalId: null,
      location: job.title.replace(/^.* in /, '') + ', Sydney',
      notes: null,
      attendee: lead ? { name: lead.name, email: lead.email, phone: lead.phone } : null,
      job: { id: job.id, number: job.number, title: job.title },
      contact: lead ? { id: lead.id, name: lead.name, email: lead.email } : null,
      conversationId: i % 3 === 0 ? null : job.conversationId,
      rescheduleUrl: null,
      createdBy: i % 3 === 0 ? 'Dan' : (lead?.name ?? 'The visitor'),
      createdAt: start - 3 * DAY,
      updatedAt: start - 3 * DAY,
      syncedAt: null,
    });
  });
  // Busy time from a calendar, to show how it looks.
  const busy = at(2, 13);
  appointments.push({ ...appointments[0]!, id: 'apt_demo_busy', title: 'Busy', start: busy, end: busy + 90 * 60_000, startIso: new Date(busy).toISOString(), endIso: new Date(busy + 5_400_000).toISOString(), status: 'busy', source: 'provider', job: null, contact: null, attendee: null, conversationId: null, location: null });
}

const integrations: IntegrationView[] = (['composio', 'calcom', 'calendly'] as const).map((kind) => ({ kind, name: kind === 'composio' ? 'Composio' : kind === 'calcom' ? 'Cal.com' : 'Calendly', connected: false, baseUrl: null, status: 'none', lastError: null, lastAt: null, account: null, plan: null, createdAt: null, updatedAt: null }));

/** Free times from the hours, less what is booked: what the picker would offer. */
function slots(): { date: string; slots: { start: number; end: number }[] }[] {
  const out: { date: string; slots: { start: number; end: number }[] }[] = [];
  for (let d = 0; d < 7; d++) {
    const day = new Date(at(d, 0));
    const weekday = (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[day.getDay()]!;
    const list: { start: number; end: number }[] = [];
    for (const range of bookingsSettings.hours[weekday]) {
      const [from = '8', to = '16'] = range.split('-').map((t) => t.split(':')[0]!);
      for (let h = Number(from); h + 1 <= Number(to); h++) {
        const start = at(d, h);
        if (start < Date.now() + bookingsSettings.notice * 60_000) continue;
        if (appointments.some((a) => a.status !== 'cancelled' && a.start < start + 3_600_000 && a.end > start)) continue;
        list.push({ start, end: start + 3_600_000 });
      }
    }
    if (list.length) out.push({ date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`, slots: list });
  }
  return out;
}

export function bookingsRoute(method: string, parts: string[], params: URLSearchParams, body: Record<string, unknown>): Response | null {
  const [head, id] = parts;
  if (head === 'bookings') {
    if (id === 'slots') return json({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, days: slots(), next: '', title: bookingsSettings.title, duration: bookingsSettings.duration, phone: bookingsSettings.phone });
    if (id === 'test') return json({ ok: false, detail: 'In the demo nothing is connected.', eventTypes: [] });
    return json({
      site: 'harbour',
      effective: { mode: bookingsSettings.mode ?? 'none', link: bookingsSettings.link ?? null, label: bookingsSettings.label, chosen: Boolean(bookingsSettings.mode) },
      found: null,
      timezone: bookingsSettings.timezone ?? ZONE,
      calendar: { sync: bookingsSettings.sync, integration: null, ready: true },
      syncedAt: null,
      upcoming: appointments.filter((a) => a.start > Date.now() && a.status === 'confirmed').length,
    });
  }
  if (head === 'integrations') {
    if (id === 'composio' && parts[2] === 'accounts') return json({ items: [] });
    if (id === 'calcom' && parts[2] === 'webhook') return json({ url: 'https://knowtific-helppuff-harbour.example.workers.dev/v1/integrations/calcom/harbour', secret: 'whcal_demo', triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] });
    if (id && method !== 'GET') return json({ error: { code: 'bad_request', message: 'The demo connects nothing: in your own dashboard this saves the key.' } }, 400);
    return json({ items: integrations, help: { composio: { name: 'Composio', key: 'API key', help: 'Connects Google Calendar and Outlook without your own OAuth app.' }, calcom: { name: 'Cal.com', key: 'API key (cal_live_…)', help: 'Cal.com → Settings → Developer → API keys.' }, calendly: { name: 'Calendly', key: 'Personal access token', help: 'Calendly → Integrations → API and webhooks.' } } });
  }
  if (head !== 'appointments') return null;
  if (id === 'sync') return json({ synced: false, reason: 'HelpPuff keeps the appointments: there is no calendar to read.', added: 0, updated: 0, cancelled: 0, busy: 0, at: null });
  if (!id && method === 'POST') {
    const start = Date.parse(String(body['start']));
    const end = start + (Number(body['duration']) || bookingsSettings.duration) * 60_000;
    const contact = (body['contact'] ?? {}) as Record<string, string>;
    const made: Appointment = { ...appointments[3]!, id: `apt_demo_${Date.now()}`, title: String(body['title'] ?? 'Site visit'), start, end, startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString(), status: 'confirmed', source: 'dashboard', attendee: contact.name || contact.email ? { name: contact.name ?? null, email: contact.email ?? null, phone: contact.phone ?? null } : null, contact: null, job: null, conversationId: null, notes: (body['notes'] as string) || null, location: (body['location'] as string) || null, createdBy: 'Dan', createdAt: Date.now(), updatedAt: Date.now() };
    appointments.push(made);
    return json(made, 201);
  }
  if (id) {
    const a = appointments.find((x) => x.id === id);
    if (!a) return json({ error: { code: 'not_found', message: 'No such appointment.' } }, 404);
    if (method === 'DELETE') {
      appointments.splice(appointments.indexOf(a), 1);
      return json({ id, deleted: true });
    }
    if (method === 'PATCH') {
      if (body['start']) {
        const start = Date.parse(String(body['start']));
        Object.assign(a, { end: start + (a.end - a.start), start });
      }
      if (body['status']) a.status = body['status'] as Appointment['status'];
      if (body['notes'] !== undefined) a.notes = (body['notes'] as string) || null;
      a.updatedAt = Date.now();
    }
    return json(a);
  }
  const from = params.get('from') ? Date.parse(params.get('from')!) : -Infinity;
  const to = params.get('to') ? Date.parse(params.get('to')!) : Infinity;
  const status = params.get('status') ?? 'active';
  const job = params.get('job');
  const contact = params.get('contact');
  const conversation = params.get('conversation');
  const items = appointments
    .filter((a) => a.end > from && a.start < to)
    .filter((a) => (status === 'all' ? true : status === 'active' ? a.status !== 'cancelled' : status === 'appointments' ? a.status !== 'busy' : a.status === status))
    .filter((a) => (!job || a.job?.id === job) && (!contact || a.contact?.id === contact) && (!conversation || a.conversationId === conversation))
    .sort((x, y) => x.start - y.start);
  return json({ items });
}
