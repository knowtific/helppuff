import { Icon } from '../Icon.js';

export function NoticeMessage({ text, tone }: { text: string; tone?: 'info' | 'warn' }) {
  return (
    <div class="hp-notice" data-tone={tone ?? 'info'}>
      <Icon name="info" size={16} />
      <span>{text}</span>
    </div>
  );
}
