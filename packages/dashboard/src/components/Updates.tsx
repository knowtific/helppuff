import { ArrowUpCircle, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useData } from '../lib/utils';
import { CopyBlock } from '../pages/Settings';
import { WikiLink } from './Shell';
import { Card, ErrorNote, InfoTip, Skeleton } from './ui';

/**
 * Settings → Updates. The Worker cannot update itself: a deploy needs the
 * owner's Cloudflare login, which it never holds. So this says what is
 * running, whether there is newer, and the one command that upgrades it.
 */

export type VersionInfo = {
  current: string | null;
  latest: string | null;
  upgradeAvailable: boolean;
  schema: { applied: number | null; expected: number };
  command: string;
  releaseNotes: string;
};

let checked: Promise<VersionInfo> | null = null;

/**
 * The update check, once per page load and shared by the sidebar and this
 * page (the server caches the npm lookup for 12 hours). A reload after an
 * upgrade asks again; a failed check is retried by the next caller.
 */
function checkVersion(): Promise<VersionInfo> {
  checked ??= api<VersionInfo>('/version').catch((thrown: unknown) => {
    checked = null;
    throw thrown;
  });
  return checked;
}

export function useVersion(): VersionInfo | null {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  useEffect(() => {
    let active = true;
    void checkVersion().then(
      (v) => {
        if (active) setInfo(v);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);
  return info;
}

export function Updates() {
  const version = useData(checkVersion, []);
  const v = version.data;
  return (
    <div className="space-y-4">
      {version.error && <ErrorNote error={version.error} onRetry={version.reload} />}
      {!v && !version.error && <Skeleton className="h-32" />}
      {v && (
        <Card className="space-y-3 px-4 py-4">
          <div className="flex items-start gap-3">
            {v.upgradeAvailable ? <ArrowUpCircle className="mt-0.5 size-5 text-primary" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-5 text-[#16a34a]" aria-hidden />}
            <div className="space-y-0.5">
              <p className="text-[13px] font-medium">{v.upgradeAvailable ? `HelpPuff ${v.latest} is available` : 'You’re up to date'}</p>
              <p className="text-xs text-muted-foreground">
                Running {v.current ?? 'a development build'}
                {v.latest && !v.upgradeAvailable ? ` · latest is ${v.latest}` : ''}
                {v.schema.applied !== null ? ` · database schema ${v.schema.applied}${v.schema.applied < v.schema.expected ? ` (expects ${v.schema.expected})` : ''}` : ''}
              </p>
            </div>
          </div>
          {v.upgradeAvailable && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Run in your project folder
                <InfoTip label="About upgrading">
                  The folder you set the assistant up from (or ask your coding agent to). It shows what will change, keeps a restore point for the database, and
                  keeps your conversations, leads, settings and knowledge.
                </InfoTip>
              </p>
              <CopyBlock text={v.command} label="upgrade command" />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <WikiLink page="Upgrading" className="font-medium text-foreground underline-offset-2 hover:underline">
                  How to upgrade
                </WikiLink>
                <a href={v.releaseNotes} target="_blank" rel="noreferrer" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  What’s new
                </a>
              </div>
            </div>
          )}
        </Card>
      )}
      <Card className="space-y-2 px-4 py-3 text-xs text-muted-foreground">
        <p className="text-[13px] font-medium text-foreground">Why upgrading happens in the terminal</p>
        <p>
          An upgrade deploys new code to your Cloudflare account, which needs your Cloudflare login. This dashboard never holds it, by design: nobody who gets
          into the dashboard can change what runs on your account.
        </p>
        <p>
          Something wrong after an upgrade? Go back with <code>npx @knowtific/helppuff@&lt;previous version&gt; deploy --allow-downgrade</code>; the upgrade also
          printed a command to put the database back as it was.
        </p>
      </Card>
    </div>
  );
}
