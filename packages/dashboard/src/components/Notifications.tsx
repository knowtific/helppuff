import { Check, Loader2, Mail, Pause, Play, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EMAIL_PRESETS } from '@helppuff/protocol/notifications';
import { api, type EmailService, type NotificationsInfo, type Prefs } from '../lib/api';
import { cn, fmtRelative, useData } from '../lib/utils';
import { RequestEditor, type RequestDraft } from './RequestFields';
import { HelpLink, WikiLink } from './Shell';
import { AskAgent, CopyBlock } from '../pages/Settings';
import { Badge, Button, Card, CardHeader, ErrorNote, Input, PasswordInput, Select, Skeleton } from './ui';
import { confirmDelete } from '../lib/confirm';

/**
 * Settings → Notifications, the email part. Everyone picks the emails they
 * get; admins connect the email service once, for any provider with a send
 * API (`/notifications/email`). The same API as `helppuff email`.
 */

const VALUES = 'HelpPuff fills in {{email.to}} (one person per email), {{email.subject}}, {{email.text}} and {{email.html}} (the same text, escaped).';

/** "Email me when…": this person's own choice. */
export function EmailChoices({ admin }: { admin: boolean }) {
  const info = useData(() => api<NotificationsInfo>('/notifications'), []);
  const prefs = useData(() => api<Prefs>('/prefs'), []);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (prefs.data) setChosen(prefs.data.emails ?? []);
  }, [prefs.data]);
  if (info.error) return <ErrorNote error={info.error} onRetry={info.reload} />;
  if (prefs.error) return <ErrorNote error={prefs.error} onRetry={prefs.reload} />;
  if (!info.data || !chosen) return <Skeleton className="h-48" />;
  const toggle = async (type: string, on: boolean) => {
    const next = on ? [...chosen, type] : chosen.filter((t) => t !== type);
    setChosen(next);
    setSaved(false);
    setError(null);
    try {
      const result = await api<Prefs>('/prefs', { method: 'PUT', json: { emails: next } });
      setChosen(result.emails);
      setSaved(true);
    } catch (thrown) {
      setChosen(chosen);
      setError(thrown as Error);
    }
  };
  const { email, choices } = info.data;
  return (
    <Card>
      <CardHeader
        title="Email me when"
        tip={{ label: 'About email notifications', text: 'Only you get these: everyone on the team chooses their own. Each email links to the conversation, job or booking.' }}
        action={saved ? <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status"><Check className="size-3.5" /> Saved</span> : undefined}
      />
      {!email.configured && (
        <p role="note" className="mx-4 mb-3 rounded-md border bg-subtle px-3 py-2 text-xs text-muted-foreground">
          {admin ? 'No email is sent until you connect your email service below. You can choose now.' : 'An admin has not connected an email service yet. You can choose now: emails start once they do.'}
        </p>
      )}
      {email.configured && !email.enabled && (
        <p role="note" className="mx-4 mb-3 rounded-md border bg-subtle px-3 py-2 text-xs text-muted-foreground">
          Emails are paused for everyone{admin ? ': resume them below.' : ' by an admin.'}
        </p>
      )}
      <fieldset className="divide-y border-t">
        <legend className="sr-only">Emails you get</legend>
        {choices.map((choice) => (
          <label key={choice.type} className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-muted/40">
            <input type="checkbox" className="mt-0.5 accent-[var(--primary)]" checked={chosen.includes(choice.type)} onChange={(e) => void toggle(choice.type, e.target.checked)} />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{choice.label}</span>
              <span className="block text-xs text-muted-foreground">{choice.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <div className="border-t px-4 py-2">
          <ErrorNote error={error} />
        </div>
      )}
    </Card>
  );
}

type Draft = { preset: string; from: string; key: string; advanced: boolean; request: RequestDraft };

const blank = (): RequestDraft => ({ method: 'POST', url: '', headers: [{ name: 'Content-Type', value: 'application/json', secret: false }], body: '{\n  "to": "{{email.to}}",\n  "subject": "{{email.subject}}",\n  "text": "{{email.text}}"\n}' });

function fromPreset(preset: string, from: string, key: string): RequestDraft {
  const found = EMAIL_PRESETS.find((p) => p.id === preset);
  if (!found) return blank();
  const request = found.request(from || 'you@yourdomain.com', key);
  // No key typed: the secret header goes empty, which keeps the stored one.
  return key ? request : { ...request, headers: request.headers.map((h) => (h.secret ? { ...h, value: '', set: true } : h)) };
}

/** Admins: the one request that sends everyone's emails. */
export function EmailServiceCard() {
  const { data, error, loading, reload } = useData(() => api<{ service: EmailService | null; cloudflare?: boolean }>('/notifications/email'), []);
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton className="h-40" />;
  const service = data?.service ?? null;
  return (
    <Card>
      <CardHeader
        title="Email service"
        tip={{ label: 'About the email service', text: 'Bring the email service you use: HelpPuff sends each email through its API, with your key. Resend, Postmark, SendGrid and Brevo are filled in for you; any other service works with its own request.' }}
        action={service && !editing ? <ServiceState service={service} /> : undefined}
      />
      <div className="border-t px-4 py-3">
        {service && !editing ? (
          <ServiceSummary service={service} onEdit={() => setEditing(true)} onChanged={reload} />
        ) : (
          <ServiceForm
            service={service}
            cloudflare={Boolean(data?.cloudflare)}
            onSaved={() => {
              setEditing(false);
              reload();
            }}
            onCancel={service ? () => setEditing(false) : undefined}
          />
        )}
      </div>
    </Card>
  );
}

function ServiceState({ service }: { service: EmailService }) {
  if (!service.enabled) return <Badge>Paused</Badge>;
  if (service.lastStatus === 'failed') return <Badge dot="#dc2626">Failing</Badge>;
  return <Badge dot="#16a34a">On</Badge>;
}

function ServiceSummary({ service, onEdit, onChanged }: { service: EmailService; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; status: number | null; error: string | null; to: string } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const run = async (what: string, work: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await work();
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3">
      {service.kind === 'cloudflare' ? (
        <p className="flex items-center gap-2 text-[13px]">
          <Mail className="size-4 text-muted-foreground" aria-hidden />
          Cloudflare Email Service, from <span className="font-mono text-xs">{service.from}</span>
        </p>
      ) : (
        <p className="flex items-center gap-2 text-[13px]">
          <Mail className="size-4 text-muted-foreground" aria-hidden />
          <span className="font-mono text-xs">{service.method}</span>
          <span className="min-w-0 truncate font-mono text-xs" title={service.url}>
            {service.url}
          </span>
        </p>
      )}
      {service.lastAt && (
        <p className={cn('text-xs', service.lastStatus === 'failed' ? 'text-danger' : 'text-muted-foreground')}>
          Last email {fmtRelative(service.lastAt)}: {service.lastStatus === 'failed' ? `failed (${service.lastError ?? 'no answer'})` : 'sent'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run('test', async () => setResult(await api('/notifications/email/test', { method: 'POST', json: {} })))}>
          {busy === 'test' ? <Loader2 className="animate-spin" /> : <Send />} Send me a test
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => void run('pause', async () => {
            await api('/notifications/email', { method: 'PUT', json: { enabled: !service.enabled } });
            onChanged();
          })}
        >
          {service.enabled ? <Pause /> : <Play />} {service.enabled ? 'Pause emails' : 'Resume emails'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => confirmDelete('Remove the email service?', 'Nobody gets notification emails until you set one up again.') && void run('remove', async () => {
            await api('/notifications/email', { method: 'DELETE' });
            onChanged();
          })}
        >
          <Trash2 /> Remove
        </Button>
      </div>
      {result && (
        <p role="status" className={cn('text-xs', result.ok ? 'text-foreground' : 'text-danger')}>
          {result.ok ? `Sent to ${result.to}. Check that inbox (and its spam folder).` : `The service said no: ${result.error ?? `HTTP ${result.status}`}. Check the key and that the sender’s domain is verified.`}
        </p>
      )}
      {error && <ErrorNote error={error} />}
    </div>
  );
}

function ServiceForm({ service, cloudflare, onSaved, onCancel }: { service: EmailService | null; cloudflare: boolean; onSaved: () => void; onCancel: (() => void) | undefined }) {
  const [draft, setDraft] = useState<Draft>(() =>
    service?.kind === 'cloudflare'
      ? { preset: 'cloudflare', from: service.from ?? '', key: '', advanced: false, request: blank() }
      : service
      ? // The saved request as it is; named after the service it calls, when it is a known one.
        { preset: EMAIL_PRESETS.find((p) => p.request('', '').url === service.url)?.id ?? 'custom', from: '', key: '', advanced: true, request: { method: service.method, url: service.url, headers: service.headers, body: service.body } }
      : { preset: 'resend', from: '', key: '', advanced: false, request: fromPreset('resend', '', '') },
  );
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tested, setTested] = useState<{ ok: boolean; status: number | null; error: string | null; to: string } | null>(null);
  const preset = EMAIL_PRESETS.find((p) => p.id === draft.preset);
  const request = draft.advanced || !preset ? draft.request : fromPreset(draft.preset, draft.from, draft.key);
  const viaCloudflare = draft.preset === 'cloudflare';
  const payload = () =>
    viaCloudflare ? { kind: 'cloudflare', from: draft.from.trim() } : { kind: 'request', method: request.method, url: request.url, headers: request.headers.filter((h) => h.name.trim()).map(({ name, value, secret }) => ({ name, value, secret })), body: request.body };
  const ready = viaCloudflare ? cloudflare && Boolean(draft.from.trim()) : preset && !draft.advanced ? Boolean(draft.from.trim() && (draft.key.trim() || service)) : Boolean(request.url.trim());
  const go = async (what: 'save' | 'test') => {
    setBusy(what);
    setError(null);
    setTested(null);
    try {
      // Cloudflare has nothing to try unsaved: it is tested once saved.
      if (what === 'test') setTested(await api('/notifications/email/test', { method: 'POST', json: viaCloudflare ? {} : payload() }));
      else {
        await api('/notifications/email', { method: 'PUT', json: payload() });
        onSaved();
      }
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(null);
    }
  };
  const choose = (id: string) => setDraft({ ...draft, preset: id, advanced: id === 'custom', request: id === 'custom' ? (service ? draft.request : blank()) : id === 'cloudflare' ? blank() : fromPreset(id, draft.from, draft.key) });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void go('save');
      }}
    >
      <label className="block space-y-1.5">
        <span className="block text-xs font-medium">Service</span>
        <Select value={draft.preset} onChange={(e) => choose(e.target.value)} className="max-w-xs">
          {EMAIL_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="cloudflare">Cloudflare Email Service</option>
          <option value="custom">Another service (any send API)</option>
        </Select>
      </label>
      {viaCloudflare && <CloudflarePanel ready={cloudflare} from={draft.from} onFrom={(from) => setDraft({ ...draft, from })} />}
      {preset && !draft.advanced && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="block text-xs font-medium">Send from</span>
            <Input type="email" placeholder="assistant@yourdomain.com" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} autoComplete="off" />
            <span className="block text-xs text-muted-foreground">An address on a domain you verified in {preset.name}.</span>
          </label>
          <div className="space-y-1.5">
            <label htmlFor="email-service-key" className="block text-xs font-medium">{preset.key.label}</label>
            <PasswordInput id="email-service-key" visibilityLabel="key" placeholder={service ? 'Stored: leave empty to keep it' : ''} value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} autoComplete="off" />
            <span className="block text-xs text-muted-foreground">Stored encrypted and never shown again.</span>
          </div>
        </div>
      )}
      {preset && (
        <p className="text-xs text-muted-foreground">
          {draft.advanced ? 'Change anything: HelpPuff sends exactly this.' : 'HelpPuff writes the request for you.'}{' '}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setDraft({ ...draft, advanced: !draft.advanced, request })}>
            {draft.advanced ? 'Use the simple form' : 'Edit the request'}
          </button>{' '}
          ·{' '}
          <a href={preset.docs} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            {preset.name}’s docs
          </a>
        </p>
      )}
      {!viaCloudflare && (draft.advanced || !preset) && <RequestEditor id="email-service" value={draft.request} onChange={(next) => setDraft({ ...draft, request: next })} values={VALUES} />}
      {!preset && !viaCloudflare && (
        <p className="text-xs text-muted-foreground">
          Look up your service’s “send an email” API, and put its key in a secret header. <WikiLink page="Email-Notifications" className="underline underline-offset-2">How it works</WikiLink>
        </p>
      )}
      {error && <ErrorNote error={error} />}
      {tested && (
        <p role="status" className={cn('text-xs', tested.ok ? 'text-foreground' : 'text-danger')}>
          {tested.ok ? `Sent to ${tested.to}: check that inbox (and its spam folder).` : `The service said no: ${tested.error ?? `HTTP ${tested.status}`}.`}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="button" variant="outline" disabled={!ready || busy !== null || (viaCloudflare && service?.kind !== 'cloudflare')} onClick={() => void go('test')}>
          {busy === 'test' ? <Loader2 className="animate-spin" /> : <Send />} Send me a test
        </Button>
        <Button type="submit" disabled={!ready || busy !== null}>
          {busy === 'save' && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}

const CLOUDFLARE_REQUEST = 'Set up HelpPuff to send email with Cloudflare Email Service. Check my domain is on Cloudflare, pick a sending address with me (a subdomain like chat.mydomain.com is safest), run helppuff email set --cloudflare --from that address, then send me a test and tell me what happened.';

/**
 * Cloudflare Email Service: the Worker's binding, no key. It needs a deploy
 * with the binding and a domain onboarded for sending, which the CLI does;
 * until then, the steps instead of a form.
 */
function CloudflarePanel({ ready, from, onFrom }: { ready: boolean; from: string; onFrom: (from: string) => void }) {
  if (ready) {
    return (
      <label className="block space-y-1.5">
        <span className="block text-xs font-medium">Send from</span>
        <Input type="email" placeholder="hello@chat.yourdomain.com" value={from} onChange={(e) => onFrom(e.target.value)} autoComplete="off" className="max-w-sm" />
        <span className="block text-xs text-muted-foreground">On a domain onboarded for sending in Cloudflare. Emailing customers needs Workers Paid.</span>
      </label>
    );
  }
  return (
    <div className="space-y-2 rounded-md border bg-subtle px-3 py-3 text-xs">
      <p className="font-medium">Set it up from your project folder</p>
      <p className="text-muted-foreground">Your domain must be on Cloudflare, in this account. The CLI onboards it for sending and deploys the binding.</p>
      <CopyBlock text="npx @knowtific/helppuff email set --cloudflare --from hello@chat.yourdomain.com" label="command" />
      <div className="flex flex-wrap items-center gap-3">
        <AskAgent request={CLOUDFLARE_REQUEST} />
        <HelpLink page="Email-Notifications#cloudflare-email-service" />
      </div>
    </div>
  );
}
