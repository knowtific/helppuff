import { ArrowUpCircle, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useData } from '../lib/utils';
import { CopyBlock } from '../pages/Settings';
import { Card, ErrorNote, Skeleton } from './ui';

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

const SEEN = 'mm-version';

/** The update check, once per browser session (the server caches npm for 12 hours anyway). */
export function useVersion(): VersionInfo | null {
  const [info, setInfo] = useState<VersionInfo | null>(() => {
    try {
      const saved = sessionStorage.getItem(SEEN);
      return saved ? (JSON.parse(saved) as VersionInfo) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (info) return;
    api<VersionInfo>('/version').then(
      (v) => {
        setInfo(v);
        try {
          sessionStorage.setItem(SEEN, JSON.stringify(v));
        } catch {
          // Private mode: asked again next page load.
        }
      },
      () => {},
    );
  }, [info]);
  return info;
}

export function Updates() {
  const version = useData(() => api<VersionInfo>('/version'), []);
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
              <p className="text-[13px] font-medium">{v.upgradeAvailable ? `Murmur ${v.latest} is available` : 'You’re up to date'}</p>
              <p className="text-xs text-muted-foreground">
                Running {v.current ?? 'a development build'}
                {v.latest && !v.upgradeAvailable ? ` · latest is ${v.latest}` : ''}
                {v.schema.applied !== null ? ` · database schema ${v.schema.applied}${v.schema.applied < v.schema.expected ? ` (expects ${v.schema.expected})` : ''}` : ''}
              </p>
            </div>
          </div>
          {v.upgradeAvailable && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Run this in the folder you set the assistant up from (or ask your coding agent to). It shows what will change, keeps a restore point for the
                database, and keeps your conversations, leads, settings and knowledge.
              </p>
              <CopyBlock text={v.command} label="upgrade command" />
              <a href={v.releaseNotes} target="_blank" rel="noreferrer" className="inline-block text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                What’s new
              </a>
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
          Something wrong after an upgrade? Go back with <code>npx @knowtific/murmur@&lt;previous version&gt; deploy --allow-downgrade</code>; the upgrade also
          printed a command to put the database back as it was.
        </p>
      </Card>
    </div>
  );
}
