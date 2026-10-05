import { Check, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type LeadField, type Settings, type SettingsView } from '../lib/api';
import { Button, ErrorNote, Input, Select, Skeleton, Textarea } from './ui';

/**
 * The settings object, one topic at a time: what the chat says, how it looks,
 * the pre-chat form, and the advanced model and crawl options. Each page saves
 * the whole object, so nothing on another page is lost. Live within a minute;
 * `murmur config pull` brings it into murmur.json.
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
const MODELS = [
  {
    value: '@cf/zai-org/glm-4.7-flash',
    label: 'GLM-4.7 Flash — default, free plan',
  },
  {
    value: '@cf/openai/gpt-oss-120b',
    label: 'gpt-oss 120B — steadier, ~4× the cost',
  },
  {
    value: '@cf/zai-org/glm-5.3-flash',
    label: 'GLM-5.3 Flash — needs Workers Paid',
  },
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
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function SettingsForm({ knowledge, section }: { knowledge: boolean; section: FormSection }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [suggesting, setSuggesting] = useState(false);

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
      const result = await api<SettingsView>('/settings', {
        method: 'PUT',
        json: { settings: draft },
      });
      setDraft(result.settings);
      setSaved(true);
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const { questions } = await api<{ questions: string[] }>('/knowledge/suggest-questions', { method: 'POST', json: {} });
      set({
        starterQuestions: [...new Set([...questions, ...draft.starterQuestions])].slice(0, 6),
      });
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setSuggesting(false);
    }
  };

  const addQuestion = () => {
    const q = newQuestion.trim();
    if (!q || draft.starterQuestions.length >= 6) return;
    set({ starterQuestions: [...draft.starterQuestions, q] });
    setNewQuestion('');
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
          <div className="space-y-1.5">
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium" id="starters">
                Suggested questions
              </span>
              {knowledge && (
                <Button type="button" variant="ghost" size="sm" onClick={() => void suggest()} disabled={suggesting}>
                  {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Suggest from my site
                </Button>
              )}
            </span>
            <ul className="flex flex-wrap gap-1.5" aria-labelledby="starters">
              {draft.starterQuestions.map((q, i) => (
                <li key={`${q}-${i}`} className="inline-flex items-center gap-1 rounded-md border bg-subtle py-0.5 pr-0.5 pl-2 text-xs">
                  {q}
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Remove “${q}”`}
                    onClick={() =>
                      set({
                        starterQuestions: draft.starterQuestions.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
            {draft.starterQuestions.length < 6 && (
              <div className="flex gap-2">
                <Input
                  value={newQuestion}
                  maxLength={80}
                  placeholder="e.g. Do you service my suburb?"
                  aria-label="New suggested question"
                  onChange={(e) => setNewQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addQuestion())}
                />
                <Button type="button" variant="outline" onClick={addQuestion} disabled={!newQuestion.trim()}>
                  <Plus /> Add
                </Button>
              </div>
            )}
          </div>
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
            {draft.assistant && (
              <Field label="Model" hint="All run on Workers AI in your Cloudflare account.">
                <Select className="w-full" value={draft.assistant.model} onChange={(e) => setAssistant({ model: e.target.value })}>
                  {[
                    ...MODELS,
                    ...(MODELS.some((m) => m.value === draft.assistant!.model)
                      ? []
                      : [
                          {
                            value: draft.assistant.model,
                            label: draft.assistant.model,
                          },
                        ]),
                  ].map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
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
                <div className="space-y-1 sm:col-span-2">
                  <label className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={draft.assistant.rerank}
                      onChange={(e) => setAssistant({ rerank: e.target.checked })}
                      aria-describedby="rerank-hint"
                    />
                    Double-check answers before replying
                  </label>
                  <p id="rerank-hint" className="pl-6 text-[11px] text-muted-foreground">
                    Re-reads what it found on your site and keeps only what answers the question, so it says “not sure” instead of guessing. Off replies about half a second sooner but is more likely
                    to use the wrong page.
                  </p>
                </div>
              </>
            )}
          </div>
        </Section>
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
