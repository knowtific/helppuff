import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, BookOpen, Bot, ChevronRight, History, Loader2, Lock, MessageSquare, MessageSquareOff, RotateCcw, Sparkles, Webhook, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PageHeader, SettingsTabs } from '../components/Shell';
import { AskAgent, agentRequest } from './Settings';
import { hostOf, PromptEditor, promptSuggestions, ToolDialog, unknownRefs, type Section } from '../components/Tools';
import { AddMenu, Canvas, Edge, Node, NodeButton, Stem, type Tint } from '../components/Flow';
import { useKnowledgeStatus } from '../components/knowledge';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, InfoTip, Input, Segmented, Select, Skeleton } from '../components/ui';
import { api, ApiError, type Me, type PromptVersion, type PromptView, type PublishResult, type ToolsList, type ToolView } from '../lib/api';
import { promptToolRefs } from '@helppuff/protocol/tools';
import { diffLines } from '../lib/diff';
import { cn, fmtDateTime, fmtNumber, fmtRelative, href, useData } from '../lib/utils';

/**
 * What happens around every chat, as a diagram that does not move: tools
 * before the chat, the prompt (with the knowledge above it and the webhooks
 * below), then the summary and labels and the tools after it. Each step is
 * where you change it: the prompt opens in a modal (its editor, its tools,
 * its history), "+ Add" offers your tools or a new one, and Knowledge,
 * Labels and Webhooks open their pages. In the prompt, `{{tool}}` lets the
 * assistant call one and `{{tool.key}}` reads what it returned.
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
  /** The prompt's modal. */
  const [open, setOpen] = useState(false);

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
        setOpen(false);
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

  const siteInfo = me.sites.find((s) => s.id === site);
  const knowledge = useKnowledgeStatus(Boolean(siteInfo?.knowledge));
  const hooks = useData(() => api<{ webhooks: { id: string; enabled: boolean }[] }>('/webhooks').catch(() => null), []);
  const labels = useData(() => api<{ labels: { id: string }[] }>('/labels').catch(() => null), []);
  const list = tools.data;
  const named = new Set(promptToolRefs(text).map((r) => r.name));
  const inPrompt = list?.tools.filter((t) => named.has(t.name)) ?? [];
  const learned = (knowledge.status?.pages.indexed ?? 0) + (knowledge.status?.pages.unchanged ?? 0);
  const hookCount = hooks.data?.webhooks.filter((h) => h.enabled).length ?? 0;
  const labelCount = labels.data?.labels.length ?? 0;
  /** A tool goes into the prompt as a sentence the owner can then reword. */
  const addToPrompt = (tool: Pick<ToolView, 'name' | 'kind'>) => {
    if (named.has(tool.name)) return;
    setDraft(`${text.replace(/\s+$/, '')}${text.trim() ? '\n' : ''}${tool.kind === 'extract' ? `Save it with {{${tool.name}}}.` : `Use {{${tool.name}}} when needed.`}`);
  };

  return (
    <>
      {/* While the prompt is open, the page behind it is out of reach: no focus, no screen reader, no clicks. */}
      <div inert={open}>
        <PageHeader
          title="Prompt & tools"
          description="What happens around every chat: tools before it, your prompt and knowledge during it, a summary, tools and webhooks after it. Click any step to change it."
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
          {tools.error && <ErrorNote error={tools.error} onRetry={tools.reload} />}
          {notice && !open && <NoticeLine notice={notice} />}
          {!data && !error && <Skeleton className="h-[28rem]" />}

          {data && (
            <Canvas label="How a chat runs">
              <div className="mx-auto flex max-w-6xl flex-col items-stretch lg:flex-row lg:items-center">
                {/* Before the chat */}
                <div className="lg:w-64 lg:shrink-0">
                  {list?.assistant ? (
                    <ToolsNode section="before" list={list} onOpen={(tool) => setDialog({ tool })} onNew={() => setDialog({ tool: null, section: 'before' })} onChange={(tool, on) => setFlag(tool, 'before', on)} />
                  ) : (
                    <Node tint="pink" icon={<ArrowDownToLine />} title="Before the chat" tip="Tools called when a chat starts run with HelpPuff’s assistant; this backend keeps its own." />
                  )}
                </div>
                <Edge icon={<MessageSquare />} label="Chat starts" />

                {/* During: knowledge, the prompt, and the webhooks that hear about it */}
                <div className="flex flex-col lg:w-60 lg:shrink-0">
                  {siteInfo?.knowledge ? (
                    <NodeButton tint="amber" icon={<BookOpen />} title="Knowledge" detail={knowledge.status ? `${fmtNumber(learned)} pages · ${fmtNumber(knowledge.status.chunks)} passages` : 'Loading…'} href={href({ page: 'knowledge' })} />
                  ) : (
                    <NodeButton tint="amber" icon={<BookOpen />} title="Knowledge" detail="Your backend’s own" className="pointer-events-none opacity-70" />
                  )}
                  <Stem />
                  <NodeButton
                    tint="lime"
                    icon={<Bot />}
                    title={
                      <>
                        Prompt {data.version > 0 && <Badge>v{data.version}</Badge>}
                      </>
                    }
                    detail={
                      !data.editable
                        ? 'Managed by your backend'
                        : dirty
                          ? 'Unpublished edit'
                          : `${inPrompt.length ? `${inPrompt.length} tool${inPrompt.length === 1 ? '' : 's'} · ` : ''}${data.meta ? `published ${fmtRelative(data.meta.at)}` : 'not published yet'}`
                    }
                    onClick={() => setOpen(true)}
                    className={cn('py-3.5', dirty && 'border-[var(--series-2)]')}
                  />
                  <Stem dashed />
                  <NodeButton tint="violet" icon={<Webhook />} title="Webhooks" detail={hookCount ? `${hookCount} endpoint${hookCount === 1 ? '' : 's'} · every event` : 'None yet'} href={href({ page: 'settings', id: 'webhooks' })} />
                </div>

                <Edge icon={<MessageSquareOff />} label="Chat ends" />

                {/* After the chat: the summary and labels, then the owner's tools */}
                <div className="relative flex flex-col gap-3 lg:w-64 lg:shrink-0 lg:pl-4">
                  <span className="absolute top-10 bottom-10 left-0 hidden w-px bg-border lg:block" aria-hidden />
                  <Node
                    tint="teal"
                    icon={<Sparkles />}
                    title="Summary & labels"
                    tip="Five quiet minutes after the last message, the AI writes a summary and adds labels. Both are on the conversation and in the conversation.completed webhook."
                  >
                    <div className="flex items-center justify-between text-[13px]">
                      <span>Summary</span>
                      <span className="text-xs text-muted-foreground">{me.summaries ? 'On' : 'Off'}</span>
                    </div>
                    <a href={href({ page: 'settings', id: 'labels' })} className="flex items-center justify-between text-[13px] hover:underline">
                      <span>Labels</span>
                      <span className="text-xs text-muted-foreground">{labelCount ? `${labelCount} →` : 'Add →'}</span>
                    </a>
                  </Node>
                  {list && <ToolsNode section="after" list={list} onOpen={(tool) => setDialog({ tool })} onNew={() => setDialog({ tool: null, section: 'after' })} onChange={(tool, on) => setFlag(tool, 'after', on)} />}
                </div>
              </div>
            </Canvas>
          )}
        </div>
      </div>

      {open && data && (
        <PromptModal
          data={data}
          site={site}
          text={text}
          dirty={dirty}
          over={over}
          busy={busy}
          note={note}
          notice={notice}
          list={list ?? null}
          suggestions={suggestions}
          selected={selected}
          nested={dialog !== null}
          onText={setDraft}
          onNote={setNote}
          onDiscard={() => setDraft(null)}
          onPublish={() => void publish()}
          onRestore={(v) => void restore(v)}
          onSelect={setSelected}
          onOpenTool={(tool) => setDialog({ tool })}
          onAddTool={addToPrompt}
          onNewTool={() => setDialog({ tool: null, section: 'prompt' })}
          onClose={() => setOpen(false)}
        />
      )}
      {dialog && list && (
        <ToolDialog
          site={site}
          tool={dialog.tool}
          {...(dialog.section ? { section: dialog.section } : {})}
          list={list}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            tools.reload();
            // A new tool made from the prompt goes into it at the end, ready to publish.
            if (saved && !dialog.tool && dialog.section === 'prompt') addToPrompt(saved);
          }}
        />
      )}
    </>
  );
}

function NoticeLine({ notice }: { notice: NonNullable<Notice> }) {
  return (
    <div role="status" className={cn('rounded-md border px-3 py-2 text-[13px]', notice.tone === 'ok' ? 'bg-subtle' : 'border-danger/30 bg-danger/5 text-danger')}>
      {notice.text}
    </div>
  );
}

const SECTION: Record<Section, { title: string; tint: Tint; icon: ReactNode; tip: string }> = {
  before: {
    title: 'Before the chat',
    tint: 'pink',
    icon: <ArrowDownToLine />,
    tip: 'Called when a chat starts, with the pre-chat form’s answers, so the first answer already knows what they returned. For example: look the visitor up in your CRM by their email.',
  },
  after: {
    title: 'After the chat',
    tint: 'blue',
    icon: <ArrowUpFromLine />,
    tip: 'Called five quiet minutes after the last message, with the transcript, summary, contact and every tool’s data. For example: send each finished chat to your CRM or a sheet.',
  },
};

/** Before or after the chat: its tools, each removable, and "+ Add" (one you have, or a new one). */
function ToolsNode({
  section,
  list,
  onOpen,
  onNew,
  onChange,
}: {
  section: Section;
  list: ToolsList;
  onOpen: (tool: ToolView) => void;
  onNew: () => void;
  onChange: (tool: ToolView, on: boolean) => Promise<void>;
}) {
  const copy = SECTION[section];
  const inSection = list.tools.filter((t) => t[section]);
  const others = list.tools.filter((t) => t.kind === 'http' && !t[section]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (tool: ToolView, on: boolean) => {
    setBusy(tool.id);
    setError(null);
    try {
      await onChange(tool, on);
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Node tint={copy.tint} icon={copy.icon} title={copy.title} tip={copy.tip}>
      {inSection.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No tools</p>
      ) : (
        <ul className="space-y-1.5">
          {inSection.map((tool) => (
            <li key={tool.id} className="flex items-center gap-1 rounded-md border px-2 py-1.5">
              <button type="button" onClick={() => onOpen(tool)} className="min-w-0 flex-1 text-left">
                <span className={cn('block truncate font-mono text-[12.5px]', !tool.enabled && 'text-muted-foreground line-through')}>{tool.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {tool.method} {hostOf(tool.url)}
                  {tool.lastStatus !== null && tool.lastStatus >= 400 && <span className="text-danger"> · last {tool.lastStatus}</span>}
                </span>
              </button>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => void toggle(tool, false)} disabled={busy === tool.id} aria-label={`Remove ${tool.name} from ${copy.title.toLowerCase()}`}>
                {busy === tool.id ? <Loader2 className="animate-spin" /> : <X />}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AddMenu
        label={`Add a tool to ${copy.title.toLowerCase()}`}
        items={others.map((t) => ({ key: t.id, label: t.name, detail: `${t.method} ${hostOf(t.url)}`, onSelect: () => void toggle(t, true) }))}
        newLabel="New tool"
        onNew={onNew}
        disabled={list.tools.length >= list.limits.tools && others.length === 0}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </Node>
  );
}

/** The prompt, opened from its node: write it (with its tools), or look back through its versions. */
function PromptModal({
  data,
  site,
  text,
  dirty,
  over,
  busy,
  note,
  notice,
  list,
  suggestions,
  selected,
  nested,
  onText,
  onNote,
  onDiscard,
  onPublish,
  onRestore,
  onSelect,
  onOpenTool,
  onAddTool,
  onNewTool,
  onClose,
}: {
  data: PromptView;
  site: string;
  text: string;
  dirty: boolean;
  over: boolean;
  busy: boolean;
  note: string;
  notice: Notice;
  list: ToolsList | null;
  suggestions: ReturnType<typeof promptSuggestions>;
  selected: number | null;
  nested: boolean;
  onText: (text: string) => void;
  onNote: (note: string) => void;
  onDiscard: () => void;
  onPublish: () => void;
  onRestore: (version: number) => void;
  onSelect: (version: number | null) => void;
  onOpenTool: (tool: ToolView) => void;
  onAddTool: (tool: ToolView) => void;
  onNewTool: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'edit' | 'history'>('edit');
  // Escape closes it, unless a tool's dialog is open on top (that one closes first). The draft is kept either way.
  useEffect(() => {
    const escape = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && !nested && onClose();
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [nested, onClose]);
  const named = new Set(promptToolRefs(text).map((r) => r.name));
  const notNamed = list?.tools.filter((t) => !named.has(t.name)) ?? [];
  const lines = new Set(text.split('\n').map((l) => l.trim()));
  const repeats = data.overlaps.filter((o) => lines.has(o.text));

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[5vh]" role="dialog" aria-modal="true" aria-labelledby="prompt-dialog-title">
      <div className="w-full max-w-3xl rounded-xl border bg-card shadow-xl">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <h2 id="prompt-dialog-title" className="flex items-center gap-2 text-[15px] font-semibold">
            <Bot className="size-4 text-[#65a30d]" aria-hidden /> Prompt {data.version > 0 && <Badge>v{data.version}</Badge>}
            {dirty && <Badge dot="var(--series-2)">Unpublished edit</Badge>}
            <InfoTip label="How to write a prompt">
              Only what is specific to your business, and what your website doesn’t say or says wrongly: this wins over the website. Goal, tone and length
              are settings, and HelpPuff adds its own rules. Type <code className="rounded bg-muted px-1">{'{{'}</code> to insert a tool, a business detail or
              what the visitor filled in.
            </InfoTip>
          </h2>
          <Segmented
            label="Prompt view"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'edit', label: 'Edit' },
              { value: 'history', label: data.versions.length ? `History (${data.versions.length})` : 'History' },
            ]}
          />
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <div className="space-y-3 p-4">
          {notice && <NoticeLine notice={notice} />}
          {!data.editable ? (
            <Empty icon={<Lock />} title="This prompt is managed elsewhere">
              {data.reason}
            </Empty>
          ) : tab === 'history' ? (
            selected === null ? (
              <Versions data={data} onSelect={onSelect} />
            ) : (
              <VersionView site={site} version={selected} live={data} busy={busy} onBack={() => onSelect(null)} onRestore={onRestore} />
            )
          ) : (
            <>
              {repeats.length > 0 && (
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
                      onText(
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
              )}
              <PromptEditor value={text} onChange={onText} suggestions={suggestions} label="System prompt" placeholder={PROMPT_PLACEHOLDER} className="min-h-[22rem] resize-y font-mono text-[12.5px] leading-relaxed" />
              {list?.assistant && (
                <div className="flex flex-wrap items-center gap-2">
                  <PromptTools text={text} list={list} onOpen={onOpenTool} />
                  <AddMenu
                    label="Add a tool to the prompt"
                    items={notNamed.map((t) => ({ key: t.id, label: t.name, detail: t.kind === 'extract' ? 'Saves what the visitor says' : `${t.method} ${hostOf(t.url)}`, onSelect: () => onAddTool(t) }))}
                    newLabel="New tool"
                    onNew={onNewTool}
                  />
                </div>
              )}
              {data.builtIn && (
                <details className="group rounded-md border">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium marker:hidden">
                    <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                    What HelpPuff adds
                    <InfoTip label="About what HelpPuff adds">Added to every answer from your settings and HelpPuff’s rules. Read-only: no need to repeat any of it in your prompt.</InfoTip>
                  </summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground scroll-thin">{data.builtIn}</pre>
                </details>
              )}
            </>
          )}
        </div>

        {data.editable && tab === 'edit' && (
          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
            <Input value={note} onChange={(e) => onNote(e.target.value)} maxLength={200} placeholder="What changed? (optional)" aria-label="Change note" className="max-w-sm flex-1" />
            <span className="ml-auto" />
            {/* The length matters only near the limit. */}
            {normalize(text).length > data.limit * 0.9 && (
              <span className={cn('text-xs tabular-nums', over ? 'text-danger' : 'text-muted-foreground')}>
                {normalize(text).length.toLocaleString()} / {data.limit.toLocaleString()}
              </span>
            )}
            {dirty && (
              <Button variant="ghost" onClick={onDiscard} disabled={busy}>
                Discard
              </Button>
            )}
            <Button onClick={onPublish} disabled={!dirty || over || busy}>
              {busy ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Every version, newest first: who, from where, when; one opens to compare or restore. */
function Versions({ data, onSelect }: { data: PromptView; onSelect: (version: number | null) => void }) {
  if (!data.versions.length) return <p className="text-[13px] text-muted-foreground">No versions yet.</p>;
  return (
    <ul className="max-h-[28rem] overflow-auto rounded-md border scroll-thin">
      {data.versions.map((v) => (
        <li key={v.version}>
          <button
            onClick={() => onSelect(v.version === data.version ? null : v.version)}
            className="flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/60"
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
