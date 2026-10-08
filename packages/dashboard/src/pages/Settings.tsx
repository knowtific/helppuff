import { Check, Copy, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader, settingsSections, type SettingsSection } from '../components/Shell';
import { Avatar, Badge, Button, Card, CardHeader, Input, Select, Skeleton } from '../components/ui';
import { api, isMember, type Me, type Team as TeamList } from '../lib/api';
import { LabelsSettings, LiveChatSettings, NotificationSettings } from '../components/LiveChat';
import { cn, fmtRelative, href, useData } from '../lib/utils';
import { SettingsForm } from '../components/SettingsForm';
import { InstructionsForm } from '../components/InstructionsForm';
import { FactsForm } from '../components/FactsForm';
import { Webhooks } from '../components/Webhooks';
import { ApiKeys } from '../components/ApiKeys';
import { Updates } from '../components/Updates';
import { JobsSettings } from '../components/JobsSettings';
import { HomeScreenSettings } from '../components/HomeScreenSettings';

export function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md border bg-subtle p-2 pl-3">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre py-1 text-xs scroll-thin">{text}</code>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

const DESCRIPTIONS: Record<SettingsSection, string> = {
  chat: 'The assistant’s name and its greeting.',
  home: 'What visitors see when they open the chat: the heading, the buttons and useful pages.',
  appearance: 'Taken from your website. Change it if you like.',
  leads: 'A short form before the chat: every conversation becomes a lead, and the assistant knows who it’s talking to.',
  instructions: 'How it talks and what it’s for.',
  business: 'Read from your website. The assistant always has these; your changes are never overwritten.',
  live: 'Let visitors talk to a person on your team, from the dashboard or Telegram.',
  labels: 'Tag conversations, by hand or by the AI, and filter by them.',
  jobs: 'Requests, quotes and work: the stages they go through, what you need to know, and the quote questions on the widget.',
  notifications: 'Your own alerts for live chats: browser notifications, sound and availability.',
  advanced: 'The model, how often your site is re-read, rate limits, blocked IPs and sign-in protection.',
  webhooks: 'Send chats, messages, leads and callbacks to other tools as they happen.',
  api: 'Use HelpPuff from your own servers, as a backend: keys, the base URL and examples.',
  team: 'Who can sign in and what they can do, and what to do if you’re locked out.',
  updates: 'The version running, and how to upgrade it.',
};

const HELP: Record<SettingsSection, string> = {
  chat: 'Widget#customising',
  home: 'Widget#the-home-screen',
  appearance: 'Widget#customising',
  leads: 'Leads#the-form-in-helppuffjson',
  instructions: 'Prompts-and-Instructions',
  business: 'Knowledge-Base#business-details',
  live: 'Live-Chat',
  labels: 'Dashboard#labels',
  jobs: 'Jobs',
  notifications: 'Live-Chat#notifications',
  advanced: 'AI-Models',
  webhooks: 'Webhooks',
  api: 'API',
  team: 'Dashboard#team--security',
  updates: 'Upgrading',
};

/** One page per topic; the sidebar's Settings sub-menu (or the tabs on a phone) moves between them. */
export function Settings({ me, section }: { me: Me; section: string | undefined }) {
  const site = me.sites[0];
  const sections = settingsSections(site, me);
  const current = sections.find((s) => s.id === section) ?? sections[0]!;
  return (
    <>
      <PageHeader title={current.label} description={DESCRIPTIONS[current.id]} help={HELP[current.id]} />
      <nav className="flex gap-1 overflow-x-auto border-b px-4 py-2 scroll-thin md:hidden" aria-label="Settings">
        {sections.map((s) => (
          <a
            key={s.id}
            href={href({ page: 'settings', id: s.id })}
            aria-current={s.id === current.id ? 'page' : undefined}
            className={cn('shrink-0 rounded-md px-2.5 py-1 text-xs', s.id === current.id ? 'bg-muted font-medium' : 'text-muted-foreground')}
          >
            {s.label}
          </a>
        ))}
      </nav>
      <div className={cn('p-4 md:p-6', current.id === 'home' ? 'max-w-6xl' : 'max-w-3xl')}>
        {(current.id === 'chat' || current.id === 'appearance' || current.id === 'leads' || current.id === 'advanced') && (
          <Card>
            <SettingsForm key={current.id} knowledge={Boolean(site?.knowledge)} section={current.id} />
          </Card>
        )}
        {current.id === 'instructions' && (
          <Card>
            <InstructionsForm />
          </Card>
        )}
        {current.id === 'business' && (
          <Card>
            <FactsForm />
          </Card>
        )}
        {current.id === 'webhooks' && <Webhooks />}
        {current.id === 'api' && <ApiKeys />}
        {current.id === 'live' && <LiveChatSettings />}
        {current.id === 'home' && <HomeScreenSettings knowledge={Boolean(site?.knowledge)} />}
        {current.id === 'labels' && <LabelsSettings />}
        {current.id === 'jobs' && <JobsSettings />}
        {current.id === 'notifications' && <NotificationSettings />}
        {current.id === 'team' && <Team me={me} />}
        {current.id === 'updates' && <Updates />}
      </div>
    </>
  );
}

const ROLE_HINT = 'Admins: everything. Members: conversations, jobs, contacts, callbacks and live chat, no settings.';

function Team({ me }: { me: Me }) {
  const { data, reload } = useData(() => api<TeamList>('/admins'), []);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const admin = !isMember(me);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      reload();
      return true;
    } catch (thrown) {
      setError((thrown as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Team" description={`People who can sign in to this dashboard. ${ROLE_HINT}`} />
        <ul className="divide-y border-t">
          {!data && <Skeleton className="m-4 h-8" />}
          {data?.owner && (
            <li className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={data.owner} />
              <span className="flex-1 text-[13px]">{data.owner}</span>
              <Badge>Owner</Badge>
            </li>
          )}
          {data?.admins.map((person) => (
            <li key={person.email} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Avatar name={person.name ?? person.email} />
              <span className="min-w-0 flex-1 text-[13px]">
                {person.name && <span className="block font-medium">{person.name}</span>}
                <span className={person.name ? 'text-xs text-muted-foreground' : ''}>{person.email}</span>
              </span>
              <span className="text-xs text-muted-foreground">{person.lastLoginAt ? `Last seen ${fmtRelative(person.lastLoginAt)}` : 'Never signed in'}</span>
              {person.role === 'owner' || !admin ? (
                <Badge>{person.role === 'owner' ? 'Owner' : person.role === 'member' ? 'Member' : 'Admin'}</Badge>
              ) : (
                <>
                  <Select
                    value={person.role}
                    onChange={(e) => void run(() => api(`/admins/${encodeURIComponent(person.email)}`, { method: 'PATCH', json: { role: e.target.value } }))}
                    aria-label={`Role of ${person.email}`}
                    className="h-7 text-xs"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove ${person.email}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${person.email}? They are signed out at once.`)) void run(() => api(`/admins/${encodeURIComponent(person.email)}`, { method: 'DELETE' }));
                    }}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        {admin && (
          <form
            className="space-y-2 border-t px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const made = await api<{ email: string; signInLink: string | null }>('/admins', { method: 'POST', json: { email, name: name || undefined, role } });
                if (made.signInLink) setLink({ email: made.email, url: made.signInLink });
                setEmail('');
                setName('');
              });
            }}
          >
            <p className="text-xs font-medium">Invite someone</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" aria-label="Email" />
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="First name (visitors see it)" aria-label="Name" maxLength={100} />
              <Select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')} aria-label="Role">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
              <Button type="submit" disabled={busy || !email}>
                {busy && <Loader2 className="animate-spin" />} Invite
              </Button>
            </div>
            {link && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs text-muted-foreground">Send {link.email} this one-time sign-in link (valid 7 days):</p>
                <CopyBlock text={link.url} label="sign-in link" />
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
          </form>
        )}
        <div className="space-y-2 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">Or from the command line:</p>
          <CopyBlock text={'helppuff users add teammate@example.com --role member\nhelppuff users remove teammate@example.com\nhelppuff users reset teammate@example.com'} label="commands" />
        </div>
      </Card>

      <Card>
        <CardHeader title="Security" description="Keys live only in your project’s .env and as Worker secrets on your Cloudflare account." />
        <div className="space-y-2 border-t px-4 py-3 text-[13px]">
          <p>
            <span className="font-medium">Locked out?</span> <span className="text-muted-foreground">A one-time sign-in link, from the folder you set up in:</span>
          </p>
          <CopyBlock text="npx @knowtific/helppuff dashboard" label="command" />
          <p className="pt-2">
            <span className="font-medium">Rotate the admin key</span>{' '}
            <span className="text-muted-foreground">(what the CLI and agents use): delete ADMIN_API_KEY from .env and redeploy — a new one is made and set.</span>
          </p>
        </div>
      </Card>
    </div>
  );
}
