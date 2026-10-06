import type { WidgetConfig } from '@helppuff/protocol';
import { Icon, Orb } from './Icon.js';
import type { StringKey } from '../app/strings.js';

export function Header({
  config,
  thinking,
  showBack,
  t,
  onBack,
  onClose,
}: {
  config: WidgetConfig;
  thinking: boolean;
  showBack: boolean;
  t: (key: StringKey) => string;
  onBack: () => void;
  onClose: () => void;
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
        <div class="hp-header-status">{thinking ? t('thinking') : t('status')}</div>
      </div>

      <button type="button" class="hp-icon-btn hp-close" aria-label={t('close')} onClick={onClose}>
        <Icon name="close" />
      </button>
    </header>
  );
}
