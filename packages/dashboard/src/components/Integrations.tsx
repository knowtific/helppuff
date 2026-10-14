import { KeyRound, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type IntegrationView } from '../lib/api';
import { fmtRelative, useData } from '../lib/utils';
import { CopyBlock } from '../pages/Settings';
import { HelpNote } from './Shell';
import { Badge, Button, Card, CardHeader, Disclosure, ErrorNote, Input, PasswordInput, Skeleton } from './ui';

/**
 * Settings → Integrations: the site's keys for other services, each usable
 * by any feature (bookings today). Saved sealed, live at once, never shown
 * again; each has a check. Composio's calendar accounts are connected through
 * its own sign-in page and picked from a list, never typed.
 */

type Listed = { items: IntegrationView[]; help: Record<string, { name: string; key: string; help: string }> };
type Account = { id: string; toolkit: string; label: string; status: string };
const loadIntegrations = () => api<Listed>('/integrations');

const USED_BY: Record<IntegrationView['kind'], string> = {
  composio: 'Google Calendar and Outlook for bookings; later, CRMs.',
  calcom: 'Bookings: free times and appointments in Cal.com.',
  calendly: 'Bookings: free times and appointments in Calendly.',
};

type Check = { ok: boolean; detail: string } | null;

/** `result` lives in the card, so it survives the form moving into the fold once connected. */
function KeyForm({ item, help, onSaved, result, setResult, inset = false }: { item: IntegrationView; help: { key: string; help: string }; onSaved: () => void; result: Check; setResult: (result: Check) => void; inset?: boolean }) {
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(item.baseUrl ?? '');
  const [selfHosted, setSelfHosted] = useState(Boolean(item.baseUrl));
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<{ ok: boolean; detail: string }>) => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await work());
      onSaved();
    } catch (thrown) {
      setResult({ ok: false, detail: (thrown as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      const saved = await api<IntegrationView & { check: { ok: boolean; detail: string } }>(`/integrations/${item.kind}`, {
        method: 'PUT',
        json: { ...(key ? { key } : {}), ...(item.kind === 'calcom' ? { baseUrl: selfHosted ? baseUrl : null } : {}) },
      });
      setKey('');
      return saved.check;
    });
  return (
    <div className={inset ? 'space-y-3' : 'space-y-3 border-t p-4'}>
      <p className="text-xs text-muted-foreground">{help.help}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1 space-y-1">
          <label htmlFor={`integration-key-${item.kind}`} className="block text-xs font-medium text-muted-foreground">{help.key}</label>
          <PasswordInput id={`integration-key-${item.kind}`} visibilityLabel="key" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={item.connected ? 'Saved (hidden). Paste a new one to replace it.' : 'Paste it here'} />
        </div>
        <Button type="button" onClick={() => void save()} disabled={busy || (!key && !(item.kind === 'calcom' && item.connected))}>
          {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} {item.connected ? 'Save' : 'Connect'}
        </Button>
        {item.connected && (
          <Button type="button" variant="outline" onClick={() => void run(() => api(`/integrations/${item.kind}/test`, { method: 'POST', json: {} }))} disabled={busy}>
            Check
          </Button>
        )}
      </div>
      {item.kind === 'calcom' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={selfHosted} onChange={(e) => setSelfHosted(e.target.checked)} />
            Self-hosted Cal.com
          </label>
          {selfHosted && <Input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://cal.example.com/api/v2" aria-label="Your Cal.com API v2 address" />}
        </div>
      )}
      {result && (
        <p role="status" className={result.ok ? 'text-xs text-muted-foreground' : 'text-xs text-danger'}>
          {result.ok ? '✓ ' : ''}
          {result.detail}
        </p>
      )}
    </div>
  );
}

/** One key editor in both settings pages: shared save, check, disclosure and result states. */
function IntegrationKeyEditor({ item, help, onChanged, showForm, expanded = false, inline = false }: { item: IntegrationView; help: { key: string; help: string }; onChanged: () => void; showForm: boolean; expanded?: boolean; inline?: boolean }) {
  const [result, setResult] = useState<Check>(null);
  if (item.connected) return (
    <Disclosure summary={inline ? `Change ${item.name} key or check connection` : 'Key and check'} className={inline ? undefined : 'border-t px-4 py-3'} open={expanded || item.status === 'error'}>
      <KeyForm item={item} help={help} onSaved={onChanged} result={result} setResult={setResult} inset />
    </Disclosure>
  );
  return showForm && <KeyForm item={item} help={help} onSaved={onChanged} result={result} setResult={setResult} inset={inline} />;
}

function ComposioAccounts({ toolkit, onChanged, inline = false }: { toolkit?: 'google' | 'outlook'; onChanged?: () => void; inline?: boolean }) {
  const { data, error, reload } = useData(() => api<{ items: Account[] }>(`/integrations/composio/accounts${toolkit ? `?toolkit=${toolkit}` : ''}`), [toolkit]);
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<{ toolkit: 'google' | 'outlook'; url: string } | null>(null);
  const [waitingForConnect, setWaitingForConnect] = useState(false);
  const refresh = () => {
    reload();
    onChanged?.();
  };
  useEffect(() => {
    if (!waitingForConnect) return;
    const returned = () => {
      setWaitingForConnect(false);
      setManualLink(null);
      refresh();
    };
    window.addEventListener('focus', returned);
    return () => window.removeEventListener('focus', returned);
  }, [waitingForConnect, toolkit]);
  const connect = async (toolkit: 'google' | 'outlook') => {
    setOpening(toolkit);
    setProblem(null);
    setManualLink(null);
    // Opened first, filled after: browsers block a window opened after a wait.
    const tab = window.open('about:blank', '_blank');
    try {
      const { url } = await api<{ url: string }>('/integrations/composio/connect', { method: 'POST', json: { toolkit, returnUrl: `${location.origin}/admin/#/settings/${inline ? 'bookings' : 'integrations'}` } });
      if (tab) {
        tab.location.href = url;
        setWaitingForConnect(true);
      } else setManualLink({ toolkit, url });
    } catch (thrown) {
      tab?.close();
      setProblem((thrown as Error).message);
    } finally {
      setOpening(null);
    }
  };
  return (
    <div className={inline ? 'space-y-2 border-t pt-3' : 'space-y-2 border-t p-4'}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Connected accounts</p>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Refresh accounts" onClick={refresh}>
          <RefreshCw />
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error.message}</p>}
      {data && !data.items.length && <p className="text-xs text-muted-foreground">None yet.</p>}
      <ul className="space-y-1">
        {data?.items.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-[13px]">
            <span className="w-32 shrink-0 text-muted-foreground">{a.toolkit === 'googlecalendar' ? 'Google Calendar' : a.toolkit === 'outlook' ? 'Outlook' : a.toolkit}</span>
            <span className="min-w-0 flex-1 truncate">{a.label}</span>
            <Badge dot={a.status === 'ACTIVE' ? '#22c55e' : '#f59e0b'}>{a.status.toLowerCase()}</Badge>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        {(!toolkit || toolkit === 'google') && <Button variant="outline" size="sm" onClick={() => void connect('google')} disabled={opening !== null}>
          {opening === 'google' ? <Loader2 className="animate-spin" /> : <Plus />} Connect Google Calendar
        </Button>}
        {(!toolkit || toolkit === 'outlook') && <Button variant="outline" size="sm" onClick={() => void connect('outlook')} disabled={opening !== null}>
          {opening === 'outlook' ? <Loader2 className="animate-spin" /> : <Plus />} Connect Outlook
        </Button>}
      </div>
      {manualLink && (!toolkit || manualLink.toolkit === toolkit) && (
        <p role="status" className="text-xs text-muted-foreground">
          Sign-in did not open. <a href={manualLink.url} target="_blank" rel="noopener noreferrer" onClick={() => setWaitingForConnect(true)} className="font-medium text-foreground underline-offset-2 hover:underline">Open Composio sign-in</a> to continue in a new tab.
        </p>
      )}
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
    </div>
  );
}

function CalcomWebhook() {
  const { data } = useData(() => api<{ url: string; secret: string; triggers: string[] }>('/integrations/calcom/webhook'), []);
  if (!data) return null;
  return (
    <details className="border-t px-4 py-3 text-[13px]">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Instant updates from Cal.com (optional)</summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground">In Cal.com → Settings → Developer → Webhooks, add one with this address and secret, for {data.triggers.join(', ')}. Without it, changes show at the next sync.</p>
        <CopyBlock text={data.url} label="webhook address" />
        <CopyBlock text={data.secret} label="webhook secret" />
      </div>
    </details>
  );
}

export function Integrations() {
  const { data, error, reload } = useData(loadIntegrations, []);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      {data.items.map((item) => <IntegrationCard key={item.kind} item={item} help={data.help[item.kind]!} onChanged={reload} />)}
      <HelpNote page="Integrations" label="Learn more">
        Keys are stored encrypted and never shown again.
      </HelpNote>
    </div>
  );
}

/** Connect a calendar while choosing it in Bookings; the same sealed key and check as Integrations. */
export function BookingIntegration({ kind, toolkit, onChanged }: { kind: IntegrationView['kind']; toolkit?: 'google' | 'outlook'; onChanged: () => void }) {
  const { data, error, reload } = useData(loadIntegrations, []);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-24" />;
  const item = data.items.find((entry) => entry.kind === kind);
  const help = data.help[kind];
  if (!item || !help) return <p className="text-xs text-danger">This Worker cannot connect {kind === 'calcom' ? 'Cal.com' : kind === 'calendly' ? 'Calendly' : 'Composio'} yet. Check Settings → Updates.</p>;
  const saved = () => {
    reload();
    onChanged();
  };
  return (
    <div className="space-y-2 border-t pt-3">
      {!item.connected && <p className="text-xs font-medium">Connect {item.name}</p>}
      <IntegrationKeyEditor item={item} help={help} onChanged={saved} showForm inline />
      {!item.connected && <p className="text-xs text-muted-foreground">The key is saved when you connect. Save your booking choices below when ready.</p>}
      {item.kind === 'composio' && item.connected && <ComposioAccounts toolkit={toolkit} onChanged={onChanged} inline />}
    </div>
  );
}

/** One service: a row with Connect until it is connected; then its status, with the key folded away. */
function IntegrationCard({ item, help, onChanged }: { item: IntegrationView; help: { key: string; help: string }; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card role="region" aria-label={item.name}>
      <CardHeader
        title={item.name}
        description={USED_BY[item.kind]}
        action={
          <div className="flex items-center gap-2">
            {item.connected ? (
              <Badge dot={item.status === 'error' ? '#ef4444' : item.status === 'ok' ? '#22c55e' : '#a1a1aa'}>
                {item.status === 'error' ? 'Error' : 'Connected'}
                {item.lastAt ? ` · ${fmtRelative(item.lastAt)}` : ''}
              </Badge>
            ) : (
              <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? 'Cancel' : 'Connect'}
              </Button>
            )}
            {item.connected && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Remove ${item.name}`}
                onClick={() => {
                  if (window.confirm(`Remove ${item.name}? A calendar synced through it stops syncing; appointments stay.`)) void api(`/integrations/${item.kind}`, { method: 'DELETE' }).then(onChanged, onChanged);
                }}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        }
      />
      {item.status === 'error' && item.lastError && <p className="border-t bg-danger/5 px-4 py-1.5 text-xs text-danger">{item.lastError}</p>}
      {(item.account || item.plan) && (
        <p className="border-t px-4 py-1.5 text-xs text-muted-foreground">
          {item.account}
          {item.plan ? ` · ${item.plan} plan${item.plan === 'free' ? ': visitors finish booking on Calendly’s page, and it is read back' : ''}` : ''}
        </p>
      )}
      <IntegrationKeyEditor item={item} help={help} onChanged={onChanged} showForm={open} expanded={open} />
      {item.kind === 'composio' && item.connected && <ComposioAccounts />}
      {item.kind === 'calcom' && item.connected && <CalcomWebhook />}
    </Card>
  );
}
