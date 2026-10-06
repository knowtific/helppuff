import { useState } from 'preact/hooks';
import type { Field, Message } from '@helppuff/protocol';
import { FieldRow, collectValues, validateFields } from '../Fields.js';

type FormMsg = Extract<Message, { type: 'form' }>;

/**
 * An inline form in the thread. Uses the same field component as the
 * lead form, and submits as an `action` carrying a JSON value and a readable
 * label — the connector gets structured data, the transcript gets prose.
 */
export function FormMessage({
  message,
  consumed,
  onSubmit,
}: {
  message: FormMsg;
  consumed: boolean;
  onSubmit: (value: string, label: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const set = (field: Field, value: string) => {
    setValues((current) => ({ ...current, [field.name]: value }));
    if (errors[field.name]) setErrors((current) => ({ ...current, [field.name]: '' }));
  };

  const submit = (event: Event) => {
    event.preventDefault();
    if (consumed) return;

    const found = validateFields(message.fields, values);
    setErrors(found);
    setTouched(Object.fromEntries(message.fields.map((field) => [field.name, true])));
    if (Object.keys(found).length > 0) return;

    const collected = collectValues(message.fields, values);
    // The label is what appears in the thread, so it has to read as a sentence.
    const label = message.fields
      .filter((field) => collected[field.name])
      .map((field) => `${field.label}: ${collected[field.name]}`)
      .join(', ');

    onSubmit(JSON.stringify(collected), label || (message.submitLabel ?? 'Submitted'));
  };

  return (
    <form class="hp-inline-form" onSubmit={submit} noValidate>
      {message.title ? <h3 class="hp-card-title">{message.title}</h3> : null}

      {message.fields.map((field) => (
        <FieldRow
          key={field.name}
          field={field}
          idPrefix={`hp-i-${message.id}`}
          value={values[field.name] ?? ''}
          error={touched[field.name] ? (errors[field.name] ?? '') : ''}
          requiredLabel="required"
          onInput={(value) => set(field, value)}
          onBlur={() => {
            setTouched((current) => ({ ...current, [field.name]: true }));
            setErrors((current) => ({
              ...current,
              [field.name]: validateFields([field], values)[field.name] ?? '',
            }));
          }}
        />
      ))}

      <button type="submit" class="hp-btn" disabled={consumed}>
        {message.submitLabel ?? 'Submit'}
      </button>
    </form>
  );
}
