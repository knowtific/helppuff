import { Download, MessageSquare, Search, Users } from 'lucide-react';
import { Fragment, useState } from 'react';
import { PageHeader } from '../components/Shell';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Input, Select, Skeleton, statusLabel } from '../components/ui';
import { api, LEAD_STATUSES, type Lead, type LeadStatus } from '../lib/api';
import { cn, fmtRelative, href, useData, useDebounced } from '../lib/utils';

const SOURCE: Record<Lead['source'], string> = { form: 'Form', chat: 'Typed in chat', ai: 'Found by AI', api: 'Added over the API' };

export function Leads() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const q = useDebounced(query);
  const { data, error, loading, reload } = useData(
    () => api<{ items: Lead[]; counts: Record<string, number> }>(`/leads?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`),
    [q, status],
  );
  const [edits, setEdits] = useState<Record<string, Lead>>({});
  const leads = (data?.items ?? []).map((lead) => edits[lead.id] ?? lead);
  const total = Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0);

  const setLeadStatus = async (lead: Lead, next: LeadStatus) => {
    setEdits((e) => ({ ...e, [lead.id]: { ...lead, status: next } }));
    const saved = await api<Lead>(`/leads/${lead.id}`, { method: 'PATCH', json: { status: next } });
    setEdits((e) => ({ ...e, [lead.id]: { ...lead, ...saved, status: saved.status } }));
  };

  return (
    <>
      <PageHeader
        title="Contacts"
        description="People who left their details. Open one for their history, notes and attributes."
        help="Leads"
        actions={
          <Button variant="outline" onClick={() => (window.location.href = '/admin/api/leads.csv')}>
            <Download /> Export CSV
          </Button>
        }
      />
      <div className="space-y-3 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, company, notes…" className="pl-8" aria-label="Search contacts" />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
            {(['', ...LEAD_STATUSES] as const).map((s) => (
              <button
                key={s || 'all'}
                onClick={() => setStatus(s)}
                className={cn(
                  'h-7 rounded-md border px-2.5 text-xs transition-colors',
                  status === s ? 'bg-primary text-primary-foreground border-transparent' : 'hover:bg-muted',
                )}
              >
                {s ? statusLabel(s) : 'All'}
                <span className="ml-1.5 tabular-nums opacity-60">{s ? (data?.counts[s] ?? 0) : total}</span>
              </button>
            ))}
          </div>
        </div>

        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card className="overflow-hidden">
          {loading && !data && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="m-3 h-10" />)}
          {data && leads.length === 0 && (
            <Empty icon={<Users />} title={q || status ? 'No leads match' : 'No leads yet'}>
              {q || status
                ? 'Try another search or status.'
                : 'A lead is created when a visitor fills in the form, types an email or phone number, or when an AI summary finds one.'}
            </Empty>
          )}
          {leads.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="border-b bg-subtle text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Contact</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Last active</th>
                    <th className="px-2 py-2" aria-label="Conversations" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leads.map((lead) => {
                    const conversation = lead.lastConversationId ?? lead.conversationId ?? lead.conversation_id;
                    const active = lead.updatedAt ?? lead.createdAt ?? lead.created_at ?? 0;
                    const chats = lead.conversations ?? 1;
                    return (
                      <Fragment key={lead.id}>
                        <tr className="cursor-pointer hover:bg-subtle" onClick={() => (window.location.hash = href({ page: 'contact', id: lead.id }))}>
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-2.5">
                              <Avatar name={lead.name ?? lead.email} />
                              <a href={href({ page: 'contact', id: lead.id })} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                                {lead.name ?? <span className="text-muted-foreground">Unnamed</span>}
                              </a>
                              {lead.company && <span className="text-xs text-muted-foreground">{lead.company}</span>}
                              {Boolean(lead.openCallbacks) && (
                                <a href={href({ page: 'callbacks' })} title="Waiting for a callback">
                                  <Badge dot="#d97706">Callback requested</Badge>
                                </a>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="block">{lead.email ?? lead.phone ?? '—'}</span>
                            {lead.email && lead.phone && <span className="block text-xs text-muted-foreground">{lead.phone}</span>}
                          </td>
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Select
                              value={lead.status}
                              onChange={(e) => void setLeadStatus(lead, e.target.value as LeadStatus)}
                              aria-label={`Status for ${lead.name ?? lead.email ?? 'lead'}`}
                              className="h-7 text-xs"
                            >
                              {LEAD_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {statusLabel(s)}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge>{SOURCE[lead.source] ?? lead.source}</Badge>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{fmtRelative(active)}</td>
                          <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                            {conversation && (
                              <a
                                href={href({ page: 'conversations', id: conversation })}
                                className="inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                                aria-label={chats > 1 ? `Open the latest of ${chats} conversations` : 'Open conversation'}
                              >
                                <MessageSquare className="size-4" />
                                {chats > 1 && <span className="tabular-nums">{chats}</span>}
                              </a>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
