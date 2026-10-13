import { Download, MessageSquare, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Shell';
import { ContactTagPicker } from '../components/ContactTags';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Input, Select, Skeleton } from '../components/ui';
import { api, download, type ContactTag, type Lead } from '../lib/api';
import { fmtRelative, href, useData, useDebounced } from '../lib/utils';

const SOURCE: Record<Lead['source'], string> = { form: 'Form', chat: 'Typed in chat', ai: 'Found by AI', api: 'Added over the API' };

export function Leads() {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const q = useDebounced(query);
  const { data, error, loading, reload } = useData(
    () => api<{ items: Lead[]; counts: Record<string, number> }>(`/leads?q=${encodeURIComponent(q)}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`),
    [q, tag],
  );
  const { data: tagData, error: tagError, reload: reloadTags } = useData(() => api<{ tags: ContactTag[] }>('/contact-tags'), []);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<Error | null>(null);
  const exportCsv = () => {
    setExporting(true);
    setExportError(null);
    download('/leads.csv')
      .catch((e: unknown) => setExportError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setExporting(false));
  };
  const leads = data?.items ?? [];
  const total = Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Contacts"
        description="People who left their details. Organise them with tags, then open one for their history, notes and attributes."
        help="Leads"
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={exporting}>
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
          <Select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Filter contacts by tag" className="h-9 w-auto min-w-36 text-xs">
            <option value="">All contacts ({total})</option>
            <option value="untagged">Untagged</option>
            {(tagData?.tags ?? []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </Select>
        </div>

        {error && <ErrorNote error={error} onRetry={reload} />}
        {tagError && <ErrorNote error={tagError} onRetry={reloadTags} />}
        {exportError && <ErrorNote error={exportError} onRetry={exportCsv} />}

        <Card className="overflow-hidden">
          {loading && !data && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="m-3 h-10" />)}
          {data && leads.length === 0 && (
            <Empty icon={<Users />} title={q || tag ? 'No contacts match' : 'No contacts yet'}>
              {q || tag
                ? 'Try another search or tag.'
                : 'A contact is created when a visitor fills in the form, types an email or phone number, or when an AI summary finds one.'}
            </Empty>
          )}
          {leads.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead className="border-b bg-subtle text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Contact</th>
                    <th className="px-4 py-2 font-medium">Tags</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Updated</th>
                    <th className="px-2 py-2" aria-label="Conversations" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leads.map((lead) => {
                    const conversation = lead.lastConversationId ?? lead.conversationId ?? lead.conversation_id;
                    const updated = lead.updatedAt ?? lead.createdAt ?? lead.created_at ?? 0;
                    const chats = lead.conversations ?? 1;
                    return (
                      <tr key={lead.id} className="cursor-pointer hover:bg-subtle" onClick={() => (window.location.hash = href({ page: 'contact', id: lead.id }))}>
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
                            <ContactTagPicker value={lead.tags ?? []} options={tagData?.tags ?? []} onChange={async (ids) => { await api(`/leads/${lead.id}`, { method: 'PATCH', json: { tags: ids } }); reload(); }} />
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge>{SOURCE[lead.source] ?? lead.source}</Badge>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{fmtRelative(updated)}</td>
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
