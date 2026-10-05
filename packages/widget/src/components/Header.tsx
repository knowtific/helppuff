import type { WidgetConfig } from '@murmur/protocol';
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
    <header class="mm-header">
      {showBack ? (
        <button type="button" class="mm-icon-btn" aria-label={t('back')} onClick={onBack}>
          <Icon name="arrow-left" />
        </button>
      ) : (
        <Orb className="mm-header-orb" size={34} avatar={config.brand.avatar} thinking={thinking} />
      )}

      <div class="mm-header-text">
        <div class="mm-header-name" id="mm-title">{config.brand.agentName}</div>
        <div class="mm-header-status">{thinking ? t('thinking') : t('status')}</div>
      </div>

      <button type="button" class="mm-icon-btn mm-close" aria-label={t('close')} onClick={onClose}>
        <Icon name="close" />
      </button>
    </header>
  );
}
