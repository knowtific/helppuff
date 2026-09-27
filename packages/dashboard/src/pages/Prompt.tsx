import { ArrowLeft, History, Lock, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Shell';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Input, Segmented, Select, Skeleton, Textarea } from '../components/ui';
import { api, ApiError, type Me, type PromptVersion, type PromptView, type PublishResult } from '../lib/api';
import { diffLines } from '../lib/diff';
import { cn, fmtDateTime, fmtRelative, useData } from '../lib/utils';

/**
 * The assistant's system prompt, versioned. Publishing makes a new version
 * live; restoring publishes an old text as a new version, so nothing in the
 * history is ever lost. `murmur deploy` publishes into the same history, and
 * refuses to overwrite a version made here that prompt.md has not pulled.
 */

const normalize = (text: string) => text.replace(/\r\n?/g, '\n').trim();

function sourceLabel(v: Pick<PromptVersion, 'source' | 'restoredFrom'>): string {
  if (v.source === 'restore') return `Restored v${v.restoredFrom ?? '?'}`;
  return v.source === 'dashboard' ? 'Dashboard' : 'CLI deploy';
}

type Notice = { tone: 'ok' | 'warn'; text: string } | null;

export function Prompt({ me }: { me: Me }) {
  const [site, setSite] = useState(me.sites[0]?.id ?? '');
  const { data, error, reload } = useData(() => api<PromptView>(`/prompt?site=${encodeURIComponent(site)}`), [site]);
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const live = data?.text ?? '';
  const text = draft ?? live;
  const dirty = draft !== null && normalize(draft) !== normalize(live);
  const over = data ? normalize(text).length > data.limit : false;

  // Leaving with an unpublished edit loses it; say so.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const run = async (action: () => Promise<PublishResult>, done: (result: PublishResult) => string) => {
    if (!data) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      setNotice(result.status === 'unchanged' ? { tone: 'warn', text: 'Nothing changed, so no new version was made.' } : { tone: 'ok', text: done(result) });
      if (result.status === 'published') {
        setDraft(null);
        setNote('');
        setSelected(null);
      }
      reload();
    } catch (thrown) {
      // A conflict keeps the draft: reload shows what won, and publishing again replaces it knowingly.
      const conflict = thrown instanceof ApiError && thrown.status === 409;
      setNotice({ tone: 'warn', text: conflict ? `${thrown.message} Your edit is still here.` : (thrown as Error).message });
      if (conflict) reload();
    } finally {
      setBusy(false);
    }
  };

  const publish = () =>
    run(
      () => api<PublishResult>('/prompt', { method: 'POST', json: { site, text, note, baseVersion: data!.version } }),
      (r) => `Published as version ${r.version}. Visitors get it within a minute.`,
    );
  const restore = (version: number) =>
    run(
      () => api<PublishResult>('/prompt/restore', { method: 'POST', json: { site, version, baseVersion: data!.version } }),
      (r) => `Version ${version} is live again, as version ${r.version}.`,
    );

  return (
    <>
      <PageHeader
        title="Prompt"
        description="How the assistant behaves. Every change is kept as a version you can restore."
        actions={
          me.sites.length > 1 && (
            <Select
              value={site}
              onChange={(e) => {
                setSite(e.target.value);
                setDraft(null);
                setSelected(null);
              }}
              aria-label="Site"
            >
              {me.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )
        }
      />
      <div className="space-y-3 p-4 md:p-6">
        {error && <ErrorNote error={error} onRetry={reload} />}
        {notice && (
          <div
            role="status"
            className={cn(
              'rounded-md border px-3 py-2 text-[13px]',
              notice.tone === 'ok' ? 'bg-subtle' : 'border-danger/30 bg-danger/5 text-danger',
            )}
          >
            {notice.text}
          </div>
        )}

        {!data && !error && <Skeleton className="h-[32rem]" />}

        {data && !data.editable && (
          <Card>
            <Empty icon={<Lock />} title="This prompt is managed elsewhere">
              {data.reason}
            </Empty>
          </Card>
        )}

        {data?.editable && (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            {selected === null ? (
              <Card>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      Live prompt {data.version > 0 && <Badge>v{data.version}</Badge>}
                      {dirty && <Badge dot="var(--series-2)">Unpublished edit</Badge>}
                    </span>
                  }
                  description={
                    data.meta
                      ? `Published ${fmtRelative(data.meta.at)}${data.meta.by ? ` by ${data.meta.by}` : ''} · ${sourceLabel(
                          data.versions.find((v) => v.version === data.version) ?? { source: data.meta.source, restoredFrom: null },
                        )}`
                      : 'Not versioned yet — your first publish starts the history.'
                  }
                />
                <div className="space-y-3 px-4 pb-4">
                  <Textarea
                    value={text}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label="System prompt"
                    className="min-h-[28rem] resize-y font-mono text-[12.5px] leading-relaxed"
                  />
                  <p className="text-xs text-muted-foreground">
                    Instructions only — facts belong in the knowledge base. You can use{' '}
                    <code className="rounded bg-muted px-1">{'{{lead.name}}'}</code> and{' '}
                    <code className="rounded bg-muted px-1">{'{{context.pageUrl}}'}</code>.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={200}
                      placeholder="What changed? (optional)"
                      aria-label="Change note"
                      className="max-w-sm flex-1"
                    />
                    <span className={cn('ml-auto text-xs tabular-nums', over ? 'text-danger' : 'text-muted-foreground')}>
                      {normalize(text).length.toLocaleString()} / {data.limit.toLocaleString()}
                    </span>
                    {dirty && (
                      <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                        Discard
                      </Button>
                    )}
                    <Button onClick={() => void publish()} disabled={!dirty || over || busy}>
                      {busy ? 'Publishing…' : 'Publish'}
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <VersionView
                site={site}
                version={selected}
                live={data}
                busy={busy}
                onBack={() => setSelected(null)}
                onRestore={(v) => void restore(v)}
              />
            )}

            <Card>
              <CardHeader title="History" description={data.versions.length ? `${data.versions.length} version${data.versions.length === 1 ? '' : 's'}` : undefined} />
              {data.versions.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-muted-foreground">
                  No versions yet. The next publish — here or with <code className="rounded bg-muted px-1">murmur deploy</code> — starts the history.
                </p>
              ) : (
                <ul className="max-h-[36rem] overflow-auto border-t scroll-thin">
                  {data.versions.map((v) => (
                    <li key={v.version}>
                      <button
                        // The live version is what the editor shows.
                        onClick={() => setSelected(v.version === data.version ? null : v.version)}
                        aria-current={(selected ?? data.version) === v.version ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-start gap-2.5 border-b px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/60',
                          (selected ?? data.version) === v.version && 'bg-muted',
                        )}
                      >
                        <span className="w-8 shrink-0 pt-px text-xs font-medium tabular-nums">v{v.version}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[13px]">
                            {sourceLabel(v)}
                            {v.version === data.version && <Badge dot="#16a34a">Live</Badge>}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground" title={v.note ?? undefined}>
                            {v.note ?? v.author ?? '—'}
                          </span>
                        </span>
                        <span className="shrink-0 pt-px text-xs text-muted-foreground" title={fmtDateTime(v.createdAt)}>
                          {fmtRelative(v.createdAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

function VersionView({
  site,
  version,
  live,
  busy,
  onBack,
  onRestore,
}: {
  site: string;
  version: number;
  live: PromptView;
  busy: boolean;
  onBack: () => void;
  onRestore: (version: number) => void;
}) {
  const { data, error, reload } = useData(
    () => api<PromptVersion & { text: string }>(`/prompt/versions/${version}?site=${encodeURIComponent(site)}`),
    [site, version],
  );
  const isLive = version === live.version;
  const [mode, setMode] = useState<'diff' | 'full'>('diff');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [version]);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <History className="size-3.5 text-muted-foreground" /> Version {version}
            {isLive && <Badge dot="#16a34a">Live</Badge>}
          </span>
        }
        description={data ? `${sourceLabel(data)}${data.author ? ` · ${data.author}` : ''} · ${fmtDateTime(data.createdAt)}${data.note ? ` · ${data.note}` : ''}` : ' '}
        action={
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft /> Editor
          </Button>
        }
      />
      <div className="space-y-3 px-4 pb-4">
        {error && <ErrorNote error={error} onRetry={reload} />}
        {!data && !error && <Skeleton className="h-80" />}
        {data && (
          <>
            {!isLive && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented
                  label="View"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'diff', label: 'Changes from live' },
                    { value: 'full', label: 'Full text' },
                  ]}
                />
                {confirming ? (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    Make this live as v{live.version + 1}?
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => onRestore(version)} disabled={busy}>
                      {busy ? 'Restoring…' : 'Restore'}
                    </Button>
                  </span>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                    <RotateCcw /> Restore this version
                  </Button>
                )}
              </div>
            )}
            {isLive || mode === 'full' ? (
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border bg-subtle p-3 font-mono text-[12.5px] leading-relaxed scroll-thin">
                {data.text}
              </pre>
            ) : (
              <Diff before={live.text} after={data.text} />
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** What restoring would change: removed lines are live today, added lines come back. */
function Diff({ before, after }: { before: string; after: string }) {
  const lines = diffLines(normalize(before), normalize(after));
  if (lines.every((l) => l.kind === 'same')) return <p className="text-[13px] text-muted-foreground">Same text as the live prompt.</p>;
  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border font-mono text-[12.5px] leading-relaxed scroll-thin">
      {lines.map((line, i) => (
        <div key={i} className={cn('flex', line.kind === 'added' && 'bg-added', line.kind === 'removed' && 'bg-removed')}>
          <span className="w-6 shrink-0 select-none text-center text-muted-foreground" aria-hidden>
            {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
          </span>
          <span className="sr-only">{line.kind === 'added' ? 'Added: ' : line.kind === 'removed' ? 'Removed: ' : ''}</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap pr-3">{line.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}
