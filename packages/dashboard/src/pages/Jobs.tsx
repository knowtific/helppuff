import { AlertTriangle, ArrowLeft, Briefcase, CalendarDays, ExternalLink, Loader2, MessageSquare, Plus, Search, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { PageHeader } from '../components/Shell';
import { NotesPanel, SideSection } from '../components/inbox';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Input, Segmented, Select, Skeleton, Textarea } from '../components/ui';
import { api, isMember, type Job, type JobDetail, type JobEvent, type JobField, type JobList, type JobStage, type Me, type PipelineView, type Team } from '../lib/api';
import { useLiveEvents } from '../lib/live';
import { cn, fmtDateTime, fmtRelative, href, useData, useDebounced, usePersisted } from '../lib/utils';

/**
 * Jobs: requests, quotes, projects or tickets on the site's pipeline. A
 * board (one column per open stage, won and lost as drop zones), a list, and
 * a panel per job with its fields, details, updates, notes and history.
 */

const SOURCE: Record<Job['source'], string> = { chat: 'From the chat', quote: 'Quote questions', api: 'API', manual: 'Added by hand', callback: 'From a callback' };
const CREATED: Record<Job['source'], string> = { chat: 'from the chat', quote: 'from the quote questions', api: 'through the API', manual: 'by hand', callback: 'from a callback request' };

export function money(cents: number | null, currency: string | null): string {
  if (cents === null) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: currency ? 'currency' : 'decimal', currency: currency ?? undefined, maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return String(Math.round(cents / 100));
  }
}

/** One value from a job's fields, as shown on a card: the first one or two set, by field order. */
function cardFields(job: Job, fields: JobField[]): string[] {
  return fields
    .filter((f) => !f.archived && f.type !== 'textarea' && job.fields[f.name])
    .slice(0, 2)
    .map((f) => job.fields[f.name]!);
}

function JobCard({ job, fields, stages, onMove, onDragStart, onDropBefore }: { job: Job; fields: JobField[]; stages: JobStage[]; onMove: (job: Job, stageId: string) => void; onDragStart: (job: Job) => void; onDropBefore: (job: Job) => void }) {
  const isNew = Date.now() - job.createdAt < 86_400_000 && job.stage?.id === stages.find((s) => s.kind === 'open')?.id;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', job.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(job);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropBefore(job);
      }}
      className={cn('group rounded-md border bg-card p-2.5 text-[13px] shadow-xs transition-colors hover:border-foreground/20', job.stale && 'border-[#dc2626]/50')}
    >
      <a href={href({ page: 'jobs', id: job.id })} className="block">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium leading-snug">{job.title}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">#{job.number}</span>
        </div>
        {job.contact?.name && <p className="mt-0.5 truncate text-xs text-muted-foreground">{job.contact.name}</p>}
        {cardFields(job, fields).length > 0 && <p className="mt-1 truncate text-xs">{cardFields(job, fields).join(' · ')}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {isNew && <Badge dot="#3b82f6">New</Badge>}
          {job.stale && (
            <span className="inline-flex items-center gap-0.5 text-[#dc2626]">
              <AlertTriangle className="size-3" aria-hidden /> Stale
            </span>
          )}
          {job.valueCents !== null && <span className="font-medium text-foreground">{money(job.valueCents, job.currency)}</span>}
          {job.dueAt && (
            <span className="inline-flex items-center gap-0.5">
              <CalendarDays className="size-3" aria-hidden /> {new Date(job.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          <span className="ml-auto">{fmtRelative(job.stageChangedAt)}</span>
          {job.assignedName && <Avatar name={job.assignedName} className="size-5 text-[9px]" />}
        </div>
      </a>
      {/* Moving without a mouse: the same as dragging. */}
      <select
        value={job.stage?.id ?? ''}
        onChange={(e) => onMove(job, e.target.value)}
        aria-label={`Move ${job.title} to`}
        className="mt-1.5 h-6 w-full cursor-pointer rounded border border-transparent bg-transparent px-1 text-[11px] text-muted-foreground hover:border-border focus-visible:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.kind === 'open' ? s.name : `${s.kind === 'won' ? '✓' : '✗'} ${s.name}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function Board({ list, fields, onMove }: { list: JobList; fields: JobField[]; onMove: (job: Job, stageId: string, before?: string | null) => void }) {
  const dragging = useRef<Job | null>(null);
  const [active, setActive] = useState(false);
  const open = list.stages.filter((s) => s.kind === 'open');
  const closed = list.stages.filter((s) => s.kind !== 'open');
  const drop = (stageId: string, before: string | null) => (e: DragEvent) => {
    e.preventDefault();
    const job = dragging.current;
    setActive(false);
    dragging.current = null;
    if (job) onMove(job, stageId, before);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scroll-thin flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {open.map((stage) => {
          const jobs = list.items.filter((j) => j.stage?.id === stage.id);
          return (
            <section
              key={stage.id}
              aria-label={stage.name}
              onDragOver={(e) => e.preventDefault()}
              onDrop={drop(stage.id, null)}
              className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/40"
            >
              <header className="flex items-center gap-2 px-3 py-2.5">
                <span className="size-2 rounded-full" style={{ background: stage.color }} aria-hidden />
                <h2 className="flex-1 truncate text-[13px] font-medium">{stage.name}</h2>
                <span className="text-xs tabular-nums text-muted-foreground">{stage.count}</span>
              </header>
              {stage.valueCents > 0 && <p className="-mt-1.5 px-3 pb-1.5 text-[11px] text-muted-foreground">{money(stage.valueCents, jobs.find((j) => j.currency)?.currency ?? null)}</p>}
              <div className="scroll-thin flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    fields={fields}
                    stages={list.stages}
                    onMove={(j, stageId) => onMove(j, stageId)}
                    onDragStart={(j) => {
                      dragging.current = j;
                      setActive(true);
                    }}
                    onDropBefore={(target) => {
                      const j = dragging.current;
                      setActive(false);
                      dragging.current = null;
                      if (j && j.id !== target.id) onMove(j, stage.id, target.id);
                    }}
                  />
                ))}
                {jobs.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted-foreground">Nothing here</p>}
              </div>
            </section>
          );
        })}
      </div>
      {/* Won and lost: outcomes, not columns (closed jobs are in the list). */}
      <div className={cn('grid gap-3 border-t px-4 py-3 transition-opacity', closed.length > 2 ? 'grid-cols-3' : 'grid-cols-2', active ? 'opacity-100' : 'opacity-60')}>
        {closed.map((stage) => (
          <div
            key={stage.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={drop(stage.id, null)}
            className={cn('rounded-md border-2 border-dashed px-3 py-3 text-center text-[13px]', stage.kind === 'won' ? 'border-[#16a34a]/40 text-[#16a34a]' : 'border-[#dc2626]/40 text-[#dc2626]')}
          >
            {stage.kind === 'won' ? '✓' : '✗'} {stage.name} <span className="text-xs opacity-70">({stage.count})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListView({ items, fields }: { items: Job[]; fields: JobField[] }) {
  if (!items.length) return null;
  return (
    <div className="overflow-x-auto p-4">
      <Card className="overflow-hidden">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="border-b bg-subtle text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Details</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Assigned</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((job) => (
              <tr key={job.id} className="cursor-pointer hover:bg-subtle" onClick={() => (window.location.hash = href({ page: 'jobs', id: job.id }))}>
                <td className="px-3 py-2 text-muted-foreground">{job.number}</td>
                <td className="px-3 py-2">
                  <a href={href({ page: 'jobs', id: job.id })} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                    {job.title}
                  </a>
                  {job.stale && <span className="ml-1.5 text-[11px] text-[#dc2626]">stale</span>}
                </td>
                <td className="px-3 py-2">{job.stage?.name}</td>
                <td className="px-3 py-2">{job.contact?.name ?? job.contact?.email ?? '—'}</td>
                <td className="max-w-56 truncate px-3 py-2 text-muted-foreground">{cardFields(job, fields).join(' · ')}</td>
                <td className="px-3 py-2 tabular-nums">{money(job.valueCents, job.currency)}</td>
                <td className="px-3 py-2">{job.assignedName ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmtRelative(job.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** An input for one job field, by its type. */
export function FieldInput({ field, value, onChange }: { field: JobField; value: string; onChange: (value: string) => void }) {
  const common = { id: `job-field-${field.name}`, value, required: field.required, 'aria-label': field.label };
  if (field.type === 'textarea') return <Textarea rows={3} {...common} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === 'select' && field.options.length) {
    return (
      <Select {...common} onChange={(e) => onChange(e.target.value)} className="w-full">
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {value && !field.options.includes(value) && <option value={value}>{value}</option>}
      </Select>
    );
  }
  return <Input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'} {...common} onChange={(e) => onChange(e.target.value)} />;
}

/** "New job": by hand, or for a contact, a conversation or a callback. */
export function NewJob({ fields, itemSingular, context, onClose, onCreated }: { fields: JobField[]; itemSingular: string; context?: { contactId?: string; conversationId?: string; callbackId?: string; label?: string }; onClose: () => void; onCreated: (job: Job) => void }) {
  const live = fields.filter((f) => !f.archived);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [values, setValues] = useState<Record<string, string>>({});
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = Boolean(context?.contactId || context?.conversationId || context?.callbackId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const job = await api<Job>('/jobs', {
        method: 'POST',
        json: {
          ...(title.trim() ? { title } : {}),
          ...(details.trim() ? { details } : {}),
          fields: Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())),
          ...(value.trim() ? { value: Number(value) } : {}),
          ...(context?.contactId ? { contactId: context.contactId } : {}),
          ...(context?.conversationId ? { conversationId: context.conversationId } : {}),
          ...(context?.callbackId ? { callbackId: context.callbackId } : {}),
          ...(!linked && (contact.name || contact.email || contact.phone) ? { contact: Object.fromEntries(Object.entries(contact).filter(([, v]) => v.trim())) } : {}),
        },
      });
      onCreated(job);
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]" role="dialog" aria-modal="true" aria-label={`New ${itemSingular.toLowerCase()}`}>
      <Card className="w-full max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">New {itemSingular.toLowerCase()}</h2>
            <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
              <X />
            </Button>
          </div>
          {context?.label && <p className="text-xs text-muted-foreground">{context.label}</p>}
          <Labeled label="Title (optional: made from the details)">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus />
          </Labeled>
          {!linked && (
            <div className="grid gap-2 sm:grid-cols-3">
              <Labeled label="Contact name">
                <Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
              </Labeled>
              <Labeled label="Email">
                <Input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
              </Labeled>
              <Labeled label="Phone">
                <Input type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
              </Labeled>
            </div>
          )}
          {live.map((f) => (
            <Labeled key={f.id} label={`${f.label}${f.required ? ' *' : ''}`} htmlFor={`job-field-${f.name}`}>
              <FieldInput field={f} value={values[f.name] ?? ''} onChange={(v) => setValues({ ...values, [f.name]: v })} />
            </Labeled>
          ))}
          {!live.some((f) => f.name === 'description') && (
            <Labeled label="Details">
              <Textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
            </Labeled>
          )}
          <Labeled label="Value (optional)">
            <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
          </Labeled>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Create
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Labeled({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="block space-y-1" {...(htmlFor ? { htmlFor } : {})}>
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

// ------------------------------------------------------------------- a job

/** One history event, in words. */
export function describeEvent(event: JobEvent): string {
  const d = event.data ?? {};
  const v = (x: unknown) => (x === null || x === undefined || x === '' ? 'empty' : String(x));
  switch (event.kind) {
    case 'created':
      return `Created ${CREATED[d['source'] as Job['source']] ?? String(d['source'])}, in ${String(d['stage'])}`;
    case 'stage':
      return `Moved from ${String(d['from'])} to ${String(d['to'])}${d['reason'] ? `: ${String(d['reason'])}` : ''}`;
    case 'field':
      return `${String(d['label'] ?? d['field'])}: ${v(d['from'])} → ${v(d['to'])}`;
    case 'value':
      return `Value: ${d['from'] === null ? 'none' : money(Number(d['from']), null)} → ${d['to'] === null ? 'none' : money(Number(d['to']), null)}`;
    case 'assigned':
      return d['to'] ? `Assigned to ${String(d['name'] ?? d['to'])}` : 'Unassigned';
    case 'update':
      return String(d['text']);
    case 'edited':
      return d['field'] === 'title' ? `Title: ${v(d['from'])} → ${v(d['to'])}` : d['field'] === 'due' ? 'Due date changed' : 'Details changed';
    default:
      return event.kind;
  }
}

function JobPanel({ id, me, pipeline, team, onChanged }: { id: string; me: Me; pipeline: PipelineView['pipeline']; team: Team | null; onChanged: () => void }) {
  const { data, error, reload } = useData(() => api<JobDetail>(`/jobs/${id}`), [id]);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [update, setUpdate] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const member = isMember(me);
  useEffect(() => setValues(null), [id]);
  if (error) return <div className="p-4"><ErrorNote error={error} onRetry={reload} /></div>;
  if (!data) return <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
  const fields = pipeline.fields.filter((f) => !f.archived || data.fields[f.name]);
  const current = values ?? data.fields;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await work();
      reload();
      onChanged();
      return true;
    } catch (thrown) {
      setActionError((thrown as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const patch = (json: Record<string, unknown>) => run(() => api(`/jobs/${id}`, { method: 'PATCH', json }));
  const move = (stageId: string) => {
    const stage = pipeline.stages.find((s) => s.id === stageId);
    const lostReason = stage?.kind === 'lost' ? (window.prompt('Why was it lost? (optional)') ?? '') : undefined;
    void run(() => api(`/jobs/${id}/move`, { method: 'POST', json: { stageId, ...(lostReason ? { lostReason } : {}) } }));
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <a href={href({ page: 'jobs' })} className="mt-1 text-muted-foreground" aria-label="Back to the board">
          <ArrowLeft className="size-4" />
        </a>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {pipeline.itemSingular} #{data.number} · {SOURCE[data.source]} · {fmtDateTime(data.createdAt)}
          </p>
          <input
            key={data.title}
            defaultValue={data.title}
            aria-label="Title"
            className="w-full bg-transparent text-[17px] font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            onBlur={(e) => e.target.value.trim() && e.target.value !== data.title && void patch({ title: e.target.value })}
          />
        </div>
        {!member && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Delete"
            onClick={() => {
              if (window.confirm(`Delete #${data.number}? Its history and notes go too.`)) void run(() => api(`/jobs/${id}`, { method: 'DELETE' })).then(() => (window.location.hash = href({ page: 'jobs' })));
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {actionError && (
        <p role="alert" className="border-b bg-danger/5 px-4 py-1.5 text-xs text-danger">
          {actionError}
        </p>
      )}
      <div className="scroll-thin grid min-h-0 flex-1 gap-0 overflow-auto lg:grid-cols-[1fr_300px]">
        <div className="space-y-5 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Stage">
              <Select value={data.stage?.id ?? ''} onChange={(e) => move(e.target.value)} disabled={busy} className="w-full">
                {pipeline.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.kind === 'open' ? s.name : `${s.kind === 'won' ? '✓' : '✗'} ${s.name}`}
                  </option>
                ))}
              </Select>
            </Labeled>
            <Labeled label="Assigned to">
              <Select
                value={data.assignedTo ?? ''}
                onChange={(e) => void patch({ assignedTo: e.target.value || null })}
                disabled={busy}
                className="w-full"
              >
                <option value="">Nobody</option>
                {member ? (
                  <option value={me.admin.email}>Me</option>
                ) : (
                  <>
                    {team?.owner && <option value={team.owner}>{team.owner}</option>}
                    {team?.admins.map((a) => (
                      <option key={a.email} value={a.email}>
                        {a.name ?? a.email}
                      </option>
                    ))}
                  </>
                )}
                {data.assignedTo && !team?.admins.some((a) => a.email === data.assignedTo) && data.assignedTo !== team?.owner && data.assignedTo !== me.admin.email && (
                  <option value={data.assignedTo}>{data.assignedName ?? data.assignedTo}</option>
                )}
              </Select>
            </Labeled>
            <Labeled label="Value">
              <Input key={`v${data.valueCents}`} type="number" min={0} defaultValue={data.value ?? ''} onBlur={(e) => String(data.value ?? '') !== e.target.value && void patch({ value: e.target.value === '' ? null : Number(e.target.value) })} />
            </Labeled>
            <Labeled label="Due">
              <Input key={`d${data.dueAt}`} type="date" defaultValue={data.dueAt ? new Date(data.dueAt).toISOString().slice(0, 10) : ''} onChange={(e) => void patch({ dueAt: e.target.value || null })} />
            </Labeled>
          </div>
          {data.lostReason && <p className="text-xs text-muted-foreground">Lost: {data.lostReason}</p>}

          {fields.length > 0 && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const changed = Object.fromEntries(Object.entries(current).filter(([k, v]) => (data.fields[k] ?? '') !== v).map(([k, v]) => [k, v === '' ? null : v]));
                if (Object.keys(changed).length) void patch({ fields: changed }).then((ok) => ok && setValues(null));
              }}
            >
              <h3 className="text-xs font-medium text-muted-foreground">Details</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.id} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                    <Labeled label={`${f.label}${f.archived ? ' (removed field)' : ''}`} htmlFor={`job-field-${f.name}`}>
                      <FieldInput field={f} value={current[f.name] ?? ''} onChange={(v) => setValues({ ...current, [f.name]: v })} />
                    </Labeled>
                  </div>
                ))}
              </div>
              {values && (
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setValues(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={busy}>
                    Save details
                  </Button>
                </div>
              )}
            </form>
          )}
          {data.details && !fields.some((f) => f.name === 'description' && data.fields['description'] === data.details) && (
            <SideSection title="Request">
              <p className="whitespace-pre-wrap rounded-md border bg-subtle px-3 py-2 text-[13px]">{data.details}</p>
            </SideSection>
          )}

          <SideSection title="Add an update">
            <form
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (update.trim()) void run(() => api(`/jobs/${id}/updates`, { method: 'POST', json: { text: update } })).then((ok) => ok && setUpdate(''));
              }}
            >
              <Textarea rows={2} value={update} onChange={(e) => setUpdate(e.target.value)} placeholder="Parts ordered, back Thursday…" aria-label="Update" />
              <div className="flex justify-end">
                <Button size="sm" variant="outline" type="submit" disabled={busy || !update.trim()}>
                  Add to history
                </Button>
              </div>
            </form>
          </SideSection>

          <SideSection title="History">
            <ol className="space-y-2.5 border-l pl-4">
              {[...data.history].reverse().map((event) => (
                <li key={event.id} className="relative text-[13px]">
                  <span className={cn('absolute -left-[21px] top-1.5 size-2 rounded-full', event.kind === 'update' ? 'bg-primary' : event.kind === 'stage' ? 'bg-[#f59e0b]' : 'bg-muted-foreground/40')} aria-hidden />
                  <p className={cn(event.kind === 'update' && 'whitespace-pre-wrap rounded-md bg-subtle px-2 py-1')}>{describeEvent(event)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {event.actorName ?? event.actor} · {fmtDateTime(event.at)}
                  </p>
                </li>
              ))}
            </ol>
          </SideSection>
        </div>
        <aside className="space-y-5 border-l p-4 text-[13px]">
          <SideSection title="Contact">
            {data.contact ? (
              <a href={href({ page: 'contact', id: data.contact.id })} className="flex items-center gap-2 hover:underline">
                <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
                {data.contact.name ?? data.contact.email ?? data.contact.phone}
              </a>
            ) : (
              <p className="text-muted-foreground">No contact.</p>
            )}
            {data.contact?.email && <p className="text-xs text-muted-foreground">{data.contact.email}</p>}
            {data.contact?.phone && <p className="text-xs text-muted-foreground">{data.contact.phone}</p>}
          </SideSection>
          {data.conversation && (
            <SideSection title="Conversation">
              <a href={href({ page: 'conversations', id: data.conversation.id })} className="flex items-start gap-2 hover:underline">
                <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="line-clamp-2">{data.conversation.firstMessage ?? 'Open the chat'}</span>
                <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
              </a>
            </SideSection>
          )}
          <SideSection title="Notes">
            <NotesPanel notes={data.notes} me={me.admin.email} isAdmin={!member} addPath={`/jobs/${id}/notes`} onChange={reload} />
          </SideSection>
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- page

const VIEWS = ['board', 'list'] as const;
const STATUSES = ['open', 'won', 'lost', 'all'] as const;
const ASSIGNED = ['all', 'me', 'none'] as const;

export function Jobs({ id, me }: { id?: string | undefined; me: Me }) {
  const pipeline = useData(() => api<PipelineView>('/jobs/pipeline'), []);
  const team = useData(() => api<Team>('/admins').catch(() => null), []).data;
  const [view, setView] = usePersisted<(typeof VIEWS)[number]>('hp-jobs-view', 'board', VIEWS);
  const [status, setStatus] = usePersisted<(typeof STATUSES)[number]>('hp-jobs-status', 'open', STATUSES);
  const [assigned, setAssigned] = usePersisted<(typeof ASSIGNED)[number]>('hp-jobs-assigned', 'all', ASSIGNED);
  const [query, setQuery] = useState('');
  const q = useDebounced(query);
  const [creating, setCreating] = useState(false);
  const shownStatus = view === 'board' ? 'open' : status;
  const params = `status=${shownStatus}${assigned !== 'all' ? `&assigned=${assigned}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const { data, error, loading, reload } = useData(() => api<JobList>(`/jobs?${params}`), [params]);
  const [items, setItems] = useState<Job[] | null>(null);
  useEffect(() => setItems(null), [data]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents((event) => {
    if (event.t !== 'job') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(reload, 300);
  });

  if (pipeline.error) return <div className="p-6"><ErrorNote error={pipeline.error} onRetry={pipeline.reload} /></div>;
  const p = pipeline.data?.pipeline;
  const list = data && { ...data, items: items ?? data.items };

  const move = async (job: Job, stageId: string, before?: string | null) => {
    const stage = p?.stages.find((s) => s.id === stageId);
    const lostReason = stage?.kind === 'lost' && stageId !== job.stage?.id ? (window.prompt('Why was it lost? (optional)') ?? '') : undefined;
    // Shown at once; the server's order follows.
    if (list && stage) setItems(list.items.map((j) => (j.id === job.id ? { ...j, stage: { id: stage.id, name: stage.name, kind: stage.kind }, status: stage.kind } : j)).filter((j) => stage.kind === 'open' || j.id !== job.id));
    await api(`/jobs/${job.id}/move`, { method: 'POST', json: { ...(stageId !== job.stage?.id ? { stageId } : {}), ...(before !== undefined ? { before } : {}), ...(lostReason ? { lostReason } : {}) } }).catch(() => {});
    reload();
  };

  if (id && p) {
    return <JobPanel id={id} me={me} pipeline={p} team={team} onChanged={reload} />;
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={p?.itemPlural ?? 'Jobs'}
        description={p ? `Requests, quotes and work, from the chat, the quote questions and the API.` : undefined}
        help="Jobs"
        actions={
          <Button onClick={() => setCreating(true)} disabled={!p}>
            <Plus /> New {(p?.itemSingular ?? 'job').toLowerCase()}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'board', label: 'Board' },
            { value: 'list', label: 'List' },
          ]}
        />
        {view === 'list' && (
          <Select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])} aria-label="Show">
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="all">All</option>
          </Select>
        )}
        <Select value={assigned} onChange={(e) => setAssigned(e.target.value as (typeof ASSIGNED)[number])} aria-label="Assigned">
          <option value="all">Everyone’s</option>
          <option value="me">Mine</option>
          <option value="none">Unassigned</option>
        </Select>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, or a number like 1042" className="pl-8" aria-label="Search jobs" />
        </div>
      </div>
      {error && <div className="p-4"><ErrorNote error={error} onRetry={reload} /></div>}
      {(loading && !data) || !p ? (
        <div className="flex gap-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-72" />)}</div>
      ) : list && view === 'board' ? (
        <Board list={list} fields={p.fields} onMove={(job, stageId, before) => void move(job, stageId, before)} />
      ) : list && list.items.length ? (
        <ListView items={list.items} fields={p.fields} />
      ) : (
        <Empty icon={<Briefcase />} title={q ? 'Nothing matches' : `No ${p.itemPlural.toLowerCase()} yet`}>
          {q ? 'Try another word or number.' : 'They arrive from the chat, the quote questions and the API, or add one by hand.'}
        </Empty>
      )}
      {creating && p && (
        <NewJob
          fields={p.fields}
          itemSingular={p.itemSingular}
          onClose={() => setCreating(false)}
          onCreated={(job) => {
            setCreating(false);
            window.location.hash = href({ page: 'jobs', id: job.id });
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * A contact's or a conversation's jobs, with "New job" for them: on the
 * contact page and beside a conversation.
 */
export function RelatedJobs({ filter, context }: { filter: { contact: string } | { conversation: string }; context: { contactId?: string; conversationId?: string; label?: string } }) {
  const query = 'contact' in filter ? `contact=${encodeURIComponent(filter.contact)}` : `conversation=${encodeURIComponent(filter.conversation)}`;
  const { data, reload } = useData(() => api<JobList>(`/jobs?status=all&${query}`), [query]);
  const pipeline = useData(() => api<PipelineView>('/jobs/pipeline'), []).data?.pipeline;
  const [creating, setCreating] = useState(false);
  const noun = (pipeline?.itemSingular ?? 'job').toLowerCase();
  return (
    <div className="space-y-1.5">
      {data?.items.length ? (
        <ul className="space-y-1">
          {data.items.map((job) => (
            <li key={job.id}>
              <a href={href({ page: 'jobs', id: job.id })} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-[13px] hover:bg-subtle">
                <Briefcase className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  #{job.number} {job.title}
                </span>
                <Badge dot={data.stages.find((s) => s.id === job.stage?.id)?.color}>{job.stage?.name}</Badge>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        data && <p className="text-xs text-muted-foreground">None yet.</p>
      )}
      <Button variant="outline" size="sm" onClick={() => setCreating(true)} disabled={!pipeline}>
        <Plus /> New {noun}
      </Button>
      {creating && pipeline && (
        <NewJob
          fields={pipeline.fields}
          itemSingular={pipeline.itemSingular}
          context={context}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** "Make a job" from something else (a callback request): the form, then the new job. */
export function NewJobButton({ context, size = 'sm' }: { context: { contactId?: string; conversationId?: string; callbackId?: string; label?: string }; size?: 'sm' | 'md' }) {
  const [pipeline, setPipeline] = useState<PipelineView['pipeline'] | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Button
        size={size}
        variant="outline"
        onClick={() =>
          void api<PipelineView>('/jobs/pipeline').then(
            (view) => setPipeline(view.pipeline),
            () => setFailed(true),
          )
        }
      >
        <Briefcase /> Make a job
      </Button>
      {failed && <span className="sr-only" role="alert">Couldn’t open the form.</span>}
      {pipeline && (
        <NewJob
          fields={pipeline.fields}
          itemSingular={pipeline.itemSingular}
          context={context}
          onClose={() => setPipeline(null)}
          onCreated={(job) => {
            setPipeline(null);
            window.location.hash = href({ page: 'jobs', id: job.id });
          }}
        />
      )}
    </>
  );
}
