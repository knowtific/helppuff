import type { IconName } from '@murmur/protocol';
import { ICON_PATHS } from '../lib/icons.js';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

/** The signature orb (§9.2), shared by the launcher and the header. */
export function Orb({
  size = 56,
  avatar,
  thinking,
  className = '',
}: {
  size?: number;
  avatar?: string | undefined;
  thinking?: boolean;
  className?: string;
}) {
  return (
    <span
      class={className}
      style={{ width: `${size}px`, height: `${size}px`, minWidth: `${size}px` }}
      {...(thinking ? { 'data-thinking': '' } : {})}
    >
      {avatar ? <img src={avatar} alt="" loading="lazy" decoding="async" /> : null}
    </span>
  );
}
