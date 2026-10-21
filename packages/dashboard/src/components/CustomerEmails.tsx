import { Check, Eye, Loader2, Mail, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api, type CustomerEmailsSettings, type CustomerEmailsStatus, type CustomerEmailLogRow } from '../lib/api';
import { cn, fmtRelative, href, useData } from '../lib/utils';
import { HelpLink } from './Shell';
import { AskAgent, CopyBlock } from '../pages/Settings';
import { Badge, Button, Card, CardHeader, ErrorNote, Skeleton } from './ui';

/**
 * Settings → Customer emails: three switches, each off by default, in the
 * order the owner thinks of them (B, C, A). While one cannot work yet, its
 * card says what is missing instead of offering the switch: what the
 * dashboard can do itself is a button, the rest a CLI command or a request
 * for the owner's AI agent. Explanations live in the wiki (Customer-Emails).
 */

const AGENT = {
  replies: 'Set up HelpPuff so customers who left the website get my team’s replies by email. Check live chat is on and my email service works (helppuff email show, helppuff live), explain what customers will get, turn on customerEmails.replies, then test it with me.',
  inbound:
    'Set up HelpPuff so customers can answer by email. Check my domain is on Cloudflare (helppuff email replies status), suggest a subdomain for replies, explain what it changes, run helppuff email replies on, send a test and tell me what happened.',
  copy: 'Explain HelpPuff’s “send a copy of the conversation” email to me, including the risk of someone typing another person’s address, and turn it on only if I agree (customerEmails.copy).',
};

const COPY_RISK =
  'Anyone can type someone else’s email address into the chat form. With this on, that person gets a copy of a conversation they never had, including whatever was typed in it, sent from your email service. Your sending reputation can suffer if it is misused. The daily limits keep it small, and every email has an unsubscribe link.';

const KINDS: Record<string, string> = { copy: 'Copy', reply: 'Reply', test: 'Test', inbound: 'Answer by email', 'inbound-test': 'Test arrived' };

function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn('relative h-5 w-9 shrink-0 rounded-full border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50', on ? 'bg-primary' : 'bg-muted-foreground/30')}
    >
      <span className={cn('absolute top-px left-px size-4 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none', on ? 'translate-x-4' : 'translate-x-0')} />
    </button>
  );
}

type Item = { ok: boolean; label: ReactNode; fix?: ReactNode };

function Checklist({ items, children }: { items: Item[]; children?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border bg-subtle px-3 py-3 text-xs">
      <p className="font-medium">Before you turn this on</p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            {item.ok ? <Check className="mt-px size-3.5 shrink-0 text-[#16a34a]" aria-label="Done" /> : <X className="mt-px size-3.5 shrink-0 text-danger" aria-label="Missing" />}
            <span className="min-w-0 flex-1">
              {item.label}
              {!item.ok && item.fix && <span className="mt-1 block text-muted-foreground">{item.fix}</span>}
            </span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

function Preview({ kind }: { kind: 'copy' | 'reply' }) {
  const [open, setOpen] = useState(false);
  const { data, error } = useData(() => (open ? api<{ subject: string; text: string }>(`/customer-emails/preview?kind=${kind}`) : Promise.resolve(null)), [open, kind]);
  return (
    <div>
      <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Eye className="size-3.5" aria-hidden /> {open ? 'Hide the preview' : 'What the customer sees'}
      </button>
      {open && (
        <div className="mt-2 rounded-md border bg-card px-3 py-2 text-xs">
          {error ? <ErrorNote error={error} /> : !data ? <Skeleton className="h-16" /> : (
            <>
              <p className="font-medium">{data.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{data.text}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SwitchCard({
  title,
  description,
  on,
  ready,
  saving,
  onChange,
  children,
}: {
  title: string;
  description: string;
  on: boolean;
  ready: boolean;
  saving: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={
          <span className="flex items-center gap-2">
            {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
            {/* Off is always allowed; on only once it can work. */}
            <Switch on={on} disabled={saving || (!on && !ready)} label={title} onChange={onChange} />
          </span>
        }
      />
      <div className="space-y-3 border-t px-4 py-3">{children}</div>
    </Card>
  );
}

export function CustomerEmails() {
  const status = useData(() => api<CustomerEmailsStatus>('/customer-emails/status'), []);
  const log = useData(() => api<{ emails: CustomerEmailLogRow[] }>('/customer-emails/log?limit=20'), []);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [added, setAdded] = useState(false);
  if (status.error) return <ErrorNote error={status.error} onRetry={status.reload} />;
  if (!status.data) return <Skeleton className="h-96" />;
  const s = status.data;
  const settings = s.settings;

  const save = async (key: 'copy' | 'replies' | 'inbound', on: boolean) => {
    if (key === 'copy' && on && !window.confirm(`${COPY_RISK}\n\nTurn on copies of conversations?`)) return;
    setSaving(key);
    setError(null);
    try {
      const patch: Partial<Record<keyof CustomerEmailsSettings, { enabled: boolean }>> = { [key]: { enabled: on } };
      await api('/settings', { method: 'PUT', json: { settings: { customerEmails: patch } } });
      status.reload();
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setSaving(null);
    }
  };
  const addReplyTo = async () => {
    setSaving('reply-to');
    setError(null);
    try {
      await api('/customer-emails/reply-to', { method: 'POST', json: {} });
      setAdded(true);
      status.reload();
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setSaving(null);
    }
  };

  const notifications = <a href={href({ page: 'settings', id: 'notifications' })} className="underline underline-offset-2 hover:text-foreground">Settings → Notifications</a>;
  const service: Item = {
    ok: Boolean(s.service?.enabled),
    label: s.service ? `An email service is connected (${s.service.name ?? 'your request'})${s.service.enabled ? '' : ': paused'}` : 'An email service is connected',
    fix: <>Connect one in {notifications}, or from your project folder: <code>helppuff email set …</code></>,
  };
  const live: Item = { ok: s.live, label: 'Live chat is on: the team replies there', fix: <>Turn it on in <a href={href({ page: 'settings', id: 'live' })} className="underline underline-offset-2 hover:text-foreground">Settings → Live chat</a>.</> };
  const replyTo: Item = {
    ok: Boolean(s.service?.sendsReplyTo),
    label: 'Its request sends a reply-to address',
    fix: s.service?.canAddReplyTo ? (
      <Button variant="outline" size="sm" disabled={saving !== null} onClick={() => void addReplyTo()}>
        {saving === 'reply-to' && <Loader2 className="animate-spin" />} Add it for me
      </Button>
    ) : (
      <>Add <code>{'{{email.replyTo}}'}</code> where your service takes a reply-to address, in {notifications}.</>
    ),
  };
  const address: Item = {
    ok: Boolean(s.inbound.domain),
    label: s.inbound.domain ? `Replies are received at ${s.inbound.domain}` : 'Replies are received at a subdomain you own',
    fix: 'Your domain must be on Cloudflare DNS, in this account.',
  };
  const arrived: Item = { ok: Boolean(s.inbound.verifiedAt), label: s.inbound.verifiedAt ? `A test arrived ${fmtRelative(s.inbound.verifiedAt)}` : 'A test email has arrived', fix: <>Run <code>helppuff email replies test</code> from your project folder.</> };

  return (
    <div className="space-y-4">
      {error && <ErrorNote error={error} />}
      {added && <p role="status" className="px-1 text-xs text-muted-foreground">Added to your email service’s request.</p>}

      <SwitchCard
        title="Email the team’s replies when the customer has left"
        description="A reply from your team they would otherwise never see, with a link to continue the chat."
        on={settings.replies.enabled}
        ready={s.ready.replies}
        saving={saving === 'replies'}
        onChange={(on) => void save('replies', on)}
      >
        <p className="text-xs text-muted-foreground">
          Sent {s.delaySeconds ? `${Math.round(s.delaySeconds / 60) || 1} minute${Math.round(s.delaySeconds / 60) > 1 ? 's' : ''}` : 'right'} after a reply, only if they are not on the site by then. Several replies are one email.
        </p>
        <Preview kind="reply" />
        {!s.ready.replies && (
          <Checklist items={[service, live]}>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <AskAgent request={AGENT.replies} />
              <HelpLink page="Customer-Emails#the-teams-replies" />
            </div>
          </Checklist>
        )}
      </SwitchCard>

      <SwitchCard
        title="Customers can answer by email"
        description="Their email replies land in the same conversation, waiting for the team as a live chat."
        on={settings.inbound.enabled}
        ready={s.ready.inbound}
        saving={saving === 'inbound'}
        onChange={(on) => void save('inbound', on)}
      >
        {s.inbound.address && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="size-3.5" aria-hidden /> Received at {s.inbound.address}; the assistant never answers them.</p>}
        {!s.ready.inbound && (
          <Checklist items={[service, replyTo, live, address, ...(s.inbound.domain ? [arrived] : [])]}>
            {!s.inbound.domain && (
              <>
                <p className="pt-1 font-medium">Set it up from your project folder:</p>
                <CopyBlock text={`npx @knowtific/helppuff email replies on chat.${hostOf(s)}`} label="command" />
              </>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <AskAgent request={AGENT.inbound} />
              <HelpLink page="Customer-Emails#answers-by-email" />
            </div>
          </Checklist>
        )}
      </SwitchCard>

      <SwitchCard
        title="Send a copy of the conversation"
        description="When a chat ends: a short recap and the whole conversation."
        on={settings.copy.enabled}
        ready={s.ready.copy}
        saving={saving === 'copy'}
        onChange={(on) => void save('copy', on)}
      >
        <p role="note" className="rounded-md border border-[color-mix(in_oklab,var(--danger)_30%,transparent)] px-3 py-2 text-xs">{COPY_RISK}</p>
        <Preview kind="copy" />
        {!s.ready.copy && (
          <Checklist items={[service]}>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <AskAgent request={AGENT.copy} />
              <HelpLink page="Customer-Emails#a-copy-of-the-conversation" />
            </div>
          </Checklist>
        )}
      </SwitchCard>

      <Card>
        <CardHeader title="Sent to customers" description="The last 20 emails to and from customers." />
        {log.error ? (
          <div className="border-t px-4 py-3">
            <ErrorNote error={log.error} onRetry={log.reload} />
          </div>
        ) : !log.data ? (
          <Skeleton className="m-4 h-16" />
        ) : !log.data.emails.length ? (
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y border-t">
            {log.data.emails.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
                <span className="w-24 shrink-0 text-muted-foreground">{fmtRelative(row.at)}</span>
                <Badge>{KINDS[row.kind] ?? row.kind}</Badge>
                <span className="min-w-0 flex-1 truncate">
                  {row.conversationId ? <a href={href({ page: 'conversations', id: row.conversationId })} className="hover:underline">{row.to ?? '—'}</a> : (row.to ?? '—')}
                </span>
                <span className={cn(row.status === 'failed' ? 'text-danger' : 'text-muted-foreground')}>{row.status === 'ok' ? 'ok' : row.status === 'other_sender' ? 'from another address' : `failed${row.error ? `: ${row.error}` : ''}`}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** The site's domain, for the example command. */
function hostOf(status: CustomerEmailsStatus): string {
  try {
    return new URL(status.origin ?? '').hostname.replace(/^www\./, '') || 'yourdomain.com';
  } catch {
    return 'yourdomain.com';
  }
}
