import { ArrowLeft, Bot, ExternalLink, Headset, Loader2, Lock, Mail, MessagesSquare, Phone, PhoneCall, Search, Send, Sparkles, ThumbsDown, ThumbsUp, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/Shell';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Input, Segmented, Select, Skeleton, StatusBadge, Textarea } from '../components/ui';
import { AttributesEditor, ConversationStatusBadge, LabelChip, LabelPicker, NotesPanel, SideSection, useLabels, WaitingBadge } from '../components/inbox';
import { api, isMember, parseSummary, type ConversationDetail, type ConversationRow, type Me, type StoredMessage, type Summary, type Team } from '../lib/api';
import { sendTyping, useLiveEvents } from '../lib/live';
import { cn, flag, fmtDateTime, fmtRelative, fmtTime, href, pathOf, useData, useDebounced, usePersisted } from '../lib/utils';

const QUALITY_DOT = { hot: '#dc2626', warm: '#f59e0b', cold: '#3b82f6', none: '#a1a1aa' } as const;
const OUTCOME_LABEL = {
  answered: 'answered',
  callback_requested: 'callback requested',
  lead_captured: 'details left',
  unanswered: 'not answered',
  abandoned: 'left early',
} as const;

const STATUSES = ['all', 'bot', 'live'] as const;
type StatusFilter = (typeof STATUSES)[number];
const FILTERS = ['all', 'waiting', 'leads', 'callbacks', 'unsummarized'] as const;
type Filter = (typeof FILTERS)[number];

function Row({ row, active }: { row: ConversationRow; active: boolean }) {
  const who = row.leadName ?? row.leadEmail ?? row.leadPhone;
  const summary = parseSummary(row.summary);
  return (
    <a
      href={href({ page: 'conversations', id: row.id })}
      aria-current={active ? 'true' : undefined}
      className={cn('flex gap-3 border-b px-3 py-3 transition-colors', active ? 'bg-muted' : 'hover:bg-subtle', Boolean(row.waitingSince) && 'border-l-2 border-l-[#d97706]')}
    >
      <Avatar name={who} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-[13px]', who ? 'font-medium' : 'text-muted-foreground')}>{who ?? 'Visitor'}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{fmtRelative(row.lastAt)}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{summary?.summary ?? row.firstMessage ?? 'No messages'}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {row.waitingSince ? <WaitingBadge since={row.waitingSince} compact /> : row.status && row.status !== 'bot' && <ConversationStatusBadge status={row.status} />}
          {row.status === 'live' && <Badge>{row.assignedName ?? 'Unassigned'}</Badge>}
          {row.labels?.map((label) => <LabelChip key={label.id} label={label} />)}
          {row.intent && <Badge>{row.intent}</Badge>}
          {summary?.leadQuality === 'hot' && <Badge dot={QUALITY_DOT.hot}>hot lead</Badge>}
          {row.leadStatus && <StatusBadge status={row.leadStatus} />}
          {row.callback === 'open' && <Badge dot="#d97706">Callback requested</Badge>}
          {row.callback === 'done' && <Badge>Called back</Badge>}
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
  const human = Boolean(message.author);
  const name = (payload['meta'] as { agentName?: string } | undefined)?.agentName;
  if (message.role === 'system' || message.type === 'notice' || message.type === 'handover') {
    return <p className="py-1 text-center text-xs text-muted-foreground">{message.text}</p>;
  }
  return (
    <div className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      {!mine && (
        <span className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
          {human ? <UserRound className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
          {human ? `${name ?? message.author} (team)` : 'Assistant'}
        </span>
      )}
      {message.text && message.type !== 'options' && (
        <div
          className={cn(
            'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed',
            mine ? 'rounded-br-md bg-primary text-primary-foreground' : human ? 'rounded-bl-md border border-primary/30 bg-primary/5' : 'rounded-bl-md bg-muted',
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
      <span className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
        {fmtTime(message.ts)}
        {message.feedback === 1 && (
          <span className="inline-flex items-center gap-0.5 text-foreground">
            <ThumbsUp className="size-3" aria-hidden /> Helpful
          </span>
        )}
        {message.feedback === -1 && (
          <span className="inline-flex items-center gap-0.5 text-danger">
            <ThumbsDown className="size-3" aria-hidden /> Not helpful
          </span>
        )}
      </span>
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
                {stored.leadQuality && stored.leadQuality !== 'none' && <Badge dot={QUALITY_DOT[stored.leadQuality]}>{stored.leadQuality} lead</Badge>}
                {stored.outcome && <Badge>{OUTCOME_LABEL[stored.outcome]}</Badge>}
                {stored.sentiment && <Badge>{stored.sentiment}</Badge>}
                {stored.topics?.map((topic) => (
                  <Badge key={topic} className="font-normal">
                    {topic}
                  </Badge>
                ))}
              </div>
              {stored.unanswered && stored.unanswered.length > 0 && (
                <div className="text-[13px]">
                  <span className="text-muted-foreground">It could not answer: </span>
                  {stored.unanswered.map((q) => `“${q}”`).join(', ')}{' '}
                  <a href={href({ page: 'knowledge' })} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                    Add an answer
                  </a>
                </div>
              )}
              {stored.followUp && (
                <p className="text-[13px]">
                  <span className="text-muted-foreground">Next step: </span>
                  {stored.followUp}
                </p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {enabled ? 'Summarise what the visitor wanted, how it ended and what to do next.' : 'Summaries need Workers AI — redeploy with helppuff deploy.'}
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

/** The reply box of a live chat: Enter sends, Shift+Enter is a new line. */
function Composer({ id, onSent }: { id: string; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/conversations/${id}/reply`, { method: 'POST', json: { text: value } });
      setText('');
      sendTyping(id, false);
      onSent();
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="border-t bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="flex items-end gap-2">
        <Textarea
          rows={2}
          value={text}
          maxLength={4000}
          placeholder="Reply to the visitor…"
          aria-label="Reply to the visitor"
          onChange={(e) => {
            setText(e.target.value);
            if (!typing.current) sendTyping(id, true);
            if (typing.current) clearTimeout(typing.current);
            typing.current = setTimeout(() => {
              sendTyping(id, false);
              typing.current = null;
            }, 3000);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="min-h-[52px] resize-none"
        />
        <Button type="submit" disabled={busy || !text.trim()} aria-label="Send">
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function Detail({ id, me, team, onChanged }: { id: string; me: Me; team: Team | null; onChanged: () => void }) {
  const { data, error, reload } = useData(() => api<ConversationDetail>(`/conversations/${id}`), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [visitorTyping, setVisitorTyping] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  useLiveEvents((event) => {
    if (!('conversationId' in event) || event.conversationId !== id) return;
    if (event.t === 'typing') setVisitorTyping(event.on);
    else reload();
  });
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [data?.messages.length]);

  if (error) return <div className="p-6"><ErrorNote error={error} onRetry={reload} /></div>;
  if (!data) return <div className="space-y-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;

  const c = data.conversation;
  const lead = data.lead;
  const who = lead?.name ?? lead?.email ?? lead?.phone ?? 'Visitor';
  const status = c.status ?? 'bot';
  const member = isMember(me);
  const mine = c.assigned_to === me.admin.email;
  const act = async (name: string, path: string, json?: unknown) => {
    setBusy(name);
    setActionError(null);
    try {
      await api(`/conversations/${id}/${path}`, { method: 'POST', ...(json === undefined ? {} : { json }) });
      reload();
      onChanged();
    } catch (thrown) {
      setActionError((thrown as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const patch = async (json: Record<string, unknown>) => {
    await api(`/conversations/${id}`, { method: 'PATCH', json });
    reload();
    onChanged();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <a href={href({ page: 'conversations' })} className="text-muted-foreground lg:hidden" aria-label="Back to list">
          <ArrowLeft className="size-4" />
        </a>
        <Avatar name={lead ? who : null} className="size-8" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-medium">
            {lead ? (
              <a href={href({ page: 'contact', id: lead.id })} className="truncate hover:underline">
                {who}
              </a>
            ) : (
              who
            )}
            <ConversationStatusBadge status={status} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            Started {fmtDateTime(Number(c.started_at))} on {pathOf(c['page_url'] as string | null)}
            {c['country'] ? ` · ${flag(String(c['country']))} ${String(c['country'])}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {status === 'live' && !mine && (
            <Button size="sm" onClick={() => void act('take', 'assign', { to: 'me' })} disabled={busy !== null}>
              <Headset /> {c.assigned_to ? 'Take over' : 'Take chat'}
            </Button>
          )}
          {status === 'live' && (
            <Button size="sm" variant="outline" onClick={() => void act('handback', 'handback')} disabled={busy !== null}>
              <Bot /> Back to assistant
            </Button>
          )}
          {status !== 'closed' && (
            <Button size="sm" variant="outline" onClick={() => void act('close', 'close')} disabled={busy !== null}>
              <Lock /> Close
            </Button>
          )}
        </div>
      </div>
      {actionError && (
        <p role="alert" className="border-b bg-danger/5 px-4 py-1.5 text-xs text-danger">
          {actionError}
        </p>
      )}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_280px]">
        <div className="flex min-h-0 flex-col">
          <div ref={thread} className="scroll-thin min-h-0 flex-1 space-y-4 overflow-auto p-4">
            {c.waiting_since && <WaitingBadge since={Number(c.waiting_since)} />}
            <SummaryCard id={id} stored={parseSummary(c.summary)} enabled={me.summaries} onDone={reload} />
            <div className="space-y-3" aria-live="polite">
              {data.messages.map((m) => (
                <Bubble key={m.id} message={m} />
              ))}
              {visitorTyping && <p className="text-xs text-muted-foreground">The visitor is typing…</p>}
            </div>
          </div>
          {status === 'live' && <Composer id={id} onSent={reload} />}
          {status === 'bot' && me.sites[0]?.live && (
            <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">The assistant is answering. When the visitor asks for a person, you can reply here.</p>
          )}
        </div>
        <aside className="scroll-thin hidden min-h-0 space-y-5 overflow-auto border-l p-4 text-[13px] lg:block">
          {status === 'live' && (
            <SideSection title="Assigned to">
              {member || !team ? (
                <p>{c.assigned_name ?? c.assigned_to ?? 'Nobody yet'}</p>
              ) : (
                <Select
                  value={c.assigned_to ?? ''}
                  onChange={(e) => void act('assign', 'assign', { to: e.target.value || null })}
                  aria-label="Assign to"
                  className="w-full"
                >
                  <option value="">Nobody</option>
                  {!team.admins.some((a) => a.email === team.owner) && team.owner && <option value={team.owner}>{team.owner}</option>}
                  {team.admins.map((a) => (
                    <option key={a.email} value={a.email}>
                      {a.name ? `${a.name} (${a.email})` : a.email}
                    </option>
                  ))}
                  {c.assigned_to && c.assigned_to.startsWith('telegram:') && <option value={c.assigned_to}>{c.assigned_name ?? 'Telegram'} (Telegram)</option>}
                </Select>
              )}
            </SideSection>
          )}
          <SideSection title="Contact">
            {lead ? (
              <div className="space-y-1.5">
                <a href={href({ page: 'contact', id: lead.id })} className="font-medium hover:underline">
                  {lead.name ?? '—'}
                </a>
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
                {data.callbacks.map((cb) => (
                  <div key={cb.id} className="mt-2 rounded-md border px-2.5 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium">
                      <PhoneCall className="size-3.5" aria-hidden />
                      {cb.status === 'open' ? 'Callback requested' : cb.status === 'done' ? 'Called back' : 'Callback dismissed'}
                    </p>
                    {cb.reason && <p className="mt-1 text-xs text-muted-foreground">“{cb.reason}”</p>}
                    {cb.note && <p className="mt-1 text-xs">{cb.note}</p>}
                    <a href={href({ page: 'callbacks' })} className="mt-1 block text-xs text-muted-foreground hover:text-foreground">
                      {cb.status === 'open' ? 'Mark done in Callbacks →' : 'Callbacks →'}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No contact details shared.</p>
            )}
          </SideSection>
          <SideSection title="Labels">
            <LabelPicker value={data.labels ?? []} onChange={(ids) => void patch({ labels: ids })} />
          </SideSection>
          <SideSection title="Attributes">
            <AttributesEditor value={c.attributes ?? {}} onSave={(attributes) => patch({ attributes })} />
          </SideSection>
          <SideSection title="Notes">
            <NotesPanel notes={data.notes ?? []} me={me.admin.email} isAdmin={!member} addPath={`/conversations/${id}/notes`} onChange={reload} />
          </SideSection>
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
  const [status, setStatus] = usePersisted<StatusFilter>('hp-conversations-status', 'all', STATUSES);
  const [filter, setFilter] = usePersisted<Filter>('hp-conversations-filter', 'all', FILTERS);
  const [label, setLabel] = usePersisted<string>('hp-conversations-label', '');
  const { labels } = useLabels();
  const q = useDebounced(query);
  const [pages, setPages] = useState<number[]>([]);
  const params = `filter=${filter}&status=${status}${label ? `&label=${encodeURIComponent(label)}` : ''}&q=${encodeURIComponent(q)}`;
  const { data, error, loading, reload } = useData(() => api<{ items: ConversationRow[]; next: number | null }>(`/conversations?${params}`), [params]);
  const team = useData(() => api<Team>('/admins').catch(() => null), []).data;
  const [more, setMore] = useState<ConversationRow[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const items = [...(data?.items ?? []), ...more];
  const cursor = more.length ? next : (data?.next ?? null);
  const live = Boolean(me.sites[0]?.live);

  // New chats, messages and who took what: the list follows, a moment later.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents((event) => {
    if (event.t === 'typing' || event.t === 'presence') return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(reload, 400);
  });
  // A label that no longer exists is not a filter.
  useEffect(() => {
    if (label && labels.length && !labels.some((l) => l.name === label)) setLabel('');
  }, [labels, label, setLabel]);

  const reset = () => {
    setMore([]);
    setPages([]);
  };
  const loadMore = async () => {
    if (!cursor) return;
    const page = await api<{ items: ConversationRow[]; next: number | null }>(`/conversations?${params}&before=${cursor}`);
    setMore((rows) => [...rows, ...page.items]);
    setNext(page.next);
    setPages((p) => [...p, cursor]);
  };
  const filtered = status !== 'all' || filter !== 'all' || Boolean(label) || Boolean(q);

  return (
    <div className="flex h-full flex-col">
      <div className={cn(id && 'hidden lg:block')}>
        <PageHeader title="Conversations" description="Every chat, newest first." help="Dashboard#conversations" />
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
                  reset();
                }}
                placeholder="Search messages, names, emails…"
                className="pl-8"
                aria-label="Search conversations"
              />
            </div>
            <Segmented
              label="Who is answering"
              value={status}
              onChange={(value) => {
                setStatus(value);
                reset();
              }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'bot', label: 'AI bot' },
                { value: 'live', label: 'Live agent' },
              ]}
            />
            <div className="flex gap-2">
              <Select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value as Filter);
                  reset();
                }}
                aria-label="Show"
                className="min-w-0 flex-1"
              >
                <option value="all">Everything</option>
                {live && <option value="waiting">Waiting for a reply</option>}
                <option value="leads">With contact</option>
                <option value="callbacks">Callback waiting</option>
                <option value="unsummarized">Not summarised</option>
              </Select>
              <Select
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  reset();
                }}
                aria-label="Label"
                className="min-w-0 flex-1"
              >
                <option value="">Any label</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            {error && <div className="p-3"><ErrorNote error={error} onRetry={reload} /></div>}
            {loading && !data && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="m-3 h-16" />)}
            {data && items.length === 0 && (
              <Empty icon={<MessagesSquare />} title={filtered ? 'Nothing matches' : 'No conversations yet'}>
                {filtered ? 'Try another word or filter.' : 'Chats appear here as soon as a visitor says hello.'}
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
            <Detail id={id} me={me} team={team} onChanged={reload} />
          ) : (
            <Empty icon={<MessagesSquare />} title="Pick a conversation">
              Read the full transcript, the visitor&apos;s details and an AI summary{live ? ', or answer a live chat' : ''}.
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}
