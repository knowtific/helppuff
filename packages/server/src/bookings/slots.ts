import { DAY_PART_HOURS, type DayPart, type Weekday } from '@helppuff/protocol';
import { addDays, atZoned, daysBetween, weekdayOf, zoned } from './time.js';

/**
 * Free times, made by HelpPuff from working hours: for keeping appointments
 * in HelpPuff alone, and for Google Calendar and Outlook (which have no
 * event types: their busy time is subtracted). Cal.com and Calendly hand us
 * their own slots instead. Pure, so every rule is tested without a clock.
 */

export type Interval = { start: number; end: number };

export type SlotRules = {
  hours: Record<Weekday, string[]>;
  /** Minutes. */
  duration: number;
  buffer: number;
  notice: number;
  daysAhead: number;
  /** The business's time zone: the hours are local to it. */
  timezone: string;
};

/** Slots start on these minutes past the hour, or the duration's step when it is shorter. */
const step = (duration: number) => (duration <= 15 ? 15 : duration <= 30 ? 30 : 60) * 60_000;

/**
 * Every free slot starting in [from, to): within the hours, at least
 * `notice` from now, within `daysAhead`, clear of `busy` (each widened by
 * the buffer on both sides). Sorted.
 */
export function makeSlots(rules: SlotRules, window: Interval, busy: readonly Interval[], now: number): Interval[] {
  const duration = rules.duration * 60_000;
  const buffer = rules.buffer * 60_000;
  const earliest = Math.max(window.start, now + rules.notice * 60_000);
  const today = zoned(now, rules.timezone).date;
  const lastDay = addDays(today, rules.daysAhead);
  const latest = Math.min(window.end, atZoned(addDays(lastDay, 1), '00:00', rules.timezone));
  if (earliest >= latest) return [];
  const blocked = busy.map((b) => ({ start: b.start - buffer, end: b.end + buffer })).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  let date = zoned(earliest, rules.timezone).date;
  const endDate = zoned(latest - 1, rules.timezone).date;
  for (let guard = 0; date <= endDate && guard < 400; guard++, date = addDays(date, 1)) {
    for (const range of rules.hours[weekdayOf(date)] ?? []) {
      const [open, close] = range.split('-') as [string, string];
      const opens = atZoned(date, open, rules.timezone);
      const closes = close === '24:00' ? atZoned(addDays(date, 1), '00:00', rules.timezone) : atZoned(date, close, rules.timezone);
      // Aligned to the hour (or half or quarter hour) from the opening time.
      for (let start = opens; start + duration <= closes; start += step(rules.duration)) {
        if (start < earliest || start >= latest) continue;
        const end = start + duration;
        if (blocked.some((b) => b.start < end && b.end > start)) continue;
        out.push({ start, end });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Only the slots in a part of the day (in the visitor's time zone). */
export function inPart(slots: readonly Interval[], part: DayPart | undefined, timeZone: string): Interval[] {
  if (!part) return [...slots];
  const [from, to] = DAY_PART_HOURS[part];
  return slots.filter((s) => {
    const hour = zoned(s.start, timeZone).hour;
    return hour >= from && hour < to;
  });
}

/** Slots grouped by the visitor's date, in order. */
export function byDay<T extends Interval>(slots: readonly T[], timeZone: string): { date: string; slots: T[] }[] {
  const days = new Map<string, T[]>();
  for (const slot of slots) {
    const date = zoned(slot.start, timeZone).date;
    const list = days.get(date);
    if (list) list.push(slot);
    else days.set(date, [slot]);
  }
  return [...days].map(([date, list]) => ({ date, slots: list }));
}

/** The window the picker asks for: whole days in the visitor's time zone, at most `maxDays`. */
export function dayWindow(from: string, to: string, timeZone: string, maxDays: number): Interval & { from: string; to: string } {
  const span = Math.max(0, Math.min(daysBetween(from, to), maxDays - 1));
  const last = addDays(from, span);
  return { from, to: last, start: atZoned(from, '00:00', timeZone), end: atZoned(addDays(last, 1), '00:00', timeZone) };
}
