import { ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/Shell';
import { AppointmentPanel, NewAppointment, STATUS, StatusSelect, fmtClock, fmtDay, whoOf } from '../components/Appointments';
import { Badge, Button, Card, Empty, ErrorNote, Segmented, Skeleton } from '../components/ui';
import { api, isMember, type Appointment, type BookingsStatus, type Me, type SettingsView, type SyncResult } from '../lib/api';
import { cn, fmtRelative, usePersisted } from '../lib/utils';

/**
 * The Calendar (on with the date picker, Settings → Bookings): every
 * appointment as a list, a month, a week or a day, in the viewer's time
 * zone. Busy time read from the synced calendar shows muted. Opening it reads
 * the synced calendar (at most once a minute); **Sync** reads it now.
 */

type View = 'list' | 'month' | 'week' | 'day';
const VIEWS = ['list', 'month', 'week', 'day'] as const;

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const addDays = (ms: number, days: number) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
};
/** Monday of the week `ms` is in. */
const startOfWeek = (ms: number) => {
  const day = startOfDay(ms);
  const weekday = (new Date(day).getDay() + 6) % 7;
  return addDays(day, -weekday);
};
const startOfMonth = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

function rangeOf(view: View, anchor: number): { from: number; to: number; title: string } {
  if (view === 'day') return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1), title: new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(anchor) };
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7), title: `${fmtDay(from)} – ${fmtDay(addDays(from, 6))}` };
  }
  if (view === 'month') {
    const first = startOfMonth(anchor);
    const from = startOfWeek(first);
    return { from, to: addDays(from, 42), title: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(first) };
  }
  return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 60), title: 'Coming up' };
}

function shift(view: View, anchor: number, by: 1 | -1): number {
  if (view === 'day') return addDays(anchor, by);
  if (view === 'week') return addDays(anchor, 7 * by);
  if (view === 'month') {
    const d = new Date(startOfMonth(anchor));
    return new Date(d.getFullYear(), d.getMonth() + by, 1).getTime();
  }
  return addDays(anchor, 60 * by);
}

const tone = (a: Appointment) => (a.status === 'busy' ? 'bg-muted text-muted-foreground' : a.status === 'cancelled' ? 'bg-muted/60 text-muted-foreground line-through' : 'bg-primary/10 text-foreground');

export function Calendar({ me }: { me: Me }) {
  const admin = !isMember(me);
  const [view, setView] = usePersisted<View>('hp-calendar-view', 'week', VIEWS);
  const [anchor, setAnchor] = useState(() => Date.now());
  const [status, setStatus] = useState('active');
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [info, setInfo] = useState<BookingsStatus | null>(null);
  const [duration, setDuration] = useState(30);
  const [title, setTitle] = useState('Appointment');
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [open, setOpen] = useState<Appointment | null>(null);
  const [creating, setCreating] = useState<number | null>(null);
  const range = useMemo(() => rangeOf(view, anchor), [view, anchor]);

  const load = () => {
    const query = new URLSearchParams({ from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString(), status: view === 'list' ? status : 'all' });
    api<{ items: Appointment[] }>(`/appointments?${query}`).then(
      (r) => {
        setItems(r.items);
        setError(null);
      },
      (thrown: Error) => setError(thrown),
    );
  };
  useEffect(load, [range.from, range.to, status, view]);

  const sync = async (force: boolean) => {
    setSyncing(true);
    try {
      const r = await api<SyncResult>('/appointments/sync', { method: 'POST', json: { force } });
      setSyncNote(r.synced ? `Read just now: ${r.added} new, ${r.updated} moved, ${r.cancelled} cancelled.` : (r.reason ?? null));
      if (r.synced) load();
    } catch (thrown) {
      setSyncNote((thrown as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  // Opening the page reads the synced calendar (the server skips it if it was read in the last minute).
  useEffect(() => {
    api<BookingsStatus>('/bookings').then((s) => {
      setInfo(s);
      if (s.calendar.sync !== 'none') void sync(false);
    }, () => {});
    api<SettingsView>('/settings').then((v) => {
      if (v.settings.bookings) {
        setDuration(v.settings.bookings.duration);
        setTitle(v.settings.bookings.title);
      }
    }, () => {});
  }, []);

  const changed = (next: Appointment | null) => {
    if (!next) setOpen(null);
    load();
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Every appointment: booked in the chat, added here, from the API, or read from your synced calendar. Times are in your time zone."
        help="Bookings#the-calendar"
        actions={
          <div className="flex items-center gap-2">
            {info && info.calendar.sync !== 'none' && (
              <Button variant="outline" size="sm" onClick={() => void sync(true)} disabled={syncing} title={info.syncedAt ? `Last read ${fmtRelative(info.syncedAt)}` : undefined}>
                {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync
              </Button>
            )}
            <Button size="sm" onClick={() => setCreating(Math.ceil((Date.now() + 3_600_000) / 1_800_000) * 1_800_000)}>
              <Plus /> New
            </Button>
          </div>
        }
      />
      <div className="space-y-3 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={view} onChange={setView} options={VIEWS.map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))} label="View" />
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-8" aria-label="Earlier" onClick={() => setAnchor(shift(view, anchor, -1))}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(Date.now())}>
              Today
            </Button>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Later" onClick={() => setAnchor(shift(view, anchor, 1))}>
              <ChevronRight />
            </Button>
          </div>
          <h2 className="text-[15px] font-semibold" aria-live="polite">
            {range.title}
          </h2>
          <div className="ml-auto flex items-center gap-2">
            {syncNote && <p className="text-xs text-muted-foreground" role="status">{syncNote}</p>}
            {view === 'list' && <StatusSelect value={status} onChange={setStatus} />}
          </div>
        </div>
        {error ? (
          <ErrorNote error={error} onRetry={load} />
        ) : !items ? (
          <Skeleton className="h-96" />
        ) : view === 'list' ? (
          <ListView items={items} onOpen={setOpen} />
        ) : view === 'month' ? (
          <MonthView items={items} from={range.from} anchor={anchor} onOpen={setOpen} onDay={(day) => { setAnchor(day); setView('day'); }} />
        ) : (
          <TimeGrid items={items} from={range.from} days={view === 'week' ? 7 : 1} onOpen={setOpen} onSlot={(at) => setCreating(at)} />
        )}
      </div>
      {open && <AppointmentPanel appointment={open} admin={admin} onClose={() => setOpen(null)} onChanged={changed} />}
      {creating !== null && (
        <NewAppointment
          context={{ start: creating }}
          duration={duration}
          title={title}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            load();
          }}
        />
      )}
    </>
  );
}

function ListView({ items, onOpen }: { items: Appointment[]; onOpen: (a: Appointment) => void }) {
  const days = new Map<number, Appointment[]>();
  for (const a of items) {
    const day = startOfDay(a.start);
    days.set(day, [...(days.get(day) ?? []), a]);
  }
  if (!items.length) return <Empty icon={<Plus />} title="Nothing in the next two months">Appointments booked in the chat, added here or read from your calendar show here.</Empty>;
  return (
    <Card className="divide-y">
      {[...days].map(([day, list]) => (
        <section key={day} aria-label={fmtDay(day)}>
          <h3 className="bg-subtle px-4 py-1.5 text-xs font-medium text-muted-foreground">{new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(day)}</h3>
          <ul className="divide-y">
            {list.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onOpen(a)} className="flex w-full items-center gap-3 px-4 py-2.5 text-start text-[13px] hover:bg-subtle/60">
                  <span className="w-28 shrink-0 tabular-nums text-muted-foreground">
                    {fmtClock(a.start)} – {fmtClock(a.end)}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate', a.status === 'cancelled' && 'text-muted-foreground line-through')}>
                    <span className="font-medium">{a.title}</span>
                    {whoOf(a) && <span className="text-muted-foreground"> · {whoOf(a)}</span>}
                    {a.job?.number && <span className="text-muted-foreground"> · #{a.job.number}</span>}
                  </span>
                  {a.status !== 'confirmed' && <Badge dot={STATUS[a.status].dot}>{STATUS[a.status].label}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Card>
  );
}

function MonthView({ items, from, anchor, onOpen, onDay }: { items: Appointment[]; from: number; anchor: number; onOpen: (a: Appointment) => void; onDay: (day: number) => void }) {
  const month = new Date(anchor).getMonth();
  const today = startOfDay(Date.now());
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(addDays(from, i)));
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b bg-subtle text-center text-xs text-muted-foreground">
        {weekdays.map((w) => (
          <div key={w} className="py-1.5">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 42 }, (_, i) => {
          const day = addDays(from, i);
          const list = items.filter((a) => a.start >= day && a.start < addDays(day, 1) && a.status !== 'cancelled');
          return (
            <div key={day} className={cn('min-h-24 border-r border-b p-1 last:border-r-0 [&:nth-child(7n)]:border-r-0', new Date(day).getMonth() !== month && 'bg-subtle/50 text-muted-foreground')}>
              <button type="button" onClick={() => onDay(day)} className={cn('mb-1 rounded px-1 text-xs hover:bg-muted', day === today && 'bg-primary font-semibold text-primary-foreground hover:bg-primary')} aria-label={`${new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(day)}: ${list.length}`}>
                {new Date(day).getDate()}
              </button>
              <ul className="space-y-0.5">
                {list.slice(0, 3).map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => onOpen(a)} className={cn('block w-full truncate rounded px-1 py-0.5 text-start text-[11px]', tone(a))}>
                      {fmtClock(a.start)} {a.title}
                    </button>
                  </li>
                ))}
                {list.length > 3 && (
                  <li>
                    <button type="button" onClick={() => onDay(day)} className="px-1 text-[11px] text-muted-foreground hover:underline">
                      +{list.length - 3} more
                    </button>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const HOUR_PX = 48;

/** A week or a day: hours down the side, appointments as blocks. A click on an empty hour starts a new one there. */
function TimeGrid({ items, from, days, onOpen, onSlot }: { items: Appointment[]; from: number; days: number; onOpen: (a: Appointment) => void; onSlot: (at: number) => void }) {
  const shown = items.filter((a) => a.status !== 'cancelled');
  // The hours that matter: 7 to 19, widened to fit what is booked.
  const hoursOf = (a: Appointment) => [new Date(a.start).getHours(), new Date(a.end - 1).getHours() + 1];
  const first = Math.min(7, ...shown.map((a) => hoursOf(a)[0]!));
  const last = Math.max(19, ...shown.map((a) => hoursOf(a)[1]!));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const today = startOfDay(Date.now());
  return (
    <Card className="overflow-hidden">
      <div className="grid border-b bg-subtle text-xs text-muted-foreground" style={{ gridTemplateColumns: `52px repeat(${days}, minmax(0, 1fr))` }}>
        <div />
        {Array.from({ length: days }, (_, i) => {
          const day = addDays(from, i);
          return (
            <div key={day} className={cn('py-1.5 text-center', day === today && 'font-semibold text-foreground')}>
              {fmtDay(day)}
            </div>
          );
        })}
      </div>
      <div className="scroll-thin max-h-[70vh] overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: `52px repeat(${days}, minmax(0, 1fr))` }}>
          <div>
            {hours.map((h) => (
              <div key={h} className="pr-2 text-right text-[11px] text-muted-foreground tabular-nums" style={{ height: HOUR_PX }}>
                {new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, h))}
              </div>
            ))}
          </div>
          {Array.from({ length: days }, (_, i) => {
            const day = addDays(from, i);
            const list = shown.filter((a) => a.start < addDays(day, 1) && a.end > day);
            return (
              <div key={day} className="relative border-l">
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className="block w-full border-b border-dashed border-border/60 hover:bg-subtle/60"
                    style={{ height: HOUR_PX }}
                    aria-label={`New appointment ${fmtDay(day)} ${h}:00`}
                    onClick={() => onSlot(new Date(day).setHours(h, 0, 0, 0))}
                  />
                ))}
                {list.map((a) => {
                  const start = Math.max(a.start, day);
                  const end = Math.min(a.end, addDays(day, 1));
                  const top = ((start - day) / 3_600_000 - first) * HOUR_PX;
                  const height = Math.max(18, ((end - start) / 3_600_000) * HOUR_PX - 2);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onOpen(a)}
                      className={cn('absolute right-1 left-1 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-start text-[11px] leading-tight', tone(a), a.status === 'busy' ? 'border-muted-foreground/40' : 'border-primary')}
                      style={{ top, height }}
                    >
                      <span className="font-medium">{a.status === 'busy' ? 'Busy' : a.title}</span>
                      <span className="block truncate text-muted-foreground">
                        {fmtClock(a.start)}
                        {whoOf(a) ? ` · ${whoOf(a)}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

