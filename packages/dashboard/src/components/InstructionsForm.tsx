import { Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type PromptView, type SettingsView } from '../lib/api';
import { cn, href } from '../lib/utils';
import { Button, ErrorNote, Input, Skeleton } from './ui';

/**
 * How the assistant behaves: the choices (goal, tone, length, prices), which
 * HelpPuff writes around the prompt on every answer, with its built-in rules.
 * The owner's own text, the prompt, has one place: the Prompt & tools page,
 * linked from here, so the two never repeat or contradict each other.
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
  { value: 'callbacks', label: 'Offer a callback', hint: 'Answers questions, then offers to have your team call or email them' },
  { value: 'answers', label: 'Just answer', hint: 'Answers questions from your site; puts them in touch only if they ask' },
  { value: 'bookings', label: 'Send them to a page', hint: 'Answers questions, then links to your booking, sign-up or quote page' },
];

export function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
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
  return <Choice name="When a visitor is interested" value={value} options={GOALS} onChange={onChange} />;
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
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    Promise.all([loadBehaviour(), api<PromptView>('/prompt')]).then(
      ([behaviour, view]) => {
        setDraft(behaviour);
        setPrompt(view);
      },
      (thrown: Error) => setError(thrown),
    );
  }, []);

  if (!draft || !prompt) return error ? <div className="p-4"><ErrorNote error={error} /></div> : <Skeleton className="m-4 h-48" />;
  if (!prompt.editable) {
    return <p className="px-4 py-4 text-[13px] text-muted-foreground md:px-5">This backend keeps its instructions on the provider’s side.</p>;
  }
  const set = (patch: Partial<Behaviour>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };
  const save = () => saveBehaviour(draft);

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
          <span className="text-xs font-medium">When a visitor is interested</span>
          <GoalPicker value={draft.goal} onChange={(goal) => set({ goal })} />
        </div>
        {draft.goal === 'bookings' && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Page to send them to</span>
            <Input type="url" placeholder="https://example.com/book" value={draft.bookingUrl ?? ''} onChange={(e) => set({ bookingUrl: e.target.value || undefined })} />
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
        <a href={href({ page: 'prompt' })} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 hover:bg-subtle">
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">Anything specific to your business</span>
            <span className="block text-xs text-muted-foreground">
              {prompt.text.trim() ? 'Your prompt, and the tools it can call.' : 'Write what your website doesn’t say, or says wrongly, and add tools.'} In Prompt & tools.
            </span>
          </span>
          <span aria-hidden className="text-muted-foreground">→</span>
        </a>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3 md:px-5">
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
