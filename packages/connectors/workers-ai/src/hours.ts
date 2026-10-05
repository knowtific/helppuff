/**
 * Opening hours, as businesses write them, and whether they are open now.
 *
 * Accepts the shapes crawled pages and owners actually produce:
 *   "Monday, Tuesday: 07:00–17:00"        (our own JSON-LD rendering)
 *   "Mo-Fr 08:00-17:00", "Sa 09:00-12:00"   (schema.org openingHours)
 *   "Mon–Fri 8am–5pm"                       (free text)
 * Anything unparseable is still shown to the model as text; only "open now"
 * needs it parsed, and that answer is simply left out when it cannot be.
 */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function dayIndex(token: string): number | null {
  const t = token.toLowerCase().replace(/[^a-z]/g, '');
  if (t.length < 2) return null;
  const i = DAYS.findIndex((d) => d.startsWith(t.slice(0, Math.min(3, t.length))) || (t.length === 2 && d.startsWith(t)));
  return i === -1 ? null : i;
}

function minutes(token: string): number | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(token.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h > 24 || min > 59 ? null : h * 60 + min;
}

export type Span = { day: number; open: number; close: number };

/** Parse one or more hours lines into day spans. Unparseable parts are skipped. */
export function parseHours(lines: readonly string[]): Span[] {
  const spans: Span[] = [];
  for (const line of lines.flatMap((l) => l.split(/;|\n/))) {
    const m = /^\s*(.+?)[\s:]+(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*$/i.exec(line);
    if (!m) continue;
    const open = minutes(m[2]!);
    const close = minutes(m[3]!);
    if (open === null || close === null) continue;
    const days = new Set<number>();
    for (const part of m[1]!.split(/,|&|\band\b/i)) {
      const range = part.split(/\s*(?:-|–|—|to)\s*/i).map((p) => dayIndex(p));
      if (range.length === 2 && range[0] !== null && range[1] !== null && range[0] !== undefined && range[1] !== undefined) {
        for (let d = range[0]; ; d = (d + 1) % 7) {
          days.add(d);
          if (d === range[1]) break;
        }
      } else if (range.length === 1 && range[0] !== null && range[0] !== undefined) {
        days.add(range[0]);
      }
    }
    for (const day of days) spans.push({ day, open, close });
  }
  return spans;
}

/** Day of week and minutes past midnight in a time zone. */
export function localTime(now: number, timezone?: string): { day: number; minutes: number; label: string } {
  let tz = timezone;
  try {
    if (tz) new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    tz = undefined;
  }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'UTC', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = DAYS.indexOf(get('weekday').toLowerCase());
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  return { day, minutes: mins, label: `${get('weekday')} ${get('hour')}:${get('minute')}${tz ? ` (${tz})` : ' UTC'}` };
}

/** Open now? Null when the hours could not be read. */
export function openNow(lines: readonly string[], now: number, timezone?: string): boolean | null {
  const spans = parseHours(lines);
  if (!spans.length) return null;
  const t = localTime(now, timezone);
  return spans.some((s) => s.day === t.day && t.minutes >= s.open && t.minutes < s.close);
}
