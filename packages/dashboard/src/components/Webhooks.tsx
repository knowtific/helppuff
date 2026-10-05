import { Check, ChevronRight, Copy, Eye, EyeOff, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { cn, fmtRelative, useData } from '../lib/utils';
import { Badge, Button, Card, Empty, ErrorNote, Input, Skeleton } from './ui';

/**
 * Settings → Webhooks: endpoints that receive what happens — chats, messages,
 * leads, callbacks, ratings, learning — as signed JSON. The same API as
 * `murmur webhooks`.
 */

type Webhook = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  secret: string;
  lastStatus: 'ok' | 'failed' | null;
  lastError: string | null;
  lastAt: number | null;
};
type EventInfo = { type: string; description: string };
type Delivery = { id: string; event: string; ok: boolean; status: number | null; error: string | null; attempts: number; durationMs: number; at: number };
type TestResult = { ok: boolean; status: number | null; error: string | null };

const ALL = '*';

export function Webhooks() {
  const list = useData(() => api<{ webhooks: Webhook[]; events: EventInfo[] }>('/webhooks'), []);
  const [adding, setAdding] = useState(false);
  const events = list.data?.events ?? [];

  return (
    <div className="space-y-4">
      {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Skeleton className="h-32" />}
      {list.data && list.data.webhooks.length === 0 && !adding && (
        <Card>
          <Empty icon={<Send />} title="No webhooks yet">
            Send chats, leads and callbacks to Zapier, Make, n8n, your CRM or your own server as they happen.
          </Empty>
        </Card>
      )}
      {list.data?.webhooks.map((hook) => <WebhookCard key={hook.id} hook={hook} events={events} onChanged={list.reload} />)}

      {adding ? (
        <Card>
          <WebhookForm
            events={events}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              list.reload();
            }}
          />
        </Card>
      ) : (
        list.data && (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Add webhook
          </Button>
        )
      )}

      <Card className="space-y-2 px-4 py-3 text-xs text-muted-foreground">
        <p className="text-[13px] font-medium text-foreground">Checking it came from us</p>
        <p>
          Every delivery is a JSON <code>POST</code> with <code>X-Murmur-Event</code>, <code>X-Murmur-Delivery</code>, <code>X-Murmur-Timestamp</code> and{' '}
          <code>X-Murmur-Signature</code>. The signature is <code>sha256=</code> + the hex HMAC-SHA256 of <code>timestamp + "." + body</code> with the webhook’s signing secret.
          Reject timestamps older than five minutes; use the body’s <code>id</code> to ignore a repeat.
        </p>
      </Card>
    </div>
  );
}

function EventPicker({ events, value, onChange }: { events: EventInfo[]; value: string[]; onChange: (events: string[]) => void }) {
  const all = value.includes(ALL);
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium">Events</legend>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="radio" name="scope" className="size-4 accent-[var(--primary)]" checked={all} onChange={() => onChange([ALL])} />
        All events, including ones added later
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="radio" name="scope" className="size-4 accent-[var(--primary)]" checked={!all} onChange={() => onChange(['lead.captured', 'callback.requested'])} />
        Only some
      </label>
      {!all && (
        <ul className="grid gap-1.5 pl-6 sm:grid-cols-2">
          {events.map((e) => (
            <li key={e.type}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 accent-[var(--primary)]"
                  checked={value.includes(e.type)}
                  onChange={(ev) => onChange(ev.target.checked ? [...value, e.type] : value.filter((v) => v !== e.type))}
                />
                <span>
                  <code className="text-xs">{e.type}</code>
                  <span className="block text-[11px] text-muted-foreground">{e.description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function WebhookForm({ events, initial, onSaved, onCancel }: { events: EventInfo[]; initial?: Webhook; onSaved: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [chosen, setChosen] = useState<string[]>(initial?.events ?? [ALL]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const json = { url, description, events: chosen };
      if (initial) await api(`/webhooks/${initial.id}`, { method: 'PATCH', json });
      else await api('/webhooks', { method: 'POST', json });
      onSaved();
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-3 px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">Endpoint URL</span>
        <Input type="url" required placeholder="https://hooks.zapier.com/hooks/catch/…" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">Description (optional)</span>
        <Input placeholder="e.g. New leads to HubSpot" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <EventPicker events={events} value={chosen} onChange={setChosen} />
      {error && <p className="text-xs text-danger" role="alert">{error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !url.trim() || !chosen.length}>
          {busy && <Loader2 className="animate-spin" />}
          {initial ? 'Save' : 'Add webhook'}
        </Button>
      </div>
    </form>
  );
}

function WebhookCard({ hook, events, onChanged }: { hook: Webhook; events: EventInfo[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const deliveries = useData(() => (open ? api<{ deliveries: Delivery[] }>(`/webhooks/${hook.id}/deliveries`) : Promise.resolve(null)), [open, test]);

  const patch = (json: Record<string, unknown>) =>
    api(`/webhooks/${hook.id}`, { method: 'PATCH', json })
      .then(onChanged)
      .catch((thrown: Error) => setError(thrown));
  const sendTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api<TestResult>(`/webhooks/${hook.id}/test`, { method: 'POST', json: {} }));
      onChanged();
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setTesting(false);
    }
  };

  if (editing) {
    return (
      <Card>
        <WebhookForm
          events={events}
          initial={hook}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      </Card>
    );
  }

  const all = hook.events.includes(ALL);
  return (
    <Card className={cn(!hook.enabled && 'opacity-70')}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px]" title={hook.url}>
            {hook.url}
          </p>
          {hook.description && <p className="mt-0.5 text-xs text-muted-foreground">{hook.description}</p>}
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {all ? (
              <Badge>All events</Badge>
            ) : (
              hook.events.map((e) => (
                <Badge key={e} className="font-mono font-normal">
                  {e}
                </Badge>
              ))
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={hook.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} />
          {hook.enabled ? 'On' : 'Off'}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground" role="status">
          {hook.lastAt ? (
            <>
              <span className={cn('size-1.5 rounded-full', hook.lastStatus === 'ok' ? 'bg-[#16a34a]' : 'bg-danger')} aria-hidden />
              {hook.lastStatus === 'ok' ? 'Delivered' : `Failed${hook.lastError ? `: ${hook.lastError}` : ''}`} {fmtRelative(hook.lastAt)}
            </>
          ) : (
            'Nothing sent yet'
          )}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void sendTest()} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : <Send />}
            Send test
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Delete webhook ${hook.url}`}
            onClick={() => {
              if (window.confirm('Delete this webhook? It stops receiving events at once.')) void api(`/webhooks/${hook.id}`, { method: 'DELETE' }).then(onChanged, (thrown: Error) => setError(thrown));
            }}
          >
            <Trash2 />
          </Button>
        </span>
      </div>
      {test && (
        <p className={cn('border-t px-4 py-2 text-xs', test.ok ? 'text-foreground' : 'text-danger')} role="status">
          {test.ok ? `Test delivered (HTTP ${test.status}).` : `Test failed: ${test.error ?? `HTTP ${test.status}`}.`}
        </p>
      )}
      {error && (
        <div className="border-t px-4 py-2">
          <ErrorNote error={error} />
        </div>
      )}

      <div className="flex items-center gap-2 border-t px-4 py-2.5 text-xs">
        <span className="font-medium">Signing secret</span>
        <code className="min-w-0 flex-1 truncate text-muted-foreground">{showSecret ? hook.secret : '•'.repeat(24)}</code>
        <Button variant="ghost" size="icon" className="size-7" aria-label={showSecret ? 'Hide secret' : 'Show secret'} onClick={() => setShowSecret(!showSecret)}>
          {showSecret ? <EyeOff /> : <Eye />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Copy secret"
          onClick={() =>
            void navigator.clipboard.writeText(hook.secret).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check /> : <Copy />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.confirm('Make a new secret? Deliveries are signed with it at once; update your receiver.')) void patch({ rotateSecret: true });
          }}
        >
          New secret
        </Button>
      </div>

      <div className="border-t">
        <button type="button" className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
          Recent deliveries
        </button>
        {open && (
          <div className="px-4 pb-3">
            {!deliveries.data && <Skeleton className="h-10" />}
            {deliveries.data?.deliveries.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
            {deliveries.data && deliveries.data.deliveries.length > 0 && (
              <table className="w-full text-xs">
                <tbody className="divide-y">
                  {deliveries.data.deliveries.map((d) => (
                    <tr key={d.id}>
                      <td className="py-1.5 pr-2">
                        <span className={cn('inline-block size-1.5 rounded-full', d.ok ? 'bg-[#16a34a]' : 'bg-danger')} aria-label={d.ok ? 'Delivered' : 'Failed'} />
                      </td>
                      <td className="py-1.5 pr-3 font-mono">{d.event}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{d.ok ? `HTTP ${d.status}` : (d.error ?? `HTTP ${d.status}`)}</td>
                      <td className="hidden py-1.5 pr-3 text-muted-foreground tabular-nums sm:table-cell">
                        {d.durationMs} ms{d.attempts > 1 ? ` · ${d.attempts} tries` : ''}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground">{fmtRelative(d.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
