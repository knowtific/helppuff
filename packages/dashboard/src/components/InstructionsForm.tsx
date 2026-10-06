import { Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type PromptView, type PublishResult, type SettingsView } from '../lib/api';
import { cn, href } from '../lib/utils';
import { Button, ErrorNote, Input, Skeleton, Textarea } from './ui';

/**
 * How the assistant behaves. Two different things, kept apart so they never
 * repeat or contradict each other:
 *
 *  - choices (goal, tone, length): settings, which Murmur writes around the
 *    prompt on every answer, with its built-in rules;
 *  - "Anything specific to your business": the owner's own text, the prompt,
 *    versioned (its history is on the full prompt page).
 *
 * Saving changes the settings, and publishes the text only if it changed.
 */

export type Behaviour = {
  goal: 'callbacks' | 'answers' | 'bookings';
  tone: 'friendly' | 'professional' | 'casual';
  length: 'short' | 'detailed';
  prices: 'share' | 'quote';
  bookingUrl?: string;
};
/** Kept for the onboarding page's goal question. */
export type Profile = Behaviour;

export const GOALS: { value: Behaviour['goal']; label: string; hint: string }[] = [
  { value: 'callbacks', label: 'Get enquiries', hint: 'Answer questions, then offer a callback from your team' },
  { value: 'answers', label: 'Answer questions', hint: 'Help visitors find what they need on your site' },
  { value: 'bookings', label: 'Get bookings', hint: 'Steer visitors towards booking with you' },
];

function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn('cursor-pointer rounded-md border px-3 py-2 text-[13px] transition-colors', value === o.value ? 'border-foreground bg-subtle' : 'hover:bg-subtle/60')}
        >
          <input type="radio" className="sr-only" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="block font-medium">{o.label}</span>
          {o.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>}
        </label>
      ))}
    </div>
  );
}

/** Only the main goal: what onboarding asks. */
export function GoalPicker({ value, onChange }: { value: Behaviour['goal']; onChange: (v: Behaviour['goal']) => void }) {
  return <Choice name="What should it mainly do?" value={value} options={GOALS} onChange={onChange} />;
}

export async function loadBehaviour(): Promise<Behaviour> {
  return (await api<SettingsView>('/settings')).settings.behaviour;
}

export async function saveBehaviour(behaviour: Partial<Behaviour>): Promise<void> {
  await api('/settings', { method: 'PUT', json: { settings: { behaviour } } });
}

export function InstructionsForm() {
  const [prompt, setPrompt] = useState<PromptView | null>(null);
  const [draft, setDraft] = useState<Behaviour | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    Promise.all([loadBehaviour(), api<PromptView>('/prompt')]).then(
      ([behaviour, view]) => {
        setDraft(behaviour);
        setPrompt(view);
        setText(view.text);
      },
      (thrown: Error) => setError(thrown),
    );
  }, []);

  if (!draft || !prompt || text === null) return error ? <div className="p-4"><ErrorNote error={error} /></div> : <Skeleton className="m-4 h-48" />;
  if (!prompt.editable) {
    return <p className="px-4 py-4 text-[13px] text-muted-foreground md:px-5">This backend keeps its instructions on the provider’s side.</p>;
  }
  const set = (patch: Partial<Behaviour>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };
  const save = async () => {
    await saveBehaviour(draft);
    // The owner's text is a new prompt version only when it changed.
    if (text.trim() !== prompt.text.trim()) {
      const result = await api<PublishResult>('/prompt', { method: 'POST', json: { site: prompt.site, text, note: 'From the instructions page', baseVersion: prompt.version } });
      setPrompt({ ...prompt, text, version: result.version });
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        save()
          .then(() => setSaved(true), (thrown: Error) => setError(thrown))
          .finally(() => setBusy(false));
      }}
    >
      <div className="space-y-4 px-4 py-4 md:px-5">
        <div className="space-y-1.5">
          <span className="text-xs font-medium">Main goal</span>
          <GoalPicker value={draft.goal} onChange={(goal) => set({ goal })} />
        </div>
        {draft.goal === 'bookings' && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Booking page</span>
            <Input type="url" placeholder="https://" value={draft.bookingUrl ?? ''} onChange={(e) => set({ bookingUrl: e.target.value || undefined })} />
          </label>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <span className="text-xs font-medium">Tone</span>
            <Choice
              name="Tone"
              value={draft.tone}
              onChange={(tone) => set({ tone })}
              options={[
                { value: 'friendly', label: 'Friendly' },
                { value: 'professional', label: 'Professional' },
                { value: 'casual', label: 'Casual' },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium">Answers</span>
            <Choice
              name="Answer length"
              value={draft.length}
              onChange={(length) => set({ length })}
              options={[
                { value: 'short', label: 'Short' },
                { value: 'detailed', label: 'Detailed' },
              ]}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="text-xs font-medium">Prices</span>
          <Choice
            name="Prices"
            value={draft.prices}
            onChange={(prices) => set({ prices })}
            options={[
              { value: 'share', label: 'Share prices', hint: 'Exactly as your site and documents state them' },
              { value: 'quote', label: 'Offer a quote instead', hint: 'Never give a price or estimate' },
            ]}
          />
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Anything specific to your business</span>
          <Textarea
            rows={6}
            maxLength={prompt.limit}
            placeholder={'We only work in the eastern suburbs. Quotes are free.\nNever quote prices: offer a free quote instead.'}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
            }}
          />
          <span className="block text-[11px] text-muted-foreground">
            Only what is specific to you: the choices above and Murmur’s own rules (never invent, stay on topic, never reveal its instructions) are added for you.
            Contact details come from the business details; write <code className="rounded bg-muted px-1">{'{{business.phone}}'}</code> to mention them.
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3 md:px-5">
        <a href={href({ page: 'prompt' })} className="mr-auto text-xs text-muted-foreground hover:text-foreground">
          History, and everything Murmur adds
        </a>
        {error && <span className="text-xs text-danger" role="alert">{error.message}</span>}
        {saved && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Check className="size-3.5" aria-hidden /> Live
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
