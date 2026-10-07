import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { PageHeader, settingsSections, type SettingsSection } from '../components/Shell';
import { Avatar, Badge, Button, Card, CardHeader, Skeleton } from '../components/ui';
import { api, type Me } from '../lib/api';
import { cn, fmtRelative, href, useData } from '../lib/utils';
import { SettingsForm } from '../components/SettingsForm';
import { InstructionsForm } from '../components/InstructionsForm';
import { FactsForm } from '../components/FactsForm';
import { Webhooks } from '../components/Webhooks';
import { Updates } from '../components/Updates';

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
  chat: 'The assistant’s name, its greeting and the questions it suggests.',
  appearance: 'Taken from your website. Change it if you like.',
  leads: 'A short form before the chat: every conversation becomes a lead, and the assistant knows who it’s talking to.',
  instructions: 'How it talks and what it’s for.',
  business: 'Read from your website. The assistant always has these; your changes are never overwritten.',
  advanced: 'The model, how often your site is re-read, rate limits, blocked IPs and sign-in protection.',
  webhooks: 'Send chats, messages, leads and callbacks to other tools as they happen.',
  team: 'Who can sign in, and what to do if you’re locked out.',
  updates: 'The version running, and how to upgrade it.',
};

const HELP: Record<SettingsSection, string> = {
  chat: 'Widget#customising',
  appearance: 'Widget#customising',
  leads: 'Leads#the-form-in-helppuffjson',
  instructions: 'Prompts-and-Instructions',
  business: 'Knowledge-Base#business-details',
  advanced: 'AI-Models',
  webhooks: 'Webhooks',
  team: 'Dashboard#team--security',
  updates: 'Upgrading',
};

/** One page per topic; the sidebar's Settings sub-menu (or the tabs on a phone) moves between them. */
export function Settings({ me, section }: { me: Me; section: string | undefined }) {
  const site = me.sites[0];
  const sections = settingsSections(site);
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
      <div className="max-w-3xl p-4 md:p-6">
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
        {current.id === 'team' && <Team />}
        {current.id === 'updates' && <Updates />}
      </div>
    </>
  );
}

function Team() {
  const { data } = useData(() => api<{ me: string; owner: string; admins: { email: string; name: string | null; createdAt: number; lastLoginAt: number | null }[] }>('/admins'), []);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Team" description="People who can sign in to this dashboard." />
        <ul className="divide-y border-t">
          {!data && <Skeleton className="m-4 h-8" />}
          {data?.owner && (
            <li className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={data.owner} />
              <span className="flex-1 text-[13px]">{data.owner}</span>
              <Badge>Owner</Badge>
            </li>
          )}
          {data?.admins.map((admin) => (
            <li key={admin.email} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={admin.email} />
              <span className="flex-1 text-[13px]">{admin.email}</span>
              <span className="text-xs text-muted-foreground">{admin.lastLoginAt ? `Last seen ${fmtRelative(admin.lastLoginAt)}` : 'Never signed in'}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-2 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">Add, remove or reset people from the command line:</p>
          <CopyBlock text={'helppuff users add teammate@example.com\nhelppuff users remove teammate@example.com\nhelppuff users reset teammate@example.com'} label="commands" />
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
