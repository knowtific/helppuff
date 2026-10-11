import { ExternalLink, KeyRound, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type IntegrationView } from '../lib/api';
import { fmtRelative, useData } from '../lib/utils';
import { CopyBlock } from '../pages/Settings';
import { Badge, Button, Card, CardHeader, ErrorNote, Input, Skeleton } from './ui';

/**
 * Settings → Integrations: the site's keys for other services, each usable
 * by any feature (bookings today). Saved sealed, live at once, never shown
 * again; each has a check. Composio's calendar accounts are connected through
 * its own sign-in page and picked from a list, never typed.
 */

type Listed = { items: IntegrationView[]; help: Record<string, { name: string; key: string; help: string }> };
type Account = { id: string; toolkit: string; label: string; status: string };

const USED_BY: Record<IntegrationView['kind'], string> = {
  composio: 'Google Calendar and Outlook for bookings; later, CRMs.',
  calcom: 'Bookings: free times and appointments in Cal.com.',
  calendly: 'Bookings: free times and appointments in Calendly.',
};

function KeyForm({ item, help, onSaved }: { item: IntegrationView; help: { key: string; help: string }; onSaved: () => void }) {
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(item.baseUrl ?? '');
  const [selfHosted, setSelfHosted] = useState(Boolean(item.baseUrl));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
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
    <div className="space-y-3 border-t p-4">
      <p className="text-xs text-muted-foreground">{help.help}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-64 flex-1 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{help.key}</span>
          <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={item.connected ? 'Saved (hidden). Paste a new one to replace it.' : 'Paste it here'} />
        </label>
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

function ComposioAccounts() {
  const { data, error, reload } = useData(() => api<{ items: Account[] }>('/integrations/composio/accounts'), []);
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const connect = async (toolkit: 'google' | 'outlook') => {
    setOpening(toolkit);
    setProblem(null);
    // Opened first, filled after: browsers block a window opened after a wait.
    const tab = window.open('about:blank', '_blank');
    try {
      const { url } = await api<{ url: string }>('/integrations/composio/connect', { method: 'POST', json: { toolkit, returnUrl: `${location.origin}/admin/#/settings/integrations` } });
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (thrown) {
      tab?.close();
      setProblem((thrown as Error).message);
    } finally {
      setOpening(null);
    }
  };
  return (
    <div className="space-y-2 border-t p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Connected accounts</p>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Refresh accounts" onClick={reload}>
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
        <Button variant="outline" size="sm" onClick={() => void connect('google')} disabled={opening !== null}>
          {opening === 'google' ? <Loader2 className="animate-spin" /> : <Plus />} Connect Google Calendar
        </Button>
        <Button variant="outline" size="sm" onClick={() => void connect('outlook')} disabled={opening !== null}>
          {opening === 'outlook' ? <Loader2 className="animate-spin" /> : <Plus />} Connect Outlook
        </Button>
      </div>
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
  const { data, error, reload } = useData(() => api<Listed>('/integrations'), []);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      {data.items.map((item) => (
        <Card key={item.kind} role="region" aria-label={item.name}>
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
                  <Badge>Not connected</Badge>
                )}
                {item.connected && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${item.name}? A calendar synced through it stops syncing; appointments stay.`)) void api(`/integrations/${item.kind}`, { method: 'DELETE' }).then(reload, reload);
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
          <KeyForm item={item} help={data.help[item.kind]!} onSaved={reload} />
          {item.kind === 'composio' && item.connected && <ComposioAccounts />}
          {item.kind === 'calcom' && item.connected && <CalcomWebhook />}
        </Card>
      ))}
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        Keys are stored encrypted with your Worker’s secret and never shown again.
        <a className="inline-flex items-center gap-1 underline-offset-2 hover:underline" href="https://github.com/knowtific/helppuff/wiki/Integrations" target="_blank" rel="noreferrer">
          Learn more <ExternalLink className="size-3" />
        </a>
      </p>
    </div>
  );
}
