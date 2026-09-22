/**
 * Feature detection, never user-agent sniffing (§8.3). A browser missing any
 * of these simply never sees the launcher, which is the correct outcome: no
 * widget beats a broken one.
 */
export function isSupported(): boolean {
  try {
    return (
      typeof document !== 'undefined' &&
      typeof window !== 'undefined' &&
      typeof Element !== 'undefined' &&
      typeof Element.prototype.attachShadow === 'function' &&
      typeof fetch === 'function' &&
      typeof Promise === 'function' &&
      typeof AbortController === 'function' &&
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      typeof JSON !== 'undefined'
    );
  } catch {
    return false;
  }
}

/** `?mmdebug=1` turns on console logging for this page view only (§8.3). */
export function debugEnabled(): boolean {
  try {
    return new URLSearchParams(location.search).get('mmdebug') === '1';
  } catch {
    return false;
  }
}

let debug = false;

export function setDebug(value: boolean): void {
  debug = value;
}

/**
 * Silent at default verbosity. The widget writes nothing to a host page's
 * console unless the site owner asked for it.
 */
export function log(event: string, data?: unknown): void {
  if (!debug) return;
  try {
    console.log(`[murmur] ${event}`, data ?? '');
  } catch {
    // A host page that broke console is not our problem to solve.
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function isTouch(): boolean {
  try {
    return window.matchMedia('(hover: none)').matches;
  } catch {
    return false;
  }
}
