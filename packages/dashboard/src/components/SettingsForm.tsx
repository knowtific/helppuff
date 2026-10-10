import { Check, Loader2, Plus, X } from 'lucide-react';
import { cloneElement, isValidElement, useEffect, useId, useState, type ReactNode } from 'react';
import { api, type LeadField, type Settings, type SettingsView } from '../lib/api';
import { href } from '../lib/utils';
import { Button, ErrorNote, InfoTip, Input, Select, Skeleton, Textarea } from './ui';
import { SecurityForm } from './SecurityForm';

/**
 * The settings object, one topic at a time: what the chat says, how it looks,
 * the pre-chat form, and the advanced model and crawl options. Each page saves
 * the whole object, so nothing on another page is lost. Live within a minute;
 * `helppuff config pull` brings it into helppuff.json.
 */
export type FormSection = 'chat' | 'appearance' | 'leads' | 'advanced';

const ICONS = ['chat', 'phone', 'calendar', 'wrench', 'heart', 'pin', 'clock', 'info', 'book', 'quote'] as const;
const FIELD_TYPES: { value: LeadField['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Choice' },
];

/** `Company name` → `company_name`, unique within the form. */
function fieldName(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 30) || 'field';
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base}_${i}`;
  return name;
}

/**
 * The pre-chat form's fields: label, kind, required or not. The built-in ones
 * mean something to the assistant (a message opens the chat; a phone or email
 * means it never asks again); anything added is kept on the lead and shown to
 * the assistant too.
 */
function LeadFieldsEditor({ fields, onChange }: { fields: LeadField[]; onChange: (fields: LeadField[]) => void }) {
  const [label, setLabel] = useState('');
  const update = (i: number, patch: Partial<LeadField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () => {
    if (!label.trim() || fields.length >= 12) return;
    onChange([
      ...fields,
      {
        name: fieldName(
          label,
          fields.map((f) => f.name),
        ),
        label: label.trim(),
        type: 'text',
        required: false,
      },
    ]);
    setLabel('');
  };
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-md border" aria-label="Form fields">
        {fields.map((field, i) => (
          <li key={field.name} className="flex flex-wrap items-center gap-2 px-2.5 py-2">
            <Input className="min-w-40 flex-1" value={field.label} aria-label={`Label for ${field.name}`} onChange={(e) => update(i, { label: e.target.value })} />
            <Select value={field.type} aria-label={`Kind of ${field.label}`} onChange={(e) => update(i, { type: e.target.value as LeadField['type'] })}>
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            {field.type === 'select' && (
              <Input
                className="min-w-48 flex-1"
                placeholder="Options, comma separated"
                aria-label={`Options for ${field.label}`}
                value={(field.options ?? []).join(', ')}
                onChange={(e) =>
                  update(i, {
                    options: e.target.value
                      .split(',')
                      .map((o) => o.trim())
                      .filter(Boolean),
                  })
                }
              />
            )}
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={field.required} onChange={(e) => update(i, { required: e.target.checked })} />
              Required
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Remove ${field.label}`}
              disabled={fields.length <= 1}
              onClick={() => onChange(fields.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      {fields.length < 12 && (
        <div className="flex gap-2">
          <Input
            value={label}
            placeholder="Add a field, e.g. Company or Suburb"
            aria-label="New field"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
          <Button type="button" variant="outline" onClick={add} disabled={!label.trim()}>
            <Plus /> Add
          </Button>
        </div>
      )}
      {fields.some((f) => f.name === 'message') && (
        <p className="text-[11px] text-muted-foreground">The “{fields.find((f) => f.name === 'message')!.label}” field opens the conversation: the assistant answers it straight away.</p>
      )}
    </div>
  );
}
// Measured in HelpPuff on 2026-10-05; the wiki's AI models page has the numbers.
const MODELS = [
  { value: '@cf/zai-org/glm-4.7-flash', label: 'GLM-4.7 Flash — default, best all-round' },
  { value: '@cf/qwen/qwen3-30b-a3b-fp8', label: 'Qwen3 30B — dependable, about as cheap' },
  { value: '@cf/zai-org/glm-5.3-flash', label: 'GLM-5.3 Flash — most capable, needs Workers Paid' },
  { value: '@cf/deepseek-ai/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash — needs Workers Paid' },
];

/** One settings page's fields; the page header above names and explains it. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 px-4 py-4 md:px-5">
      <legend className="sr-only">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  if (!hint) {
    return (
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">{label}</span>
        {children}
      </label>
    );
  }
  // With a (?): the tip sits beside the label, outside it, so its text is never part of the field's name.
  const control = isValidElement<{ id?: string }>(children) ? cloneElement(children, { id: children.props.id ?? id }) : children;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={isValidElement<{ id?: string }>(children) ? (children.props.id ?? id) : undefined} className="text-xs font-medium">
          {label}
        </label>
        <InfoTip label={`About ${label.toLowerCase()}`}>{hint}</InfoTip>
      </div>
      {control}
    </div>
  );
}

export function SettingsForm({ knowledge, section }: { knowledge: boolean; section: FormSection }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<SettingsView>('/settings').then(
      (v) => {
        setView(v);
        setDraft(v.settings);
      },
      (thrown: Error) => setError(thrown),
    );
  }, []);

  if (error && !draft)
    return (
      <div className="p-4">
        <ErrorNote error={error} />
      </div>
    );
  if (!draft || !view) return <Skeleton className="m-4 h-64" />;

  const set = (patch: Partial<Settings>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };
  const setAssistant = (patch: Partial<NonNullable<Settings['assistant']>>) => draft.assistant && set({ assistant: { ...draft.assistant, ...patch } });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Behaviour belongs to the Instructions page, the home screen (and its questions) to
      // Settings → Home screen: a stale copy here must not overwrite them.
      const { behaviour: _behaviour, home: _home, starterQuestions: _questions, ...settings } = draft;
      const result = await api<SettingsView>('/settings', {
        method: 'PUT',
        json: { settings },
      });
      setDraft(result.settings);
      setSaved(true);
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {section === 'chat' && (
        <Section title="Chat">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Assistant’s name">
              <Input value={draft.botName} maxLength={60} required onChange={(e) => set({ botName: e.target.value })} />
            </Field>
            <Field label="Business name">
              <Input value={draft.businessName} maxLength={60} required onChange={(e) => set({ businessName: e.target.value })} />
            </Field>
          </div>
          <Field label="Welcome message">
            <Textarea rows={2} value={draft.welcomeMessage} maxLength={2000} onChange={(e) => set({ welcomeMessage: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">
            Buttons and links on the first screen:{' '}
            <a href={href({ page: 'settings', id: 'home' })} className="font-medium text-foreground underline-offset-2 hover:underline">
              Home screen →
            </a>
          </p>
        </Section>
      )}

      {section === 'appearance' && (
        <Section title="Appearance">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Colour">
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-8 w-10 cursor-pointer rounded-md border bg-background p-0.5"
                  value={draft.accent.length === 4 ? `#${[...draft.accent.slice(1)].map((c) => c + c).join('')}` : draft.accent}
                  onChange={(e) => set({ accent: e.target.value })}
                  aria-label="Colour picker"
                />
                <Input value={draft.accent} onChange={(e) => set({ accent: e.target.value })} pattern="#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?" aria-label="Colour as hex" />
              </span>
            </Field>
            <Field label="Position">
              <Select className="w-full" value={draft.position} onChange={(e) => set({ position: e.target.value as Settings['position'] })}>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
              </Select>
            </Field>
            <Field label="Button icon">
              <Select className="w-full" value={draft.launcherIcon} onChange={(e) => set({ launcherIcon: e.target.value })}>
                {ICONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {icon}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>
      )}

      {section === 'leads' && (
        <Section title="Lead form">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={draft.leads.enabled} onChange={(e) => set({ leads: { ...draft.leads, enabled: e.target.checked } })} />
            Ask for details before the chat
          </label>
          {draft.leads.enabled && <LeadFieldsEditor fields={draft.leads.fields} onChange={(fields) => set({ leads: { ...draft.leads, fields } })} />}
        </Section>
      )}

      {section === 'advanced' && (
        <Section title="Advanced">
          <div className="grid gap-3 sm:grid-cols-2">
            {draft.assistant && <AiPanel assistant={draft.assistant} ai={view?.ai ?? null} />}
            {knowledge && (
              <Field label="Re-learn the site">
                <Select
                  className="w-full"
                  value={draft.crawl.schedule}
                  onChange={(e) =>
                    set({
                      crawl: {
                        ...draft.crawl,
                        schedule: e.target.value as Settings['crawl']['schedule'],
                      },
                    })
                  }
                >
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                  <option value="monthly">Every month</option>
                  <option value="off">Only when I ask</option>
                </Select>
              </Field>
            )}
            {draft.assistant && (
              <>
                <Field label="Time zone" hint="For “are you open now?”">
                  <Input placeholder="Australia/Melbourne" value={draft.assistant.timezone ?? ''} onChange={(e) => setAssistant({ timezone: e.target.value || null })} />
                </Field>
                <Field label="Language and spelling">
                  <Input placeholder="en-AU" value={draft.assistant.locale ?? ''} onChange={(e) => setAssistant({ locale: e.target.value || null })} />
                </Field>
              </>
            )}
          </div>
        </Section>
      )}
      {section === 'advanced' && draft.security && (
        <div className="border-t">
          <Section title="Limits and access">
            <SecurityForm value={draft.security} captcha={view.captcha ?? false} onChange={(security) => set({ security })} />
          </Section>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3 md:px-5">
        {error && (
          <span className="mr-auto text-xs text-danger" role="alert">
            {error.message}
          </span>
        )}
        {saved && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Check className="size-3.5" aria-hidden /> Saved — live within a minute
          </span>
        )}
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}

const PROVIDER_NAMES: Record<string, string> = { 'workers-ai': 'Workers AI', 'openai-compatible': 'An OpenAI-compatible API', anthropic: 'Anthropic Claude', custom: 'Your own model' };
const KNOWLEDGE_NAMES: Record<string, string> = { helppuff: 'Your site and files (HelpPuff’s knowledge base)', none: 'None: the prompt and business details', 'ai-search': 'Cloudflare AI Search', 'openai-vector-store': 'An OpenAI vector store', http: 'Your own search (HTTP)', custom: 'Your own knowledge base' };

/** A Workers AI model by its name in the list above, else its id. */
const modelName = (id: string) => MODELS.find((m) => m.value === id)?.label ?? id;

/**
 * Who writes the answers and what they come from: shown, not edited. They
 * change with the CLI and a deploy (`helppuff model`, `helppuff rag`), so
 * helppuff.json stays the one place they are set.
 */
function AiPanel({ assistant, ai }: { assistant: NonNullable<Settings['assistant']>; ai: SettingsView['ai'] }) {
  const rows: [string, string][] = [
    ['Writes the answers', `${PROVIDER_NAMES[ai?.provider ?? 'workers-ai'] ?? ai?.provider ?? ''} · ${modelName(ai?.model ?? assistant.model)}`],
    ['Answers come from', KNOWLEDGE_NAMES[ai?.knowledge ?? 'helppuff'] ?? ai?.knowledge ?? ''],
    ['Thinking', assistant.reasoning === 'medium' ? 'Medium (default)' : assistant.reasoning === 'high' ? 'High' : 'Low'],
    ['Double-check answers', assistant.rerank ? 'On' : 'Off'],
  ];
  return (
    <div className="space-y-2 rounded-md border bg-subtle p-3 sm:col-span-2" role="group" aria-label="Model and knowledge">
      <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Changed with the CLI
        <InfoTip label="About changing the model">
          <code className="rounded bg-muted px-1">helppuff model set …</code> or <code className="rounded bg-muted px-1">helppuff rag set …</code>, then a deploy (or ask your coding
          agent). See the wiki’s Models and providers page.
        </InfoTip>
      </p>
    </div>
  );
}

