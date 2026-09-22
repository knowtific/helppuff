import { Icon } from './Icon.js';

export function Teaser({
  text,
  position,
  onOpen,
  onDismiss,
}: {
  text: string;
  position: 'bottom-right' | 'bottom-left';
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div class="mm-teaser" data-position={position}>
      <button type="button" style={{ flex: 1, textAlign: 'start' }} onClick={onOpen}>
        {text}
      </button>
      <button type="button" class="mm-teaser-close" aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
