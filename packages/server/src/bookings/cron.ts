import type { SiteConfig } from '../config/schema.js';
import type { D1Like } from '../db/d1.js';
import { emitTo, outboundOf, workflowRetry } from '../webhooks/deliver.js';
import { effectiveBooking } from './found.js';
import { bookingsOf, lastSynced, sendReminders, syncCalendar, type BookingDeps } from './service.js';

/**
 * The cron's part in bookings, for every site with the date picker on: read
 * the synced calendar every `bookings.syncMinutes`, and send
 * `appointment.reminder` a day ahead.
 */
export async function runScheduledBookings(env: Record<string, unknown>, db: D1Like, sites: Record<string, SiteConfig>, now: number): Promise<{ synced: string[]; reminded: number }> {
  const secret = typeof env['HELPPUFF_SECRET'] === 'string' ? env['HELPPUFF_SECRET'] : '';
  const fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init);
  const out = { synced: [] as string[], reminded: 0 };
  // Deliveries finish before the cron does.
  const deliveries: Promise<void>[] = [];
  for (const [siteId, site] of Object.entries(sites)) {
    if (effectiveBooking(site, null).mode !== 'picker') continue;
    const b = bookingsOf(site);
    const deps: BookingDeps = {
      db,
      secret,
      fetch: fetcher,
      now: () => now,
      log: () => {},
      emit: (type, data) => {
        deliveries.push(emitTo({ db, fetch: fetcher, now: () => now, retry: workflowRetry(env), ...outboundOf(env) }, siteId, type, data).catch(() => {}));
      },
    };
    try {
      if (b.sync !== 'none' && secret.length >= 32) {
        const last = await lastSynced(db, siteId, b);
        // A minute's slack, so a 15-minute schedule on a 15-minute cron is not skipped by seconds.
        if (!last || now - last >= b.syncMinutes * 60_000 - 60_000) {
          await syncCalendar(deps, siteId, b);
          out.synced.push(siteId);
        }
      }
    } catch {
      // Recorded on the integration (its status and error); tried again next time.
    }
    out.reminded += await sendReminders(deps, siteId).catch(() => 0);
  }
  await Promise.allSettled(deliveries);
  return out;
}
