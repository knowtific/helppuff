import { assertKnown, bool, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi, type AdminApi } from '../engine/admin-api.js';
import { loadEnv } from '../engine/env.js';
import { loadProject } from '../engine/project.js';
import type { Ctx } from './context.js';
import { confirmDelete } from './confirm.js';

/**
 * Appointments from the terminal, the same as the dashboard's Settings →
 * Bookings, Settings → Integrations and the Calendar page. Everything goes
 * through the admin API; nothing here writes helppuff.json (run
 * `helppuff config pull` afterwards to keep it in git).
 *
 *   helppuff bookings [show]
 *   helppuff bookings mode <none|link|picker|auto> [--link url]
 *   helppuff bookings sync <none|calcom|calendly|google|outlook> [--event-type id] [--account id] [--calendar id]
 *   helppuff bookings set [--title …] [--duration 30] [--buffer 15] [--notice 120] [--days-ahead 30]
 *                         [--timezone Area/City] [--phone off|optional|required] [--location …] [--label …]
 *                         [--hours "mon=09:00-17:00;tue=09:00-12:00,13:00-17:00;sat="] [--sync-minutes 15]
 *   helppuff bookings slots [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *   helppuff bookings test [calcom|calendly|google|outlook]
 *
 *   helppuff appointments list [--from …] [--to …] [--status …] [--job id]
 *   helppuff appointments add --start ISO [--duration 30] [--name …] [--email …] [--phone …] [--title …] [--job id] [--notes …] [--force]
 *   helppuff appointments move <id> --start ISO
 *   helppuff appointments cancel <id> [--reason …] | done <id> | no-show <id> | delete <id>
 *   helppuff appointments sync
 *
 *   helppuff integrations [list]
 *   helppuff integrations add <composio|calcom|calendly> --key-env NAME [--base-url https://…]
 *   helppuff integrations test <kind> | remove <kind>
 *   helppuff integrations accounts [google|outlook] | connect <google|outlook>
 *   helppuff integrations calcom-webhook
 */

type Bookings = {
  mode?: string;
  link?: string;
  label: string;
  sync: string;
  account?: string;
  calendar?: string;
  eventType?: string;
  title: string;
  duration: number;
  hours: Record<string, string[]>;
  buffer: number;
  notice: number;
  daysAhead: number;
  timezone?: string;
  phone: string;
  location?: string;
  syncMinutes: number;
};
type Status = {
  effective: { mode: string; link: string | null; label: string; chosen: boolean };
  found: { url: string; provider: string | null; page: string | null } | null;
  timezone: string;
  calendar: { sync: string; integration: { connected: boolean; status: string; lastError: string | null } | null; ready: boolean };
  syncedAt: number | null;
  upcoming: number;
};
type Appointment = {
  id: string;
  title: string;
  start: number;
  end: number;
  startIso: string;
  timezone: string;
  status: string;
  source: string;
  provider: string;
  location: string | null;
  attendee: { name: string | null; email: string | null; phone: string | null } | null;
  job: { id: string; number: number | null; title: string | null } | null;
};

const MODES = ['none', 'link', 'picker', 'auto'];
const SYNCS = ['none', 'calcom', 'calendly', 'google', 'outlook'];
const KINDS = ['composio', 'calcom', 'calendly'];

const when = (ms: number, zone: string) => {
  try {
    return new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: zone }).format(ms);
  } catch {
    return new Date(ms).toISOString();
  }
};

async function settingsOf(api: AdminApi): Promise<Bookings> {
  const { settings } = await api.get<{ settings: { bookings?: Bookings } }>('/admin/api/settings');
  if (!settings.bookings) throw new CliError('outdated', 'This Worker is older than appointments.', { hint: 'helppuff upgrade', exitCode: EXIT.usage });
  return settings.bookings;
}

const saveBookings = (api: AdminApi, patch: Record<string, unknown>) => api.send<{ settings: { bookings: Bookings } }>('PUT', '/admin/api/settings', { settings: { bookings: patch } });

/** `mon=09:00-17:00;tue=09:00-12:00,13:00-17:00;sat=` → the hours object (days left out keep theirs). */
export function parseHours(value: string, current: Record<string, string[]>): Record<string, string[]> {
  const out = { ...current };
  for (const part of value.split(';').map((p) => p.trim()).filter(Boolean)) {
    const [day = '', ranges = ''] = part.split('=');
    const key = day.trim().toLowerCase().slice(0, 3);
    if (!['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(key)) throw new CliError('usage', `Unknown day "${day}" in --hours: use mon, tue, wed, thu, fri, sat, sun.`, { exitCode: EXIT.usage });
    out[key] = ranges.split(',').map((r) => r.trim()).filter(Boolean);
  }
  return out;
}

function printStatus(ctx: Ctx, status: Status, b: Bookings): void {
  const mode = status.effective.mode;
  process.stdout.write(`${c.bold('How visitors book:')} ${mode === 'picker' ? 'date picker in the chat' : mode === 'link' ? `booking link → ${status.effective.link}` : 'no appointments'}${status.effective.chosen ? '' : c.dim(' (from the website: not chosen yet)')}\n`);
  if (status.found) process.stdout.write(c.dim(`Found on the website: ${status.found.url}${status.found.provider ? ` (${status.found.provider})` : ''}\n`));
  if (mode !== 'picker') return;
  const integration = status.calendar.integration;
  process.stdout.write(`${c.bold('Calendar sync:')} ${b.sync === 'none' ? 'none (HelpPuff keeps the appointments)' : b.sync}${b.sync !== 'none' ? ` ${integration?.connected ? (integration.status === 'error' ? c.yellow(`— error: ${integration.lastError}`) : c.green('— connected')) : c.yellow('— not connected: helppuff integrations add …')}` : ''}\n`);
  if (b.sync === 'calcom' || b.sync === 'calendly') process.stdout.write(`Event type: ${b.eventType ?? c.yellow('not chosen (helppuff bookings test, then bookings sync … --event-type)')}\n`);
  else {
    process.stdout.write(`What: ${b.title}, ${b.duration} min${b.buffer ? `, ${b.buffer} min between` : ''}; at least ${b.notice} min ahead, up to ${b.daysAhead} days\n`);
    for (const [day, ranges] of Object.entries(b.hours)) process.stdout.write(c.dim(`  ${day}  ${ranges.length ? ranges.join(', ') : 'closed'}\n`));
  }
  process.stdout.write(`Time zone: ${status.timezone} · phone: ${b.phone} · ${status.upcoming} coming up${status.syncedAt ? ` · read ${new Date(status.syncedAt).toLocaleString()}` : ''}\n`);
  void ctx;
}

export async function bookingsCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['link', 'event-type', 'account', 'calendar', 'title', 'duration', 'buffer', 'notice', 'days-ahead', 'timezone', 'phone', 'location', 'label', 'hours', 'sync-minutes', 'from', 'to'], 'bookings');
  const [sub = 'show', arg] = ctx.positionals;
  const api = adminApi(loadProject(ctx.cwd));
  switch (sub) {
    case 'show': {
      const [status, b] = await Promise.all([api.get<Status>('/admin/api/bookings'), settingsOf(api)]);
      ctx.out.result({ ...status, settings: b }, () => printStatus(ctx, status, b));
      return 0;
    }
    case 'mode': {
      if (!arg || !MODES.includes(arg)) {
        if (!arg) return ctx.out.needsInput({ questions: [{ id: 'mode', ask: 'How visitors book: none, link (a booking page), picker (a date picker in the chat), or auto (the website decides).', flag: 'bookings mode <mode>', kind: 'choice', choices: MODES, required: true }] });
        throw new CliError('usage', `mode is one of: ${MODES.join(', ')}.`, { exitCode: EXIT.usage });
      }
      const link = str(ctx.flags, 'link');
      const saved = await saveBookings(api, { mode: arg === 'auto' ? null : arg, ...(link !== undefined ? { link: link || null } : {}) });
      ctx.out.result(saved.settings.bookings, () => ctx.out.success(arg === 'picker' ? 'Visitors book in the chat. Next: `helppuff bookings set …` (hours) or `helppuff bookings sync …` (a calendar).' : arg === 'auto' ? 'The website decides: a booking link found on it is offered.' : `Mode: ${arg}.`));
      return 0;
    }
    case 'sync': {
      if (!arg || !SYNCS.includes(arg)) throw new CliError('usage', `sync is one of: ${SYNCS.join(', ')}.`, { hint: 'helppuff bookings sync calcom --event-type 1234', exitCode: EXIT.usage });
      const patch: Record<string, unknown> = { sync: arg };
      for (const [flag, key] of [['event-type', 'eventType'], ['account', 'account'], ['calendar', 'calendar']] as const) {
        const value = str(ctx.flags, flag);
        if (value !== undefined) patch[key] = value || null;
      }
      const saved = await saveBookings(api, patch);
      const check = arg === 'none' ? null : await api.send<{ ok: boolean; detail: string; eventTypes: { id: string; name: string; duration: number | null }[] }>('POST', '/admin/api/bookings/test', { sync: arg });
      ctx.out.result({ bookings: saved.settings.bookings, check }, () => {
        ctx.out.success(arg === 'none' ? 'HelpPuff keeps the appointments (free time from your hours).' : `Syncing with ${arg}.`);
        if (check) process.stdout.write(`${check.ok ? c.green('✓') : c.yellow('!')} ${check.detail}\n`);
        if (check?.eventTypes.length && !saved.settings.bookings.eventType) {
          process.stdout.write('Event types (choose one with --event-type):\n');
          for (const e of check.eventTypes) process.stdout.write(`  ${e.id}  ${e.name}${e.duration ? c.dim(` · ${e.duration} min`) : ''}\n`);
        }
      });
      return 0;
    }
    case 'set': {
      const patch: Record<string, unknown> = {};
      const num = (flag: string, key: string) => {
        const value = str(ctx.flags, flag);
        if (value === undefined) return;
        const n = Number(value);
        if (!Number.isFinite(n)) throw new CliError('usage', `--${flag} is a number.`, { exitCode: EXIT.usage });
        patch[key] = n;
      };
      num('duration', 'duration');
      num('buffer', 'buffer');
      num('notice', 'notice');
      num('days-ahead', 'daysAhead');
      num('sync-minutes', 'syncMinutes');
      for (const [flag, key] of [['title', 'title'], ['timezone', 'timezone'], ['phone', 'phone'], ['location', 'location'], ['label', 'label']] as const) {
        const value = str(ctx.flags, flag);
        if (value !== undefined) patch[key] = value || (key === 'title' || key === 'label' || key === 'phone' ? value : null);
      }
      const hours = str(ctx.flags, 'hours');
      if (hours !== undefined) patch['hours'] = parseHours(hours, (await settingsOf(api)).hours);
      if (!Object.keys(patch).length) throw new CliError('usage', 'Nothing to set.', { hint: 'helppuff bookings set --duration 45 --hours "mon=09:00-17:00;sat="', exitCode: EXIT.usage });
      const saved = await saveBookings(api, patch);
      ctx.out.result(saved.settings.bookings, () => ctx.out.success(`Saved: ${Object.keys(patch).join(', ')}.`));
      return 0;
    }
    case 'slots': {
      const from = str(ctx.flags, 'from');
      const to = str(ctx.flags, 'to');
      const result = await api.get<{ timezone: string; days: { date: string; slots: { start: number; end: number }[] }[] }>('/admin/api/bookings/slots', { ...(from ? { from } : {}), ...(to ? { to } : {}) });
      ctx.out.result(result, () => {
        if (!result.days.length) process.stdout.write(c.dim('No free times in these days.\n'));
        for (const d of result.days) process.stdout.write(`${d.date}  ${d.slots.map((s) => new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: result.timezone }).format(s.start)).join('  ')}\n`);
        process.stdout.write(c.dim(`(${result.timezone})\n`));
      });
      return 0;
    }
    case 'test': {
      const result = await api.send<{ ok: boolean; detail: string; eventTypes: { id: string; name: string; duration: number | null }[] }>('POST', '/admin/api/bookings/test', arg ? { sync: arg } : {});
      ctx.out.result(result, () => {
        process.stdout.write(`${result.ok ? c.green('✓') : c.yellow('!')} ${result.detail}\n`);
        for (const e of result.eventTypes) process.stdout.write(`  ${e.id}  ${e.name}${e.duration ? c.dim(` · ${e.duration} min`) : ''}\n`);
      });
      return result.ok ? 0 : 1;
    }
    default:
      throw new CliError('usage', 'Usage: helppuff bookings [show] | mode <none|link|picker|auto> | sync <calendar> | set … | slots | test', { exitCode: EXIT.usage });
  }
}

export async function appointmentsCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['from', 'to', 'status', 'job', 'start', 'end', 'duration', 'name', 'email', 'phone', 'title', 'notes', 'location', 'reason', 'force', 'timezone'], 'appointments');
  const [sub = 'list', id] = ctx.positionals;
  const api = adminApi(loadProject(ctx.cwd));
  const need = () => {
    if (!id) throw new CliError('usage', `Usage: helppuff appointments ${sub} <id>`, { hint: 'helppuff appointments list', exitCode: EXIT.usage });
    return encodeURIComponent(id);
  };
  const line = (a: Appointment) =>
    `${a.id}  ${when(a.start, a.timezone)}  ${a.status === 'confirmed' ? '' : `${c.dim(a.status)}  `}${a.title}${a.attendee?.name ? ` · ${a.attendee.name}` : ''}${a.job?.number ? c.dim(` · #${a.job.number}`) : ''}\n`;
  const done = (a: Appointment, text: string) => ctx.out.result(a, () => ctx.out.success(`${text}: ${when(a.start, a.timezone)} · ${a.title}`));
  switch (sub) {
    case 'list': {
      const query = Object.fromEntries((['from', 'to', 'status', 'job'] as const).flatMap((k) => (str(ctx.flags, k) ? [[k, str(ctx.flags, k)!]] : [])));
      const { items } = await api.get<{ items: Appointment[] }>('/admin/api/appointments', { from: new Date().toISOString(), ...query });
      ctx.out.result({ items }, () => {
        if (!items.length) process.stdout.write(c.dim('Nothing coming up.\n'));
        for (const a of items) process.stdout.write(line(a));
      });
      return 0;
    }
    case 'add': {
      const start = str(ctx.flags, 'start');
      if (!start) return ctx.out.needsInput({ questions: [{ id: 'start', ask: 'When it starts (ISO 8601, e.g. 2026-10-15T09:00:00+11:00).', flag: '--start', kind: 'text', required: true }] });
      const contact = Object.fromEntries((['name', 'email', 'phone'] as const).flatMap((k) => (str(ctx.flags, k) ? [[k, str(ctx.flags, k)!]] : [])));
      const body: Record<string, unknown> = { start, ...(Object.keys(contact).length ? { contact } : {}) };
      for (const k of ['end', 'title', 'notes', 'location', 'timezone'] as const) if (str(ctx.flags, k)) body[k] = str(ctx.flags, k);
      if (str(ctx.flags, 'duration')) body['duration'] = Number(str(ctx.flags, 'duration'));
      if (str(ctx.flags, 'job')) body['jobId'] = str(ctx.flags, 'job');
      if (bool(ctx.flags, 'force')) body['force'] = true;
      done(await api.send<Appointment>('POST', '/admin/api/appointments', body), 'Booked');
      return 0;
    }
    case 'move': {
      const start = str(ctx.flags, 'start');
      if (!start) throw new CliError('usage', 'Usage: helppuff appointments move <id> --start ISO', { exitCode: EXIT.usage });
      done(await api.send<Appointment>('PATCH', `/admin/api/appointments/${need()}`, { start, ...(str(ctx.flags, 'end') ? { end: str(ctx.flags, 'end') } : {}) }), 'Moved');
      return 0;
    }
    case 'cancel':
      done(await api.send<Appointment>('PATCH', `/admin/api/appointments/${need()}`, { status: 'cancelled', ...(str(ctx.flags, 'reason') ? { reason: str(ctx.flags, 'reason') } : {}) }), 'Cancelled');
      return 0;
    case 'done':
      done(await api.send<Appointment>('PATCH', `/admin/api/appointments/${need()}`, { status: 'completed' }), 'Completed');
      return 0;
    case 'no-show':
      done(await api.send<Appointment>('PATCH', `/admin/api/appointments/${need()}`, { status: 'no_show' }), 'No-show');
      return 0;
    case 'delete': {
      const id = need();
      if (!(await confirmDelete(ctx, `Delete the appointment ${id}?`, 'If it is still on, it is cancelled in the synced calendar too.'))) return 1;
      const result = await api.send<{ id: string; deleted: boolean }>('DELETE', `/admin/api/appointments/${id}`);
      ctx.out.result(result, () => ctx.out.success(`Deleted ${result.id}.`));
      return 0;
    }
    case 'sync': {
      const result = await api.send<{ synced: boolean; reason?: string; added: number; updated: number; cancelled: number; busy: number }>('POST', '/admin/api/appointments/sync', { force: true });
      ctx.out.result(result, () => (result.synced ? ctx.out.success(`Read the calendar: ${result.added} added, ${result.updated} moved, ${result.cancelled} cancelled, ${result.busy} busy.`) : process.stdout.write(`${result.reason}\n`)));
      return 0;
    }
    default:
      throw new CliError('usage', 'Usage: helppuff appointments list | add --start … | move <id> --start … | cancel <id> | done <id> | no-show <id> | delete <id> | sync', { exitCode: EXIT.usage });
  }
}

type IntegrationView = { kind: string; name: string; connected: boolean; status: string; lastError: string | null; account: string | null; plan: string | null; baseUrl: string | null };

export async function integrationsCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['key-env', 'base-url'], 'integrations');
  const [sub = 'list', arg] = ctx.positionals;
  const loaded = loadProject(ctx.cwd);
  const api = adminApi(loaded);
  const kind = () => {
    if (!arg || !KINDS.includes(arg)) throw new CliError('usage', `The integration is one of: ${KINDS.join(', ')}.`, { exitCode: EXIT.usage });
    return arg;
  };
  switch (sub) {
    case 'list': {
      const { items } = await api.get<{ items: IntegrationView[] }>('/admin/api/integrations');
      ctx.out.result({ items }, () => {
        for (const i of items) {
          const state = !i.connected ? c.dim('not connected') : i.status === 'error' ? c.yellow(`error: ${i.lastError}`) : c.green('connected');
          process.stdout.write(`${i.kind.padEnd(9)} ${state}${i.account ? c.dim(` · ${i.account}`) : ''}${i.plan ? c.dim(` · ${i.plan} plan`) : ''}${i.baseUrl ? c.dim(` · ${i.baseUrl}`) : ''}\n`);
        }
      });
      return 0;
    }
    case 'add': {
      const k = kind();
      const name = str(ctx.flags, 'key-env') ?? `${k.toUpperCase()}_API_KEY`;
      const env = loadEnv(ctx.cwd);
      const key = env[name] ?? process.env[name];
      if (!key) {
        return ctx.out.needsInput({
          message: `${name} is not in .env yet: nothing was saved.`,
          questions: [{ id: name, ask: `The ${k} key. The user stores it with \`helppuff secret set ${name}\`; never paste it into a chat.`, flag: `secret set ${name}`, kind: 'secret', required: true, envVar: name }],
        });
      }
      const baseUrl = str(ctx.flags, 'base-url');
      const saved = await api.send<IntegrationView & { check: { ok: boolean; detail: string } }>('PUT', `/admin/api/integrations/${k}`, { key, ...(baseUrl !== undefined ? { baseUrl } : {}) });
      ctx.out.result(saved, () => process.stdout.write(`${saved.check.ok ? c.green('✓') : c.yellow('!')} ${saved.name}: ${saved.check.detail}\n`));
      return saved.check.ok ? 0 : 1;
    }
    case 'test': {
      const k = kind();
      const result = await api.send<{ ok: boolean; detail: string }>('POST', `/admin/api/integrations/${k}/test`, {});
      ctx.out.result(result, () => process.stdout.write(`${result.ok ? c.green('✓') : c.yellow('!')} ${result.detail}\n`));
      return result.ok ? 0 : 1;
    }
    case 'remove': {
      const k = kind();
      if (!(await confirmDelete(ctx, `Remove the ${k} key?`, 'A calendar synced through it stops syncing; appointments stay.'))) return 1;
      const result = await api.send<{ kind: string; deleted: boolean }>('DELETE', `/admin/api/integrations/${k}`);
      ctx.out.result(result, () => ctx.out.success(`Removed ${k}.`));
      return 0;
    }
    case 'accounts': {
      const { items } = await api.get<{ items: { id: string; toolkit: string; label: string; status: string }[] }>('/admin/api/integrations/composio/accounts', arg ? { toolkit: arg } : {});
      ctx.out.result({ items }, () => {
        if (!items.length) process.stdout.write(c.dim('No accounts yet: helppuff integrations connect google\n'));
        for (const a of items) process.stdout.write(`${a.id}  ${a.toolkit}  ${a.label}  ${a.status === 'ACTIVE' ? c.green('active') : c.dim(a.status.toLowerCase())}\n`);
      });
      return 0;
    }
    case 'connect': {
      if (arg !== 'google' && arg !== 'outlook') throw new CliError('usage', 'Usage: helppuff integrations connect <google|outlook>', { exitCode: EXIT.usage });
      const { url } = await api.send<{ url: string }>('POST', '/admin/api/integrations/composio/connect', { toolkit: arg });
      ctx.out.result({ url }, () => process.stdout.write(`Open this link to sign in to ${arg === 'google' ? 'Google Calendar' : 'Outlook'} (it expires soon):\n${url}\nThen: helppuff integrations accounts ${arg}\n`));
      return 0;
    }
    case 'calcom-webhook': {
      const hook = await api.get<{ url: string; secret: string; triggers: string[] }>('/admin/api/integrations/calcom/webhook');
      ctx.out.result(hook, () => process.stdout.write(`In Cal.com → Settings → Developer → Webhooks, add:\n  Subscriber URL  ${hook.url}\n  Secret          ${hook.secret}\n  Triggers        ${hook.triggers.join(', ')}\n`));
      return 0;
    }
    default:
      throw new CliError('usage', 'Usage: helppuff integrations [list] | add <kind> --key-env NAME | test <kind> | remove <kind> | accounts [google|outlook] | connect <google|outlook> | calcom-webhook', { exitCode: EXIT.usage });
  }
}
