import { bookingProvider } from '@helppuff/rag';
import type { BookingMode, Shortcut, WidgetConfig } from '@helppuff/protocol';
import type { KvStore } from '@helppuff/connector-types';
import type { SiteConfig } from '../config/schema.js';
import type { D1Like } from '../db/d1.js';

/**
 * The booking link found on the website (the crawl's `booking` fact, else
 * its `bookingPage`), kept under its own KV key, `booking:<site>`, so a
 * deploy never drops it. While the owner has not chosen how visitors book
 * (`bookings.mode` unset), it is offered: "External booking link", silently.
 * Once they choose, the website never changes it.
 */

export type FoundBooking = { url: string; provider: string | null; page: string | null; at: number };

const key = (siteId: string) => `booking:${siteId}`;
const cache = new Map<string, { at: number; found: FoundBooking | null }>();
const TTL = 60_000;

export async function readFoundBooking(kv: Pick<KvStore, 'get'> | undefined, siteId: string, now = Date.now()): Promise<FoundBooking | null> {
  if (!kv) return null;
  const hit = cache.get(siteId);
  if (hit && now - hit.at < TTL) return hit.found;
  let found: FoundBooking | null;
  try {
    const raw = await kv.get(key(siteId), { cacheTtl: 60 });
    const parsed = raw ? (JSON.parse(raw) as Partial<FoundBooking>) : null;
    found = parsed && typeof parsed.url === 'string' && /^https:\/\//.test(parsed.url) ? { url: parsed.url, provider: parsed.provider ?? null, page: parsed.page ?? null, at: Number(parsed.at) || 0 } : null;
  } catch {
    found = null;
  }
  cache.set(siteId, { at: now, found });
  return found;
}

export function forgetFoundBooking(siteId?: string): void {
  if (siteId) cache.delete(siteId);
  else cache.clear();
}

/** After learning the site: the link it found, or none (a link removed from the site stops being offered). */
export async function foundAfterLearning(deps: { db: D1Like; kv: KvStore | undefined; now: () => number }, siteId: string): Promise<FoundBooking | null> {
  if (!deps.kv) return null;
  const rows = (await deps.db.prepare("SELECT key, value, source_url FROM site_facts WHERE site_id = ? AND key IN ('booking', 'bookingPage')").bind(siteId).all<{ key: string; value: string; source_url: string | null }>()).results;
  const row = rows.find((r) => r.key === 'booking') ?? rows.find((r) => r.key === 'bookingPage');
  forgetFoundBooking(siteId);
  if (!row || !/^https:\/\//.test(row.value)) {
    await deps.kv.delete(key(siteId));
    return null;
  }
  const found: FoundBooking = { url: row.value, provider: bookingProvider(row.value), page: row.source_url && row.source_url !== 'owner' ? row.source_url : null, at: deps.now() };
  await deps.kv.put(key(siteId), JSON.stringify(found));
  return found;
}

/** How visitors book on this site now: the owner's choice, else the website's link, else nothing. */
export function effectiveBooking(site: Pick<SiteConfig, 'bookings'>, found: FoundBooking | null): { mode: BookingMode; link: string | null; label: string; chosen: boolean } {
  const b = site.bookings;
  const label = b.label;
  if (b.mode === 'picker') return { mode: 'picker', link: null, label, chosen: true };
  if (b.mode === 'link') {
    const link = b.link ?? found?.url ?? null;
    return link ? { mode: 'link', link, label, chosen: true } : { mode: 'none', link: null, label, chosen: true };
  }
  if (b.mode === 'none') return { mode: 'none', link: null, label, chosen: true };
  return found ? { mode: 'link', link: found.url, label, chosen: false } : { mode: 'none', link: null, label, chosen: false };
}

export const BOOKING_SHORTCUT_ID = 'booking';

/** The widget config with the "Book a time" shortcut, after the quote button. */
export function withBooking(widget: WidgetConfig, booking: ReturnType<typeof effectiveBooking>): WidgetConfig {
  if (booking.mode === 'none') return widget;
  const action: Shortcut['action'] =
    booking.mode === 'link' && booking.link
      ? { id: BOOKING_SHORTCUT_ID, kind: 'url', label: booking.label, url: booking.link, newTab: true }
      : { id: BOOKING_SHORTCUT_ID, kind: 'booking', label: booking.label };
  const shortcut: Shortcut = { id: BOOKING_SHORTCUT_ID, label: booking.label, description: booking.mode === 'picker' ? 'Pick a time that suits you.' : undefined, icon: 'calendar', action };
  if (!shortcut.description) delete shortcut.description;
  const same = (label: string) => label.trim().toLowerCase() === booking.label.trim().toLowerCase();
  const others = (widget.home.shortcuts ?? []).filter((s) => s.id !== BOOKING_SHORTCUT_ID && !same(s.label));
  // After "Get a quote" when there is one: the two main ways to go ahead.
  const at = others[0]?.id === 'job-quote' ? 1 : 0;
  const shortcuts = [...others.slice(0, at), shortcut, ...others.slice(at)].slice(0, 8);
  return { ...widget, home: { ...widget.home, shortcuts } };
}
