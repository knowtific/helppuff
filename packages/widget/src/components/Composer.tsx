import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon.js';
import { isTouch } from '../lib/env.js';
import type { StringKey } from '../app/strings.js';
import { CHAT_ACCEPT } from '@helppuff/protocol/files';

const MAX_LENGTH = 1000;
/** The counter appears only in the last 100 characters. */
const COUNTER_FROM = MAX_LENGTH - 100;
const MAX_HEIGHT_PX = 120;

export function Composer({
  value,
  disabled,
  offline,
  placeholder,
  t,
  onInput,
  onSend,
  onAttach,
}: {
  value: string;
  disabled: boolean;
  offline: boolean;
  placeholder: string;
  t: (key: StringKey) => string;
  onInput: (text: string) => void;
  onSend: () => void;
  /** Present while the visitor may send a file (`capabilities.files`). Given the input; the upload chunk reads it. */
  onAttach?: ((input: HTMLInputElement) => void) | undefined;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const touch = isTouch();

  // Grow to five lines, then scroll.
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    const wanted = element.scrollHeight;
    element.style.height = `${Math.min(wanted, MAX_HEIGHT_PX)}px`;
    // Only once it can grow no further does a scrollbar belong here.
    element.toggleAttribute('data-scrolls', wanted > MAX_HEIGHT_PX);
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled && !offline;

  const handleKeyDown = (event: KeyboardEvent) => {
    // On touch devices Enter inserts a newline and the button is primary.
    if (event.key !== 'Enter' || touch || event.shiftKey) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <div class="hp-composer-wrap">
      <div class="hp-composer">
        {onAttach ? (
          <label class="hp-attach">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m19 12-7 7a5 5 0 0 1-7-7l8-8a3 3 0 0 1 5 5l-8 8a1.5 1.5 0 0 1-2-2l7-7" />
            </svg>
            <input type="file" accept={CHAT_ACCEPT} aria-label={t('attach')} disabled={disabled || offline} onChange={(event) => onAttach(event.target as HTMLInputElement)} />
          </label>
        ) : null}
        <textarea
          ref={textarea}
          rows={1}
          value={value}
          disabled={disabled}
          maxLength={MAX_LENGTH}
          placeholder={placeholder}
          aria-label={placeholder}
          enterkeyhint={touch ? 'enter' : 'send'}
          onInput={(event) => onInput((event.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          class="hp-send"
          disabled={!canSend}
          aria-label={t('send')}
          onClick={() => canSend && onSend()}
        >
          <Icon name="send" size={17} />
        </button>
      </div>

      {value.length >= COUNTER_FROM ? (
        <div class="hp-counter">{MAX_LENGTH - value.length}</div>
      ) : null}
      {offline ? <div class="hp-offline">{t('offline')}</div> : null}
    </div>
  );
}
