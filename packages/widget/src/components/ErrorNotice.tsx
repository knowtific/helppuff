import { useEffect, useState } from 'preact/hooks';
import type { WidgetConfig } from '@murmur/protocol';
import type { WidgetError } from '../app/store.js';
import type { StringKey } from '../app/strings.js';

/**
 * Recoverable failures degrade in place: the panel stays open, the
 * typed message is kept, and the visitor is offered a way forward — a retry,
 * a countdown, or the site's fallback contact details.
 */
export function ErrorNotice({
  error,
  config,
  t,
  onRetry,
  onNewChat,
  onDismiss,
}: {
  error: WidgetError;
  config: WidgetConfig;
  t: (key: StringKey) => string;
  onRetry: () => void;
  onNewChat: () => void;
  onDismiss: () => void;
}) {
  const [remaining, setRemaining] = useState(error.retryAfter ?? 0);

  useEffect(() => {
    setRemaining(error.retryAfter ?? 0);
  }, [error]);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining]);

  const contact = config.chat.fallbackContact;
  const showContact = error.code === 'quota_exceeded' || error.code === 'connector_error';
  const expired = error.code === 'session_expired';

  return (
    <div class="mm-inline-error" role="alert">
      <span>
        {error.message}
        {remaining > 0 ? ` (${formatWait(remaining)})` : ''}
      </span>

      <div class="mm-error-actions">
        {expired ? (
          <button type="button" class="mm-chip" onClick={onNewChat}>
            {t('newChat')}
          </button>
        ) : error.retryable ? (
          <button type="button" class="mm-chip" disabled={remaining > 0} onClick={onRetry}>
            {t('retry')}
          </button>
        ) : null}

        {showContact && contact?.phone ? (
          <a class="mm-chip" href={`tel:${contact.phone}`} style={{ textDecoration: 'none' }}>
            {t('callUs')}
          </a>
        ) : null}
        {showContact && contact?.email ? (
          <a class="mm-chip" href={`mailto:${contact.email}`} style={{ textDecoration: 'none' }}>
            {t('emailUs')}
          </a>
        ) : null}

        <button type="button" class="mm-chip" onClick={onDismiss}>
          {t('dismiss')}
        </button>
      </div>
    </div>
  );
}

/** 45 → "45s", 1329 → "about 23 min" — a countdown only reads as seconds while it is short. */
export function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  return `about ${Math.ceil(seconds / 60)} min`;
}
