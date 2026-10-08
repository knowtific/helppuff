import { Check, Mail, MessageSquare, Phone, PhoneCall, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Shell';
import { Avatar, Badge, Button, Card, Empty, ErrorNote, Skeleton, Textarea } from '../components/ui';
import { api, type Callback, type CallbackList, type CallbackStatus } from '../lib/api';
import { NewJobButton } from './Jobs';
import { cn, fmtDateTime, fmtRelative, href, useData } from '../lib/utils';

/**
 * Callback requests as a to-do list: who asked, how to reach them, why, and
 * from which conversation. Open ones are oldest first, so nobody waits
 * longest; mark one done (with a note of what happened) or dismiss it.
 */

const TABS: { value: CallbackStatus; label: string }[] = [
  { value: 'open', label: 'Waiting' },
  { value: 'done', label: 'Done' },
  { value: 'dismissed', label: 'Dismissed' },
];

function Row({ callback, onChanged }: { callback: Callback; onChanged: (next: Callback) => void }) {
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState(callback.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const update = async (status: CallbackStatus, withNote?: string) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api<Callback>(`/callbacks/${callback.id}`, { method: 'PATCH', json: { status, ...(withNote !== undefined ? { note: withNote } : {}) } }));
      setClosing(false);
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-3 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-start">
      <Avatar name={callback.name} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span className="font-medium">{callback.name ?? 'No name given'}</span>
          {callback.phone && (
            <a href={`tel:${callback.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-foreground hover:underline">
              <Phone className="size-3.5" aria-hidden /> {callback.phone}
            </a>
          )}
          {callback.email && (
            <a href={`mailto:${callback.email}`} className="inline-flex items-center gap-1 text-foreground hover:underline">
              <Mail className="size-3.5" aria-hidden /> {callback.email}
            </a>
          )}
        </div>
        {callback.reason && <p className="text-[13px] text-muted-foreground">“{callback.reason}”</p>}
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span title={fmtDateTime(callback.requestedAt)}>Asked {fmtRelative(callback.requestedAt)}</span>
          <a href={href({ page: 'conversations', id: callback.conversationId })} className="inline-flex items-center gap-1 hover:text-foreground">
            <MessageSquare className="size-3" aria-hidden /> Conversation
          </a>
          {callback.closedAt && (
            <span>
              {callback.status === 'done' ? 'Done' : 'Dismissed'} {fmtRelative(callback.closedAt)}
              {callback.closedBy ? ` by ${callback.closedBy}` : ''}
            </span>
          )}
        </p>
        {callback.status !== 'open' && callback.note && <p className="text-[13px]">{callback.note}</p>}
        {closing && (
          <div className="space-y-2 pt-1">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened? (optional)" aria-label="Note" autoFocus />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void update('done', note)}>
                <Check /> Mark done
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setClosing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-danger" role="alert">{error.message}</p>}
      </div>
      {!closing && (
        <div className="flex shrink-0 gap-2">
          {callback.status === 'open' ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => setClosing(true)}>
                <Check /> Done
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void update('dismissed')} aria-label="Dismiss">
                <X /> Dismiss
              </Button>
              <NewJobButton context={{ callbackId: callback.id, label: `Callback request from ${callback.name ?? 'a visitor'}: its contact, chat and reason are linked.` }} />
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void update('open')}>
              <RotateCcw /> Reopen
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function Callbacks() {
  const [tab, setTab] = useState<CallbackStatus>('open');
  const { data, error, loading, reload } = useData(() => api<CallbackList>(`/callbacks?status=${tab}`), [tab]);
  // A changed request leaves this tab; the counts follow on the next load.
  const changed = () => reload();

  return (
    <>
      <PageHeader title="Callbacks" description="Visitors who asked the team to call or email them back. Mark each one done when you have." help="Leads#callbacks" />
      <div className="space-y-3 p-4 md:p-6">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              aria-pressed={tab === t.value}
              className={cn('h-7 rounded-md border px-2.5 text-xs transition-colors', tab === t.value ? 'border-transparent bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              {t.label}
              <span className="ml-1.5 tabular-nums opacity-60">{data?.counts[t.value] ?? 0}</span>
            </button>
          ))}
        </div>

        {error && <ErrorNote error={error} onRetry={reload} />}

        <Card className="overflow-hidden">
          {loading && !data && [0, 1, 2].map((i) => <Skeleton key={i} className="m-3 h-12" />)}
          {data && data.items.length === 0 && (
            <Empty icon={<PhoneCall />} title={tab === 'open' ? 'Nobody is waiting' : tab === 'done' ? 'None done yet' : 'None dismissed'}>
              {tab === 'open' ? 'When a visitor asks to be called back, the request appears here with how to reach them and why.' : null}
            </Empty>
          )}
          {data && data.items.length > 0 && (
            <ul aria-label={`${TABS.find((t) => t.value === tab)!.label} callbacks`}>
              {data.items.map((callback) => (
                <Row key={callback.id} callback={callback} onChanged={changed} />
              ))}
            </ul>
          )}
        </Card>
        {tab === 'open' && data && data.items.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <Badge>Oldest first</Badge> so nobody waits longest. Webhooks get <code className="rounded bg-muted px-1">callback.requested</code> and{' '}
            <code className="rounded bg-muted px-1">callback.updated</code>.
          </p>
        )}
      </div>
    </>
  );
}
