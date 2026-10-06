import type { IconName, LauncherIconName } from '@helppuff/protocol';

/**
 * The built-in icon set: 1.5px stroke on a 20px grid, rounded caps.
 * Inline SVG paths — no icon font and no external request.
 *
 * Shared with the loader, which needs whichever icon the site chose for its
 * launcher before the app chunk exists.
 */
export const ICON_PATHS: Record<IconName, string> = {
  // A rounded bubble with a tail, and three dots for the conversation. The
  // dots are zero-length segments rendered by `stroke-linecap: round`, the
  // same trick the `menu` icon uses.
  chat: 'M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V5.5A2.5 2.5 0 0 1 6.5 3h12A2.5 2.5 0 0 1 21 5.5ZM8.5 10h.01M12.5 10h.01M16.5 10h.01',
  phone: 'M15.5 21A12.5 12.5 0 0 1 3 8.5 2.5 2.5 0 0 1 5.5 6h1.6a1 1 0 0 1 1 .8l.6 2.6a1 1 0 0 1-.4 1L7 11.6a10 10 0 0 0 5.4 5.4l1.2-1.3a1 1 0 0 1 1-.3l2.6.6a1 1 0 0 1 .8 1v1.5A2.5 2.5 0 0 1 15.5 21Z',
  mail: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9ZM3.5 7l8.5 6 8.5-6',
  calendar: 'M4 9h16M7 4v3m10-3v3M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
  quote: 'M6 15h6l3 4v-4h3a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1ZM8 9h8M8 12h5',
  pin: 'M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
  wrench: 'M15 7a4 4 0 0 1 5.3 4.8l-9 9a2.1 2.1 0 0 1-3-3l9-9A4 4 0 0 1 15 7Zm0 0-3.5-3.5M6 18h.01',
  heart: 'M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7-.8c0 4.8-7 12.8-7 12.8Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9v4.5M12 8h.01',
  book: 'M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm0 0v13a3 3 0 0 0 3 3M9 8h5M9 12h5',
  'arrow-right': 'M5 12h14m-6-6 6 6-6 6',
  'arrow-left': 'M19 12H5m6 6-6-6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  send: 'm4 12 16-8-6 16-2.5-6.5L4 12Z',
  menu: 'M5 12h.01M12 12h.01M19 12h.01',
  sound: 'M11 5 6.5 9H4v6h2.5L11 19V5Zm4 3.5a5 5 0 0 1 0 7M17.5 6a8 8 0 0 1 0 12',
  'sound-off': 'M11 5 6.5 9H4v6h2.5L11 19V5Zm4.5 4.5 4 4m0-4-4 4',
  check: 'm5 12.5 4.5 4.5L19 7',
  external: 'M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4',
};

/** An `<svg>` string, for the loader, which has no renderer. */
export function launcherIconSvg(name: LauncherIconName, size = 24): string {
  const path = ICON_PATHS[name] ?? ICON_PATHS.chat;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${path}"/></svg>`;
}
