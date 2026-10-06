import type { Action } from '@helppuff/protocol';
import { Icon } from '../Icon.js';

/**
 * The action row shared by cards and carousel items. `url`, `tel` and
 * `email` are real anchors so the browser handles them natively; the rest go
 * back through the protocol.
 */
export function ActionButtons({
  actions,
  disabled,
  onAction,
}: {
  actions: Action[];
  disabled?: boolean;
  onAction: (action: Action) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <div class="hp-actions">
      {actions.map((action) => {
        if (action.kind === 'url') {
          return (
            <a
              key={action.id}
              class="hp-chip"
              href={action.url}
              {...(action.newTab === false ? {} : { target: '_blank' })}
              rel="noopener noreferrer nofollow"
            >
              {action.label}
              <Icon name="external" size={14} />
            </a>
          );
        }
        if (action.kind === 'tel') {
          return (
            <a key={action.id} class="hp-chip" href={`tel:${action.phone}`}>
              <Icon name="phone" size={14} />
              {action.label}
            </a>
          );
        }
        if (action.kind === 'email') {
          return (
            <a key={action.id} class="hp-chip" href={`mailto:${action.email}`}>
              <Icon name="mail" size={14} />
              {action.label}
            </a>
          );
        }
        return (
          <button
            key={action.id}
            type="button"
            class="hp-chip"
            disabled={disabled}
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
