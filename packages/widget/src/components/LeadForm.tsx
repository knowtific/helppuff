import { useState } from 'preact/hooks';
import type { Field, WidgetConfig } from '@murmur/protocol';
import type { StringKey } from '../app/strings.js';

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
const TEL_RE = /^[+()\-.\s\d]{6,40}$/;

/** Mirrors the server's own lead validation so the visitor sees it first. */
export function validateField(field: Field, raw: string): string | null {
  const value = raw.trim();
  if (!value) return field.required ? `${field.label} is required.` : null;
  if (value.length > 200) return `${field.label} is too long.`;
  if (field.type === 'email' && !EMAIL_RE.test(value)) return `Enter a valid ${field.label.toLowerCase()}.`;
  if (field.type === 'tel' && !TEL_RE.test(value)) return `Enter a valid ${field.label.toLowerCase()}.`;
  if (field.type === 'select' && field.options && !field.options.includes(value)) {
    return `Choose one of the options for ${field.label}.`;
  }
  if (field.pattern) {
    try {
      if (!new RegExp(`^(?:${field.pattern})$`, 'u').test(value)) return `Check ${field.label}.`;
    } catch {
      // A config regex that will not compile is treated as no constraint.
    }
  }
  return null;
}

/** Sensible mobile keyboards, so autofill works (§8.7). */
function inputMode(field: Field): string | undefined {
  if (field.type === 'email') return 'email';
  if (field.type === 'tel') return 'tel';
  return undefined;
}

export function LeadForm({
  config,
  initial,
  busy,
  t,
  onSubmit,
}: {
  config: WidgetConfig;
  initial: Record<string, string> | null;
  busy: boolean;
  t: (key: StringKey) => string;
  onSubmit: (lead: Record<string, string>, firstMessage?: string) => void;
}) {
  const fields = config.leadForm.fields;
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(initial ?? {}) }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [firstMessage, setFirstMessage] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const set = (name: string, value: string) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    // Clear an error as soon as the visitor fixes it, but do not add one while typing.
    if (errors[name]) setErrors((previous) => ({ ...previous, [name]: '' }));
  };

  const blur = (field: Field) => {
    setTouched((previous) => ({ ...previous, [field.name]: true }));
    const error = validateField(field, values[field.name] ?? '');
    setErrors((previous) => ({ ...previous, [field.name]: error ?? '' }));
  };

  const submit = (event: Event) => {
    event.preventDefault();
    if (busy) return;

    const next: Record<string, string> = {};
    let firstBad: string | null = null;

    for (const field of fields) {
      const error = validateField(field, values[field.name] ?? '');
      if (error) {
        next[field.name] = error;
        firstBad ??= field.name;
      }
    }

    setErrors(next);
    setTouched(Object.fromEntries(fields.map((f) => [f.name, true])));
    if (firstBad) return;

    const lead: Record<string, string> = {};
    for (const field of fields) {
      const value = (values[field.name] ?? '').trim();
      if (value) lead[field.name] = value;
    }

    onSubmit(lead, firstMessage.trim() || undefined);
  };

  return (
    <form class="mm-form" onSubmit={submit} noValidate>
      {config.leadForm.title ? <h2 class="mm-form-title">{config.leadForm.title}</h2> : null}

      {fields.map((field) => {
        const id = `mm-f-${field.name}`;
        const error = touched[field.name] ? errors[field.name] : '';
        const described = error ? `${id}-err` : undefined;

        return (
          <div class="mm-field" key={field.name}>
            <label class="mm-label-text" for={id}>
              {field.label}
              {field.required ? (
                <span class="mm-req" aria-hidden="true">
                  {' *'}
                </span>
              ) : null}
              {field.required ? <span class="mm-sr">{` (${t('required')})`}</span> : null}
            </label>

            {field.type === 'textarea' ? (
              <textarea
                id={id}
                class="mm-textarea"
                value={values[field.name] ?? ''}
                placeholder={field.placeholder ?? ''}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={described}
                onInput={(e) => set(field.name, (e.target as HTMLTextAreaElement).value)}
                onBlur={() => blur(field)}
              />
            ) : field.type === 'select' ? (
              <select
                id={id}
                class="mm-select"
                value={values[field.name] ?? ''}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={described}
                onChange={(e) => set(field.name, (e.target as HTMLSelectElement).value)}
                onBlur={() => blur(field)}
              >
                <option value="">{field.placeholder ?? '—'}</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                class="mm-input"
                type={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'}
                value={values[field.name] ?? ''}
                placeholder={field.placeholder ?? ''}
                autocomplete={field.autocomplete ?? 'off'}
                inputMode={inputMode(field)}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={described}
                onInput={(e) => set(field.name, (e.target as HTMLInputElement).value)}
                onBlur={() => blur(field)}
              />
            )}

            {error ? (
              <span class="mm-error-text" id={`${id}-err`}>
                {error}
              </span>
            ) : null}
          </div>
        );
      })}

      {config.leadForm.askFirstMessage ? (
        <div class="mm-field">
          <label class="mm-label-text" for="mm-f-first">
            {t('firstMessage')}
          </label>
          <textarea
            id="mm-f-first"
            class="mm-textarea"
            value={firstMessage}
            maxLength={1000}
            onInput={(e) => setFirstMessage((e.target as HTMLTextAreaElement).value)}
          />
        </div>
      ) : null}

      <button type="submit" class="mm-btn" disabled={busy}>
        {busy ? '…' : (config.leadForm.submitLabel ?? t('submit'))}
      </button>

      {config.leadForm.privacy ? (
        <p class="mm-privacy">
          {config.leadForm.privacy.text}{' '}
          <a href={config.leadForm.privacy.url} target="_blank" rel="noopener noreferrer nofollow">
            Privacy
          </a>
        </p>
      ) : null}
    </form>
  );
}
