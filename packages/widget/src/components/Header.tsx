import type { WidgetConfig } from '@helppuff/protocol';
import { Icon, Orb } from './Icon.js';
import type { StringKey } from '../app/strings.js';

export function Header({
  config,
  thinking,
  showBack,
  status,
  t,
  onBack,
  onClose,
  onPerson,
}: {
  config: WidgetConfig;
  thinking: boolean;
  showBack: boolean;
  /** Replaces the usual status line (live chat: who is answering). */
  status?: string;
  t: (key: StringKey) => string;
  onBack: () => void;
  onClose: () => void;
  /** Ask for a person (live chat on, not live yet). */
  onPerson?: () => void;
}) {
  return (
    <header class="hp-header">
      {showBack ? (
        <button type="button" class="hp-icon-btn" aria-label={t('back')} onClick={onBack}>
          <Icon name="arrow-left" />
        </button>
      ) : (
        <Orb className="hp-header-orb" size={34} avatar={config.brand.avatar} thinking={thinking} />
      )}

      <div class="hp-header-text">
        <div class="hp-header-name" id="hp-title">{config.brand.agentName}</div>
        <div class="hp-header-status">{thinking ? t('thinking') : (status ?? t('status'))}</div>
      </div>

      {onPerson ? (
        <button type="button" class="hp-icon-btn" aria-label={t('talkToPerson')} title={t('talkToPerson')} onClick={onPerson}>
          <Icon name="person" />
        </button>
      ) : null}

      <button type="button" class="hp-icon-btn hp-close" aria-label={t('close')} onClick={onClose}>
        <Icon name="close" />
      </button>
    </header>
  );
}
