import { ArrowLeft, ChevronRight, History, Lock, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader, SettingsTabs } from '../components/Shell';
import { AskAgent, agentRequest } from './Settings';
import { PromptEditor, promptSuggestions, RunSection, SectionNumber, ToolDialog, ToolLibrary, unknownRefs, type Section } from '../components/Tools';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, InfoTip, Input, Segmented, Select, Skeleton } from '../components/ui';
import { api, ApiError, type Me, type PromptVersion, type PromptView, type PublishResult, type ToolsList, type ToolView } from '../lib/api';
import { promptToolRefs } from '@helppuff/protocol/tools';
import { diffLines } from '../lib/diff';
import { cn, fmtDateTime, fmtRelative, useData } from '../lib/utils';

/**
 * The assistant's system prompt, versioned, and the site's tools around it,
 * top to bottom as a chat runs: (1) tools called before the chat, (2) the
 * prompt, where `{{tool}}` lets the assistant call one and `{{tool.key}}`
 * reads what it returned, (3) tools called after it. The tool library is on
 * the right.
 *
 * Publishing makes a new prompt version live; restoring publishes an old
 * text as a new version, so nothing in the history is ever lost.
 * `helppuff deploy` publishes into the same history, and refuses to overwrite
 * a version made here that prompt.md has not pulled. Tools save at once.
 */

const normalize = (text: string) => text.replace(/\r\n?/g, '\n').trim();

function sourceLabel(v: Pick<PromptVersion, 'source' | 'restoredFrom'>): string {
  if (v.source === 'restore') return `Restored v${v.restoredFrom ?? '?'}`;
  return v.source === 'dashboard' ? 'Dashboard' : 'CLI deploy';
}

type Notice = { tone: 'ok' | 'warn'; text: string } | null;

/** How to write it, shown while the prompt is empty: a situation, then roughly what to say. */
const PROMPT_PLACEHOLDER = `## Prices
When you give a plan price, always say "from", "+ GST" and the 12-month minimum term.

## Quotes only
Custom builds and eCommerce are quoted individually. If asked for a price, say something like:
"That's scoped to what you need, so I can't give a fixed price here. Start here and the team will quote it: https://example.com/start"

## Out of date on the website
The free audit is no longer a video. Never call it one.`;

export function Prompt({ me }: { me: Me }) {
  const [site, setSite] = useState(me.sites[0]?.id ?? '');
  const { data, error, reload } = useData(() => api<PromptView>(`/prompt?site=${encodeURIComponent(site)}`), [site]);
  const tools = useData(() => api<ToolsList>(`/tools?site=${encodeURIComponent(site)}`), [site]);
  const [dialog, setDialog] = useState<{ tool: ToolView | null; section?: Section | 'prompt' } | null>(null);
  const suggestions = useMemo(() => promptSuggestions(tools.data ?? null), [tools.data]);
  const setFlag = async (tool: ToolView, section: Section, on: boolean) => {
    await api<ToolView>(`/tools/${tool.id}`, { method: 'PATCH', json: { site, [section]: on } });
    tools.reload();
  };
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
        title="Prompt & tools"
        description="What the assistant is told, and the tools it can call."
        help="Prompts-and-Instructions"
        actions={
          <>
            <AskAgent request={agentRequest('prompt', 'Prompt & tools')} />
            {me.sites.length > 1 && (
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
            )}
          </>
        }
      />
      <SettingsTabs me={me} route={{ page: 'prompt' }} />
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

        {data && (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-4">
              {tools.error && <ErrorNote error={tools.error} onRetry={tools.reload} />}
              {tools.data?.assistant && (
                <RunSection section="before" list={tools.data} onOpen={(tool) => setDialog({ tool })} onNew={() => setDialog({ tool: null, section: 'before' })} onChange={(tool, on) => setFlag(tool, 'before', on)} />
              )}
              {!data.editable ? (
                <Card>
                  <Empty icon={<Lock />} title="This prompt is managed elsewhere">
                    {data.reason}
                  </Empty>
                </Card>
              ) : selected === null ? (
                <Card>
                  <CardHeader
                    title={
                      <span className="flex items-center gap-2">
                        {tools.data?.assistant && <SectionNumber n={2} />}
                        Prompt {data.version > 0 && <Badge>v{data.version}</Badge>}
                        {dirty && <Badge dot="var(--series-2)">Unpublished edit</Badge>}
                      </span>
                    }
                    tip={{
                      label: 'How to write a prompt',
                      text: (
                        <>
                          Only what is specific to your business, and what your website doesn’t say or says wrongly: this wins over the website. Goal,
                          tone and length are settings, and HelpPuff adds its own rules. Type <code className="rounded bg-muted px-1">{'{{'}</code> to insert a
                          tool, a business detail or what the visitor filled in.
                        </>
                      ),
                    }}
                    description={
                      data.meta
                        ? `Published ${fmtRelative(data.meta.at)}${data.meta.by ? ` by ${data.meta.by}` : ''} · ${sourceLabel(
                            data.versions.find((v) => v.version === data.version) ?? { source: data.meta.source, restoredFrom: null },
                          )}`
                        : undefined
                    }
                  />
                  <div className="space-y-3 px-4 pb-4">
                    {(() => {
                      // Lines of the live prompt that settings or built-in rules already cover, still in the text being edited.
                      const lines = new Set(text.split('\n').map((l) => l.trim()));
                      const repeats = data.overlaps.filter((o) => lines.has(o.text));
                      if (!repeats.length) return null;
                      return (
                        <div className="rounded-md border bg-subtle px-3 py-2.5 text-xs" role="note">
                          <p className="font-medium">{repeats.length === 1 ? 'One line is already covered' : `${repeats.length} lines are already covered`} by your settings or HelpPuff’s rules</p>
                          <ul className="mt-1.5 space-y-1 text-muted-foreground">
                            {repeats.map((o) => (
                              <li key={o.line}>
                                <span className="text-foreground">“{o.text.length > 90 ? `${o.text.slice(0, 90)}…` : o.text}”</span> — {o.why}
                              </li>
                            ))}
                          </ul>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => {
                              const drop = new Set(repeats.map((o) => o.text));
                              setDraft(
                                text
                                  .split('\n')
                                  .filter((l) => !drop.has(l.trim()))
                                  .join('\n')
                                  .replace(/\n{3,}/g, '\n\n')
                                  .trim(),
                              );
                            }}
                          >
                            Remove these lines
                          </Button>
                        </div>
                      );
                    })()}
                    <PromptEditor
                      value={text}
                      onChange={setDraft}
                      suggestions={suggestions}
                      label="System prompt"
                      placeholder={PROMPT_PLACEHOLDER}
                      className="min-h-[24rem] resize-y font-mono text-[12.5px] leading-relaxed"
                    />
                    <PromptTools text={text} list={tools.data ?? null} onOpen={(tool) => setDialog({ tool })} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={200}
                        placeholder="What changed? (optional)"
                        aria-label="Change note"
                        className="max-w-sm flex-1"
                      />
                      <span className="ml-auto" />
                      {/* The length matters only near the limit. */}
                      {normalize(text).length > data.limit * 0.9 && (
                        <span className={cn('text-xs tabular-nums', over ? 'text-danger' : 'text-muted-foreground')}>
                          {normalize(text).length.toLocaleString()} / {data.limit.toLocaleString()}
                        </span>
                      )}
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
              {tools.data && (
                <RunSection section="after" list={tools.data} onOpen={(tool) => setDialog({ tool })} onNew={() => setDialog({ tool: null, section: 'after' })} onChange={(tool, on) => setFlag(tool, 'after', on)} />
              )}
            </div>

            <div className="space-y-4">
              {tools.data ? (
                <ToolLibrary list={tools.data} prompt={text} onOpen={(tool) => setDialog({ tool })} onNew={() => setDialog({ tool: null })} />
              ) : (
                !tools.error && <Skeleton className="h-40" />
              )}

              {data.builtIn && (
                <Card>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-[13px] font-medium marker:hidden">
                      <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                      What HelpPuff adds
                      <InfoTip label="About what HelpPuff adds" align="end">
                        Added to every answer from your settings and HelpPuff’s rules. Read-only: no need to repeat any of it in your prompt.
                      </InfoTip>
                    </summary>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground scroll-thin">{data.builtIn}</pre>
                  </details>
                </Card>
              )}

              <Card>
                <CardHeader title="History" description={data.versions.length ? `${data.versions.length} version${data.versions.length === 1 ? '' : 's'}` : undefined} />
                {data.versions.length === 0 ? (
                  <p className="px-4 pb-4 text-[13px] text-muted-foreground">No versions yet.</p>
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
          </div>
        )}
      </div>
      {dialog && tools.data && (
        <ToolDialog
          site={site}
          tool={dialog.tool}
          {...(dialog.section ? { section: dialog.section } : {})}
          list={tools.data}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            tools.reload();
            // A new tool made from the prompt section goes into the prompt at the end, ready to publish.
            if (saved && !dialog.tool && dialog.section === 'prompt' && !promptToolRefs(text).some((r) => r.name === saved.name)) {
              setDraft(`${text.replace(/\s+$/, '')}${text.trim() ? '\n' : ''}${saved.kind === 'extract' ? `Save it with {{${saved.name}}}.` : `Use {{${saved.name}}} when needed.`}`);
            }
          }}
        />
      )}
    </>
  );
}

/** The tools this prompt names, and names that are not a tool (typos). */
function PromptTools({ text, list, onOpen }: { text: string; list: ToolsList | null; onOpen: (tool: ToolView) => void }) {
  if (!list?.assistant) return null;
  const named = new Set(promptToolRefs(text).map((r) => r.name));
  const used = list.tools.filter((t) => named.has(t.name));
  const unknown = unknownRefs(text, list);
  // Nothing to show until the prompt names a tool (or a name that is not one).
  if (!used.length && !unknown.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {used.length > 0 && <span className="text-muted-foreground">Tools:</span>}
      {used.map((t) => (
        <button key={t.id} type="button" onClick={() => onOpen(t)} className={cn('rounded border px-1.5 py-0.5 font-mono hover:bg-muted', !t.enabled && 'text-muted-foreground line-through')}>
          {t.name}
        </button>
      ))}
      {unknown.length > 0 && (
        <span className="w-full text-danger" role="note">
          Not a tool or a known value: {unknown.map((u) => `{{${u}}}`).join(', ')}. Check the spelling, or add the tool.
        </span>
      )}
    </div>
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
