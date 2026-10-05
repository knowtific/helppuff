import { Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cn, href } from '../lib/utils';
import { Button, ErrorNote, Input, Skeleton, Textarea } from './ui';

/**
 * How the assistant behaves, as a few choices instead of a prompt to write.
 * Saving writes the prompt from them and publishes it as a new version (the
 * full text and its history stay under Advanced).
 */

export type Profile = {
  goal: 'callbacks' | 'answers' | 'bookings';
  tone: 'friendly' | 'professional' | 'casual';
  length: 'short' | 'detailed';
  mustKnow: string;
  neverSay: string;
  bookingUrl?: string;
};
type ProfileView = { profile: Profile; editable: boolean; custom: boolean };

export const GOALS: { value: Profile['goal']; label: string; hint: string }[] = [
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
export function GoalPicker({ value, onChange }: { value: Profile['goal']; onChange: (v: Profile['goal']) => void }) {
  return <Choice name="What should it mainly do?" value={value} options={GOALS} onChange={onChange} />;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await api('/profile', { method: 'PUT', json: { profile } });
}

export function InstructionsForm() {
  const [view, setView] = useState<ProfileView | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    api<ProfileView>('/profile').then(
      (v) => {
        setView(v);
        setDraft(v.profile);
      },
      (thrown: Error) => setError(thrown),
    );
  }, []);

  if (!draft || !view) return error ? <div className="p-4"><ErrorNote error={error} /></div> : <Skeleton className="m-4 h-48" />;
  if (!view.editable) {
    return <p className="px-4 py-4 text-[13px] text-muted-foreground md:px-5">This backend keeps its instructions on the provider’s side.</p>;
  }
  const set = (patch: Partial<Profile>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        saveProfile(draft)
          .then(() => {
            setSaved(true);
            setView({ ...view, custom: false });
          }, (thrown: Error) => setError(thrown))
          .finally(() => setBusy(false));
      }}
    >
      <div className="space-y-4 px-4 py-4 md:px-5">
        {view.custom && (
          <p className="rounded-md border bg-subtle px-3 py-2 text-xs text-muted-foreground">
            The current instructions were written by hand. Saving these choices replaces them — the old text stays in the history.
          </p>
        )}
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
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Always keep in mind</span>
          <Textarea rows={3} maxLength={2000} placeholder="We only work in the eastern suburbs. Quotes are free." value={draft.mustKnow} onChange={(e) => set({ mustKnow: e.target.value })} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Never</span>
          <Textarea rows={2} maxLength={2000} placeholder="Quote prices — offer a free quote instead." value={draft.neverSay} onChange={(e) => set({ neverSay: e.target.value })} />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3 md:px-5">
        <a href={href({ page: 'prompt' })} className="mr-auto text-xs text-muted-foreground hover:text-foreground">
          Advanced: edit the full text and its history
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
