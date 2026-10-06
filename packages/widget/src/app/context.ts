import type { VisitorContext } from '@helppuff/protocol';

/**
 * What the widget tells the server about the page it is sitting on.
 * Every read is guarded: a sandboxed iframe throws on `document.referrer`, and
 * a locked-down browser throws on `Intl`.
 */
export function pageContext(): VisitorContext {
  const context: VisitorContext = { pageUrl: read(() => location.href, '') };

  const title = read(() => document.title, '');
  if (title) context.pageTitle = title.slice(0, 300);

  const referrer = read(() => document.referrer, '');
  if (referrer) context.referrer = referrer.slice(0, 2048);

  const utm = readUtm();
  if (utm) context.utm = utm;

  const locale = read(() => navigator.language, '');
  if (locale) context.locale = locale.slice(0, 35);

  const timezone = read(() => Intl.DateTimeFormat().resolvedOptions().timeZone, '');
  if (timezone) context.timezone = timezone.slice(0, 64);

  return context;
}

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

function readUtm(): VisitorContext['utm'] {
  return read(() => {
    const params = new URLSearchParams(location.search);
    const utm: Record<string, string> = {};
    for (const key of UTM_KEYS) {
      const value = params.get(`utm_${key}`);
      if (value) utm[key] = value.slice(0, 200);
    }
    return Object.keys(utm).length > 0 ? utm : undefined;
  }, undefined);
}

function read<T>(fn: () => T, fallback: T): T {
  try {
    const value = fn();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * Glob matching for `paths` and `hideOnPaths` filters. Supports `*` (within a
 * segment) and `**` (across segments) — enough for the config's needs without
 * a regex library.
 */
export function matchesPath(pattern: string, pathname: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    // eslint-disable-next-line no-control-regex -- NUL is the placeholder for `**`
    .replace(/\u0000/g, '.*');
  try {
    return new RegExp(`^${escaped}$`).test(pathname);
  } catch {
    return false;
  }
}

/** True when no filter is configured, or any pattern matches. */
export function pathAllowed(patterns: string[] | undefined, pathname: string): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => matchesPath(pattern, pathname));
}

export function currentPath(): string {
  return read(() => location.pathname, '/');
}

/** Client ids only need to be unique within a session. */
export function clientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-crypto path.
  }
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
