import { ArrowRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FactsForm } from '../components/FactsForm';
import { GoalPicker, loadBehaviour, saveBehaviour, type Behaviour } from '../components/InstructionsForm';
import { PagePicker } from '../components/knowledge';
import { Button, Card, ErrorNote } from '../components/ui';
import { api, type Discovery, type Me, type SearchResult } from '../lib/api';
import { cn, fmtNumber, href } from '../lib/utils';

/**
 * The first run, two steps and nothing that can be worked out instead:
 *
 *   1. Pages    — what we found on the site, the useful ones already ticked.
 *                 One click starts learning; it runs on Cloudflare in the background.
 *   2. Details  — the business details read from the site, to check, and the
 *                 one choice that changes how it talks: what it is for.
 *
 * Colours, greeting and suggested questions come from the site and the crawl;
 * all of it is in Settings later.
 */
export function Onboarding({ me }: { me: Me }) {
  const site = me.sites[0]!;
  const [step, setStep] = useState<0 | 1>(site.knowledge ? 0 : 1);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-8">
      <ol className="flex gap-6 text-[13px]" aria-label="Setup steps">
        {['Your pages', 'Your details'].map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined} className={cn('flex items-center gap-2', i === step ? 'font-medium' : 'text-muted-foreground')}>
            <span className={cn('flex size-5 items-center justify-center rounded-full border text-[11px]', i < step && 'border-primary bg-primary text-primary-foreground', i === step && 'border-foreground')}>
              {i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      {step === 0 ? <Pages onStarted={() => setStep(1)} /> : <Details />}
    </div>
  );
}

function Pages({ onStarted }: { onStarted: () => void }) {
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    api<Discovery>('/knowledge/discover', { method: 'POST', json: {} }).then(setDiscovery, (thrown: Error) => setError(thrown));
  }, []);

  const start = async (urls: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await api('/knowledge/crawl', { method: 'POST', json: { urls, trigger: 'setup' } });
      onStarted();
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };

  const selected = discovery?.urls.filter((u) => u.selected) ?? [];
  return (
    <Card className="px-5 py-6">
      <h1 className="text-lg font-semibold tracking-tight">Teach it your website</h1>
      {error && <div className="mt-3"><ErrorNote error={error} /></div>}
      {!discovery && !error && (
        <p className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Looking at your site…
        </p>
      )}
      {discovery && !choosing && (
        <>
          <p className="mt-1 text-[13px] text-muted-foreground">
            We found {fmtNumber(discovery.urls.length)} pages. {fmtNumber(selected.length)} are useful for answering questions — legal pages and old posts are left out.
          </p>
          {discovery.warnings.map((w) => (
            <p key={w} className="mt-2 text-xs text-muted-foreground">{w}</p>
          ))}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={() => void start(selected.map((u) => u.url))} disabled={busy || !selected.length}>
              {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              Start learning
            </Button>
            <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setChoosing(true)}>
              Choose pages
            </button>
          </div>
        </>
      )}
      {discovery && choosing && (
        <div className="mt-4">
          <PagePicker initial={discovery} busy={busy} startLabel="Start learning" onStart={(urls) => void start(urls)} />
        </div>
      )}
    </Card>
  );
}

function Details() {
  const [goal, setGoal] = useState<Behaviour['goal']>('callbacks');
  const [profile, setProfile] = useState<Behaviour | null>(null);
  useEffect(() => {
    loadBehaviour().then((v) => {
      setProfile(v);
      setGoal(v.goal);
    }, () => {});
  }, []);

  return (
    <Card>
      <div className="space-y-2 px-4 pt-5 md:px-5">
        <h1 className="text-lg font-semibold tracking-tight">Check your details</h1>
        <p className="text-[13px] text-muted-foreground">Read from your website while it learns the rest. Fix anything that’s wrong — visitors will see these.</p>
      </div>
      <div className="space-y-1.5 px-4 pt-4 md:px-5">
        <span className="text-xs font-medium">What should it mainly do?</span>
        <GoalPicker value={goal} onChange={setGoal} />
      </div>
      <FactsForm
        detect
        saveLabel="Finish"
        onSaved={() => {
          const done = () => (window.location.hash = href({ page: 'home' }));
          if (profile && goal !== profile.goal) void saveBehaviour({ goal }).finally(done);
          else done();
        }}
      />
    </Card>
  );
}

export function Passages({ result }: { result: SearchResult }) {
  if (!result.chunks.length) {
    return (
      <p className="rounded-md border bg-subtle px-3 py-2 text-[13px] text-muted-foreground">
        Nothing on your site answers that closely enough, so the assistant will say it isn’t sure and offer a callback. Add the answer under Knowledge.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {result.chunks.map((chunk) => (
        <li key={chunk.id} className="rounded-md border px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{chunk.headingPath}</span>
            <span className="tabular-nums" title="Relevance, 0–1">
              {chunk.score.toFixed(2)}
            </span>
          </div>
          <p className="mt-1 line-clamp-4 text-[13px] whitespace-pre-line">{chunk.content.replace(/^#+ .*\n+/, '')}</p>
          {/^https?:/.test(chunk.url) && (
            <a href={chunk.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-muted-foreground underline-offset-2 hover:underline">
              {chunk.url}
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
