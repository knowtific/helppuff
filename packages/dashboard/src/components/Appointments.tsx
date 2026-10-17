import { CalendarClock, ExternalLink, Loader2, MessagesSquare, Plus, Trash2, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, type Appointment, type AppointmentStatus } from '../lib/api';
import { cn, href, useData } from '../lib/utils';
import { Badge, Button, Card, Input, Select, Textarea, useModal } from './ui';
import { confirmDelete } from '../lib/confirm';

/**
 * Appointments in the dashboard (on with the date picker, Settings →
 * Bookings): the new-appointment form, an appointment's details, and the
 * Appointments section on a job, a contact and a conversation. The Calendar
 * page (`pages/Calendar.tsx`) uses the same pieces.
 */

export const STATUS: Record<AppointmentStatus, { label: string; dot: string }> = {
  confirmed: { label: 'Confirmed', dot: '#22c55e' },
  pending: { label: 'Pending', dot: '#f59e0b' },
  completed: { label: 'Completed', dot: '#64748b' },
  no_show: { label: 'No-show', dot: '#ef4444' },
  cancelled: { label: 'Cancelled', dot: '#a1a1aa' },
  busy: { label: 'Busy (calendar)', dot: '#a1a1aa' },
};

export const SOURCE_LABEL: Record<Appointment['source'], string> = { chat: 'Booked in the chat', dashboard: 'Added here', api: 'From the API', provider: 'From your calendar' };

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (ms: number) => dayFmt.format(ms);
export const fmtClock = (ms: number) => timeFmt.format(ms);
export const fmtWhen = (a: Pick<Appointment, 'start' | 'end'>) => `${fmtDay(a.start)}, ${fmtClock(a.start)} – ${fmtClock(a.end)}`;

/** `YYYY-MM-DDTHH:MM` in the browser's time zone, for a datetime-local input. */
export const localInput = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const whoOf = (a: Appointment) => a.contact?.name ?? a.attendee?.name ?? a.contact?.email ?? a.attendee?.email ?? null;

function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="block space-y-1" htmlFor={htmlFor}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useModal<HTMLDivElement>(onClose);
  return (
    <div ref={ref} className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]" role="dialog" aria-modal="true" aria-label={title}>
      <Card className={cn('w-full', wide ? 'max-w-xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        {children}
      </Card>
    </div>
  );
}

export type NewAppointmentContext = { jobId?: string; contactId?: string; label?: string; start?: number; contact?: { name?: string; email?: string; phone?: string } };

/** Book by hand: written to the synced calendar, then here, on a job. */
export function NewAppointment({ context, duration = 30, title: defaultTitle = 'Appointment', onClose, onCreated }: { context?: NewAppointmentContext; duration?: number; title?: string; onClose: () => void; onCreated: (a: Appointment) => void }) {
  const linked = Boolean(context?.jobId || context?.contactId);
  const start0 = context?.start ?? Math.ceil((Date.now() + 3_600_000) / 1_800_000) * 1_800_000;
  const [start, setStart] = useState(localInput(start0));
  const [minutes, setMinutes] = useState(String(duration));
  const [title, setTitle] = useState(defaultTitle);
  const [contact, setContact] = useState({ name: context?.contact?.name ?? '', email: context?.contact?.email ?? '', phone: context?.contact?.phone ?? '' });
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; overlap: boolean } | null>(null);
  const submit = async (e: FormEvent, force = false) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await api<Appointment>('/appointments', {
        method: 'POST',
        json: {
          start: new Date(start).toISOString(),
          duration: Number(minutes) || duration,
          title,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(context?.jobId ? { jobId: context.jobId } : {}),
          ...(context?.contactId ? { contactId: context.contactId } : {}),
          ...(!linked && (contact.name || contact.email || contact.phone) ? { contact: Object.fromEntries(Object.entries(contact).filter(([, v]) => v.trim())) } : {}),
          ...(location.trim() ? { location } : {}),
          ...(notes.trim() ? { notes } : {}),
          ...(force ? { force: true } : {}),
        },
      });
      onCreated(made);
    } catch (thrown) {
      const err = thrown as Error & { code?: string };
      setError({ message: err.message, overlap: /overlaps/i.test(err.message) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="New appointment" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3 p-4">
        {context?.label && <p className="text-xs text-muted-foreground">{context.label}</p>}
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
        </Field>
        <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
          <Field label="Starts (your time zone)">
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required autoFocus />
          </Field>
          <Field label="Minutes">
            <Input type="number" min={5} max={480} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>
        {!linked && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Name">
              <Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
            </Field>
          </div>
        )}
        <Field label="Where (optional)">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder="An address, or a meeting link" />
        </Field>
        <Field label="Notes for the team (optional)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-danger">
            <span>{error.message}</span>
            {error.overlap && (
              <Button type="button" size="sm" variant="outline" onClick={(e) => void submit(e as unknown as FormEvent, true)} disabled={busy}>
                Book it anyway
              </Button>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Book
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** An appointment: when, who, its job and conversation; move, mark, cancel, delete. */
export function AppointmentPanel({ appointment, admin, onClose, onChanged }: { appointment: Appointment; admin: boolean; onClose: () => void; onChanged: (a: Appointment | null) => void }) {
  const [a, setA] = useState(appointment);
  const [start, setStart] = useState(localInput(appointment.start));
  const [notes, setNotes] = useState(appointment.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyTime = a.status === 'busy';
  const open = a.status !== 'cancelled' && !busyTime;
  const run = async (json: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api<Appointment>(`/appointments/${a.id}`, { method: 'PATCH', json });
      setA(next);
      setStart(localInput(next.start));
      onChanged(next);
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirmDelete('Delete this appointment?', a.provider !== 'none' && open ? 'It is cancelled in your calendar too.' : undefined)) return;
    setBusy(true);
    try {
      await api(`/appointments/${a.id}`, { method: 'DELETE' });
      onChanged(null);
      onClose();
    } catch (thrown) {
      setError((thrown as Error).message);
      setBusy(false);
    }
  };
  const who = whoOf(a);
  return (
    <Dialog title={a.title} onClose={onClose}>
      <div className="space-y-4 p-4 text-[13px]">
        <div className="space-y-1">
          <p className="text-[15px] font-medium">{fmtWhen(a)}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge dot={STATUS[a.status].dot}>{STATUS[a.status].label}</Badge>
            <span>{SOURCE_LABEL[a.source]}</span>
            {a.provider !== 'none' && <span>· synced with {a.provider === 'calcom' ? 'Cal.com' : a.provider === 'calendly' ? 'Calendly' : a.provider === 'google' ? 'Google Calendar' : 'Outlook'}</span>}
          </div>
        </div>
        <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5">
          {who && (
            <>
              <dt className="text-muted-foreground">With</dt>
              <dd>
                {a.contact ? (
                  <a className="underline-offset-2 hover:underline" href={href({ page: 'contact', id: a.contact.id })}>
                    {who}
                  </a>
                ) : (
                  who
                )}
                {(a.attendee?.email || a.attendee?.phone) && <span className="text-muted-foreground"> · {[a.attendee.email, a.attendee.phone].filter(Boolean).join(' · ')}</span>}
              </dd>
            </>
          )}
          {a.job && (
            <>
              <dt className="text-muted-foreground">Job</dt>
              <dd>
                <a className="underline-offset-2 hover:underline" href={href({ page: 'jobs', id: a.job.id })}>
                  #{a.job.number} {a.job.title}
                </a>
              </dd>
            </>
          )}
          {a.location && (
            <>
              <dt className="text-muted-foreground">Where</dt>
              <dd className="break-words">{/^https:\/\//.test(a.location) ? <a className="inline-flex items-center gap-1 underline-offset-2 hover:underline" href={a.location} target="_blank" rel="noreferrer">{a.location} <ExternalLink className="size-3" /></a> : a.location}</dd>
            </>
          )}
          {a.conversationId && (
            <>
              <dt className="text-muted-foreground">Chat</dt>
              <dd>
                <a className="inline-flex items-center gap-1 underline-offset-2 hover:underline" href={href({ page: 'conversations', id: a.conversationId })}>
                  <MessagesSquare className="size-3.5" /> The conversation
                </a>
              </dd>
            </>
          )}
        </dl>
        {busyTime && <p className="text-xs text-muted-foreground">An event in your synced calendar that matched no contact: shown as busy time. Change it in your calendar.</p>}
        {open && (
          <div className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Move to (your time zone)" htmlFor="apt-move">
                <Input id="apt-move" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Button size="sm" variant="outline" disabled={busy || new Date(start).getTime() === a.start} onClick={() => void run({ start: new Date(start).toISOString() })}>
                Move
              </Button>
              {a.rescheduleUrl && (
                <a className="text-xs text-muted-foreground underline-offset-2 hover:underline" href={a.rescheduleUrl} target="_blank" rel="noreferrer">
                  Move in Calendly
                </a>
              )}
            </div>
            <Field label="Notes for the team">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (a.notes ?? '') && void run({ notes })} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {a.status !== 'completed' && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ status: 'completed' })}>
                  Completed
                </Button>
              )}
              {a.status !== 'no_show' && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ status: 'no_show' })}>
                  No-show
                </Button>
              )}
              {a.status !== 'confirmed' && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ status: 'confirmed' })}>
                  Confirmed
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => window.confirm('Cancel this appointment?') && void run({ status: 'cancelled' })}>
                Cancel appointment
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        {admin && (
          <div className="flex justify-end border-t pt-3">
            <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => void remove()}>
              <Trash2 /> Delete
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** A job's, a contact's or a conversation's appointments, upcoming then past, with "+ Add". */
export function RelatedAppointments({ filter, context, admin }: { filter: { job: string } | { contact: string } | { conversation: string }; context?: NewAppointmentContext; admin: boolean }) {
  const key = Object.keys(filter)[0] as 'job' | 'contact' | 'conversation';
  const value = (filter as Record<string, string>)[key]!;
  const { data, reload } = useData(() => api<{ items: Appointment[] }>(`/appointments?status=appointments&${key}=${encodeURIComponent(value)}`), [key, value]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Appointment | null>(null);
  const now = Date.now();
  const items = data?.items ?? [];
  const upcoming = items.filter((a) => a.end >= now && a.status !== 'cancelled');
  const past = items.filter((a) => !(a.end >= now && a.status !== 'cancelled')).reverse();
  const row = (a: Appointment) => (
    <li key={a.id}>
      <button type="button" onClick={() => setOpen(a)} className={cn('flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-start text-[13px] hover:bg-subtle', a.status === 'cancelled' && 'text-muted-foreground line-through')}>
        <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {fmtWhen(a)} · {a.title}
        </span>
        {a.status !== 'confirmed' && <Badge dot={STATUS[a.status].dot}>{STATUS[a.status].label}</Badge>}
      </button>
    </li>
  );
  return (
    <div className="space-y-1.5">
      {items.length ? (
        <>
          {upcoming.length > 0 && <ul className="space-y-1">{upcoming.map(row)}</ul>}
          {past.length > 0 && (
            <>
              <p className="pt-1 text-[11px] font-medium text-muted-foreground uppercase">Past</p>
              <ul className="space-y-1">{past.map(row)}</ul>
            </>
          )}
        </>
      ) : (
        data && <p className="text-xs text-muted-foreground">None yet.</p>
      )}
      <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
        <Plus /> Add
      </Button>
      {adding && (
        <NewAppointment
          context={context ?? {}}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
      {open && (
        <AppointmentPanel
          appointment={open}
          admin={admin}
          onClose={() => setOpen(null)}
          onChanged={() => reload()}
        />
      )}
    </div>
  );
}

export function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Status" className="h-8 w-auto text-xs">
      <option value="active">Not cancelled</option>
      <option value="all">All</option>
      <option value="confirmed">Confirmed</option>
      <option value="completed">Completed</option>
      <option value="no_show">No-show</option>
      <option value="cancelled">Cancelled</option>
    </Select>
  );
}
