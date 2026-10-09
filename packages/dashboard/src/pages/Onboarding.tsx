import { ArrowRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FactsForm } from '../components/FactsForm';
import { Choice, GoalPicker, type Behaviour } from '../components/InstructionsForm';
import { PagePicker } from '../components/knowledge';
import { HelpLink } from '../components/Shell';
import { Button, Card, ErrorNote, InfoTip, Input, Skeleton } from '../components/ui';
import { api, type Discovery, type Me, type SearchResult, type SettingsView } from '../lib/api';
import { cn, fmtNumber, href } from '../lib/utils';

/**
 * The first run, nothing that can be worked out instead:
 *
 *   1. Website    — what we found on the site, the useful ones already ticked.
 *                   One click starts learning; it runs on Cloudflare in the background.
 *   2. Details    — the business details read from the site, to check: visitors see them.
 *   3. Assistant  — optional: what it does when a visitor is interested, and
 *                   whether the form comes before the chat or details are asked
 *                   for when needed. The defaults suit most sites, so it can be skipped.
 *
 * Colours, greeting and suggested questions come from the site and the crawl;
 * all of it is in Settings later.
 */
export function Onboarding({ me }: { me: Me }) {
  const site = me.sites[0]!;
  const [step, setStep] = useState<0 | 1 | 2>(site.knowledge ? 0 : 1);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ol className="flex gap-6 text-[13px]" aria-label="Setup steps">
          {['Your website', 'Business details', 'Assistant (optional)'].map((label, i) => (
            <li key={label} aria-current={i === step ? 'step' : undefined} className={cn('flex items-center gap-2', i === step ? 'font-medium' : 'text-muted-foreground')}>
              <span className={cn('flex size-5 items-center justify-center rounded-full border text-[11px]', i < step && 'border-primary bg-primary text-primary-foreground', i === step && 'border-foreground')}>
                {i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
        <HelpLink page="Getting-Started#2-finish-on-the-setup-page" label="Setup help" />
      </div>
      {step === 0 && <Pages onStarted={() => setStep(1)} />}
      {step === 1 && <Details onSaved={() => setStep(2)} />}
      {step === 2 && <Assistant />}
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
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            Found {fmtNumber(discovery.urls.length)} pages · {fmtNumber(selected.length)} useful
            <InfoTip label="About the pages">The useful ones are ticked; legal pages and old posts are left out. Learning runs on Cloudflare in the background.</InfoTip>
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

const finish = () => (window.location.hash = href({ page: 'home' }));

function Details({ onSaved }: { onSaved: () => void }) {
  return (
    <Card>
      <div className="space-y-2 px-4 pt-5 md:px-5">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          Check your business details
          <InfoTip label="About business details">Read from your website while it learns the rest. The assistant gives these to visitors, so fix anything that’s wrong.</InfoTip>
        </h1>
      </div>
      <FactsForm detect saveLabel="Next" onSaved={onSaved} />
    </Card>
  );
}

type AssistantDraft = Pick<Behaviour, 'goal' | 'bookingUrl'> & { prechat: boolean };

function Assistant() {
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    api<SettingsView>('/settings').then(
      ({ settings }) => setDraft({ goal: settings.behaviour.goal, bookingUrl: settings.behaviour.bookingUrl, prechat: settings.leads.enabled }),
      (thrown: Error) => setError(thrown),
    );
  }, []);

  const save = async () => {
    if (!draft) return finish();
    setBusy(true);
    setError(null);
    try {
      await api('/settings', { method: 'PUT', json: { settings: { behaviour: { goal: draft.goal, bookingUrl: draft.bookingUrl }, leads: { enabled: draft.prechat } } } });
      finish();
    } catch (thrown) {
      setError(thrown as Error);
      setBusy(false);
    }
  };

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="space-y-5 px-4 py-5 md:px-5">
          <div className="space-y-2">
            <h1 className="text-lg font-semibold tracking-tight">How should the assistant work?</h1>
            <p className="text-[13px] text-muted-foreground">Optional: the defaults suit most sites.</p>
          </div>
          {draft ? (
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium">When a visitor is interested, what should it do?</span>
                <GoalPicker value={draft.goal} onChange={(goal) => setDraft({ ...draft, goal })} />
              </div>
              {draft.goal === 'bookings' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium">Page to send them to</span>
                  <Input type="url" placeholder="https://example.com/book" value={draft.bookingUrl ?? ''} onChange={(e) => setDraft({ ...draft, bookingUrl: e.target.value || undefined })} />
                </label>
              )}
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  When should it ask for their name and phone?
                  <InfoTip label="About the form">The questions are in Settings → Lead form. Everything here can be changed later in Settings.</InfoTip>
                </span>
                <Choice
                  name="When to ask for details"
                  value={draft.prechat ? 'first' : 'later'}
                  onChange={(v) => setDraft({ ...draft, prechat: v === 'first' })}
                  options={[
                    { value: 'first', label: 'Before the chat', hint: 'A short form first, so every chat comes with a way to reach them' },
                    { value: 'later', label: 'Only when needed', hint: 'Visitors chat straight away; it asks when they want a callback, quote or booking' },
                  ]}
                />
              </div>
            </>
          ) : (
            !error && <Skeleton className="h-40" />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3 md:px-5">
          {error && (
            <span className="mr-auto text-xs text-danger" role="alert">
              {error.message}
            </span>
          )}
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={finish}>
            Skip
          </button>
          <Button type="submit" disabled={busy || !draft}>
            {busy && <Loader2 className="animate-spin" />}
            Finish
          </Button>
        </div>
      </form>
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
