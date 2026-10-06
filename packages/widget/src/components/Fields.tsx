import type { Field } from '@helppuff/protocol';

/**
 * One field, shared by the lead form and inline `form` messages, so
 * validation, labelling and mobile keyboard hints behave identically in both.
 */

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

/** Validate a whole set; returns a map of field name → message. */
export function validateFields(fields: readonly Field[], values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const error = validateField(field, values[field.name] ?? '');
    if (error) errors[field.name] = error;
  }
  return errors;
}

/** Trim and drop empties, producing the record the protocol expects. */
export function collectValues(fields: readonly Field[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = (values[field.name] ?? '').trim();
    if (value) out[field.name] = value;
  }
  return out;
}

/** Sensible mobile keyboards, so autofill works. */
function inputMode(field: Field): string | undefined {
  if (field.type === 'email') return 'email';
  if (field.type === 'tel') return 'tel';
  return undefined;
}

export function FieldRow({
  field,
  idPrefix,
  value,
  error,
  requiredLabel,
  onInput,
  onBlur,
}: {
  field: Field;
  idPrefix: string;
  value: string;
  error: string;
  requiredLabel: string;
  onInput: (value: string) => void;
  onBlur: () => void;
}) {
  const id = `${idPrefix}-${field.name}`;
  const describedBy = error ? `${id}-err` : undefined;
  const shared = {
    id,
    value,
    'aria-invalid': error ? ('true' as const) : ('false' as const),
    'aria-describedby': describedBy,
    onBlur,
  };

  return (
    <div class="hp-field">
      <label class="hp-label-text" for={id}>
        {field.label}
        {field.required ? (
          <span class="hp-req" aria-hidden="true">
            {' *'}
          </span>
        ) : null}
        {field.required ? <span class="hp-sr">{` (${requiredLabel})`}</span> : null}
      </label>

      {field.type === 'textarea' ? (
        <textarea
          {...shared}
          class="hp-textarea"
          placeholder={field.placeholder ?? ''}
          onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)}
        />
      ) : field.type === 'select' ? (
        <select
          {...shared}
          class="hp-select"
          onChange={(e) => onInput((e.target as HTMLSelectElement).value)}
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
          {...shared}
          class="hp-input"
          type={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'}
          placeholder={field.placeholder ?? ''}
          autocomplete={field.autocomplete ?? 'off'}
          inputMode={inputMode(field)}
          onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        />
      )}

      {error ? (
        <span class="hp-error-text" id={`${id}-err`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
