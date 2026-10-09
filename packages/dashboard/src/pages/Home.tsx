import { ArrowRight, CheckCircle2, ExternalLink, Loader2, ShieldAlert, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { CrawlProgress, useKnowledgeStatus } from '../components/knowledge';
import { HelpLink, wikiHref } from '../components/Shell';
import { Button, Card, CardHeader, ErrorNote, InfoTip } from '../components/ui';
import { api, type Me, type PipelineView, type Site } from '../lib/api';
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
          <h1 className="flex items-center gap-1.5 text-[13px] font-medium">
            Try your assistant
            <InfoTip label="About this chat">The live widget, exactly as visitors get it. Your test chats appear in Conversations.</InfoTip>
          </h1>
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
          <CardHeader
            title="Go live"
            tip={{ label: 'About going live', text: 'Put it on your website, or share a demo page with your team first.', href: wikiHref('Getting-Started#3-add-it-to-your-website') }}
          />
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

        <JobsChoice />
        {site.production && !site.production.turnstile && <GoLiveChecklist production={site.production} />}
      </aside>
    </div>
  );
}

const JOBS_SEEN = 'hp-jobs-choice-seen';

/**
 * What the AI set up for jobs from the website (once it has): the template and
 * why, with a link to change it. Dismissed for good on this browser.
 */
function JobsChoice() {
  const [view, setView] = useState<PipelineView | null>(null);
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(JOBS_SEEN) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    api<PipelineView>('/jobs/pipeline').then(setView, () => {});
  }, []);
  const p = view?.pipeline;
  if (!p || p.chosenBy !== 'ai' || seen === p.template) return null;
  const template = view.templates.find((t) => t.id === p.template);
  const dismiss = () => {
    try {
      localStorage.setItem(JOBS_SEEN, p.template);
    } catch {
      // Private window: shown again next time.
    }
    setSeen(p.template);
  };
  return (
    <Card className="px-4 py-3 text-[13px]">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex items-center gap-1.5 font-medium">
            {p.itemPlural} set up as “{template?.name ?? p.template}”
            {(p.reason ?? template?.description) && <InfoTip label="Why this template">{p.reason ?? template?.description}</InfoTip>}
          </p>
          <p className="text-xs text-muted-foreground">Stages: {p.stages.map((s) => s.name).join(' → ')}</p>
          <div className="flex gap-3 pt-1 text-xs">
            <a href={href({ page: 'settings', id: 'jobs' })} className="font-medium underline-offset-2 hover:underline">
              Change it
            </a>
            <button type="button" onClick={dismiss} className="text-muted-foreground hover:text-foreground">
              Looks good
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * What to settle before real visitors arrive, shown until it is done: only
 * Turnstile now (the daily cap is an Advanced setting). Testing works without it
 * (and an agent cannot do the Turnstile step: it needs the Cloudflare
 * dashboard), so this warns rather than blocks.
 */
function GoLiveChecklist({ production }: { production: NonNullable<Site['production']> }) {
  return (
    <Card>
      <CardHeader title="Before you go live" tip={{ label: 'About going live', text: 'Fine to skip while you test.', href: wikiHref('Turnstile') }} />
      <ul className="space-y-4 px-4 pb-4">
        <li className="flex gap-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[#d97706]" aria-hidden />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <h2 className="text-[13px] font-medium">Turn on Turnstile</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Stops bots starting chats and guessing passwords. Free, about five minutes.
              </p>
            </div>
            {production.hostnames.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Hostnames to add to the widget:</p>
                <CopyBlock text={production.hostnames.join('\n')} label="hostnames" />
              </div>
            )}
            <HelpLink page="Turnstile" label="How to turn it on" />
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
        <h2 className="flex items-center gap-1.5 text-[13px] font-medium">
          {title}
          <InfoTip label={`About “${title}”`}>{description}</InfoTip>
        </h2>
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

