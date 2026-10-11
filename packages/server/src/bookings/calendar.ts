import type { CalendarSync } from '@helppuff/protocol';
import type { Interval } from './slots.js';

/**
 * A synced calendar, as bookings use it: where free time comes from, where a
 * booking is written, and what the pull reads. One per provider
 * (`integrations/calcom.ts`, `calendly.ts`, `composio.ts`); keeping
 * appointments in HelpPuff alone has none.
 */

export type Attendee = { name: string; email: string; phone?: string | undefined; timezone: string };

export type BookInput = {
  start: number;
  end: number;
  title: string;
  attendee: Attendee;
  notes?: string | null;
  location?: string | null;
  /** Unique per booking attempt: a provider that takes one keeps a retry from booking twice. */
  idem: string;
};

/** What the provider made. `meta` keeps extras (a Calendly invitee's links). */
export type Booked = { externalId: string | null; start: number; end: number; location?: string | null; meta?: Record<string, string> };

/** The visitor finishes on the provider's page (Calendly on a free plan): the booking is read back by the sync. */
export type Redirect = { redirect: string };

export type ExternalEvent = {
  id: string;
  start: number;
  end: number;
  title: string;
  attendees: { email: string; name?: string | undefined }[];
  cancelled: boolean;
  /** Blocks time (a "free" or transparent event does not). */
  busy: boolean;
  location?: string | null;
  meta?: Record<string, string>;
};

export interface Calendar {
  kind: Exclude<CalendarSync, 'none'>;
  /** The provider's own slots (Cal.com, Calendly): used instead of the working hours. */
  slots?(window: Interval, duration: number): Promise<(Interval & { url?: string })[]>;
  /** Busy time (Google, Outlook): subtracted from the working hours. */
  busy?(window: Interval): Promise<Interval[]>;
  book(input: BookInput, slot?: { url?: string }): Promise<Booked | Redirect>;
  cancel(externalId: string, reason?: string): Promise<void>;
  /** Null when the provider cannot move a booking (Calendly): it is moved there. */
  reschedule: ((externalId: string, start: number, end: number) => Promise<Booked>) | null;
  /** Everything in a window, cancelled ones included where the provider says so: the pull. */
  list(window: Interval): Promise<ExternalEvent[]>;
  /** Check the connection; what was learned (the account, its event types). */
  test(): Promise<{ detail: string; meta?: Record<string, unknown>; eventTypes?: { id: string; name: string; duration: number | null }[] }>;
}

export const isRedirect = (value: Booked | Redirect): value is Redirect => 'redirect' in value;
