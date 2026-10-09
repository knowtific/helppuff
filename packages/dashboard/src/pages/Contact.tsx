import { ArrowLeft, Building2, Mail, MapPin, MessageSquare, Pencil, Phone, PhoneCall, StickyNote, Trash2, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AttributesEditor, ConversationStatusBadge, LabelChip, NotesPanel, SideSection } from '../components/inbox';
import { Avatar, Badge, Button, Card, CardHeader, Empty, ErrorNote, Input, Select, Skeleton, statusLabel } from '../components/ui';
import { api, isMember, LEAD_STATUSES, parseSummary, type ContactDetail, type LeadStatus, type Me } from '../lib/api';
import { RelatedJobs } from './Jobs';
import { fmtDateTime, fmtRelative, href, pathOf, useData } from '../lib/utils';

/**
 * One person, like a CRM's contact page: their details (editable), custom
 * attributes, the team's notes, every conversation with its status and
 * labels, callback requests, and the history of all of it in one timeline.
 */

const DETAILS = [
  { key: 'name', label: 'Name', icon: UserRound, type: 'text', max: 200 },
  { key: 'email', label: 'Email', icon: Mail, type: 'email', max: 200 },
  { key: 'phone', label: 'Phone', icon: Phone, type: 'tel', max: 40 },
  { key: 'company', label: 'Company', icon: Building2, type: 'text', max: 200 },
  { key: 'address', label: 'Address', icon: MapPin, type: 'text', max: 500 },
] as const;
type DetailKey = (typeof DETAILS)[number]['key'];

function DetailsForm({ contact, onSaved }: { contact: ContactDetail; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<DetailKey, string>>(() => Object.fromEntries(DETAILS.map((d) => [d.key, (contact[d.key] as string | null | undefined) ?? ''])) as Record<DetailKey, string>);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const changed = Object.fromEntries(DETAILS.filter((d) => values[d.key] !== ((contact[d.key] as string | null | undefined) ?? '')).map((d) => [d.key, values[d.key] || null]));
      if (Object.keys(changed).length) await api(`/leads/${contact.id}`, { method: 'PATCH', json: changed });
      setEditing(false);
      onSaved();
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!editing) {
    return (
      <div className="space-y-2">
        <dl className="space-y-1.5 text-[13px]">
          {DETAILS.map(({ key, label, icon: Icon }) => {
            const value = contact[key] as string | null | undefined;
            return (
              <div key={key} className="flex items-start gap-2">
                <dt className="sr-only">{label}</dt>
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <dd className={value ? 'min-w-0 break-words' : 'text-muted-foreground'}>
                  {value ? key === 'email' ? <a href={`mailto:${value}`} className="hover:underline">{value}</a> : key === 'phone' ? <a href={`tel:${value}`} className="hover:underline">{value}</a> : value : `No ${label.toLowerCase()}`}
                </dd>
              </div>
            );
          })}
        </dl>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil /> Edit details
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void save(e)} className="space-y-2">
      {DETAILS.map(({ key, label, type, max }) => (
        <label key={key} className="block space-y-1">
          <span className="text-xs font-medium">{label}</span>
          <Input type={type} value={values[key]} maxLength={max} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
        </label>
      ))}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

type Event = { at: number; icon: typeof Mail; text: string; href?: string };

function timeline(contact: ContactDetail): Event[] {
  const events: Event[] = [{ at: contact.createdAt ?? contact.created_at ?? 0, icon: UserRound, text: `Became a contact (${contact.source === 'api' ? 'added over the API' : contact.source === 'form' ? 'from a form' : contact.source === 'ai' ? 'found by the AI' : 'typed in a chat'})` }];
  for (const c of contact.conversations) {
    const summary = parseSummary(c.summary);
    events.push({ at: c.startedAt, icon: MessageSquare, text: `Chat on ${pathOf(c.pageUrl)}: ${summary?.summary ?? c.firstMessage ?? 'no messages'}`, href: href({ page: 'conversations', id: c.id }) });
  }
  for (const cb of contact.callbacks ?? []) {
    events.push({ at: cb.requestedAt, icon: PhoneCall, text: `Asked for a callback${cb.reason ? `: “${cb.reason}”` : ''}` });
    if (cb.closedAt) events.push({ at: cb.closedAt, icon: PhoneCall, text: cb.status === 'done' ? `Called back${cb.closedBy ? ` by ${cb.closedBy}` : ''}` : 'Callback dismissed' });
  }
  for (const note of contact.teamNotes ?? []) events.push({ at: note.createdAt, icon: StickyNote, text: `${note.authorName ?? note.author} added a note` });
  return events.sort((a, b) => b.at - a.at);
}

export function Contact({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useData(() => api<ContactDetail>(`/leads/${id}`), [id]);
  const member = isMember(me);
  const [deleting, setDeleting] = useState(false);
  if (error) return <div className="p-6"><ErrorNote error={error} onRetry={reload} /></div>;
  if (!data) return <div className="space-y-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  const name = data.name ?? data.email ?? data.phone ?? 'Unnamed';
  const setStatus = async (status: LeadStatus) => {
    await api(`/leads/${id}`, { method: 'PATCH', json: { status } });
    reload();
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${name}? Their conversations stay.`)) return;
    setDeleting(true);
    await api(`/leads/${id}`, { method: 'DELETE' }).finally(() => setDeleting(false));
    window.location.hash = href({ page: 'leads' });
  };
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <a href={href({ page: 'leads' })} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> Contacts
      </a>
      <header className="flex flex-wrap items-center gap-3">
        <Avatar name={data.name ?? data.email} className="size-11 text-sm" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{name}</h1>
          <p className="text-xs text-muted-foreground">
            {data.company ? `${data.company} · ` : ''}Contact since {fmtDateTime(data.createdAt ?? data.created_at ?? 0)} · {data.conversations.length} conversation{data.conversations.length === 1 ? '' : 's'}
          </p>
        </div>
        <Select value={data.status} onChange={(e) => void setStatus(e.target.value as LeadStatus)} aria-label="Status">
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
        {!member && (
          <Button variant="outline" size="sm" onClick={() => void remove()} disabled={deleting} aria-label="Delete contact">
            <Trash2 />
          </Button>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <Card className="space-y-5 p-4">
            <SideSection title="Details">
              <DetailsForm key={`${data.id}-${data.updatedAt ?? 0}`} contact={data} onSaved={reload} />
            </SideSection>
            <SideSection title="Attributes">
              <AttributesEditor
                value={data.attributes ?? {}}
                onSave={async (attributes) => {
                  await api(`/leads/${id}`, { method: 'PATCH', json: { attributes } });
                  reload();
                }}
              />
            </SideSection>
            {data.fields && (
              <SideSection title="From forms">
                <dl className="space-y-1 text-xs">
                  {Object.entries(JSON.parse(data.fields) as Record<string, string>).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="w-24 shrink-0 truncate text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </SideSection>
            )}
          </Card>
          <Card className="p-4">
            <SideSection title="Notes">
              {data.notes && <p className="whitespace-pre-wrap rounded-md border px-2.5 py-2 text-xs text-muted-foreground">{data.notes}</p>}
              <NotesPanel notes={(data.teamNotes ?? []).slice().reverse()} me={me.admin.email} isAdmin={!member} addPath={`/leads/${id}/notes`} onChange={reload} />
            </SideSection>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Jobs" tip={{ label: 'About jobs', text: 'Requests, quotes and work for this person.' }} />
            <div className="border-t px-4 py-3">
              <RelatedJobs filter={{ contact: id }} context={{ contactId: id, label: `For ${data.name ?? data.email ?? 'this contact'}` }} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Conversations" tip={{ label: 'About conversations', text: 'Every chat this person has had, newest first.' }} />
            {data.conversations.length === 0 ? (
              <Empty icon={<MessageSquare />} title="No conversations">
                Added from elsewhere (the API, a form): chats appear here when they write in.
              </Empty>
            ) : (
              <ul className="divide-y border-t">
                {data.conversations.map((c) => {
                  const summary = parseSummary(c.summary);
                  return (
                    <li key={c.id}>
                      <a href={href({ page: 'conversations', id: c.id })} className="block px-4 py-3 hover:bg-subtle">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium">{summary?.summary ?? c.firstMessage ?? 'No messages'}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{fmtRelative(c.lastAt)}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <ConversationStatusBadge status={c.status} />
                          {c.assignedName && <Badge>{c.assignedName}</Badge>}
                          {c.labels?.map((label) => <LabelChip key={label.id} label={label} />)}
                          {c.intent && <Badge>{c.intent}</Badge>}
                          <span className="text-[11px] text-muted-foreground">
                            {c.messageCount} msgs · {pathOf(c.pageUrl)}
                          </span>
                        </div>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="History" tip={{ label: 'About history', text: 'Chats, callbacks and notes, newest first.' }} />
            <ol className="space-y-3 border-t px-4 py-3">
              {timeline(data).map((event, index) => {
                const Icon = event.icon;
                return (
                  <li key={index} className="flex gap-2.5 text-[13px]">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      {event.href ? (
                        <a href={event.href} className="line-clamp-2 hover:underline">
                          {event.text}
                        </a>
                      ) : (
                        <p className="line-clamp-2">{event.text}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">{fmtDateTime(event.at)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
