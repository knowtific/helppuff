import { Check, Loader2, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type Fact } from '../lib/api';
import { Button, ErrorNote, Input, Skeleton } from './ui';

/**
 * The business's details, filled in from its own site (structured data, then
 * the site's AI reading the home and contact pages). The owner only checks
 * them; what they change is never overwritten by a later crawl.
 */

const FIELDS = [
  { key: 'name', label: 'Business name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address', wide: true },
  { key: 'hours', label: 'Opening hours', placeholder: 'Mon–Fri 8am–5pm; Sat 9am–12pm', wide: true },
  { key: 'serviceAreas', label: 'Areas you serve', placeholder: 'Lilydale, Mooroolbark, Montrose', wide: true },
] as const;

export function FactsForm({ detect = false, onSaved, saveLabel = 'Save', footer }: { detect?: boolean; onSaved?: () => void; saveLabel?: string; footer?: React.ReactNode }) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const loaded = useRef<Record<string, string>>({});
  const [reading, setReading] = useState(detect);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const started = useRef(false);

  const apply = (facts: Pick<Fact, 'key' | 'value'>[]) => {
    const map = Object.fromEntries(facts.map((f) => [f.key, f.value]));
    loaded.current = map;
    setValues((current) => ({ ...map, ...Object.fromEntries(Object.entries(current ?? {}).filter(([k, v]) => v !== (loaded.current[k] ?? '') && v)) }));
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void api<{ facts: Fact[] }>('/knowledge/facts').then((r) => apply(r.facts), (thrown: Error) => setError(thrown));
    if (detect) {
      void api<{ facts: Fact[] }>('/knowledge/facts/detect', { method: 'POST', json: {} })
        .then((r) => apply(r.facts), () => {})
        .finally(() => setReading(false));
    }
  }, [detect]);

  const save = async () => {
    if (!values) return;
    setBusy(true);
    setError(null);
    try {
      const changed = Object.fromEntries(FIELDS.map(({ key }) => [key, (values[key] ?? '').trim()]).filter(([key, value]) => value !== (loaded.current[key as string] ?? '')));
      if (Object.keys(changed).length) await api('/knowledge/facts', { method: 'PUT', json: { facts: changed } });
      loaded.current = { ...loaded.current, ...changed };
      setSaved(true);
      onSaved?.();
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };

  if (!values) return error ? <ErrorNote error={error} /> : <Skeleton className="m-4 h-40" />;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="space-y-3 px-4 py-4 md:px-5">
        {reading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Sparkles className="size-3.5" aria-hidden /> Reading your home and contact pages…
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className={'wide' in f ? 'block space-y-1.5 sm:col-span-2' : 'block space-y-1.5'}>
              <span className="text-xs font-medium">{f.label}</span>
              <Input
                value={values[f.key] ?? ''}
                placeholder={reading ? 'Looking…' : 'placeholder' in f ? f.placeholder : 'Not found on your site'}
                onChange={(e) => {
                  setValues({ ...values, [f.key]: e.target.value });
                  setSaved(false);
                }}
              />
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3 md:px-5">
        {error && (
          <span className="mr-auto text-xs text-danger" role="alert">
            {error.message}
          </span>
        )}
        {saved && !footer && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Check className="size-3.5" aria-hidden /> Saved
          </span>
        )}
        {footer}
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {saveLabel}
        </Button>
      </div>
    </form>
  );
}
