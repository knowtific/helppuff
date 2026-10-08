import { ArrowDown, ArrowUp, ExternalLink, Loader2, Lock, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type HomeLinks, type HomeSettings, type HomeSuggestion, type PipelineView, type SettingsView, type Shortcut, type ShortcutAction } from '../lib/api';
import { cn, href, useData } from '../lib/utils';
import { Badge, Button, Card, CardHeader, ErrorNote, Input, Select, Skeleton } from './ui';

/**
 * Settings → Home screen: the widget's first screen. Its heading, the buttons
 * (a question, a page, a call, an email, a form, a flow) and the list of
 * useful pages. Until the owner saves it, the widget shows what HelpPuff
 * suggested from the website; this page starts from that. "Suggest from my
 * site" fills in more for the owner to keep or drop.
 */

const MAX_SHORTCUTS = 8;
const MAX_LINKS = 10;
const KINDS: { value: ShortcutAction['kind']; label: string; icon: string }[] = [
  { value: 'reply', label: 'Ask a question', icon: 'chat' },
  { value: 'url', label: 'Open a page', icon: 'external' },
  { value: 'tel', label: 'Call', icon: 'phone' },
  { value: 'email', label: 'Email', icon: 'mail' },
  { value: 'form', label: 'Open a form', icon: 'calendar' },
  { value: 'flow', label: 'Ask a few questions', icon: 'quote' },
];
const ICONS = ['chat', 'phone', 'mail', 'calendar', 'quote', 'pin', 'clock', 'wrench', 'heart', 'info', 'book', 'external', 'person', 'arrow-right', 'check'];
const DEFAULT_HOME: HomeSettings = { title: 'Hi there', subtitle: 'Ask anything, or pick a shortcut.', shortcuts: [], links: null };

const newId = (kind: string) => `${kind}-${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`;

/** A shortcut's action rebuilt for another kind, keeping its label. */
function actionFor(kind: ShortcutAction['kind'], id: string, label: string, forms: Option[], flows: Option[]): ShortcutAction {
  switch (kind) {
    case 'reply':
      return { id, kind, label, value: label };
    case 'url':
      return { id, kind, label, url: 'https://', newTab: true };
    case 'tel':
      return { id, kind, label, phone: '' };
    case 'email':
      return { id, kind, label, email: '' };
    case 'form':
      return { id, kind, label, formId: forms[0]?.id ?? '' };
    case 'flow':
      return { id, kind, label, flowId: flows[0]?.id ?? '' };
  }
}

const question = (text: string, id: string): Shortcut => ({ id, label: text, icon: 'chat', action: { id, kind: 'reply', label: text, value: text } });

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const next = [...list];
  const to = index + by;
  if (to < 0 || to >= next.length) return list;
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

type Option = { id: string; title: string };

function Order({ index, length, label, onMove }: { index: number; length: number; label: string; onMove: (by: -1 | 1) => void }) {
  return (
    <div className="flex shrink-0 flex-col">
      <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>
        <ArrowUp className="size-3.5" />
      </button>
      <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={index === length - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`}>
        <ArrowDown className="size-3.5" />
      </button>
    </div>
  );
}

function Labeled({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="block text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

/** What the button does, by kind: the one value it needs. */
function TargetInput({ shortcut, forms, flows, onChange }: { shortcut: Shortcut; forms: Option[]; flows: Option[]; onChange: (action: ShortcutAction) => void }) {
  const a = shortcut.action;
  const name = shortcut.label || 'button';
  switch (a.kind) {
    case 'reply':
      return <Input value={a.value} maxLength={500} onChange={(e) => onChange({ ...a, value: e.target.value })} aria-label={`Message ${name} sends`} placeholder="The message sent for the visitor" />;
    case 'url':
      return <Input type="url" value={a.url} maxLength={2048} onChange={(e) => onChange({ ...a, url: e.target.value })} aria-label={`Page ${name} opens`} placeholder="https://…" />;
    case 'tel':
      return <Input type="tel" value={a.phone} maxLength={40} onChange={(e) => onChange({ ...a, phone: e.target.value })} aria-label={`Number ${name} calls`} placeholder="02 9000 0000" />;
    case 'email':
      return <Input type="email" value={a.email} maxLength={200} onChange={(e) => onChange({ ...a, email: e.target.value })} aria-label={`Address ${name} writes to`} placeholder="hello@…" />;
    case 'form':
      return (
        <Select value={a.formId} onChange={(e) => onChange({ ...a, formId: e.target.value })} aria-label={`Form ${name} opens`} className="w-full">
          {!forms.length && <option value="">No forms yet</option>}
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </Select>
      );
    case 'flow':
      return (
        <Select value={a.flowId} onChange={(e) => onChange({ ...a, flowId: e.target.value })} aria-label={`Questions ${name} asks`} className="w-full">
          {!flows.length && <option value="">No question flows yet</option>}
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id}: {f.title}
            </option>
          ))}
        </Select>
      );
  }
}

function ShortcutRow({ shortcut, index, count, forms, flows, onChange, onMove, onRemove }: { shortcut: Shortcut; index: number; count: number; forms: Option[]; flows: Option[]; onChange: (next: Shortcut) => void; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  const [more, setMore] = useState(false);
  const a = shortcut.action;
  const name = shortcut.label || 'button';
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Order index={index} length={count} label={name} onMove={onMove} />
        <Select value={shortcut.icon ?? 'chat'} onChange={(e) => onChange({ ...shortcut, icon: e.target.value })} aria-label={`${name} icon`} className="w-28">
          {ICONS.map((icon) => (
            <option key={icon} value={icon}>
              {icon}
            </option>
          ))}
        </Select>
        <Input
          value={shortcut.label}
          maxLength={80}
          onChange={(e) => {
            const label = e.target.value;
            // A question that says what it sends keeps doing so.
            const action = a.kind === 'reply' && a.value === shortcut.label ? { ...a, label, value: label } : { ...a, label: label || a.label };
            onChange({ ...shortcut, label, action });
          }}
          aria-label="Button label"
          placeholder="What the button says"
          className="min-w-40 flex-1"
        />
        <Select
          value={a.kind}
          onChange={(e) => {
            const kind = e.target.value as ShortcutAction['kind'];
            onChange({ ...shortcut, icon: KINDS.find((k) => k.value === kind)?.icon ?? shortcut.icon, action: actionFor(kind, a.id, shortcut.label, forms, flows) });
          }}
          aria-label={`What ${name} does`}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMore(!more)} aria-expanded={more}>
          More
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove ${name}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      {(a.kind !== 'reply' || more) && (
        <div className="mt-2 grid gap-2 pl-7 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TargetInput shortcut={shortcut} forms={forms} flows={flows} onChange={(action) => onChange({ ...shortcut, action })} />
          </div>
          {a.kind === 'url' && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={a.newTab !== false} onChange={(e) => onChange({ ...shortcut, action: { ...a, newTab: e.target.checked } })} />
              Open in a new tab
            </label>
          )}
        </div>
      )}
      {more && (
        <div className="mt-2 grid gap-2 pl-7 sm:grid-cols-2">
          <Labeled label="A line under the label">
            <Input value={shortcut.description ?? ''} maxLength={160} onChange={(e) => onChange({ ...shortcut, description: e.target.value || undefined })} />
          </Labeled>
          <Labeled label="Only on these pages (optional)">
            <Input
              value={(shortcut.paths ?? []).join(', ')}
              onChange={(e) => {
                const paths = e.target.value.split(',').map((p) => p.trim()).filter(Boolean);
                onChange({ ...shortcut, paths: paths.length ? paths : undefined });
              }}
              placeholder="/services/**, /pricing"
            />
          </Labeled>
        </div>
      )}
    </li>
  );
}

/** Roughly what the visitor sees: the heading, the buttons, the links. */
function Preview({ home, quote, accent }: { home: HomeSettings; quote: string | null; accent: string }) {
  const tiles = [...(quote ? [{ id: 'job-quote', label: quote, description: 'A few quick questions.' }] : []), ...home.shortcuts].slice(0, MAX_SHORTCUTS);
  return (
    <div className="overflow-hidden rounded-xl border bg-background text-[13px] shadow-sm" aria-label="Preview" role="figure">
      <div className="px-4 pt-5 pb-3" style={{ background: `linear-gradient(180deg, ${accent}1f, transparent)` }}>
        <p className="text-lg font-semibold tracking-tight">{home.title || DEFAULT_HOME.title}</p>
        {home.subtitle && <p className="text-muted-foreground">{home.subtitle}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 px-3">
        {tiles.map((t) => (
          <div key={t.id} className="rounded-lg bg-muted/60 p-2.5">
            <p className="font-medium leading-snug">{t.label || '…'}</p>
            {t.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{t.description}</p>}
          </div>
        ))}
      </div>
      <div className="px-3 pt-3">
        <div className="rounded-lg py-2 text-center font-medium text-white" style={{ background: accent }}>
          Start a conversation
        </div>
      </div>
      {home.links && home.links.items.length > 0 && (
        <div className="px-3 pt-3 pb-1">
          <p className="mb-1 text-xs text-muted-foreground">{home.links.title}</p>
          {home.links.items.map((l, i) => (
            <div key={`${l.url}-${i}`} className="mb-1.5 rounded-lg bg-muted/60 px-2.5 py-2">
              <p className="font-medium">{l.label || '…'}</p>
              {l.description && <p className="text-[11px] text-muted-foreground">{l.description}</p>}
            </div>
          ))}
        </div>
      )}
      <div className="h-3" />
    </div>
  );
}

/** The home screen to edit: what is saved, else what the widget shows now (the suggestions). */
function startingPoint(view: SettingsView): { home: HomeSettings; suggested: boolean } {
  const saved = view.settings.home ?? { ...DEFAULT_HOME, shortcuts: [] };
  const s = view.suggestedHome;
  if (!s) return { home: saved, suggested: false };
  const questions = !saved.shortcuts.some((x) => x.action.kind === 'reply') ? s.questions.map((q, i) => question(q, `ask-${i + 1}`)) : [];
  const links = saved.links ?? s.links;
  return { home: { ...saved, shortcuts: [...questions, ...saved.shortcuts].slice(0, MAX_SHORTCUTS), links }, suggested: Boolean(questions.length || (!saved.links && s.links)) };
}

export function HomeScreenSettings({ knowledge }: { knowledge: boolean }) {
  const { data, error, reload } = useData(() => api<SettingsView>('/settings'), []);
  const quote = useData(() => api<PipelineView>('/jobs/pipeline').catch(() => null), []).data?.pipeline.quote ?? null;
  const [draft, setDraft] = useState<HomeSettings | null>(null);
  const [base, setBase] = useState('');
  const [fromSuggestions, setFromSuggestions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const start = startingPoint(data);
    setDraft(start.home);
    // The suggestions count as a change: saving makes them the owner's.
    setBase(start.suggested ? '' : JSON.stringify(start.home));
    setFromSuggestions(start.suggested);
  }, [data]);

  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data || !draft) return <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>;

  const forms = data.forms ?? [];
  const flows = data.flows ?? [];
  const quoteLabel = quote?.enabled ? quote.label : null;
  const room = MAX_SHORTCUTS - (quoteLabel ? 1 : 0);
  const dirty = JSON.stringify(draft) !== base;
  const set = (patch: Partial<HomeSettings>) => {
    setDraft({ ...draft, ...patch });
    setNote(null);
  };
  const setShortcut = (index: number, next: Shortcut) => set({ shortcuts: draft.shortcuts.map((x, i) => (i === index ? next : x)) });
  const setLinks = (links: HomeLinks | null) => set({ links });

  const suggest = async () => {
    setSuggesting(true);
    setSaveError(null);
    try {
      const s = await api<HomeSuggestion>('/home/suggest', { method: 'POST', json: {} });
      const asked = new Set(draft.shortcuts.filter((x) => x.action.kind === 'reply').map((x) => x.label.toLowerCase()));
      const kinds = new Set(draft.shortcuts.map((x) => x.action.kind));
      // A way to reach the business first: more questions only fill the room left.
      const added = [
        ...s.contact.filter((c) => !kinds.has(c.action.kind)).map((c) => ({ ...c, id: newId(c.action.kind), action: { ...c.action, id: newId(c.action.kind) } })),
        ...s.questions.filter((q) => !asked.has(q.toLowerCase())).map((q) => question(q, newId('ask'))),
      ];
      const shortcuts = [...draft.shortcuts, ...added].slice(0, room);
      const known = new Set((draft.links?.items ?? []).map((l) => l.url));
      const links = s.links ? { title: draft.links?.title ?? s.links.title, items: [...(draft.links?.items ?? []), ...s.links.items.filter((l) => !known.has(l.url))].slice(0, MAX_LINKS) } : draft.links;
      setDraft({ ...draft, shortcuts, links });
      setNote(shortcuts.length - draft.shortcuts.length + (links?.items.length ?? 0) - (draft.links?.items.length ?? 0) > 0 ? 'Added suggestions from your website. Keep what you like, then Save.' : 'Nothing new to suggest.');
    } catch (thrown) {
      setSaveError((thrown as Error).message);
    } finally {
      setSuggesting(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const home = { ...draft, links: draft.links && draft.links.items.length ? draft.links : null };
      const result = await api<SettingsView>('/settings', { method: 'PUT', json: { settings: { home } } });
      const saved = result.settings.home ?? home;
      setDraft(saved);
      setBase(JSON.stringify(saved));
      setFromSuggestions(false);
      setNote('Saved. Live on the widget within a minute.');
    } catch (thrown) {
      setSaveError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        {fromSuggestions && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-[13px]" role="status">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <p>The widget shows these now: questions and pages HelpPuff picked from your website. Change anything, then Save to make them yours.</p>
          </div>
        )}
        {knowledge && (
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => void suggest()} disabled={suggesting}>
              {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles />} Suggest from my site
            </Button>
          </div>
        )}

        <Card role="region" aria-label="Heading">
          <CardHeader title="Heading" description="The first thing visitors read when they open the chat." />
          <div className="grid gap-3 border-t p-4 sm:grid-cols-2">
            <Labeled label="Title">
              <Input value={draft.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
            </Labeled>
            <Labeled label="Line under it">
              <Input value={draft.subtitle} maxLength={240} onChange={(e) => set({ subtitle: e.target.value })} />
            </Labeled>
          </div>
        </Card>

        <Card role="region" aria-label="Buttons">
          <CardHeader title="Buttons" description={`Up to ${MAX_SHORTCUTS}, in order: a question to ask, a page, a call, an email, a form, or a few questions.`} />
          <ul className="divide-y border-t">
            {quoteLabel && (
              <li className="flex items-center gap-2 bg-subtle px-4 py-2.5 text-[13px]">
                <Lock className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="flex-1 font-medium">{quoteLabel}</span>
                <a href={href({ page: 'settings', id: 'jobs' })} className="text-xs text-muted-foreground hover:text-foreground">
                  Set in Settings → Jobs
                </a>
              </li>
            )}
            {draft.shortcuts.length === 0 && !quoteLabel && <li className="px-4 py-3 text-[13px] text-muted-foreground">No buttons: visitors start with a message.</li>}
            {draft.shortcuts.map((shortcut, index) => (
              <ShortcutRow
                key={shortcut.id}
                shortcut={shortcut}
                index={index}
                count={draft.shortcuts.length}
                forms={forms}
                flows={flows}
                onChange={(next) => setShortcut(index, next)}
                onMove={(by) => set({ shortcuts: move(draft.shortcuts, index, by) })}
                onRemove={() => set({ shortcuts: draft.shortcuts.filter((_, i) => i !== index) })}
              />
            ))}
          </ul>
          <div className="flex flex-wrap gap-1 border-t px-4 py-2.5">
            <Button type="button" variant="ghost" size="sm" disabled={draft.shortcuts.length >= room} onClick={() => set({ shortcuts: [...draft.shortcuts, question('', newId('ask'))] })}>
              <Plus /> Add a question
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={draft.shortcuts.length >= room}
              onClick={() => {
                const id = newId('link');
                set({ shortcuts: [...draft.shortcuts, { id, label: '', icon: 'external', action: actionFor('url', id, 'Open', forms, flows) }] });
              }}
            >
              <Plus /> Add a button
            </Button>
            {draft.shortcuts.length >= room && <span className="self-center text-xs text-muted-foreground">That’s the most the widget shows.</span>}
          </div>
        </Card>

        <Card role="region" aria-label="Useful pages">
          <CardHeader
            title="Useful pages"
            description="Links under the buttons: prices, services, booking. They open your site in a new tab."
            action={
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={draft.links !== null} onChange={(e) => setLinks(e.target.checked ? { title: 'Useful pages', items: draft.links?.items ?? [] } : null)} />
                Show
              </label>
            }
          />
          {draft.links && (
            <>
              <div className="border-t p-4">
                <Labeled label="Heading" className="max-w-xs">
                  <Input value={draft.links.title} maxLength={120} onChange={(e) => setLinks({ ...draft.links!, title: e.target.value })} />
                </Labeled>
              </div>
              <ul className="divide-y border-t">
                {draft.links.items.length === 0 && <li className="px-4 py-3 text-[13px] text-muted-foreground">No links yet.</li>}
                {draft.links.items.map((link, index) => {
                  const items = draft.links!.items;
                  const update = (patch: Partial<typeof link>) => setLinks({ ...draft.links!, items: items.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
                  return (
                    <li key={index} className="flex flex-wrap items-start gap-2 px-4 py-3">
                      <Order index={index} length={items.length} label={link.label || 'link'} onMove={(by) => setLinks({ ...draft.links!, items: move(items, index, by) })} />
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                        <Input value={link.label} maxLength={160} onChange={(e) => update({ label: e.target.value })} aria-label="Link text" placeholder="Prices" />
                        <Input type="url" value={link.url} maxLength={2048} onChange={(e) => update({ url: e.target.value })} aria-label={`Address of ${link.label || 'link'}`} placeholder="https://…" />
                        <Input
                          value={link.description ?? ''}
                          maxLength={300}
                          onChange={(e) => update({ description: e.target.value || undefined })}
                          aria-label={`Line under ${link.label || 'link'}`}
                          placeholder="A line under it (optional)"
                          className="sm:col-span-2"
                        />
                      </div>
                      <a href={link.url} target="_blank" rel="noreferrer" className="mt-1.5 text-muted-foreground hover:text-foreground" aria-label={`Open ${link.label || 'link'}`}>
                        <ExternalLink className="size-3.5" />
                      </a>
                      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove ${link.label || 'link'}`} onClick={() => setLinks({ ...draft.links!, items: items.filter((_, i) => i !== index) })}>
                        <Trash2 />
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t px-4 py-2.5">
                <Button type="button" variant="ghost" size="sm" disabled={draft.links.items.length >= MAX_LINKS} onClick={() => setLinks({ ...draft.links!, items: [...draft.links!.items, { label: '', url: 'https://' }] })}>
                  <Plus /> Add a link
                </Button>
              </div>
            </>
          )}
        </Card>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
          {saveError && (
            <p role="alert" className="mr-auto text-xs text-danger">
              {saveError}
            </p>
          )}
          {note && !saveError && (
            <p role="status" className="mr-auto text-xs text-muted-foreground">
              {note}
            </p>
          )}
          {dirty && base && (
            <Button type="button" variant="ghost" onClick={() => setDraft(JSON.parse(base) as HomeSettings)} disabled={busy}>
              Undo changes
            </Button>
          )}
          <Button type="button" onClick={() => void save()} disabled={!dirty || busy}>
            {busy && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      </div>
      <aside className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Preview {dirty && <Badge>Not saved</Badge>}
        </p>
        <Preview home={draft} quote={quoteLabel} accent={data.settings.accent} />
      </aside>
    </div>
  );
}
