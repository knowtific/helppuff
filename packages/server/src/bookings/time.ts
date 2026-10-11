import { WEEKDAYS, type Weekday } from '@helppuff/protocol';

/**
 * Wall-clock time in a time zone, with nothing but `Intl`: what working
 * hours, the picker's days and every calendar API need. A date is
 * `YYYY-MM-DD`; a time `HH:MM`; instants are milliseconds (UTC).
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Whether the runtime knows this IANA time zone. */
export function validTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return false;
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export type Zoned = { date: string; hour: number; minute: number; weekday: Weekday };

/** The wall-clock date and time an instant is in a time zone. */
export function zoned(ms: number, timeZone: string): Zoned {
  const parts = Object.fromEntries(partsFormatter(timeZone).formatToParts(ms).map((p) => [p.type, p.value]));
  const weekday = (parts['weekday'] ?? 'Mon').toLowerCase().slice(0, 3) as Weekday;
  return { date: `${parts['year']}-${parts['month']}-${parts['day']}`, hour: Number(parts['hour']) % 24, minute: Number(parts['minute']), weekday };
}

/** How far a time zone is ahead of UTC at an instant, in milliseconds. */
function offsetAt(ms: number, timeZone: string): number {
  const parts = Object.fromEntries(partsFormatter(timeZone).formatToParts(ms).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']), Number(parts['hour']) % 24, Number(parts['minute']), Number(parts['second']));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a wall-clock time is in a time zone. A time skipped by a
 * clock change resolves to the hour after; one that happens twice, to the
 * first.
 */
export function atZoned(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  return first === second ? first : Math.min(first, second);
}

/** The date `days` after `date`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The weekday of a date (any time zone: a date is a date). */
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]!;
}

/** Days from `from` to `to`, `to` included. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `YYYY-MM-DDTHH:MM:SS` local to a time zone: what Google's and Outlook's tools take. */
export function localIso(ms: number, timeZone: string): string {
  const z = zoned(ms, timeZone);
  return `${z.date}T${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}:00`;
}

/** "Sunday 11 October 2026, 10:00 am" in a time zone: the date line in the prompt. */
export function longNow(ms: number, timeZone: string): string {
  try {
    const day = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(ms);
    const time = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(ms).replace(/\s?([ap])\.?m\.?$/i, (_m, x: string) => ` ${x.toLowerCase()}m`);
    return `${day.replace(/,/g, '')}, ${time}`;
  } catch {
    return new Date(ms).toISOString();
  }
}
