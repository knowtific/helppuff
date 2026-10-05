import { useState } from 'preact/hooks';
import type { Message, Option } from '@murmur/protocol';
import { Icon } from '../Icon.js';
import { renderMarkdown } from '../../lib/markdown.js';

type OptionsMsg = Extract<Message, { type: 'options' }>;

/**
 * Option chips. Tapping one sends it as an `action`; once answered the
 * chips go disabled so the thread still reads as a record of what was on
 * offer. A `multi` message collects a set and confirms once.
 */
export function OptionsMessage({
  message,
  consumed,
  onPick,
}: {
  message: OptionsMsg;
  consumed: boolean;
  onPick: (options: Option[]) => void;
}) {
  const [checked, setChecked] = useState<string[]>([]);

  const toggle = (option: Option) =>
    setChecked((current) =>
      current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id],
    );

  return (
    <div class="mm-options">
      {message.text ? (
        <div class="mm-agent" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }} />
      ) : null}

      <div class="mm-chips">
        {message.options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            class="mm-chip"
            // Staggered entrance, capped so a long list does not crawl in.
            style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
            disabled={consumed}
            {...(message.multi ? { 'aria-pressed': checked.includes(option.id) ? 'true' : 'false' } : {})}
            onClick={() => (message.multi ? toggle(option) : onPick([option]))}
          >
            {message.multi && checked.includes(option.id) ? <Icon name="check" size={15} /> : null}
            {option.label}
          </button>
        ))}
      </div>

      {message.multi && !consumed ? (
        <button
          type="button"
          class="mm-btn mm-confirm"
          disabled={checked.length === 0}
          onClick={() => onPick(message.options.filter((option) => checked.includes(option.id)))}
        >
          Confirm
        </button>
      ) : null}
    </div>
  );
}
