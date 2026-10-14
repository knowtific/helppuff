import { ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type BookingSlots, type BookingsPatch, type BookingsSettings as Bookings, type BookingsStatus, type CalendarSync, type EventType, type SettingsView, type Weekday } from '../lib/api';
import { cn, useData } from '../lib/utils';
import { Choice } from './InstructionsForm';
import { BookingIntegration } from './Integrations';
import { WikiLink, wikiHref } from './Shell';
import { Badge, Button, Card, CardHeader, ErrorNote, InfoTip, Input, Select, Skeleton } from './ui';

/**
 * Settings → Bookings: how visitors book (nothing, a link, or the date
 * picker in the chat), and for the picker, which calendar it syncs with and
 * when people can book. On the right, the picker as a visitor sees it, with
 * the real free times. Saved as `bookings` in the settings.
 */

const MODES: { value: 'none' | 'link' | 'picker'; label: string; hint: string }[] = [
  { value: 'none', label: 'No appointments', hint: 'Nothing about booking in the chat' },
  { value: 'link', label: 'External booking link', hint: 'The chat offers your booking page' },
  { value: 'picker', label: 'Date picker in the chat', hint: 'Visitors pick a time; HelpPuff books it' },
];

const SYNCS: { value: CalendarSync; label: string; needs: 'calcom' | 'calendly' | 'composio' | null }[] = [
  { value: 'none', label: 'None: keep the appointments in HelpPuff', needs: null },
  { value: 'calcom', label: 'Cal.com (cloud or self-hosted)', needs: 'calcom' },
  { value: 'calendly', label: 'Calendly', needs: 'calendly' },
  { value: 'google', label: 'Google Calendar (through Composio)', needs: 'composio' },
  { value: 'outlook', label: 'Outlook / Microsoft 365 (through Composio)', needs: 'composio' },
];

const DAYS: { key: Weekday; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const NOTICE: { value: number; label: string }[] = [
  { value: 0, label: 'Any time' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 1440, label: '1 day' },
  { value: 2880, label: '2 days' },
];

const NOTE_TIP =
  'We tested AI models booking by themselves: even the best sometimes booked a different time than the visitor chose, or booked twice. So the assistant helps the visitor find a time, and the booking itself is done by HelpPuff, the same way every time. No double bookings, whichever model you use. The calendar you sync with only decides where free time comes from and where bookings are written.';

const timeZones = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
})();

function Labeled({ label, children, className, htmlFor }: { label: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label className={cn('block space-y-1', className)} htmlFor={htmlFor}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** One day's opening ranges, as editable "from – to" pairs. */
function DayHours({ day, ranges, onChange }: { day: { key: Weekday; label: string }; ranges: string[]; onChange: (next: string[]) => void }) {
  const open = ranges.length > 0;
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2">
      <label className="flex w-32 items-center gap-2 text-[13px]">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={open} onChange={(e) => onChange(e.target.checked ? ['09:00-17:00'] : [])} />
        {day.label}
      </label>
      {!open && <span className="text-xs text-muted-foreground">Closed</span>}
      {ranges.map((range, i) => {
        const [from = '09:00', to = '17:00'] = range.split('-');
        const set = (f: string, t: string) => onChange(ranges.map((r, j) => (j === i ? `${f}-${t}` : r)));
        return (
          <span key={i} className="flex items-center gap-1">
            <Input type="time" className="h-8 w-28" value={from} onChange={(e) => set(e.target.value, to)} aria-label={`${day.label} from`} />
            <span className="text-muted-foreground">–</span>
            <Input type="time" className="h-8 w-28" value={to === '24:00' ? '23:59' : to} onChange={(e) => set(from, e.target.value)} aria-label={`${day.label} until`} />
            {ranges.length > 1 && (
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove ${day.label} ${from}–${to}`} onClick={() => onChange(ranges.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            )}
          </span>
        );
      })}
      {open && ranges.length < 4 && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...ranges, '13:00-17:00'])} aria-label={`Add hours on ${day.label}`}>
          <Plus />
        </Button>
      )}
    </li>
  );
}

/** The picker as a visitor sees it: the real free times (saved settings), days then times, then the details and Book. */
function PickerPreview({ accent, mode, link, label, version }: { accent: string; mode: 'none' | 'link' | 'picker'; link: string | null; label: string; version: number }) {
  const { data, error, reload } = useData(() => (mode === 'picker' ? api<BookingSlots>('/bookings/slots') : Promise.resolve(null)), [mode, version]);
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<number | null>(null);
  const [booked, setBooked] = useState(false);
  useEffect(() => {
    setDay(data?.days[0]?.date ?? null);
    setTime(null);
    setBooked(false);
  }, [data]);
  const zone = data?.timezone;
  const fmt = (ms: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...o, ...(zone ? { timeZone: zone } : {}) }).format(ms);
  if (mode === 'none') return <p className="rounded-xl border bg-background p-4 text-[13px] text-muted-foreground">Nothing about appointments in the chat.</p>;
  if (mode === 'link')
    return (
      <div className="space-y-2 rounded-xl border bg-background p-4 text-[13px]">
        <div className="rounded-lg bg-muted/60 p-2.5">
          <p className="font-medium">{label}</p>
          <p className="truncate text-[11px] text-muted-foreground">{link ?? 'Add your booking page'}</p>
        </div>
        <p className="text-xs text-muted-foreground">On the home screen, and after an answer about booking. It opens your page in a new tab.</p>
      </div>
    );
  const slots = data?.days.find((d) => d.date === day)?.slots ?? [];
  return (
    <div className="space-y-3 rounded-xl border bg-background p-4 text-[13px]" role="figure" aria-label="Preview of the date picker">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{data?.title ?? 'Appointment'}</p>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Refresh the free times" onClick={reload}>
          <RefreshCw />
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error.message}</p>}
      {!data && !error && <Skeleton className="h-24" />}
      {data && booked && time !== null ? (
        <div className="space-y-1 rounded-lg bg-muted/60 p-3">
          <p className="text-[11px] font-semibold uppercase" style={{ color: accent }}>
            ✓ Booked
          </p>
          <p className="font-medium">{fmt(time, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}</p>
          <p className="text-[11px] text-muted-foreground">A preview: nothing was booked.</p>
          <button type="button" className="text-xs underline" onClick={() => setBooked(false)}>
            Start again
          </button>
        </div>
      ) : data && time !== null ? (
        <div className="space-y-2">
          <p className="font-medium">{fmt(time, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}</p>
          <div className="h-8 rounded-md border bg-muted/40 px-2 leading-8 text-muted-foreground">Your name</div>
          <div className="h-8 rounded-md border bg-muted/40 px-2 leading-8 text-muted-foreground">Email</div>
          {data.phone !== 'off' && <div className="h-8 rounded-md border bg-muted/40 px-2 leading-8 text-muted-foreground">{data.phone === 'required' ? 'Phone' : 'Phone (optional)'}</div>}
          <button type="button" className="h-9 w-full rounded-md font-medium text-white" style={{ background: accent }} onClick={() => setBooked(true)}>
            Book
          </button>
          <button type="button" className="text-xs underline" onClick={() => setTime(null)}>
            Change time
          </button>
        </div>
      ) : data ? (
        data.days.length === 0 ? (
          <p className="text-muted-foreground">No free times in the next week. Check the hours, or the calendar.</p>
        ) : (
          <>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {data.days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={d.date === day}
                  onClick={() => setDay(d.date)}
                  className={cn('flex min-w-14 shrink-0 flex-col items-center rounded-lg border px-2 py-1 text-[11px]', d.date === day ? 'border-transparent text-white' : 'bg-background')}
                  style={d.date === day ? { background: accent } : undefined}
                >
                  <span className="opacity-80">{new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(Date.parse(`${d.date}T12:00:00Z`))}</span>
                  <span>{new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.parse(`${d.date}T12:00:00Z`))}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {slots.map((s) => (
                <button key={s.start} type="button" className="rounded-lg border bg-background py-1 text-xs hover:bg-muted" onClick={() => setTime(s.start)}>
                  {fmt(s.start, { hour: 'numeric', minute: '2-digit' })}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Times are in {zone?.split('/').pop()?.replace(/_/g, ' ')} time (the visitor sees their own).</p>
          </>
        )
      ) : null}
    </div>
  );
}

export function BookingsSettings() {
  const view = useData(() => api<SettingsView>('/settings'), []);
  const status = useData(() => api<BookingsStatus>('/bookings'), []);
  const [draft, setDraft] = useState<Bookings | null>(null);
  const [base, setBase] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [eventTypes, setEventTypes] = useState<EventType[] | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; detail: string } | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; label: string; status: string }[] | null>(null);

  useEffect(() => {
    const b = view.data?.settings.bookings;
    if (b && !draft) {
      setDraft(b);
      setBase(JSON.stringify(b));
    }
  }, [view.data]);

  const sync = draft?.sync ?? 'none';
  const loadCalendar = async (which: CalendarSync) => {
    setCheck(null);
    setEventTypes(null);
    setAccounts(null);
    if (which === 'none') return;
    const result = await api<{ ok: boolean; detail: string; eventTypes: EventType[] }>('/bookings/test', { method: 'POST', json: { sync: which } }).catch((thrown: Error) => ({ ok: false, detail: thrown.message, eventTypes: [] }));
    setCheck({ ok: result.ok, detail: result.detail });
    setEventTypes(result.eventTypes);
    if (which === 'google' || which === 'outlook') {
      const listed = await api<{ items: { id: string; label: string; status: string }[] }>(`/integrations/composio/accounts?toolkit=${which}`).catch(() => ({ items: [] }));
      setAccounts(listed.items);
    }
  };
  useEffect(() => {
    if (draft?.mode === 'picker') void loadCalendar(sync);
  }, [sync, draft?.mode === 'picker']);

  const dirty = useMemo(() => draft !== null && JSON.stringify(draft) !== base, [draft, base]);
  if (view.error) return <ErrorNote error={view.error} onRetry={view.reload} />;
  if (!view.data || !draft) return <Skeleton className="h-96" />;
  if (!view.data.settings.bookings) return <p className="text-[13px] text-muted-foreground">This Worker is older than appointments: upgrade it (Settings → Updates).</p>;

  const effective = status.data?.effective;
  const found = status.data?.found ?? null;
  const mode = draft.mode ?? effective?.mode ?? 'none';
  const bookingPage = draft.mode === undefined ? effective?.link ?? found?.url ?? draft.link ?? '' : draft.link ?? effective?.link ?? found?.url ?? '';
  const set = (patch: Partial<Bookings>) => setDraft({ ...draft, ...patch });
  const providerSlots = sync === 'calcom' || sync === 'calendly';
  const integrationKind = SYNCS.find((s) => s.value === sync)?.needs;
  const integration = status.data?.calendar.sync === sync ? status.data.calendar.integration : null;

  const save = async () => {
    if (draft.mode === 'link' && !bookingPage.trim()) {
      setSaveError('Enter your booking page URL.');
      return;
    }
    setBusy(true);
    setNote(null);
    setSaveError(null);
    try {
      const previous = JSON.parse(base) as Bookings;
      // Fields removed in the draft are sent as null, so they clear.
      const patch: BookingsPatch = { ...draft, ...(draft.mode === 'link' ? { link: bookingPage } : {}) };
      for (const key of Object.keys(previous) as (keyof Bookings)[]) if (patch[key] === undefined) (patch as Record<string, unknown>)[key] = null;
      const result = await api<SettingsView>('/settings', { method: 'PUT', json: { settings: { bookings: patch } } });
      const saved = result.settings.bookings!;
      setDraft(saved);
      setBase(JSON.stringify(saved));
      setVersion((v) => v + 1);
      status.reload();
      setNote('Saved. Live on the widget within a minute.');
    } catch (thrown) {
      setSaveError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <Card role="region" aria-label="Appointments">
          <CardHeader title="Appointments" tip={{ label: 'About appointments', text: 'How visitors book from the chat. You can change it any time; appointments already made are kept.', href: wikiHref('Bookings') }} />
          <div className="space-y-3 border-t p-4">
            <Choice name="How visitors book" value={mode} options={MODES} onChange={(value) => set(value === 'link' ? { mode: value, link: bookingPage || undefined } : { mode: value })} />
            {!draft.mode && (
              found ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    In use now: <span className="font-medium text-foreground">the booking link found on your website</span>
                    {found.provider ? ` (${found.provider})` : ''}. Keep this link, then Save to use this URL even if your website changes.
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => set({ mode: 'link', link: bookingPage })}>Keep this link</Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Nothing found on your website, so nothing is offered until you choose.</p>
              )
            )}
            {mode === 'link' && (
              <div className="flex flex-wrap items-end gap-2">
                <Labeled label="Booking page" className="min-w-64 flex-1">
                  <Input type="url" value={bookingPage} placeholder="https://calendly.com/you/consultation" onChange={(e) => set({ mode: 'link', link: e.target.value })} />
                </Labeled>
                {bookingPage && (
                  <a href={bookingPage} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    Open it <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            )}
            {mode === 'picker' && (
              <p className="flex items-start gap-1.5 text-[13px]">
                <span>Visitors pick a time in a calendar in the chat, and HelpPuff books it. The AI suggests times but never books.</span>
                <InfoTip label="Why the AI never books" href={wikiHref('AI-Booking-Tests')}>
                  {NOTE_TIP}
                </InfoTip>
              </p>
            )}
            {mode !== 'none' && (
              <Labeled label="Button" className="max-w-xs">
                <Input value={draft.label} maxLength={40} onChange={(e) => set({ label: e.target.value })} />
              </Labeled>
            )}
            {mode === 'link' && found && /calendly|cal\.com/i.test(found.provider ?? '') && (
              <p className="rounded-md bg-subtle px-3 py-2 text-xs">
                We found your {found.provider} page: use the date picker and sync with {found.provider} to let visitors book in the chat.
              </p>
            )}
          </div>
        </Card>

        {mode === 'picker' && (
          <>
            <Card role="region" aria-label="Calendar sync">
              <CardHeader title="Calendar sync" tip={{ label: 'About calendar sync', text: 'Only where free time comes from and where bookings are written (both ways). The picker works the same with any of them, or with none.' }} />
              <div className="space-y-3 border-t p-4">
                <Select value={sync} onChange={(e) => set({ sync: e.target.value as CalendarSync, eventType: undefined, account: undefined })} aria-label="Calendar to sync with">
                  {SYNCS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                {integrationKind && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {check ? <Badge dot={check.ok ? '#22c55e' : '#f59e0b'}>{check.ok ? 'Connected' : 'Not ready'}</Badge> : <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                    <span className="text-muted-foreground">{check?.detail ?? integration?.lastError ?? ''}</span>
                  </div>
                )}
                {integrationKind && <BookingIntegration key={integrationKind} kind={integrationKind} toolkit={sync === 'google' || sync === 'outlook' ? sync : undefined} onChanged={() => void loadCalendar(sync)} />}
                {providerSlots && (
                  <Labeled label="Event type: its length, hours and rules are used">
                    <div className="flex gap-2">
                      <Select value={draft.eventType ?? ''} onChange={(e) => set({ eventType: e.target.value || undefined })}>
                        <option value="">{eventTypes?.length ? 'Choose one' : 'None found yet'}</option>
                        {(eventTypes ?? []).map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                            {e.duration ? ` · ${e.duration} min` : ''}
                          </option>
                        ))}
                        {draft.eventType && !eventTypes?.some((e) => e.id === draft.eventType) && <option value={draft.eventType}>{draft.eventType}</option>}
                      </Select>
                      <Button type="button" variant="outline" size="icon" aria-label="Refresh the event types" onClick={() => void loadCalendar(sync)}>
                        <RefreshCw />
                      </Button>
                    </div>
                  </Labeled>
                )}
                {(sync === 'google' || sync === 'outlook') && (
                  <Labeled label="Account">
                    <Select value={draft.account ?? ''} onChange={(e) => set({ account: e.target.value || undefined })}>
                      <option value="">{accounts?.length ? 'The only one (or Composio’s default)' : 'None connected yet'}</option>
                      {(accounts ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                          {a.status !== 'ACTIVE' ? ` (${a.status.toLowerCase()})` : ''}
                        </option>
                      ))}
                    </Select>
                  </Labeled>
                )}
              </div>
            </Card>

            <Card role="region" aria-label="What is booked">
              <CardHeader title="What is booked" />
              <div className="grid gap-3 border-t p-4 sm:grid-cols-2">
                <Labeled label="Title">
                  <Input value={draft.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
                </Labeled>
                {!providerSlots && (
                  <Labeled label="Minutes">
                    <Input type="number" min={5} max={480} step={5} value={draft.duration} onChange={(e) => set({ duration: Number(e.target.value) || 30 })} />
                  </Labeled>
                )}
                {sync === 'none' && (
                  <Labeled label="Where (shown on the confirmation)" className="sm:col-span-2">
                    <Input value={draft.location ?? ''} maxLength={300} placeholder="Our office, 12 Smith St, or a meeting link" onChange={(e) => set({ location: e.target.value || undefined })} />
                  </Labeled>
                )}
                <Labeled label="Ask for a phone number">
                  <Select className="w-full" value={draft.phone} onChange={(e) => set({ phone: e.target.value as Bookings['phone'] })}>
                    <option value="off">No</option>
                    <option value="optional">Optional</option>
                    <option value="required">Required</option>
                  </Select>
                </Labeled>
                <Labeled label="Time zone">
                  <Input list="hp-zones" value={draft.timezone ?? ''} placeholder={status.data?.timezone ?? 'Australia/Melbourne'} onChange={(e) => set({ timezone: e.target.value || undefined })} />
                  <datalist id="hp-zones">
                    {timeZones.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </Labeled>
              </div>
            </Card>

            {!providerSlots && (
              <Card role="region" aria-label="When">
                <CardHeader title="When" tip={{ label: 'About when', text: sync === 'none' ? 'The hours appointments can be in. Times already booked are taken out.' : 'The hours appointments can be in; busy time in your calendar is taken out.' }} />
                <ul className="divide-y border-t">
                  {DAYS.map((d) => (
                    <DayHours key={d.key} day={d} ranges={draft.hours[d.key]} onChange={(next) => set({ hours: { ...draft.hours, [d.key]: next } })} />
                  ))}
                </ul>
                <div className="grid gap-3 border-t p-4 sm:grid-cols-3">
                  <Labeled label="Gap between (minutes)">
                    <Input type="number" min={0} max={240} step={5} value={draft.buffer} onChange={(e) => set({ buffer: Number(e.target.value) || 0 })} />
                  </Labeled>
                  <Labeled label="Earliest booking">
                    <Select className="w-full" value={String(draft.notice)} onChange={(e) => set({ notice: Number(e.target.value) })}>
                      {[...NOTICE, ...(NOTICE.some((n) => n.value === draft.notice) ? [] : [{ value: draft.notice, label: `${draft.notice} minutes` }])].map((n) => (
                        <option key={n.value} value={n.value}>
                          {n.value === 0 ? n.label : `${n.label} ahead`}
                        </option>
                      ))}
                    </Select>
                  </Labeled>
                  <Labeled label="Days ahead">
                    <Input type="number" min={1} max={365} value={draft.daysAhead} onChange={(e) => set({ daysAhead: Number(e.target.value) || 30 })} />
                  </Labeled>
                </div>
              </Card>
            )}
          </>
        )}

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
          {saveError && (
            <p role="alert" className="mr-auto text-xs text-danger">
              {saveError}
            </p>
          )}
          {note && !saveError && (
            <p role="status" className="mr-auto text-xs text-muted-foreground">
              {note}
            </p>
          )}
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setDraft(JSON.parse(base) as Bookings)} disabled={busy}>
              Undo changes
            </Button>
          )}
          <Button type="button" onClick={() => void save()} disabled={!dirty || busy}>
            {busy && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      </div>
      <aside className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Preview {dirty && <Badge>Not saved</Badge>}
        </p>
        <PickerPreview accent={view.data.settings.accent} mode={dirty ? mode : (effective?.mode ?? mode)} link={bookingPage || null} label={draft.label} version={version} />
        {mode === 'picker' && dirty && <p className="text-[11px] text-muted-foreground">Times show the saved settings: save to see changes.</p>}
        <p className="text-[11px] text-muted-foreground">
          Why the AI never books: <WikiLink page="AI-Booking-Tests" className="underline">our tests</WikiLink>.
        </p>
      </aside>
    </div>
  );
}
