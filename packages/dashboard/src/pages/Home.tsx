import { ArrowRight, CheckCircle2, ExternalLink, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CrawlProgress, useKnowledgeStatus } from '../components/knowledge';
import { HelpLink } from '../components/Shell';
import { Button, Card, CardHeader, ErrorNote } from '../components/ui';
import { api, type Me, type SettingsView, type Site } from '../lib/api';
import { cn, href, pathOf } from '../lib/utils';
import { CopyBlock } from './Settings';

/** The live test chat. The dashboard demo on the website points it (and the demo link) elsewhere. */
const chatUrl = (import.meta.env['VITE_HELPPUFF_CHAT_URL'] as string | undefined) ?? '/chat.html';

/**
 * Home: try the assistant, then put it on the site. The live chat is the
 * real widget (the Worker's preview page), so what you test is what visitors
 * get. While the site is still being learned, it says so instead of showing a
 * chat that knows nothing.
 */
export function Home({ me }: { me: Me }) {
  const site = me.sites[0]!;
  const { status } = useKnowledgeStatus(site.knowledge);
  const demo = (import.meta.env['VITE_HELPPUFF_DEMO_URL'] as string | undefined) ?? `${window.location.origin}/`;
  const learning = status?.run?.status === 'queued' || status?.run?.status === 'running';
  const notStarted = site.knowledge && status && !status.run;
  useStarterQuestions(site.knowledge && (status?.chunks ?? 0) > 0);

  if (notStarted) {
    return (
      <div className="mx-auto max-w-xl p-6 md:p-10">
        <Card className="px-5 py-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight">Let’s teach it your website</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Pick the pages it should learn from. It takes a minute.</p>
          <a href={href({ page: 'onboarding' })} className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90">
            Start <ArrowRight className="size-4" aria-hidden />
          </a>
        </Card>
      </div>
    );
  }

  const pages = (status?.pages.indexed ?? 0) + (status?.pages.unchanged ?? 0);
  return (
    <div className="mx-auto grid h-full max-w-6xl gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)]">
      <Card className="flex h-[75vh] min-h-[480px] flex-col overflow-hidden lg:h-auto lg:min-h-0">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <h1 className="text-[13px] font-medium">Try your assistant</h1>
          <span className="text-xs text-muted-foreground">Exactly what visitors get</span>
        </div>
        {/* Nothing learned yet: a chat would only say "not sure". Show the progress instead. */}
        {learning && status && status.chunks === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="w-full max-w-sm">
              <CrawlProgress run={status.run} chunks={status.chunks} />
            </div>
          </div>
        ) : (
          <iframe src={chatUrl} title="Your chat assistant, live" className="w-full flex-1 bg-background" />
        )}
      </Card>

      <aside className="space-y-4 lg:overflow-y-auto lg:pb-1 scroll-thin">
        {site.knowledge && status?.run && (
          <Card className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[13px]" role="status">
                {learning ? (
                  <>
                    <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> Learning your site — {status.run.done + status.run.failed} of {status.run.total} pages
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4 text-[#16a34a]" aria-hidden /> Knows {pages} {pages === 1 ? 'page' : 'pages'}
                  </>
                )}
              </span>
              <a href={href({ page: 'knowledge' })} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Manage
              </a>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Go live" description="Two ways to put it in front of people." action={<HelpLink page="Getting-Started#3-add-it-to-your-website" />} />
          <ol className="space-y-5 px-4 pb-4">
            <Step n={1} title="Add it to your website" description="Paste before </body> on every page, or send it to whoever looks after your site.">
              <CopyBlock text={site.embed} label="script" />
              <InstallCheck />
            </Step>
            <Step n={2} title="Share a demo" description="A page with the assistant on it, to show your team first.">
              <CopyBlock text={demo} label="demo link" />
              <a href={demo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                Open it <ExternalLink className="size-3" aria-hidden />
              </a>
            </Step>
          </ol>
        </Card>

        {site.production && <GoLiveChecklist production={site.production} />}
      </aside>
    </div>
  );
}

/**
 * What to settle before real visitors arrive. Testing works without any of it
 * (and an agent cannot do the Turnstile step: it needs the Cloudflare
 * dashboard), so this warns rather than blocks.
 */
function GoLiveChecklist({ production }: { production: NonNullable<Site['production']> }) {
  return (
    <Card>
      <CardHeader title="Before you go live" description="Fine to skip while you test." action={<HelpLink page="Turnstile" />} />
      <ul className="space-y-4 px-4 pb-4">
        <li className="flex gap-3">
          {production.turnstile ? (
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#16a34a]" aria-hidden />
          ) : (
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[#d97706]" aria-hidden />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <h2 className="text-[13px] font-medium">{production.turnstile ? 'Turnstile is on' : 'Turn on Turnstile'}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {production.turnstile
                  ? 'New chats and dashboard sign-ins are checked for bots.'
                  : 'Off now. Without it, a script can start chats and use up your daily cap, and try passwords on this dashboard. Free, about five minutes, in your Cloudflare dashboard.'}
              </p>
            </div>
            {!production.turnstile && (
              <>
                {production.hostnames.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground">Hostnames to add to the widget:</p>
                    <CopyBlock text={production.hostnames.join('\n')} label="hostnames" />
                  </div>
                )}
                <HelpLink page="Turnstile" label="How to turn it on" />
              </>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-medium">Daily cap: {production.dailyCap.toLocaleString()} messages</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The most the whole site can use in a day. Set it to what you’re happy to pay for in{' '}
              <a href={href({ page: 'settings', id: 'advanced' })} className="underline underline-offset-2 hover:text-foreground">
                Settings → Advanced
              </a>
              .
            </p>
          </div>
        </li>
      </ul>
    </Card>
  );
}

function Step({ n, title, description, children }: { n: number; title: string; description: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium" aria-hidden>
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <h2 className="text-[13px] font-medium">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </li>
  );
}

function InstallCheck() {
  const [check, setCheck] = useState<{ installed: boolean; url: string; reason: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            api<{ installed: boolean; url: string; reason: string | null }>('/install-check')
              .then(setCheck, (thrown: Error) => setError(thrown))
              .finally(() => setBusy(false));
          }}
        >
          {busy && <Loader2 className="animate-spin" />}
          Check my site
        </Button>
        {check && (
          <span className={cn('flex items-center gap-1.5 text-xs', check.installed ? 'text-foreground' : 'text-muted-foreground')} role="status">
            {check.installed && <CheckCircle2 className="size-3.5 text-[#16a34a]" aria-hidden />}
            {check.installed ? `Installed on ${pathOf(check.url)}` : check.reason}
          </span>
        )}
      </div>
      {error && <ErrorNote error={error} />}
    </div>
  );
}

/** Once the site is learned, give the widget suggested questions written from it — if it has none yet. */
function useStarterQuestions(ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    void (async () => {
      const view = await api<SettingsView>('/settings');
      if (view.settings.starterQuestions.length) return;
      const { questions } = await api<{ questions: string[] }>('/knowledge/suggest-questions', { method: 'POST', json: {} });
      if (questions.length) await api('/settings', { method: 'PUT', json: { settings: { starterQuestions: questions } } });
    })().catch(() => {});
  }, [ready]);
}
