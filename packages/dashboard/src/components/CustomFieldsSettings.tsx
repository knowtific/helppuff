import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useData } from '../lib/utils';
import { JobFieldsSettings } from './JobsSettings';
import { Button, Card, CardHeader, ErrorNote, Input, Skeleton } from './ui';

type Scope = 'conversation' | 'contact';
type Attribute = { name: string; used: number; defined: boolean };
type AttributeList = { conversations: Attribute[]; contacts: Attribute[] };
type Change = (method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, string>) => Promise<boolean>;

function AttributeRow({ attribute, scope, busy, change }: { attribute: Attribute; scope: Scope; busy: boolean; change: Change }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(attribute.name);
  const records = `${attribute.used} ${scope}${attribute.used === 1 ? '' : 's'}`;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (await change('PATCH', { scope, oldName: attribute.name, name: name.trim() })) setEditing(false);
  };
  const remove = () => {
    const values = attribute.used ? ` and its values on ${records}` : '';
    if (window.confirm(`Remove “${attribute.name}”${values}? This cannot be undone.`)) void change('DELETE', { scope, name: attribute.name });
  };
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
      {editing ? (
        <form onSubmit={(event) => void save(event)} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={64} aria-label={`Rename ${attribute.name}`} className="min-w-36 flex-1" />
          <Button size="sm" type="submit" disabled={busy || !name.trim() || name.trim() === attribute.name}>Save</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => { setName(attribute.name); setEditing(false); }}>Cancel</Button>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <span className="break-all font-medium">{attribute.name}</span>
            <p className="text-xs text-muted-foreground">{attribute.used ? `Used on ${records}` : 'No values yet'}</p>
          </div>
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Rename ${attribute.name}`} disabled={busy} onClick={() => setEditing(true)}><Pencil /></Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${attribute.name}`} disabled={busy} onClick={remove}><Trash2 /></Button>
        </>
      )}
    </li>
  );
}

function AttributeCard({ title, scope, attributes, busy, change }: { title: string; scope: Scope; attributes: Attribute[]; busy: boolean; change: Change }) {
  const [name, setName] = useState('');
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (await change('POST', { scope, name: name.trim() })) setName('');
  };
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="divide-y border-t">
        {attributes.length === 0 && <li className="px-4 py-3 text-[13px] text-muted-foreground">No attributes yet.</li>}
        {attributes.map((attribute) => <AttributeRow key={attribute.name} attribute={attribute} scope={scope} busy={busy} change={change} />)}
      </ul>
      <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} placeholder="Name, e.g. order_id" aria-label={`New ${scope} attribute name`} className="min-w-40 flex-1" />
        <Button type="submit" size="sm" disabled={busy || !name.trim()}><Plus /> Add attribute</Button>
      </form>
    </Card>
  );
}

/** One inventory for the two freeform attribute stores and the existing job field editor. */
export function CustomFieldsSettings({ site }: { site: string }) {
  const { data, error, reload } = useData(() => api<AttributeList>(`/attribute-definitions?site=${encodeURIComponent(site)}`), [site]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const change: Change = async (method, body) => {
    setBusy(true);
    setSaveError(null);
    try {
      await api('/attribute-definitions', { method, json: { site, ...body } });
      reload();
      return true;
    } catch (thrown) {
      setSaveError((thrown as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-4">
      <AttributeCard title="Conversations" scope="conversation" attributes={data.conversations} busy={busy} change={change} />
      <AttributeCard title="Contacts" scope="contact" attributes={data.contacts} busy={busy} change={change} />
      {saveError && <p role="alert" className="text-xs text-danger">{saveError}</p>}
      <div className="space-y-2 pt-2">
        <h2 className="px-1 text-[13px] font-medium">Jobs</h2>
        <JobFieldsSettings />
      </div>
    </div>
  );
}
