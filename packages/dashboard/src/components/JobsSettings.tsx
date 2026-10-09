import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type JobField, type JobFieldType, type Pipeline, type PipelineView, type StageKind } from '../lib/api';
import { cn, href, useData } from '../lib/utils';
import { CopyBlock } from '../pages/Settings';
import { Badge, Button, Card, CardHeader, ErrorNote, InfoTip, Input, Select, Skeleton } from './ui';

/**
 * Settings → Jobs: the template (and letting the AI choose again), what a job
 * is called, the stages, the fields, the quote questions the widget asks, and
 * how to send jobs from other tools. Each card saves on its own.
 */

const TYPES: { value: JobFieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Choice' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
];
const KINDS: { value: StageKind; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'won', label: 'Won (went ahead)' },
  { value: 'lost', label: 'Lost' },
];
const CHOSEN: Record<Pipeline['chosenBy'], string> = { ai: 'Chosen by the AI from your website', owner: 'Edited by you', default: 'The basic template' };

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const next = [...list];
  const to = index + by;
  if (to < 0 || to >= next.length) return list;
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

function Order({ index, length, onMove, label }: { index: number; length: number; onMove: (by: -1 | 1) => void; label: string }) {
  return (
    <div className="flex shrink-0 flex-col">
      <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>
        <ArrowUp className="size-3.5" />
      </button>
      <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={index === length - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`}>
        <ArrowDown className="size-3.5" />
      </button>
    </div>
  );
}

function Check({ checked, onChange, children, hint }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-start gap-1.5 text-[13px]">
      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{children}</span>
      </label>
      {hint && (
        <span className="mt-0.5">
          <InfoTip label="About this option">{hint}</InfoTip>
        </span>
      )}
    </div>
  );
}

/** Save buttons and what happened, at the foot of a card. */
function Foot({ dirty, busy, error, saved, onSave, onReset }: { dirty: boolean; busy: boolean; error: string | null; saved: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
      {error && (
        <p role="alert" className="mr-auto text-xs text-danger">
          {error}
        </p>
      )}
      {saved && !dirty && !error && <p className="mr-auto text-xs text-muted-foreground" role="status">Saved.</p>}
      {dirty && (
        <Button variant="ghost" onClick={onReset} disabled={busy}>
          Undo changes
        </Button>
      )}
      <Button onClick={onSave} disabled={!dirty || busy}>
        {busy && <Loader2 className="animate-spin" />} Save
      </Button>
    </div>
  );
}

/** One card's save: PUT the patch, hand the new pipeline up. */
function useSave(onSaved: (view: PipelineView) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async (json: Record<string, unknown>, path = '/jobs/pipeline', method: 'PUT' | 'POST' = 'PUT') => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const view = await api<PipelineView>(path, { method, json });
      onSaved(view);
      setSaved(true);
      return true;
    } catch (thrown) {
      setError((thrown as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, saved, save };
}

// --------------------------------------------------------------- template

function TemplateCard({ view, onSaved }: { view: PipelineView; onSaved: (view: PipelineView) => void }) {
  const { pipeline, templates } = view;
  const [choice, setChoice] = useState(pipeline.template);
  const { busy, error, save } = useSave(onSaved);
  const [setup, setSetup] = useState<{ busy: boolean; result: string | null; error: string | null }>({ busy: false, result: null, error: null });
  useEffect(() => setChoice(pipeline.template), [pipeline.template]);
  const current = templates.find((t) => t.id === pipeline.template);
  const picked = templates.find((t) => t.id === choice);
  const aiChoose = async () => {
    if (!window.confirm('Let the AI read your website and set up the stages and fields again? Your current stages and fields are replaced; jobs keep their place.')) return;
    setSetup({ busy: true, result: null, error: null });
    try {
      const result = await api<{ template?: string; reason?: string | null; skipped?: string; pipeline: Pipeline }>('/jobs/setup', { method: 'POST', json: { force: true } });
      onSaved({ pipeline: result.pipeline, templates });
      setSetup({ busy: false, result: result.reason ?? `Chose “${templates.find((t) => t.id === result.pipeline.template)?.name ?? result.pipeline.template}”.`, error: null });
    } catch (thrown) {
      setSetup({ busy: false, result: null, error: (thrown as Error).message });
    }
  };
  return (
    <Card role="region" aria-label="Template">
      <CardHeader
        title="Template"
        tip={{ label: 'About template', text: 'The starting point for your stages and fields. Change anything below; a template is only where it begins.' }}
        action={<Badge>{CHOSEN[pipeline.chosenBy]}</Badge>}
      />
      <div className="space-y-3 border-t p-4 text-[13px]">
        <p>
          Now: <span className="font-medium">{current?.name ?? pipeline.template}</span>
          {current && <span className="text-muted-foreground"> · {current.description}</span>}
        </p>
        {pipeline.reason && <p className="rounded-md bg-subtle px-3 py-2 text-xs text-muted-foreground">Why: {pipeline.reason}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Template" className="min-w-56">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            disabled={busy || choice === pipeline.template}
            onClick={() => {
              if (window.confirm(`Use “${picked?.name}”? Your stages and fields are replaced by the template’s; jobs keep their place, and values in removed fields are kept.`)) void save({ template: choice }, '/jobs/pipeline/template', 'POST');
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Use this template
          </Button>
          <Button variant="ghost" onClick={() => void aiChoose()} disabled={setup.busy}>
            {setup.busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Let the AI choose again
          </Button>
        </div>
        {picked && picked.id !== pipeline.template && (
          <p className="text-xs text-muted-foreground">
            {picked.description} Stages: {picked.stages.map((s) => s.name).join(' → ')}. Fields: {picked.fields.map((f) => f.label).join(', ') || 'none'}.
          </p>
        )}
        {setup.result && <p role="status" className="text-xs text-muted-foreground">{setup.result}</p>}
        {(error ?? setup.error) && (
          <p role="alert" className="text-xs text-danger">
            {error ?? setup.error}
          </p>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ names

function NamesCard({ pipeline, onSaved }: { pipeline: Pipeline; onSaved: (view: PipelineView) => void }) {
  const initial = { itemSingular: pipeline.itemSingular, itemPlural: pipeline.itemPlural, assistantJobs: pipeline.assistantJobs };
  const [value, setValue] = useState(initial);
  const { busy, error, saved, save } = useSave(onSaved);
  useEffect(() => setValue(initial), [pipeline.itemSingular, pipeline.itemPlural, pipeline.assistantJobs]);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <Card role="region" aria-label="Names and the assistant">
      <CardHeader title="Names and the assistant" tip={{ label: 'About names and the assistant', text: 'What one is called, on the board, in the chat and in emails from your tools.' }} />
      <div className="space-y-3 border-t p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium">One</span>
            <Input value={value.itemSingular} onChange={(e) => setValue({ ...value, itemSingular: e.target.value })} maxLength={30} placeholder="Job, Quote, Ticket, Project…" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">Many</span>
            <Input value={value.itemPlural} onChange={(e) => setValue({ ...value, itemPlural: e.target.value })} maxLength={30} />
          </label>
        </div>
        <Check checked={value.assistantJobs} onChange={(on) => setValue({ ...value, assistantJobs: on })} hint="When a visitor asks for a quote, a booking or work done, the assistant records it here and asks for what’s missing.">
          The assistant creates {value.itemPlural.toLowerCase() || 'jobs'} from the chat
        </Check>
      </div>
      <Foot dirty={dirty} busy={busy} error={error} saved={saved} onSave={() => void save(value)} onReset={() => setValue(initial)} />
    </Card>
  );
}

// ----------------------------------------------------------------- stages

type StageDraft = { id?: string; key: string; name: string; color: string; kind: StageKind; rotDays: number | null };
const stageDrafts = (pipeline: Pipeline): StageDraft[] => pipeline.stages.map((s) => ({ id: s.id, key: s.id, name: s.name, color: s.color, kind: s.kind, rotDays: s.rotDays }));

function StagesCard({ pipeline, onSaved }: { pipeline: Pipeline; onSaved: (view: PipelineView) => void }) {
  const [stages, setStages] = useState(() => stageDrafts(pipeline));
  const { busy, error, saved, save } = useSave(onSaved);
  useEffect(() => setStages(stageDrafts(pipeline)), [pipeline]);
  const dirty = JSON.stringify(stages) !== JSON.stringify(stageDrafts(pipeline));
  const set = (index: number, patch: Partial<StageDraft>) => setStages(stages.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const missing = (['open', 'won', 'lost'] as const).filter((k) => !stages.some((s) => s.kind === k));
  return (
    <Card role="region" aria-label="Stages">
      <CardHeader
        title="Stages"
        tip={{ label: 'About stages', text: 'In order. Open stages are the board’s columns; won and lost are where a job ends. “Stale after” marks a job red when it sits in a stage that long. Jobs in a removed stage move to the first stage of the same kind.' }}
      />
      <ul className="divide-y border-t">
        {stages.map((stage, index) => (
          <li key={stage.key} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <Order index={index} length={stages.length} label={stage.name || 'stage'} onMove={(by) => setStages(move(stages, index, by))} />
            <input type="color" value={stage.color} onChange={(e) => set(index, { color: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded border bg-transparent p-0.5" aria-label={`${stage.name} colour`} />
            <Input value={stage.name} onChange={(e) => set(index, { name: e.target.value })} maxLength={40} className="min-w-36 flex-1" aria-label="Stage name" />
            <Select value={stage.kind} onChange={(e) => set(index, { kind: e.target.value as StageKind })} aria-label={`${stage.name} kind`}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
            {stage.kind === 'open' && (
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                Stale after
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={stage.rotDays ?? ''}
                  onChange={(e) => set(index, { rotDays: e.target.value ? Number(e.target.value) : null })}
                  className="w-16"
                  placeholder="—"
                  aria-label={`${stage.name}: stale after days`}
                />
                days
              </label>
            )}
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${stage.name}`} onClick={() => setStages(stages.filter((_, i) => i !== index))}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <div className="space-y-1 border-t px-4 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          disabled={stages.length >= 20}
          onClick={() => {
            // A new open stage goes before won and lost.
            const at = stages.findIndex((s) => s.kind !== 'open');
            const next: StageDraft = { key: `new-${Date.now()}`, name: '', color: '#6b7280', kind: 'open', rotDays: null };
            setStages(at === -1 ? [...stages, next] : [...stages.slice(0, at), next, ...stages.slice(at)]);
          }}
        >
          <Plus /> Add a stage
        </Button>
        {missing.length > 0 && <p className="text-xs text-danger">Keep at least one {missing.join(', one ')} stage.</p>}
      </div>
      <Foot dirty={dirty} busy={busy} error={error} saved={saved} onReset={() => setStages(stageDrafts(pipeline))} onSave={() => void save({ stages: stages.map(({ key: _key, ...s }) => s) })} />
    </Card>
  );
}

// ----------------------------------------------------------------- fields

type FieldDraft = { id?: string; key: string; label: string; type: JobFieldType; required: boolean; options: string; question: string };
const fieldDrafts = (pipeline: Pipeline): FieldDraft[] =>
  pipeline.fields.filter((f) => !f.archived).map((f) => ({ id: f.id, key: f.id, label: f.label, type: f.type, required: f.required, options: f.options.join(', '), question: f.question ?? '' }));

function FieldsCard({ pipeline, onSaved }: { pipeline: Pipeline; onSaved: (view: PipelineView) => void }) {
  const [fields, setFields] = useState(() => fieldDrafts(pipeline));
  const [open, setOpen] = useState<string | null>(null);
  const { busy, error, saved, save } = useSave(onSaved);
  useEffect(() => setFields(fieldDrafts(pipeline)), [pipeline]);
  const dirty = JSON.stringify(fields) !== JSON.stringify(fieldDrafts(pipeline));
  const set = (index: number, patch: Partial<FieldDraft>) => setFields(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  return (
    <Card role="region" aria-label="Fields">
      <CardHeader title="Fields" tip={{ label: 'About fields', text: 'What you need to know about each one. The assistant asks for required fields it doesn’t have yet; removed fields keep their values on old jobs.' }} />
      <ul className="divide-y border-t">
        {fields.length === 0 && <li className="px-4 py-3 text-[13px] text-muted-foreground">No fields: just a title and the details.</li>}
        {fields.map((field, index) => (
          <li key={field.key} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Order index={index} length={fields.length} label={field.label || 'field'} onMove={(by) => setFields(move(fields, index, by))} />
              <Input value={field.label} onChange={(e) => set(index, { label: e.target.value })} maxLength={60} className="min-w-36 flex-1" aria-label="Field label" placeholder="Label, e.g. Suburb" />
              <Select value={field.type} onChange={(e) => set(index, { type: e.target.value as JobFieldType })} aria-label={`${field.label} type`}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={field.required} onChange={(e) => set(index, { required: e.target.checked })} />
                Required
              </label>
              <Button variant="ghost" size="sm" onClick={() => setOpen(open === field.key ? null : field.key)} aria-expanded={open === field.key}>
                More
              </Button>
              <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${field.label}`} onClick={() => setFields(fields.filter((_, i) => i !== index))}>
                <Trash2 />
              </Button>
            </div>
            {(field.type === 'select' || open === field.key) && (
              <div className="mt-2 grid gap-2 pl-7 sm:grid-cols-2">
                {field.type === 'select' && (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-medium">Choices, separated by commas</span>
                    <Input value={field.options} onChange={(e) => set(index, { options: e.target.value })} placeholder="Hot water, Blocked drains, Leaks" />
                  </label>
                )}
                {open === field.key && (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-medium">How the widget and the assistant ask for it</span>
                    <Input value={field.question} onChange={(e) => set(index, { question: e.target.value })} maxLength={200} placeholder={`What’s the ${field.label.toLowerCase() || 'value'}?`} />
                  </label>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="border-t px-4 py-2.5">
        <Button variant="ghost" size="sm" disabled={fields.length >= 40} onClick={() => setFields([...fields, { key: `new-${Date.now()}`, label: '', type: 'text', required: false, options: '', question: '' }])}>
          <Plus /> Add a field
        </Button>
      </div>
      <Foot
        dirty={dirty}
        busy={busy}
        error={error}
        saved={saved}
        onReset={() => setFields(fieldDrafts(pipeline))}
        onSave={() =>
          void save({
            fields: fields.map(({ key: _key, options, question, ...f }) => ({
              ...f,
              options: f.type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [],
              question: question.trim() || null,
            })),
          })
        }
      />
    </Card>
  );
}

// ---------------------------------------------------------------- quote

const quoteDraft = (pipeline: Pipeline) => ({
  enabled: pipeline.quote.enabled,
  label: pipeline.quote.label,
  askContact: pipeline.quote.askContact,
  fields: pipeline.fields
    .filter((f) => f.inQuote && !f.archived)
    .sort((a, b) => (a.quotePosition ?? a.position) - (b.quotePosition ?? b.position))
    .map((f) => f.name),
});

function QuoteCard({ pipeline, onSaved }: { pipeline: Pipeline; onSaved: (view: PipelineView) => void }) {
  const [value, setValue] = useState(() => quoteDraft(pipeline));
  const { busy, error, saved, save } = useSave(onSaved);
  useEffect(() => setValue(quoteDraft(pipeline)), [pipeline]);
  const dirty = JSON.stringify(value) !== JSON.stringify(quoteDraft(pipeline));
  const live = pipeline.fields.filter((f) => !f.archived);
  const byName = (name: string) => live.find((f) => f.name === name);
  const asked = value.fields.map(byName).filter((f): f is JobField => Boolean(f));
  const others = live.filter((f) => !value.fields.includes(f.name));
  return (
    <Card role="region" aria-label="Quote questions">
      <CardHeader
        title="Quote questions"
        tip={{ label: 'About quote questions', text: 'A button on the widget’s home screen. It asks these one at a time, then saves the answers as a new one here, without the visitor having to explain in a chat.' }}
      />
      <div className="space-y-3 border-t p-4">
        <Check checked={value.enabled} onChange={(on) => setValue({ ...value, enabled: on })}>
          Show the button on the widget
        </Check>
        <div className={cn('space-y-3', !value.enabled && 'pointer-events-none opacity-50')}>
          <label className="block space-y-1">
            <span className="block text-xs font-medium">Button</span>
            <Input value={value.label} onChange={(e) => setValue({ ...value, label: e.target.value })} maxLength={40} className="max-w-xs" />
          </label>
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Questions, in order (up to 10)</p>
            {asked.length === 0 && <p className="text-xs text-muted-foreground">None yet: add fields below.</p>}
            <ol className="space-y-1">
              {asked.map((f, index) => (
                <li key={f.name} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[13px]">
                  <Order index={index} length={asked.length} label={f.label} onMove={(by) => setValue({ ...value, fields: move(value.fields, value.fields.indexOf(f.name), by) })} />
                  <span className="flex-1">
                    {f.question ?? f.label}
                    {f.required && <span className="text-muted-foreground"> (required)</span>}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setValue({ ...value, fields: value.fields.filter((n) => n !== f.name) })} aria-label={`Don’t ask ${f.label}`}>
                    Remove
                  </Button>
                </li>
              ))}
            </ol>
            {others.length > 0 && value.fields.length < 10 && (
              <Select value="" onChange={(e) => e.target.value && setValue({ ...value, fields: [...value.fields, e.target.value] })} aria-label="Add a question" className="max-w-xs">
                <option value="">Add a question from a field…</option>
                {others.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.label}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <Check checked={value.askContact} onChange={(on) => setValue({ ...value, askContact: on })} hint="Asked last, when the chat doesn’t already know who it is.">
            Ask for a name, email and phone
          </Check>
          {pipeline.quotePreview.length > 0 && !dirty && (
            <div className="rounded-md bg-subtle p-3 text-xs">
              <p className="mb-1.5 font-medium">What the visitor sees</p>
              <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
                {pipeline.quotePreview.map((step) => (
                  <li key={step.field}>
                    {step.ask}
                    {step.choices?.length ? ` (${step.choices.join(' / ')})` : ''}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
      <Foot
        dirty={dirty}
        busy={busy}
        error={error}
        saved={saved}
        onReset={() => setValue(quoteDraft(pipeline))}
        onSave={() => void save({ quote: value.fields, quoteEnabled: value.enabled, quoteLabel: value.label, quoteContact: value.askContact })}
      />
    </Card>
  );
}

// ----------------------------------------------------- from other tools

function ElsewhereCard({ pipeline }: { pipeline: Pipeline }) {
  const base = `${window.location.origin}/api/v1`;
  const fields = Object.fromEntries(
    pipeline.fields
      .filter((f) => !f.archived)
      .slice(0, 4)
      .map((f) => [f.name, f.type === 'select' ? (f.options[0] ?? '…') : f.type === 'number' ? '2' : f.type === 'date' ? '2026-11-03' : '…']),
  );
  const body = JSON.stringify({ contact: { name: 'Sam Lee', email: 'sam@example.com' }, fields, details: 'From the booking form' }, null, 2);
  return (
    <Card role="region" aria-label="Send them from other tools">
      <CardHeader title="Send them from other tools" tip={{ label: 'About send them from other tools', text: 'Your own forms, Zapier or Make: create one with the API. Webhooks tell other tools when one is created, moves or is won.' }} />
      <div className="space-y-3 border-t p-4 text-[13px]">
        <CopyBlock label="curl example" text={`curl -X POST "${base}/jobs" \\\n  -H "Authorization: Bearer $HELPPUFF_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`} />
        <p className="text-xs text-muted-foreground">
          Needs an API key with <code className="rounded bg-muted px-1">jobs:write</code>: <a className="underline" href={href({ page: 'settings', id: 'api' })}>API keys</a>. Events:{' '}
          <a className="underline" href={href({ page: 'settings', id: 'webhooks' })}>
            webhooks
          </a>{' '}
          (<code className="rounded bg-muted px-1">job.created</code>, <code className="rounded bg-muted px-1">job.stage_changed</code>, <code className="rounded bg-muted px-1">job.won</code>…).
        </p>
      </div>
    </Card>
  );
}

export function JobsSettings() {
  const { data, error, reload } = useData(() => api<PipelineView>('/jobs/pipeline'), []);
  const [view, setView] = useState<PipelineView | null>(null);
  useEffect(() => setView(data ?? null), [data]);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!view) return <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>;
  return (
    <div className="space-y-4">
      <TemplateCard view={view} onSaved={setView} />
      <NamesCard pipeline={view.pipeline} onSaved={setView} />
      <StagesCard pipeline={view.pipeline} onSaved={setView} />
      <FieldsCard pipeline={view.pipeline} onSaved={setView} />
      <QuoteCard pipeline={view.pipeline} onSaved={setView} />
      <ElsewhereCard pipeline={view.pipeline} />
    </div>
  );
}
