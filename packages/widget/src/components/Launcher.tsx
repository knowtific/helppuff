import type { WidgetConfig } from '@murmur/protocol';
import { Icon } from './Icon.js';

/**
 * The app's launcher. Deliberately identical to the loader's static markup
 * (`launcher-shell.ts`) so the handoff is invisible.
 */
export function Launcher({
  config,
  open,
  unread,
  onClick,
}: {
  config: WidgetConfig;
  open: boolean;
  unread: number;
  onClick: () => void;
}) {
  const { position, offset, label, icon, shape } = config.launcher;
  const style = offset ? { '--mm-launcher-x': `${offset.x}px`, '--mm-launcher-y': `${offset.y}px` } : {};
  // A pill sits the label inside the button; once open it collapses back to
  // a circle, so the close glyph is not stranded beside stale text.
  const pill = shape === 'pill' && Boolean(label) && !open;

  return (
    <div class="mm-launcher" data-position={position} style={style as never}>
      <button
        type="button"
        class="mm-orb"
        {...(pill ? { 'data-shape': 'pill' } : {})}
        aria-label={label || `Chat with ${config.brand.name}`}
        aria-expanded={open ? 'true' : 'false'}
        aria-haspopup="dialog"
        aria-controls="mm-panel"
        onClick={onClick}
      >
        <Icon name={open ? 'close' : icon} size={24} />
        {pill ? <span class="mm-orb-label">{label}</span> : null}
        {!open && unread > 0 ? <span class="mm-dot" /> : null}
      </button>
      {label && !pill && !open ? <span class="mm-label">{label}</span> : null}
    </div>
  );
}
