import type { LauncherIconName } from '@murmur/protocol';
import { ICON_PATHS } from './lib/icons.js';
import { fetchWithTimeout } from './lib/safe.js';

/**
 * The loader's slice of the config. It needs only enough to paint a
 * launcher in the right colour, in the right corner, on the right pages — so
 * it reads those fields directly rather than importing the full validator,
 * which costs more than the loader's entire 4 kb budget.
 *
 * The app does the complete `parseConfig` when it mounts, and hides the
 * widget if that fails. Nothing incorrect can render in between: every field
 * below is either validated here or replaced by its default.
 */

export const CONFIG_TIMEOUT_MS = 6000;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export type LauncherHints = {
  name: string;
  accent: string;
  accentFg: string;
  theme: 'light' | 'dark' | 'auto';
  position: 'bottom-right' | 'bottom-left';
  label: string;
  icon: LauncherIconName;
  shape: 'orb' | 'pill';
  offset: { x: number; y: number } | null;
  hideOnPaths: string[];
  /**
   * The earliest the app could need to be mounted — a teaser is drawn by the
   * app, so it cannot appear before the chunk has loaded. Null when the site
   * configures no teaser.
   */
  teaserAt: number | null;
  /** Whether a teaser is waiting on a scroll position rather than a timer. */
  teaserOnScroll: boolean;
};

export type RawConfig = { widget: unknown; capabilities: { poll: boolean; end: boolean; stream: boolean; feedback: boolean } };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Fetch and structurally check the config. A failure, a timeout, a non-2xx or
 * a body that is not shaped like a config is fatal and throws.
 */
export async function fetchConfig(base: string, siteId: string): Promise<RawConfig> {
  const response = await fetchWithTimeout(
    `${base}/v1/sites/${encodeURIComponent(siteId)}/config`,
    { method: 'GET', credentials: 'omit', mode: 'cors' },
    CONFIG_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`config_status_${response.status}`);

  const body: unknown = await response.json();
  if (!isObject(body) || !isObject(body['widget'])) throw new Error('config_malformed');

  const capabilities = isObject(body['capabilities']) ? body['capabilities'] : {};
  return {
    widget: body['widget'],
    capabilities: {
      poll: capabilities['poll'] === true,
      end: capabilities['end'] === true,
      stream: capabilities['stream'] === true,
      feedback: capabilities['feedback'] === true,
    },
  };
}

/** Pull the launcher's fields out, substituting a default for anything unusable. */
export function launcherHints(widget: unknown): LauncherHints {
  const root = isObject(widget) ? widget : {};
  const brand = isObject(root['brand']) ? root['brand'] : {};
  const launcher = isObject(root['launcher']) ? root['launcher'] : {};

  const accent = typeof brand['accent'] === 'string' && HEX.test(brand['accent']) ? brand['accent'] : '#5B5BF7';
  const theme = brand['theme'];
  const position = launcher['position'];
  const offset = isObject(launcher['offset']) ? launcher['offset'] : null;
  const x = offset && typeof offset['x'] === 'number' ? offset['x'] : null;
  const y = offset && typeof offset['y'] === 'number' ? offset['y'] : null;

  const icon = launcher['icon'];
  const shape = launcher['shape'];
  const teaser = isObject(root['teaser']) ? root['teaser'] : null;
  const delay = teaser && typeof teaser['delayMs'] === 'number' ? teaser['delayMs'] : null;

  return {
    name: typeof brand['name'] === 'string' && brand['name'] ? brand['name'].slice(0, 60) : 'Chat',
    accent,
    accentFg: readableOn(accent),
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
    position: position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    label: typeof launcher['label'] === 'string' ? launcher['label'].slice(0, 40) : '',
    icon: typeof icon === 'string' && icon in ICON_PATHS ? (icon as LauncherIconName) : 'chat',
    shape: shape === 'pill' ? 'pill' : 'orb',
    offset: x !== null && y !== null ? { x, y } : null,
    hideOnPaths: Array.isArray(launcher['hideOnPaths'])
      ? launcher['hideOnPaths'].filter((p): p is string => typeof p === 'string').slice(0, 50)
      : [],
    teaserAt: teaser ? (delay ?? 8000) : null,
    teaserOnScroll: Boolean(teaser && typeof teaser['afterScroll'] === 'number'),
  };
}

/**
 * Black or white, whichever reads better on the accent. The full
 * WCAG helpers live in `lib/color.ts`, in the app chunk; this is the one
 * calculation the loader cannot defer.
 */
export function readableOn(hex: string): string {
  const value = hex.replace(/^#/, '');
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value.slice(0, 6);
  const channel = (offset: number) => {
    const c = (parseInt(full.slice(offset, offset + 2), 16) || 0) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  // 0.179 is where contrast against white and against near-black are equal.
  return luminance > 0.179 ? '#111114' : '#FFFFFF';
}
