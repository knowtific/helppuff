import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type RequestCtx } from '../core/request.js';
import { dbFrom } from '../db/d1.js';
import { announceJob } from '../admin/jobs.js';
import { emit } from '../webhooks/deliver.js';
import type { BookingDeps } from './service.js';

/** The booking service's dependencies for a request: its database, secret, webhooks and the team's alerts. */
export function bookingDeps(ctx: RequestCtx, siteId: string): BookingDeps {
  const db = dbFrom(ctx.env);
  if (!db) throw new HelpPuffError('not_found', { message: 'Appointments need the dashboard\'s database. Run `helppuff deploy` with the dashboard on.', detail: 'bookings_no_db' });
  return {
    db,
    secret: requireSecret(ctx),
    // Looked up at call time, so a test's stub (and the e2e Worker's) is the one used.
    fetch: (input, init) => globalThis.fetch(input, init),
    now: () => ctx.platform.now(),
    log: (event, data) => ctx.platform.log(event, data),
    emit: (type, data) => emit(ctx, siteId, type, data),
    jobCreated: (job) => announceJob(ctx, siteId, 'job.created', job),
  };
}
