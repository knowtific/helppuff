import { useCallback, useEffect, useState } from 'react';

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const number = new Intl.NumberFormat();
export const fmtNumber = (value: number) => number.format(Math.round(value));
export const fmtPercent = (value: number) => `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
export const fmtDecimal = (value: number) => value.toFixed(1);

export function fmtRelative(ts: number, now = Date.now()): string {
  const seconds = Math.round((now - ts) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** `https://acme.com/pricing?x=1` → `/pricing`. */
export function pathOf(url: string | null | undefined): string {
  if (!url) return '—';
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/' ? parsed.host : parsed.pathname;
  } catch {
    return url;
  }
}

export function flag(country: string | null | undefined): string {
  if (!country || !/^[A-Z]{2}$/.test(country) || country === 'XX' || country === 'T1') return '';
  return String.fromCodePoint(...[...country].map((c) => 127397 + c.charCodeAt(0)));
}

/** Two letters from a name or email; empty for something with no letters, like a phone number. */
export function initials(value: string | null | undefined): string {
  const parts = (value ?? '').replace(/@.*/, '').split(/[\s._-]+/).filter((p) => /^\p{L}/u.test(p));
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** A stable soft colour per visitor, for avatars. */
export function hueOf(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

// ------------------------------------------------------------------ routing

export type Route = { page: 'overview' | 'conversations' | 'leads' | 'prompt' | 'settings'; id?: string | undefined };

function parseHash(): Route {
  const [page, id] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (page === 'conversations' || page === 'leads' || page === 'prompt' || page === 'settings') return { page, id: id || undefined };
  return { page: 'overview' };
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const update = () => setRoute(parseHash());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const go = useCallback((next: Route) => {
    window.location.hash = `/${next.page}${next.id ? `/${next.id}` : ''}`;
  }, []);
  return [route, go];
}

export function href(route: Route): string {
  return `#/${route.page}${route.id ? `/${route.id}` : ''}`;
}

// ------------------------------------------------------------------ data

/** A tiny fetch-on-deps hook with reload. */
export function useData<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: Error | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error: Error) => live && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('mm-theme', next ? 'dark' : 'light');
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    setDark(next);
  };
  return [dark, toggle];
}
