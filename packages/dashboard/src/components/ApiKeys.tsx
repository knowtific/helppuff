import { Check, Copy, KeyRound, Loader2, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { fmtRelative, useData } from '../lib/utils';
import { CopyBlock } from '../pages/Settings';
import { HelpLink } from './Shell';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Input, Select, Skeleton } from './ui';

/**
 * Settings → API keys: keys for the public API (`/api/v1`). A key works on
 * this site only, with the scopes it is given; the full key is shown once.
 * The same API as `helppuff keys`.
 */

type Key = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  allowIps: string[];
  ratePerMinute: number;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
};
type Listed = { keys: Key[]; scopes: { scope: string; description: string }[]; presets: { id: string; label: string; scopes: string[] }[] };

const EXPIRY = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: '', label: 'Never' },
];

export function ApiKeys() {
  const list = useData(() => api<Listed>('/keys'), []);
  const [creating, setCreating] = useState(false);
  const [made, setMade] = useState<(Key & { key: string }) | null>(null);
  const base = `${window.location.origin}/api/v1`;

  return (
    <div className="space-y-4">
      {made && <ShownOnce made={made} onDone={() => setMade(null)} />}
      {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Skeleton className="h-32" />}

      {list.data && (
        <Card>
          <CardHeader
            title="API keys"
            description="Use HelpPuff from your own servers: chat, leads, callbacks, knowledge, settings. Keys belong on a server, never in a web page."
            action={
              !creating && (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus /> New key
                </Button>
              )
            }
          />
          {creating && (
            <CreateKey
              listed={list.data}
              onCancel={() => setCreating(false)}
              onMade={(key) => {
                setCreating(false);
                setMade(key);
                list.reload();
              }}
            />
          )}
          {list.data.keys.length === 0 && !creating ? (
            <Empty icon={<KeyRound />} title="No API keys yet">
              Make one to start a conversation from your app, sync leads to your CRM, or manage everything with scripts.
            </Empty>
          ) : (
            <ul className="divide-y border-t">
              {list.data.keys.map((key) => (
                <KeyRow key={key.id} item={key} onRevoked={list.reload} />
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Use it" description="Every request sends the key as a Bearer token." action={<HelpLink page="API" />} />
        <div className="space-y-3 border-t px-4 py-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Base URL</p>
            <CopyBlock text={base} label="base URL" />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Start a conversation</p>
            <CopyBlock
              text={`curl -X POST "${base}/conversations" \\\n  -H "Authorization: Bearer $HELPPUFF_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Do you work weekends?"}'`}
              label="example"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Every endpoint, with examples: <HelpLink page="API-Reference" label="API reference" className="align-middle" /> · machine-readable: <code className="rounded bg-muted px-1">{base}/openapi.json</code>
          </p>
        </div>
      </Card>
    </div>
  );
}

function KeyRow({ item, onRevoked }: { item: Key; onRevoked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const expired = item.expiresAt !== null && item.expiresAt < Date.now();
  const state = item.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Active';
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{item.name}</span>
          <Badge dot={state === 'Active' ? '#16a34a' : '#a1a1aa'}>{state}</Badge>
        </div>
        <p className="font-mono text-xs text-muted-foreground">{item.prefix}…</p>
        <p className="text-xs text-muted-foreground">
          {item.scopes.join(', ')} · {item.ratePerMinute}/min{item.allowIps.length ? ` · from ${item.allowIps.join(', ')}` : ''}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Made {fmtRelative(item.createdAt)}
          {item.createdBy ? ` by ${item.createdBy}` : ''} · {item.lastUsedAt ? `last used ${fmtRelative(item.lastUsedAt)}` : 'never used'} ·{' '}
          {item.expiresAt ? `${expired ? 'expired' : 'expires'} ${new Date(item.expiresAt).toLocaleDateString()}` : 'never expires'}
        </p>
        {error && <p className="text-xs text-danger" role="alert">{error.message}</p>}
      </div>
      {!item.revokedAt && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Revoke “${item.name}”? Anything using it stops working within 30 seconds.`)) return;
            setBusy(true);
            api(`/keys/${item.id}`, { method: 'DELETE' }).then(onRevoked, (thrown: Error) => setError(thrown)).finally(() => setBusy(false));
          }}
        >
          {busy && <Loader2 className="animate-spin" />}
          Revoke
        </Button>
      )}
    </li>
  );
}

function CreateKey({ listed, onCancel, onMade }: { listed: Listed; onCancel: () => void; onMade: (key: Key & { key: string }) => void }) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<string>('chat');
  const [custom, setCustom] = useState<string[]>([]);
  const [expires, setExpires] = useState('365');
  const [allowIps, setAllowIps] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const scopes = preset === 'custom' ? custom : (listed.presets.find((p) => p.id === preset)?.scopes ?? []);
  const powerful = scopes.some((s) => s === 'team:write' || s === 'keys:write');

  const submit = () => {
    setBusy(true);
    setError(null);
    api<Key & { key: string }>('/keys', {
      method: 'POST',
      json: {
        name,
        ...(preset === 'custom' ? { scopes: custom } : { preset }),
        ...(expires ? { expiresInDays: Number(expires) } : {}),
        ...(allowIps.trim() ? { allowIps: allowIps.split(/[\s,]+/).filter(Boolean) } : {}),
      },
    }).then(onMade, (thrown: Error) => setError(thrown)).finally(() => setBusy(false));
  };

  return (
    <form
      className="space-y-3 border-t px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Name</span>
          <Input required maxLength={100} placeholder="Website backend" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Expires</span>
          <Select className="w-full" value={expires} onChange={(e) => setExpires(e.target.value)}>
            {EXPIRY.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">What it may do</legend>
        <div className="flex flex-wrap gap-2">
          {[...listed.presets, { id: 'custom', label: 'Choose…', scopes: [] }].map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs has-[:checked]:border-foreground">
              <input type="radio" name="preset" value={p.id} checked={preset === p.id} onChange={() => setPreset(p.id)} className="accent-[var(--primary)]" />
              {p.label}
            </label>
          ))}
        </div>
        {preset === 'custom' ? (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {listed.scopes.map((s) => (
              <label key={s.scope} className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--primary)]"
                  checked={custom.includes(s.scope)}
                  onChange={(e) => setCustom(e.target.checked ? [...custom, s.scope] : custom.filter((x) => x !== s.scope))}
                />
                <span>
                  <code>{s.scope}</code> <span className="text-muted-foreground">{s.description}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">{scopes.join(', ')}</p>
        )}
        {powerful && (
          <p className="flex items-center gap-1.5 text-[11px] text-[#d97706]">
            <TriangleAlert className="size-3.5" aria-hidden /> This key can give access to others (team or keys): treat it like a password to this dashboard.
          </p>
        )}
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">Only from these IP addresses (optional)</span>
        <Input placeholder="203.0.113.7, 198.51.100.0/24" value={allowIps} onChange={(e) => setAllowIps(e.target.value)} />
      </label>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim() || !scopes.length}>
          {busy && <Loader2 className="animate-spin" />}
          Create key
        </Button>
      </div>
    </form>
  );
}

/** The one time the full key is visible. */
function ShownOnce({ made, onDone }: { made: Key & { key: string }; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="border-[#16a34a]/50">
      <div className="space-y-3 px-4 py-4" role="status">
        <p className="text-[13px] font-medium">“{made.name}” is ready</p>
        <div className="flex items-start gap-2 rounded-md border bg-subtle p-2 pl-3">
          <code className="min-w-0 flex-1 break-all py-1 text-xs">{made.key}</code>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Copy the key"
            onClick={() => {
              void navigator.clipboard.writeText(made.key).then(() => setCopied(true));
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Copy it now and keep it in your server’s secrets: it is shown once and cannot be recovered. Lost it? Revoke it and make another.</p>
        <div className="flex justify-end">
          <Button size="sm" onClick={onDone}>
            I’ve saved it
          </Button>
        </div>
      </div>
    </Card>
  );
}
