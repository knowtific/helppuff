import { Check, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type ContactTag } from '../lib/api';
import { useData } from '../lib/utils';
import { Button, Card, CardHeader, ErrorNote, Input, Skeleton } from './ui';
import { confirmDelete } from '../lib/confirm';

type TagList = { tags: ContactTag[]; colors: string[] };

export function ContactTagChip({ tag, onRemove }: { tag: ContactTag; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none">
      <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />
      {tag.name}
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${tag.name}`} className="-mr-0.5 rounded text-muted-foreground hover:text-foreground"><X className="size-3" /></button>}
    </span>
  );
}

/** Assign several site-defined tags to one contact. */
export function ContactTagPicker({ value, options, onChange }: { value: ContactTag[]; options: ContactTag[]; onChange: (ids: string[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => value.map((tag) => tag.id));
  useEffect(() => {
    const ids = value.map((tag) => tag.id);
    setSelectedIds((current) => current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids);
  }, [value]);
  const chosen = new Set(selectedIds);
  const shown = selectedIds.map((id) => options.find((tag) => tag.id === id) ?? value.find((tag) => tag.id === id)).filter((tag): tag is ContactTag => Boolean(tag));
  const toggle = async (id: string) => {
    setBusy(true);
    setError(null);
    const next = chosen.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id];
    setSelectedIds(next);
    try {
      await onChange(next);
    } catch (thrown) {
      setSelectedIds(value.map((tag) => tag.id));
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {shown.map((tag) => <ContactTagChip key={tag.id} tag={tag} onRemove={busy ? undefined : () => void toggle(tag.id)} />)}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed px-1.5 text-[11px] text-muted-foreground hover:text-foreground">
          <Tag className="size-3" aria-hidden /> {shown.length ? 'Edit tags' : 'Add tags'}
        </button>
      </div>
      {open && (
        <div className="max-h-48 min-w-40 overflow-auto rounded-md border bg-card p-1.5 shadow-sm scroll-thin">
          {options.length ? options.map((tag) => (
            <button key={tag.id} type="button" role="checkbox" aria-checked={chosen.has(tag.id)} disabled={busy} onClick={() => void toggle(tag.id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted disabled:opacity-50">
              <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />
              <span className="flex-1">{tag.name}</span>
              {chosen.has(tag.id) && <Check className="size-3" aria-hidden />}
            </button>
          )) : <p className="px-1.5 py-1 text-xs text-muted-foreground">No contact tags yet. An admin can add them in Settings → Contact tags.</p>}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function TagColor({ colors, value, onChange }: { colors: string[]; value: string; onChange: (color: string) => void }) {
  return (
    <div role="group" aria-label="Tag colour" className="flex flex-wrap items-center gap-1">
      {colors.map((color) => <button key={color} type="button" onClick={() => onChange(color)} aria-label={`Colour ${color}`} aria-pressed={value === color} className={`size-6 rounded-full ring-offset-2 ring-offset-background ${value === color ? 'ring-2 ring-ring' : ''}`} style={{ backgroundColor: color }} />)}
    </div>
  );
}

function TagRow({ tag, colors, onSaved }: { tag: ContactTag; colors: string[]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/contact-tags/${tag.id}`, { method: 'PATCH', json: { name, color } });
      setEditing(false);
      onSaved();
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setEditing(false);
    setName(tag.name);
    setColor(tag.color);
    setError(null);
  };
  const remove = async () => {
    if (!confirmDelete(`Delete “${tag.name}”?`, 'It is removed from every contact.')) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/contact-tags/${tag.id}`, { method: 'DELETE' });
      onSaved();
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-2 px-4 py-2.5 text-[13px]">
      {editing ? (
        <form onSubmit={(event) => void save(event)} className="space-y-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} aria-label={`Rename ${tag.name}`} />
          <TagColor colors={colors} value={color} onChange={setColor} />
          <div className="flex justify-end gap-1.5"><Button type="button" size="sm" variant="ghost" onClick={cancel}>Cancel</Button><Button type="submit" size="sm" disabled={busy || !name.trim()}>Save</Button></div>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <ContactTagChip tag={tag} />
          <span className="flex-1" />
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Edit ${tag.name}`} disabled={busy} onClick={() => setEditing(true)}><Pencil /></Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Delete ${tag.name}`} disabled={busy} onClick={() => void remove()}><Trash2 /></Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </li>
  );
}

/** The definitions are shared by all contacts at this site. */
export function ContactTagsSettings() {
  const { data, error, reload } = useData(() => api<TagList>('/contact-tags'), []);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setSaveError(null);
    try {
      await api('/contact-tags', { method: 'POST', json: { name, ...(color ? { color } : {}) } });
      setName('');
      setColor('');
      reload();
    } catch (thrown) {
      setSaveError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">A contact can have several tags. Add them to people from Contacts, then filter the list by tag. Conversation labels are managed separately.</p>
      <Card>
        <CardHeader title="Contact tags" />
        <ul className="divide-y border-t">
          {data.tags.length === 0 && <li className="px-4 py-3 text-[13px] text-muted-foreground">No contact tags yet.</li>}
          {data.tags.map((tag) => <TagRow key={tag.id} tag={tag} colors={data.colors} onSaved={reload} />)}
        </ul>
      </Card>
      <Card>
        <form onSubmit={(event) => void add(event)} className="space-y-3 p-4">
          <h3 className="text-[13px] font-medium">New contact tag</h3>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="Name, e.g. VIP" aria-label="Contact tag name" />
          <TagColor colors={data.colors} value={color} onChange={setColor} />
          <div className="flex justify-end"><Button type="submit" disabled={busy || !name.trim()}><Plus /> Add tag</Button></div>
        </form>
      </Card>
      {saveError && <p role="alert" className="text-xs text-danger">{saveError}</p>}
    </div>
  );
}
