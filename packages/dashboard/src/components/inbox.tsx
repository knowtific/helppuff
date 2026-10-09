import { Bot, Check, Headset, Lock, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type ConversationStatus, type Label, type LabelRef, type Note } from '../lib/api';
import { cn, fmtRelative, href } from '../lib/utils';
import { Badge, Button, Input, Textarea } from './ui';

/**
 * The inbox's shared pieces: a conversation's status, the waiting indicator,
 * labels, custom attributes and the team's notes. Used by the Conversations
 * page and the contact page alike.
 */

const STATUS: Record<ConversationStatus, { label: string; icon: typeof Bot; className: string }> = {
  bot: { label: 'AI bot', icon: Bot, className: '' },
  live: { label: 'Live agent', icon: Headset, className: 'border-primary/40 text-primary' },
  closed: { label: 'Closed', icon: Lock, className: 'text-muted-foreground' },
};

/** Always the word with the icon: never colour alone. */
export function ConversationStatusBadge({ status }: { status: ConversationStatus | undefined }) {
  const s = STATUS[status ?? 'bot'];
  const Icon = s.icon;
  return (
    <Badge className={s.className}>
      <Icon className="size-3" aria-hidden />
      {s.label}
    </Badge>
  );
}

/** A visitor in a live chat waiting for the team's reply. Ticks every 30 seconds. */
export function WaitingBadge({ since, compact = false }: { since: number; compact?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.round((Date.now() - since) / 60_000));
  const label = minutes < 1 ? 'just now' : `${minutes}m`;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-[#d97706]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#b45309] dark:text-[#f59e0b]">
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#d97706] opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-[#d97706]" />
      </span>
      {compact ? `Waiting ${label}` : `Waiting for a reply · ${label}`}
    </span>
  );
}

export function LabelChip({ label, onRemove }: { label: LabelRef; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none">
      <span className="size-2 rounded-full" style={{ background: label.color }} aria-hidden />
      {label.name}
      {onRemove && (
        <button type="button" onClick={onRemove} className="-mr-0.5 rounded text-muted-foreground hover:text-foreground" aria-label={`Remove label ${label.name}`}>
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

// ------------------------------------------------------------------- labels

let cache: Promise<{ labels: Label[]; colors: string[] }> | null = null;

/** The site's labels, fetched once per page load (Settings → Labels refreshes it). */
export function useLabels(): { labels: Label[]; colors: string[]; refresh: () => void } {
  const [data, setData] = useState<{ labels: Label[]; colors: string[] }>({ labels: [], colors: [] });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    cache ??= api<{ labels: Label[]; colors: string[] }>('/labels').catch(() => ({ labels: [], colors: [] }));
    let live = true;
    void cache.then((value) => live && setData(value));
    return () => {
      live = false;
    };
  }, [tick]);
  return {
    ...data,
    refresh: () => {
      cache = null;
      setTick((t) => t + 1);
    },
  };
}

export function forgetLabels(): void {
  cache = null;
}

/** The labels on a conversation, and a menu to add or remove any of the site's. */
export function LabelPicker({ value, onChange, disabled, canManage = true }: { value: LabelRef[]; onChange: (ids: string[]) => void; disabled?: boolean; canManage?: boolean }) {
  const { labels } = useLabels();
  const [open, setOpen] = useState(false);
  const chosen = new Set(value.map((l) => l.id));
  const toggle = (id: string) => onChange(chosen.has(id) ? [...chosen].filter((x) => x !== id) : [...chosen, id]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((label) => (
          <LabelChip key={label.id} label={label} {...(disabled ? {} : { onRemove: () => toggle(label.id) })} />
        ))}
        {!disabled && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="inline-flex h-5 items-center gap-1 rounded-md border border-dashed px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Tag className="size-3" aria-hidden /> {value.length ? 'Edit' : 'Add label'}
          </button>
        )}
      </div>
      {open && (
        <div className="rounded-md border bg-card p-1.5 shadow-sm">
          {labels.length === 0 ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">
              No labels yet.{' '}
              {canManage ? (
                <a href={href({ page: 'settings', id: 'labels' })} className="font-medium text-foreground underline-offset-2 hover:underline">
                  Add labels
                </a>
              ) : (
                'An admin can add them in Settings → Labels.'
              )}
            </p>
          ) : (
            <ul className="max-h-48 overflow-auto scroll-thin">
              {labels.map((label) => (
                <li key={label.id}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={chosen.has(label.id)}
                    onClick={() => toggle(label.id)}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
                  >
                    <span className="size-2 rounded-full" style={{ background: label.color }} aria-hidden />
                    <span className="flex-1">{label.name}</span>
                    {chosen.has(label.id) && <Check className="size-3.5" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- attributes

/**
 * Custom attributes: key-value strings for the team's own data (an order
 * number, a plan). Saves one change at a time; `null` removes a key.
 */
export function AttributesEditor({ value, onSave }: { value: Record<string, string>; onSave: (patch: Record<string, string | null>) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState('');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Record<string, string | null>) => {
    setError(null);
    try {
      await onSave(patch);
      return true;
    } catch (thrown) {
      setError((thrown as Error).message);
      return false;
    }
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    if (await save({ [key.trim()]: text })) {
      setKey('');
      setText('');
      setAdding(false);
    }
  };
  const entries = Object.entries(value);
  return (
    <div className="space-y-1.5">
      {entries.length === 0 && !adding && <p className="text-xs text-muted-foreground">None yet.</p>}
      {entries.length > 0 && (
        <dl className="divide-y rounded-md border text-xs">
          {entries.map(([k, v]) => (
            <div key={k} className="group flex items-start gap-2 px-2 py-1.5">
              <dt className="w-24 shrink-0 truncate text-muted-foreground" title={k}>
                {k}
              </dt>
              {editing === k ? (
                <form
                  className="flex flex-1 gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save({ [k]: text }).then((ok) => ok && setEditing(null));
                  }}
                >
                  <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} className="h-6 text-xs" aria-label={`Value of ${k}`} />
                  <Button size="sm" type="submit" className="h-6">
                    Save
                  </Button>
                </form>
              ) : (
                <dd className="min-w-0 flex-1 break-words">{v}</dd>
              )}
              {editing !== k && (
                <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(k);
                      setText(v);
                    }}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={`Edit ${k}`}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button type="button" onClick={() => void save({ [k]: null })} className="rounded p-0.5 text-muted-foreground hover:text-danger" aria-label={`Remove ${k}`}>
                    <Trash2 className="size-3" />
                  </button>
                </span>
              )}
            </div>
          ))}
        </dl>
      )}
      {adding ? (
        <form onSubmit={(e) => void add(e)} className="space-y-1.5 rounded-md border p-2">
          <Input autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="Key, e.g. order_id" className="h-7 text-xs" aria-label="Attribute key" maxLength={64} />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Value" className="h-7 text-xs" aria-label="Attribute value" maxLength={1000} />
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!key.trim()}>
              Add
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="size-3" aria-hidden /> Add attribute
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- notes

/** The team's private notes: the visitor and the assistant never see them. */
export function NotesPanel({ notes, me, isAdmin, addPath, onChange }: { notes: Note[]; me: string; isAdmin: boolean; addPath: string; onChange: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChange();
      return true;
    } catch (thrown) {
      setError((thrown as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      {notes.map((note) => {
        const mine = note.author === me;
        return (
          <div key={note.id} className="rounded-md border bg-[#fef9c3]/40 px-2.5 py-2 text-xs dark:bg-[#fef9c3]/5">
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {note.authorName ?? note.author} · {fmtRelative(note.createdAt)}
                {note.updatedAt > note.createdAt + 1000 ? ' · edited' : ''}
              </span>
              {(mine || isAdmin) && editing !== note.id && (
                <span className="flex gap-0.5">
                  {mine && (
                    <button
                      type="button"
                      className="rounded p-0.5 hover:text-foreground"
                      aria-label="Edit note"
                      onClick={() => {
                        setEditing(note.id);
                        setDraft(note.text);
                      }}
                    >
                      <Pencil className="size-3" />
                    </button>
                  )}
                  <button type="button" className="rounded p-0.5 hover:text-danger" aria-label="Delete note" onClick={() => void run(() => api(`/notes/${note.id}`, { method: 'DELETE' }))}>
                    <Trash2 className="size-3" />
                  </button>
                </span>
              )}
            </div>
            {editing === note.id ? (
              <form
                className="space-y-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => api(`/notes/${note.id}`, { method: 'PATCH', json: { text: draft } })).then((ok) => ok && setEditing(null));
                }}
              >
                <Textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit note" />
                <div className="flex justify-end gap-1.5">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
                    Save
                  </Button>
                </div>
              </form>
            ) : (
              <p className="whitespace-pre-wrap">{note.text}</p>
            )}
          </div>
        );
      })}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void run(() => api(addPath, { method: 'POST', json: { text } })).then((ok) => ok && setText(''));
        }}
        className="space-y-1.5"
      >
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a private note for the team…" aria-label="New note" maxLength={5000} />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="size-3" aria-hidden /> Only your team sees notes
          </span>
          <Button type="submit" size="sm" variant="outline" disabled={busy || !text.trim()}>
            Add note
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** A small section heading for the side panels. */
/**
 * What the site's tools returned or saved in a conversation (the Prompt
 * page's tools), by tool name: read-only, a line per key, objects folded.
 */
export function ToolData({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  if (!entries.length) return <p className="text-xs text-muted-foreground">No tool has run in this conversation.</p>;
  const line = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <div className="space-y-1.5">
      {entries.map(([name, data]) => {
        const failed = Boolean(data && typeof data === 'object' && !Array.isArray(data) && 'error' in data);
        const rows = data && typeof data === 'object' && !Array.isArray(data) ? Object.entries(data as Record<string, unknown>) : [['value', data] as const];
        return (
          <details key={name} className="group rounded-md border text-xs" open={entries.length <= 3}>
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 font-mono marker:hidden">
              <span className="truncate">{name}</span>
              {failed && <span className="ml-auto text-danger">failed</span>}
            </summary>
            <dl className="divide-y border-t">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-start gap-2 px-2 py-1">
                  <dt className="w-24 shrink-0 truncate text-muted-foreground" title={k}>
                    {k}
                  </dt>
                  <dd className="min-w-0 flex-1 break-words font-mono text-[11px]">{line(v)}</dd>
                </div>
              ))}
            </dl>
          </details>
        );
      })}
    </div>
  );
}

export function SideSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

