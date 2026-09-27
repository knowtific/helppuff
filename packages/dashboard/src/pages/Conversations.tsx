import { ArrowLeft, ExternalLink, Loader2, Mail, MessagesSquare, Phone, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Shell';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Input, Segmented, Skeleton, StatusBadge } from '../components/ui';
import { api, parseSummary, type ConversationDetail, type ConversationRow, type Me, type StoredMessage, type Summary } from '../lib/api';
import { cn, flag, fmtDateTime, fmtRelative, fmtTime, href, pathOf, useData, useDebounced } from '../lib/utils';

type Filter = 'all' | 'leads' | 'unsummarized';

function Row({ row, active }: { row: ConversationRow; active: boolean }) {
  const who = row.leadName ?? row.leadEmail ?? row.leadPhone;
  const summary = parseSummary(row.summary);
  return (
    <a
      href={href({ page: 'conversations', id: row.id })}
      aria-current={active ? 'true' : undefined}
      className={cn('flex gap-3 border-b px-3 py-3 transition-colors', active ? 'bg-muted' : 'hover:bg-subtle')}
    >
      <Avatar name={who} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-[13px]', who ? 'font-medium' : 'text-muted-foreground')}>{who ?? 'Visitor'}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{fmtRelative(row.lastAt)}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{summary?.summary ?? row.firstMessage ?? 'No messages'}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {row.intent && <Badge>{row.intent}</Badge>}
          {row.leadStatus && <StatusBadge status={row.leadStatus} />}
          <span className="text-[11px] text-muted-foreground">
            {row.messageCount} msgs{row.country ? ` · ${flag(row.country)} ${row.country}` : ''}
          </span>
        </div>
      </div>
    </a>
  );
}

function Bubble({ message }: { message: StoredMessage }) {
  const mine = message.role === 'user';
  const payload = message.payload ?? {};
  const options = Array.isArray(payload['options']) ? (payload['options'] as { label: string }[]) : null;
  const links = Array.isArray(payload['links']) ? (payload['links'] as { label: string; url: string }[]) : null;
  if (message.role === 'system' || message.type === 'notice') {
    return <p className="py-1 text-center text-xs text-muted-foreground">{message.text}</p>;
  }
  return (
    <div className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      {message.text && message.type !== 'options' && (
        <div
          className={cn(
            'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed',
            mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted',
          )}
        >
          {message.type === 'card' && <span className="block font-medium">{message.text}</span>}
          {message.type === 'card' ? String(payload['body'] ?? '') : message.text}
        </div>
      )}
      {options && (
        <div className="flex max-w-[85%] flex-wrap gap-1.5">
          {message.text && <p className="w-full text-[13px]">{message.text}</p>}
          {options.map((o) => (
            <span key={o.label} className="rounded-full border px-2.5 py-1 text-xs">
              {o.label}
            </span>
          ))}
        </div>
      )}
      {links && (
        <div className="flex max-w-[85%] flex-col gap-1">
          {links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-2">
              {l.label} <ExternalLink className="size-3" />
            </a>
          ))}
        </div>
      )}
      <span className="px-1 text-[10px] text-muted-foreground">{fmtTime(message.ts)}</span>
    </div>
  );
}

function SummaryCard({ id, stored, enabled, onDone }: { id: string; stored: Summary | null; enabled: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/conversations/${id}/summary`, { method: 'POST' });
      onDone();
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="bg-subtle">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" /> AI summary
          </p>
          {stored ? (
            <>
              <p className="text-[13px] leading-relaxed">{stored.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                {stored.intent && <Badge>{stored.intent}</Badge>}
                {stored.sentiment && <Badge>{stored.sentiment}</Badge>}
              </div>
              {stored.followUp && (
                <p className="text-[13px]">
                  <span className="text-muted-foreground">Next step: </span>
                  {stored.followUp}
                </p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {enabled ? 'Summarise what the visitor wanted, how it ended and what to do next.' : 'Summaries need Workers AI — redeploy with murmur deploy.'}
            </p>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        {enabled && (
          <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {stored ? 'Refresh' : 'Summarise'}
          </Button>
        )}
      </div>
    </Card>
  );
}

function Detail({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useData(() => api<ConversationDetail>(`/conversations/${id}`), [id]);
  if (error) return <div className="p-6"><ErrorNote error={error} onRetry={reload} /></div>;
  if (!data) return <div className="space-y-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;

  const c = data.conversation;
  const lead = data.lead;
  const who = lead?.name ?? lead?.email ?? lead?.phone ?? 'Visitor';
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <a href={href({ page: 'conversations' })} className="text-muted-foreground lg:hidden" aria-label="Back to list">
          <ArrowLeft className="size-4" />
        </a>
        <Avatar name={lead ? who : null} className="size-8" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{who}</p>
          <p className="truncate text-xs text-muted-foreground">
            Started {fmtDateTime(Number(c.started_at))} on {pathOf(c['page_url'] as string | null)}
            {c['country'] ? ` · ${flag(String(c['country']))} ${String(c['country'])}` : ''}
          </p>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_260px]">
        <div className="scroll-thin min-h-0 space-y-4 overflow-auto p-4">
          <SummaryCard id={id} stored={parseSummary(c.summary)} enabled={me.summaries} onDone={reload} />
          <div className="space-y-3">
            {data.messages.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}
          </div>
        </div>
        <aside className="hidden space-y-4 border-l p-4 text-[13px] lg:block">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Contact</p>
            {lead ? (
              <div className="space-y-1.5">
                <p className="font-medium">{lead.name ?? '—'}</p>
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 hover:underline">
                    <Mail className="size-3.5 text-muted-foreground" /> {lead.email}
                  </a>
                )}
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 hover:underline">
                    <Phone className="size-3.5 text-muted-foreground" /> {lead.phone}
                  </a>
                )}
                <div className="pt-1">
                  <StatusBadge status={lead.status} />
                </div>
                <a href={href({ page: 'leads' })} className="block pt-1 text-xs text-muted-foreground hover:text-foreground">
                  Manage in Leads →
                </a>
              </div>
            ) : (
              <p className="text-muted-foreground">No contact details shared.</p>
            )}
          </div>
          <div className="space-y-1 border-t pt-4 text-xs text-muted-foreground">
            <p>{data.messages.length} messages</p>
            {Boolean(c['referrer']) && <p className="truncate">From {pathOf(String(c['referrer']))}</p>}
            {Boolean(c['locale']) && <p>Language {String(c['locale'])}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function Conversations({ id, me }: { id?: string | undefined; me: Me }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const q = useDebounced(query);
  const [pages, setPages] = useState<number[]>([]);
  const { data, error, loading, reload } = useData(
    () => api<{ items: ConversationRow[]; next: number | null }>(`/conversations?filter=${filter}&q=${encodeURIComponent(q)}`),
    [q, filter],
  );
  const [more, setMore] = useState<ConversationRow[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const items = [...(data?.items ?? []), ...more];
  const cursor = more.length ? next : (data?.next ?? null);

  const loadMore = async () => {
    if (!cursor) return;
    const page = await api<{ items: ConversationRow[]; next: number | null }>(`/conversations?filter=${filter}&q=${encodeURIComponent(q)}&before=${cursor}`);
    setMore((rows) => [...rows, ...page.items]);
    setNext(page.next);
    setPages((p) => [...p, cursor]);
  };

  return (
    <div className="flex h-full flex-col">
      <div className={cn(id && 'hidden lg:block')}>
        <PageHeader title="Conversations" description="Every chat, newest first." />
      </div>
      <div className="flex min-h-0 flex-1">
        <section className={cn('flex w-full flex-col border-r lg:w-[380px] lg:shrink-0', id && 'hidden lg:flex')}>
          <div className="space-y-2 border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setMore([]);
                  setPages([]);
                }}
                placeholder="Search messages, names, emails…"
                className="pl-8"
                aria-label="Search conversations"
              />
            </div>
            <Segmented
              label="Filter"
              value={filter}
              onChange={(value) => {
                setFilter(value);
                setMore([]);
                setPages([]);
              }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'leads', label: 'With contact' },
                { value: 'unsummarized', label: 'Not summarised' },
              ]}
            />
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            {error && <div className="p-3"><ErrorNote error={error} onRetry={reload} /></div>}
            {loading && !data && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="m-3 h-16" />)}
            {data && items.length === 0 && (
              <Empty icon={<MessagesSquare />} title={q ? 'Nothing matches' : 'No conversations yet'}>
                {q ? 'Try another word.' : 'Chats appear here as soon as a visitor says hello.'}
              </Empty>
            )}
            {items.map((row) => (
              <Row key={row.id} row={row} active={row.id === id} />
            ))}
            {cursor && (
              <div className="p-3">
                <Button variant="outline" className="w-full" onClick={() => void loadMore()} data-pages={pages.length}>
                  Load more
                </Button>
              </div>
            )}
          </div>
        </section>
        <section className={cn('min-w-0 flex-1', !id && 'hidden lg:block')}>
          {id ? (
            <Detail id={id} me={me} />
          ) : (
            <Empty icon={<MessagesSquare />} title="Pick a conversation">
              Read the full transcript, the visitor&apos;s details and an AI summary.
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}
