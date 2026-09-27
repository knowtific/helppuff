import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Shell';
import { Avatar, Badge, Button, Card, CardHeader, Skeleton } from '../components/ui';
import { api, type Me } from '../lib/api';
import { fmtRelative, useData } from '../lib/utils';

function CopyBlock({ text, label }: { text: string; label: string }) {
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

export function Settings({ me }: { me: Me }) {
  const { data } = useData(
    () => api<{ me: string; owner: string; admins: { email: string; name: string | null; createdAt: number; lastLoginAt: number | null }[] }>('/admins'),
    [],
  );
  return (
    <>
      <PageHeader title="Settings" description="Install the widget and see who can sign in." />
      <div className="max-w-3xl space-y-4 p-4 md:p-6">
        {me.sites.map((site) => (
          <Card key={site.id}>
            <CardHeader title={`Install on ${site.name}`} description="Paste this before </body> on every page where the chat should appear." />
            <div className="space-y-2 px-4 pb-4">
              <CopyBlock text={site.embed} label="embed snippet" />
              <p className="text-xs text-muted-foreground">
                Edit the prompt on the Prompt page. Change the look or backend in <code>murmur.json</code>, then run <code>murmur deploy</code>.
              </p>
            </div>
          </Card>
        ))}

        <Card>
          <CardHeader title="Team" description="People who can sign in to this dashboard." />
          <ul className="divide-y border-t">
            {!data && <Skeleton className="m-4 h-8" />}
            {data && (
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
            <CopyBlock text={'murmur users add teammate@example.com\nmurmur users remove teammate@example.com\nmurmur users reset teammate@example.com'} label="commands" />
          </div>
        </Card>
      </div>
    </>
  );
}
