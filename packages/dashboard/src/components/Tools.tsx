import { ArrowDownToLine, ArrowUpFromLine, Braces, Check, KeyRound, Loader2, Play, Plus, Terminal, Trash2, Wrench, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { parseCurl, promptToolRefs, toolArgs, TOOL_METHODS, TOOL_NAME, isSecretHeader } from '@helppuff/protocol/tools';
import { api, type ToolHeaderView, type ToolParamView, type ToolsList, type ToolTestResult, type ToolView } from '../lib/api';
import { cn, fmtRelative } from '../lib/utils';
import { Badge, Button, Card, CardHeader, Input, Segmented, Select, Textarea } from './ui';

/**
 * The Prompt page's tools: the library (right), the dialog that makes one
 * (paste a curl, or fill it in), the "Before the chat" and "After the chat"
 * sections, and the prompt editor's `{{` autocomplete. The same API as
 * `helppuff tools`.
 */

export type Section = 'before' | 'after';

// ----------------------------------------------------------------- library

export function ToolLibrary({
  list,
  prompt,
  onOpen,
  onNew,
}: {
  list: ToolsList;
  prompt: string;
  onOpen: (tool: ToolView) => void;
  onNew: () => void;
}) {
  const named = new Set(promptToolRefs(prompt).map((r) => r.name));
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Wrench className="size-3.5 text-muted-foreground" /> Tools
          </span>
        }
        description="Your APIs, and what the assistant saves."
        action={
          <Button size="sm" variant="outline" onClick={onNew} disabled={list.tools.length >= list.limits.tools} aria-label="New tool">
            <Plus /> New
          </Button>
        }
      />
      {list.tools.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-muted-foreground">
          None yet. Add an API the assistant can call (paste its curl), or an extract tool that saves what the visitor tells it, like an order number.
        </p>
      ) : (
        <ul className="border-t">
          {list.tools.map((tool) => (
            <li key={tool.id}>
              <button onClick={() => onOpen(tool)} className="flex w-full items-start gap-2.5 border-b px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/60">
                <span className="mt-0.5 text-muted-foreground" aria-hidden>
                  {tool.kind === 'extract' ? <KeyRound className="size-3.5" /> : <Braces className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-mono text-[12.5px]">
                    <span className={cn('truncate', !tool.enabled && 'text-muted-foreground line-through')}>{tool.name}</span>
                    {tool.lastStatus !== null && tool.lastStatus >= 400 && <span className="size-1.5 shrink-0 rounded-full bg-danger" title={`Last call: ${tool.lastStatus}`} />}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{tool.kind === 'extract' ? `Saves ${(tool.fields ?? []).map((f) => f.name).join(', ')}` : `${tool.method} ${hostOf(tool.url)}`}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {tool.before && <Badge>Before</Badge>}
                    {named.has(tool.name) && <Badge>In prompt</Badge>}
                    {tool.after && <Badge>After</Badge>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const hostOf = (url: string | undefined) => {
  try {
    return new URL(String(url).replace(/\{\{[^}]*\}\}/g, 'x')).host;
  } catch {
    return url ?? '';
  }
};

// ----------------------------------------------------------------- sections

const SECTION_COPY: Record<Section, { title: string; number: number; icon: ReactNode; description: string; empty: string }> = {
  before: {
    number: 1,
    title: 'Before the chat',
    icon: <ArrowDownToLine className="size-3.5 text-muted-foreground" />,
    description: 'Called when a chat starts, with the pre-chat form’s answers. What they return is there for the assistant’s first answer, under the tool’s name.',
    empty: 'Look the visitor up in your CRM or shop by their email before they ask anything.',
  },
  after: {
    number: 3,
    title: 'After the chat',
    icon: <ArrowUpFromLine className="size-3.5 text-muted-foreground" />,
    description: 'Called when the conversation ends (five quiet minutes after the last message), with the transcript, the summary, the contact, the attributes and every tool’s data. Webhooks get the same data in conversation.completed.',
    empty: 'Send each finished conversation to your CRM, help desk or a sheet.',
  },
};

export function RunSection({
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
  const copy = SECTION_COPY[section];
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
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <SectionNumber n={copy.number} /> {copy.title}
          </span>
        }
        description={copy.description}
      />
      <div className="space-y-2 px-4 pb-4">
        {inSection.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-3 text-[13px] text-muted-foreground">{copy.empty}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {inSection.map((tool) => (
              <li key={tool.id} className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => onOpen(tool)} className="min-w-0 flex-1 text-left">
                  <span className="block font-mono text-[12.5px]">{tool.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {tool.method} {hostOf(tool.url)}
                    {section === 'before' && inputsOf(tool).length > 0 && <> · sends {inputsOf(tool).join(', ')}</>}
                    {tool.lastAt && <> · last {fmtRelative(tool.lastAt)}{tool.lastStatus ? ` (${tool.lastStatus})` : ''}</>}
                  </span>
                </button>
                <Button variant="ghost" size="icon" className="size-7" onClick={() => void toggle(tool, false)} disabled={busy === tool.id} aria-label={`Remove ${tool.name} from ${copy.title.toLowerCase()}`}>
                  {busy === tool.id ? <Loader2 className="animate-spin" /> : <X />}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {others.length > 0 && (
            <Select
              value=""
              onChange={(e) => {
                const tool = others.find((t) => t.id === e.target.value);
                if (tool) void toggle(tool, true);
              }}
              aria-label={`Add a tool to ${copy.title.toLowerCase()}`}
            >
              <option value="">Add from your tools…</option>
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          <Button size="sm" variant="outline" onClick={onNew}>
            <Plus /> New tool
          </Button>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Card>
  );
}

export function SectionNumber({ n }: { n: number }) {
  return <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">{n}</span>;
}

/** The pre-chat answers a tool sends. */
const inputsOf = (tool: ToolView) => {
  const text = [tool.url ?? '', ...(tool.headers ?? []).map((h) => h.value), tool.body ?? ''].join('\n');
  return [...new Set([...text.matchAll(/\{\{\s*prechat\.([\w-]+)\s*\}\}/g)].map((m) => m[1]!))];
};

// ------------------------------------------------------------- the dialog

type Draft = {
  id?: string;
  name: string;
  kind: 'http' | 'extract';
  description: string;
  method: (typeof TOOL_METHODS)[number];
  url: string;
  headers: ToolHeaderView[];
  body: string;
  parameters: ToolParamView[];
  fields: ToolParamView[];
  pick: string[];
  keys: string[];
  timeoutMs: number;
  before: boolean;
  after: boolean;
  enabled: boolean;
};

const blank = (section?: Section | 'prompt'): Draft => ({
  name: '',
  kind: 'http',
  description: '',
  method: section === 'after' ? 'POST' : 'GET',
  url: '',
  headers: [],
  body: '',
  parameters: [],
  fields: [{ name: '', description: '', required: true }],
  pick: [],
  keys: [],
  timeoutMs: 5000,
  before: section === 'before',
  after: section === 'after',
  enabled: true,
});

const draftOf = (tool: ToolView): Draft => ({
  id: tool.id,
  name: tool.name,
  kind: tool.kind,
  description: tool.description,
  method: tool.method ?? 'GET',
  url: tool.url ?? '',
  headers: tool.headers ?? [],
  body: tool.body ?? '',
  parameters: tool.parameters ?? [],
  fields: tool.fields?.length ? tool.fields : [{ name: '', description: '', required: true }],
  pick: tool.pick ?? [],
  keys: tool.keys,
  timeoutMs: tool.timeoutMs ?? 5000,
  before: tool.before,
  after: tool.after,
  enabled: tool.enabled,
});

/** What the API takes: only what the kind uses. */
function payload(draft: Draft, args: string[]) {
  const common = { name: draft.name.trim(), kind: draft.kind, description: draft.description.trim(), before: draft.before, after: draft.after, enabled: draft.enabled };
  if (draft.kind === 'extract') return { ...common, fields: draft.fields.filter((f) => f.name.trim()) };
  return {
    ...common,
    method: draft.method,
    url: draft.url.trim(),
    headers: draft.headers.filter((h) => h.name.trim()).map(({ name, value, secret }) => ({ name: name.trim(), value, secret })),
    body: draft.body,
    parameters: args.map((name) => draft.parameters.find((p) => p.name === name) ?? { name, description: '', required: true }),
    pick: draft.pick,
    keys: draft.keys,
    timeoutMs: draft.timeoutMs,
  };
}

/** A name from the URL's last word, when the owner has not given one. */
const nameFromUrl = (url: string) => {
  try {
    const parts = new URL(url.replace(/\{\{[^}]*\}\}/g, 'x')).pathname.split('/').filter((p) => p && p !== 'x' && !/^v\d+$/.test(p));
    const word = (parts.at(-1) ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return /^[a-z]/.test(word) ? word.slice(0, 40) : '';
  } catch {
    return '';
  }
};

export function ToolDialog({
  site,
  tool,
  section,
  list,
  onClose,
  onSaved,
}: {
  site: string;
  tool: ToolView | null;
  section?: Section | 'prompt';
  list: ToolsList;
  onClose: () => void;
  onSaved: (tool: ToolView | null) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (tool ? draftOf(tool) : blank(section)));
  const [mode, setMode] = useState<'curl' | 'manual'>(tool ? 'manual' : 'curl');
  const [curl, setCurl] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const args = useMemo(() => (draft.kind === 'http' ? toolArgs(draft) : []), [draft]);
  const nameOk = TOOL_NAME.test(draft.name.trim());
  const taken = list.tools.some((t) => t.name === draft.name.trim() && t.id !== draft.id);
  const first = useRef<HTMLDivElement>(null);
  const focused = useRef<{ field: 'url' | 'body'; at: number }>({ field: 'body', at: 0 });

  useEffect(() => {
    first.current?.querySelector<HTMLElement>('textarea, input')?.focus();
    const escape = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const readCurl = () => {
    setError(null);
    try {
      const parsed = parseCurl(curl);
      setDraft((d) => ({ ...d, kind: 'http', method: parsed.method, url: parsed.url, headers: parsed.headers, body: parsed.body, name: d.name || nameFromUrl(parsed.url) }));
      setWarnings(parsed.warnings);
      setMode('manual');
    } catch (thrown) {
      setError((thrown as Error).message);
    }
  };

  /** Put a variable where the owner was typing (the URL or the body). */
  const insert = (variable: string) => {
    const { field, at } = focused.current;
    const text = draft[field];
    const next = `${text.slice(0, at)}${variable}${text.slice(at)}`;
    focused.current = { field, at: at + variable.length };
    set({ [field]: next });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = payload(draft, args);
      const saved = draft.id
        ? await api<ToolView>(`/tools/${draft.id}`, { method: 'PATCH', json: { site, ...body } })
        : await api<ToolView>('/tools', { method: 'POST', json: { site, ...body } });
      onSaved(saved);
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id) return;
    setBusy(true);
    try {
      await api(`/tools/${draft.id}?site=${encodeURIComponent(site)}`, { method: 'DELETE' });
      onSaved(null);
    } catch (thrown) {
      setError((thrown as Error).message);
      setBusy(false);
    }
  };

  const others = list.tools.filter((t) => t.id !== draft.id);
  const variables = [
    ...(draft.after ? ['{{conversation}}', '{{transcript}}', '{{summary}}', '{{data}}', '{{lead}}', '{{attributes}}'] : []),
    ...list.prechat.map((f) => `{{prechat.${f.name}}}`),
    ...(draft.before || draft.after ? [] : ['{{args.order_number}}']),
    '{{page.url}}',
    '{{conversation.id}}',
    ...others.flatMap((t) => (t.keys.length ? t.keys.slice(0, 3).map((k) => `{{data.${t.name}.${k}}}`) : [`{{data.${t.name}}}`])).slice(0, 6),
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[6vh]" role="dialog" aria-modal="true" aria-labelledby="tool-dialog-title">
      <Card className="w-full max-w-2xl">
        <div ref={first} className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="tool-dialog-title" className="text-[15px] font-semibold">
              {draft.id ? `Edit ${tool?.name}` : 'New tool'}
            </h2>
            <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
              <X />
            </Button>
          </div>

          {!draft.id && (
            <Segmented
              label="Kind of tool"
              value={draft.kind}
              onChange={(kind) => set({ kind, ...(kind === 'extract' ? { before: false, after: false } : {}) })}
              options={[
                { value: 'http', label: 'Call an API' },
                { value: 'extract', label: 'Save what the visitor says' },
              ]}
            />
          )}

          {draft.kind === 'http' && !draft.id && (
            <Segmented
              label="How to set it up"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'curl', label: 'Paste a curl' },
                { value: 'manual', label: 'Fill it in' },
              ]}
            />
          )}

          {draft.kind === 'http' && mode === 'curl' ? (
            <div className="space-y-2">
              <Field label="curl command" htmlFor="tool-curl" hint="Copied from your API's docs or Postman (Code → cURL). Use {{args.order_number}} where the assistant fills a value in.">
                <Textarea
                  id="tool-curl"
                  value={curl}
                  onChange={(e) => setCurl(e.target.value)}
                  placeholder={"curl https://api.example.com/orders/{{args.order_number}} \\\n  -H 'Authorization: Bearer sk_live_…'"}
                  className="min-h-36 font-mono text-xs"
                  spellCheck={false}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setMode('manual')}>
                  Fill it in instead
                </Button>
                <Button onClick={readCurl} disabled={!curl.trim()}>
                  <Terminal /> Read the curl
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" htmlFor="tool-name" hint={`In the prompt: {{${draft.name.trim() || 'name'}}}`}>
                  <Input
                    id="tool-name"
                    value={draft.name}
                    onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                    placeholder={draft.kind === 'extract' ? 'order_number' : 'order_status'}
                    className="font-mono"
                    maxLength={48}
                    aria-invalid={draft.name !== '' && (!nameOk || taken)}
                  />
                  {draft.name !== '' && !nameOk && <span className="text-xs text-danger">Start with a letter; 2 to 48 lowercase letters, digits or _.</span>}
                  {taken && <span className="text-xs text-danger">Another tool has this name.</span>}
                </Field>
                {draft.kind === 'http' && (
                  <Field label="Runs" htmlFor="tool-before">
                    <div className="flex flex-wrap gap-3 pt-1 text-[13px]">
                      <label className="flex items-center gap-1.5">
                        <input id="tool-before" type="checkbox" checked={draft.before} onChange={(e) => set({ before: e.target.checked })} /> Before the chat
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={draft.after} onChange={(e) => set({ after: e.target.checked })} /> After the chat
                      </label>
                    </div>
                  </Field>
                )}
              </div>
              <Field
                label="What it does, for the assistant"
                htmlFor="tool-description"
                hint={draft.kind === 'extract' ? 'When to save it, e.g. “Save the order number once the visitor gives it.”' : 'When to use it, e.g. “Look up an order’s status and delivery date by its number.”'}
              >
                <Textarea id="tool-description" value={draft.description} onChange={(e) => set({ description: e.target.value })} className="min-h-16" maxLength={1000} />
              </Field>

              {draft.kind === 'extract' ? (
                <ParamList
                  title="Fields to save"
                  hint="Each one is saved on the conversation as a custom attribute, and sent to webhooks and your after-chat tools."
                  items={draft.fields}
                  onChange={(fields) => set({ fields })}
                  editableNames
                />
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
                    <Field label="Method" htmlFor="tool-method">
                      <Select id="tool-method" value={draft.method} onChange={(e) => set({ method: e.target.value as Draft['method'] })}>
                        {TOOL_METHODS.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="URL" htmlFor="tool-url">
                      <Input
                        id="tool-url"
                        value={draft.url}
                        onChange={(e) => set({ url: e.target.value })}
                        onSelect={(e) => (focused.current = { field: 'url', at: e.currentTarget.selectionStart ?? draft.url.length })}
                        placeholder="https://api.example.com/orders/{{args.order_number}}"
                        className="font-mono text-xs"
                        spellCheck={false}
                      />
                    </Field>
                  </div>
                  {warnings.length > 0 && (
                    <ul className="rounded-md border bg-subtle px-3 py-2 text-xs text-muted-foreground" role="note">
                      {warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                  <HeaderList headers={draft.headers} onChange={(headers) => set({ headers })} />
                  {draft.method !== 'GET' && (
                    <Field label="Body" htmlFor="tool-body" hint={draft.after && !draft.body.trim() ? 'Empty: the whole conversation is sent as JSON.' : 'JSON or text. "{{data}}" as a whole JSON value sends the object itself.'}>
                      <Textarea
                        id="tool-body"
                        value={draft.body}
                        onChange={(e) => set({ body: e.target.value })}
                        onSelect={(e) => (focused.current = { field: 'body', at: e.currentTarget.selectionStart ?? draft.body.length })}
                        placeholder={draft.before ? '{ "email": "{{prechat.email}}" }' : '{ "order": "{{args.order_number}}" }'}
                        className="min-h-24 font-mono text-xs"
                        spellCheck={false}
                      />
                    </Field>
                  )}
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Insert a value where you were typing:</p>
                    <div className="flex flex-wrap gap-1">
                      {variables.map((v) => (
                        <button key={v} type="button" onClick={() => insert(v)} className="rounded border bg-subtle px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted">
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  {args.length > 0 && (
                    <ParamList
                      title="What the assistant fills in"
                      hint="It asks the visitor for anything it does not know yet."
                      items={args.map((name) => draft.parameters.find((p) => p.name === name) ?? { name, description: '', required: true })}
                      onChange={(parameters) => set({ parameters })}
                    />
                  )}
                </>
              )}

              <TestPanel site={site} draft={draft} args={args} prechat={list.prechat} payload={() => payload(draft, args)} onKeys={(keys) => set({ keys })} onPick={(pick) => set({ pick })} />

              {error && (
                <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger" role="alert">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                {draft.id &&
                  (confirmDelete ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Delete {tool?.name}?
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                        Keep
                      </Button>
                      <Button size="sm" variant="outline" className="text-danger" onClick={() => void remove()} disabled={busy}>
                        Delete
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                      <Trash2 /> Delete
                    </Button>
                  ))}
                <label className="flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> On
                </label>
                <span className="ml-auto" />
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={() => void save()} disabled={busy || !nameOk || taken || !draft.description.trim() || (draft.kind === 'http' && !draft.url.trim())}>
                  {busy ? 'Saving…' : draft.id ? 'Save' : 'Add tool'}
                </Button>
              </div>
            </>
          )}
          {mode === 'curl' && draft.kind === 'http' && error && (
            <p className="text-[13px] text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function HeaderList({ headers, onChange }: { headers: ToolHeaderView[]; onChange: (headers: ToolHeaderView[]) => void }) {
  const update = (i: number, patch: Partial<ToolHeaderView>) => onChange(headers.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">Headers</p>
      {headers.map((h, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto_auto] items-center gap-1.5">
          <Input
            value={h.name}
            onChange={(e) => update(i, { name: e.target.value, ...(isSecretHeader(e.target.value) && !h.secret && !h.value ? { secret: true } : {}) })}
            placeholder="Name"
            aria-label={`Header ${i + 1} name`}
            className="font-mono text-xs"
          />
          <Input
            value={h.value}
            type={h.secret ? 'password' : 'text'}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder={h.secret && h.set ? 'Stored: leave empty to keep it' : 'Value'}
            aria-label={`Header ${i + 1} value`}
            className="font-mono text-xs"
            autoComplete="off"
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Stored encrypted and never shown again">
            <input type="checkbox" checked={h.secret} onChange={(e) => update(i, { secret: e.target.checked })} /> Secret
          </label>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => onChange(headers.filter((_, j) => j !== i))} aria-label={`Remove header ${h.name || i + 1}`}>
            <X />
          </Button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...headers, { name: '', value: '', secret: false }])} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <Plus className="size-3" /> Add a header
      </button>
      {headers.some((h) => h.secret) && <p className="text-xs text-muted-foreground">Secret values are stored encrypted and never shown again.</p>}
    </div>
  );
}

function ParamList({ title, hint, items, onChange, editableNames = false }: { title: string; hint: string; items: ToolParamView[]; onChange: (items: ToolParamView[]) => void; editableNames?: boolean }) {
  const update = (i: number, patch: Partial<ToolParamView>) => onChange(items.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{title}</p>
      {items.map((p, i) => (
        <div key={editableNames ? i : p.name} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto_auto] items-center gap-1.5">
          {editableNames ? (
            <Input value={p.name} onChange={(e) => update(i, { name: e.target.value.replace(/[^\w]/g, '_') })} placeholder="order_number" aria-label={`Field ${i + 1} name`} className="font-mono text-xs" />
          ) : (
            <code className="truncate font-mono text-xs">{p.name}</code>
          )}
          <Input value={p.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="What it is, e.g. Like A-1042" aria-label={`What ${p.name || `field ${i + 1}`} is`} className="text-xs" maxLength={300} />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={p.required} onChange={(e) => update(i, { required: e.target.checked })} /> Required
          </label>
          {editableNames ? (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${p.name || `field ${i + 1}`}`} disabled={items.length === 1}>
              <X />
            </Button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {editableNames && (
        <button type="button" onClick={() => onChange([...items, { name: '', description: '', required: false }])} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="size-3" /> Add a field
        </button>
      )}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Call it now with sample values; pick the response keys to keep (they feed the prompt's autocomplete). */
function TestPanel({
  site,
  draft,
  args,
  prechat,
  payload: body,
  onKeys,
  onPick,
}: {
  site: string;
  draft: Draft;
  args: string[];
  prechat: { name: string; label: string }[];
  payload: () => unknown;
  onKeys: (keys: string[]) => void;
  onPick: (pick: string[]) => void;
}) {
  const [sample, setSample] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ToolTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const used = useMemo(() => {
    const text = [draft.url, ...draft.headers.map((h) => h.value), draft.body].join('\n');
    return prechat.filter((f) => text.includes(`prechat.${f.name}`));
  }, [draft, prechat]);
  const inputs = draft.kind === 'extract' ? draft.fields.filter((f) => f.name).map((f) => ({ key: `args.${f.name}`, label: f.name })) : [...args.map((a) => ({ key: `args.${a}`, label: a })), ...used.map((f) => ({ key: `prechat.${f.name}`, label: `${f.label} (pre-chat)` }))];

  const test = async () => {
    setBusy(true);
    setError(null);
    try {
      const values = { args: {} as Record<string, string>, prechat: {} as Record<string, string> };
      for (const [key, value] of Object.entries(sample)) {
        const [root, name] = key.split('.') as ['args' | 'prechat', string];
        if (value) values[root][name] = value;
      }
      const res = await api<ToolTestResult>('/tools/test', { method: 'POST', json: { site, ...(draft.id ? { id: draft.id } : {}), tool: body(), sample: values } });
      setResult(res);
      if (res.ok && res.keys.length) onKeys(res.keys);
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const topKeys = result?.ok ? result.keys.filter((k) => !k.includes('.')) : [];
  const togglePick = (key: string) => onPick(draft.pick.includes(key) ? draft.pick.filter((k) => k !== key) : [...draft.pick, key]);

  return (
    <div className="space-y-2 rounded-md border bg-subtle p-3">
      <div className="flex flex-wrap items-end gap-2">
        {inputs.map((input) => (
          <label key={input.key} className="flex min-w-32 flex-1 flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{input.label}</span>
            <Input value={sample[input.key] ?? ''} onChange={(e) => setSample({ ...sample, [input.key]: e.target.value })} className="h-7 text-xs" placeholder="Sample value" />
          </label>
        ))}
        <Button size="sm" variant="outline" onClick={() => void test()} disabled={busy || (draft.kind === 'http' && !draft.url.trim())}>
          {busy ? <Loader2 className="animate-spin" /> : <Play />} Test
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {result && (
        <div className="space-y-2" role="status">
          <p className={cn('flex items-center gap-1.5 text-xs', result.ok ? 'text-foreground' : 'text-danger')}>
            {result.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            {draft.kind === 'extract' ? (result.missing?.length ? `Missing: ${result.missing.join(', ')}` : 'Would save these values.') : `${result.status ?? 'No answer'}${result.error ? ` · ${result.error}` : ''} · ${result.ms} ms`}
          </p>
          <pre className="max-h-56 overflow-auto rounded border bg-background p-2 font-mono text-[11px] leading-relaxed scroll-thin">{JSON.stringify(result.response, null, 2)}</pre>
          {topKeys.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Keep only these keys (none ticked keeps everything, cut to about 4 KB):</p>
              <div className="flex flex-wrap gap-2">
                {topKeys.map((key) => (
                  <label key={key} className="flex items-center gap-1 font-mono text-[11px]">
                    <input type="checkbox" checked={draft.pick.includes(key)} onChange={() => togglePick(key)} /> {key}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------- the prompt editor

export type Suggestion = { value: string; detail: string };

/** What `{{` can complete to: the site's tools and what they return, the form's answers, the business details. */
export function promptSuggestions(list: ToolsList | null): Suggestion[] {
  const tools = list?.tools ?? [];
  return [
    ...tools.flatMap((t) => [
      { value: t.name, detail: t.kind === 'extract' ? `Saves ${(t.fields ?? []).map((f) => f.name).join(', ')}` : `Calls ${t.method} ${hostOf(t.url)}` },
      ...t.keys.map((k) => ({ value: `${t.name}.${k}`, detail: `What ${t.name} returned` })),
    ]),
    ...(list?.prechat ?? []).map((f) => ({ value: `lead.${f.name}`, detail: `Pre-chat form: ${f.label}` })),
    ...['name', 'phone', 'email', 'address', 'hours', 'areas'].map((k) => ({ value: `business.${k}`, detail: 'Business details' })),
    { value: 'context.pageUrl', detail: 'The page the visitor is on' },
    { value: 'context.pageTitle', detail: 'The page’s title' },
  ];
}

const KNOWN_ROOTS = new Set(['lead', 'context', 'site', 'business']);

/** `{{name}}` that is neither a tool nor one of HelpPuff's values: probably a typo. */
export function unknownRefs(text: string, list: ToolsList | null): string[] {
  const names = new Set((list?.tools ?? []).map((t) => t.name));
  return [...new Set(promptToolRefs(text).filter((r) => !names.has(r.name) && !KNOWN_ROOTS.has(r.name)).map((r) => r.path))];
}

/** Where the caret is inside a textarea, in pixels from its top-left (a mirror element measures it). */
function caretPoint(el: HTMLTextAreaElement, at: number): { top: number; left: number } {
  const mirror = document.createElement('div');
  const style = getComputedStyle(el);
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'tabSize'] as const) {
    mirror.style[prop] = style[prop];
  }
  // The text area's inside (padding, no border or scrollbar), so lines wrap where they do in it.
  mirror.style.boxSizing = 'border-box';
  mirror.style.width = `${el.clientWidth}px`;
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.textContent = el.value.slice(0, at);
  const mark = document.createElement('span');
  mark.textContent = '​';
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const point = { top: el.clientTop + mark.offsetTop - el.scrollTop + (parseFloat(style.lineHeight) || 18), left: el.clientLeft + Math.min(mark.offsetLeft, el.clientWidth - 240) };
  mirror.remove();
  return point;
}

export function PromptEditor({ value, onChange, suggestions, className, label }: { value: string; onChange: (text: string) => void; suggestions: Suggestion[]; className?: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);
  const [point, setPoint] = useState({ top: 0, left: 0 });
  const pendingCaret = useRef<number | null>(null);

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.text.toLowerCase();
    return suggestions
      .filter((s) => s.value.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.value.toLowerCase().startsWith(q)) - Number(!b.value.toLowerCase().startsWith(q)))
      .slice(0, 8);
  }, [query, suggestions]);

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && ref.current) {
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const look = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart;
    const match = /\{\{\s*([\w.]*)$/.exec(el.value.slice(0, caret));
    if (match && el.selectionStart === el.selectionEnd) {
      setQuery({ start: caret - match[1]!.length, text: match[1]! });
      setPoint(caretPoint(el, caret));
    } else setQuery(null);
    setActive(0);
  };

  const choose = (s: Suggestion) => {
    const el = ref.current;
    if (!el || !query) return;
    const after = el.value.slice(el.selectionStart).replace(/^[\w.]*/, '');
    const closing = /^\s*\}\}/.test(after) ? '' : '}}';
    const next = `${el.value.slice(0, query.start)}${s.value}${closing}${after}`;
    pendingCaret.current = query.start + s.value.length + closing.length + (closing ? 0 : (/^\s*\}\}/.exec(after)?.[0].length ?? 0));
    setQuery(null);
    onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!matches.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      choose(matches[active]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery(null);
    }
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          look(e.target);
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => look(e.currentTarget)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        aria-controls="prompt-suggestions"
        aria-activedescendant={matches.length ? `prompt-suggestion-${active}` : undefined}
        className={className}
        spellCheck
      />
      {matches.length > 0 && (
        <ul
          id="prompt-suggestions"
          role="listbox"
          aria-label="Values you can use"
          className="absolute z-20 w-60 overflow-hidden rounded-md border bg-background py-1 shadow-lg"
          style={{ top: point.top + 4, left: Math.max(8, point.left) }}
        >
          {matches.map((s, i) => (
            <li
              key={s.value}
              id={`prompt-suggestion-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('cursor-pointer px-2.5 py-1.5', i === active && 'bg-muted')}
            >
              <span className="block truncate font-mono text-xs">{s.value}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
