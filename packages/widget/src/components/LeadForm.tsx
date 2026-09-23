import { useState } from 'preact/hooks';
import type { Field, WidgetConfig } from '@murmur/protocol';
import { FieldRow, collectValues, validateField, validateFields } from './Fields.js';
import type { StringKey } from '../app/strings.js';

export { validateField };

export function LeadForm({
  config,
  initial,
  initialMessage,
  busy,
  t,
  onSubmit,
}: {
  config: WidgetConfig;
  initial: Record<string, string> | null;
  /**
   * A message the visitor already wrote before the form appeared — a finished
   * flow's summary, or text typed with no session yet. It prefills the
   * first-message box so they can see and edit what will be sent, instead of
   * it riding along invisibly or being replaced by whatever they type here.
   */
  initialMessage?: string | null;
  busy: boolean;
  t: (key: StringKey) => string;
  onSubmit: (lead: Record<string, string>, firstMessage?: string) => void;
}) {
  const fields = config.leadForm.fields;
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(initial ?? {}) }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [firstMessage, setFirstMessage] = useState(() => initialMessage ?? '');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const set = (name: string, value: string) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    // Clear an error as soon as the visitor fixes it, but do not add one while typing.
    if (errors[name]) setErrors((previous) => ({ ...previous, [name]: '' }));
  };

  const blur = (field: Field) => {
    setTouched((previous) => ({ ...previous, [field.name]: true }));
    setErrors((previous) => ({ ...previous, [field.name]: validateField(field, values[field.name] ?? '') ?? '' }));
  };

  const submit = (event: Event) => {
    event.preventDefault();
    if (busy) return;

    const found = validateFields(fields, values);
    setErrors(found);
    setTouched(Object.fromEntries(fields.map((f) => [f.name, true])));
    if (Object.keys(found).length > 0) return;

    onSubmit(collectValues(fields, values), firstMessage.trim() || undefined);
  };

  return (
    <form class="mm-form" onSubmit={submit} noValidate>
      {config.leadForm.title ? <h2 class="mm-form-title">{config.leadForm.title}</h2> : null}

      {fields.map((field) => (
        <FieldRow
          key={field.name}
          field={field}
          idPrefix="mm-f"
          value={values[field.name] ?? ''}
          error={touched[field.name] ? (errors[field.name] ?? '') : ''}
          requiredLabel={t('required')}
          onInput={(value) => set(field.name, value)}
          onBlur={() => blur(field)}
        />
      ))}

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
