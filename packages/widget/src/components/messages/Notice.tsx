import type { IconName } from '@helppuff/protocol';
import { Icon } from '../Icon.js';

export function NoticeMessage({ text, tone, icon = 'info' }: { text: string; tone?: 'info' | 'warn'; icon?: IconName }) {
  return (
    <div class="hp-notice" data-tone={tone ?? 'info'}>
      <Icon name={icon} size={16} />
      <span>{text}</span>
    </div>
  );
}
