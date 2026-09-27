import { useEffect, useMemo, useRef, useState } from 'react';
import { cn, fmtNumber } from '../lib/utils';

/**
 * Conversations and leads per day. Change over time → a line chart; both
 * series count the same thing (conversations), so one y-axis is honest.
 *
 * Spec (dataviz): 2px round-joined lines; hairline solid gridlines one step
 * off the surface; a legend plus direct labels at each line's end, with
 * text in text colours and identity carried by a short line key; a
 * crosshair + tooltip on hover with ≥8px markers; a table view of the same
 * data. Series colours are the validated categorical slots 1–2 for each
 * theme (see index.css).
 */

type Point = { date: string; conversations: number; leads: number };
const SERIES = [
  { key: 'conversations' as const, label: 'Conversations', color: 'var(--series-1)' },
  { key: 'leads' as const, label: 'Leads', color: 'var(--series-2)' },
];

const HEIGHT = 220;
const PAD = { top: 12, right: 124, bottom: 26, left: 36 };

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude * 4 >= value)! * magnitude;
  return step * 4;
}

const dayLabel = (date: string, withWeekday = false) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withWeekday ? { weekday: 'short' } : {}) });

export function ActivityChart({ data }: { data: Point[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  useEffect(() => {
    if (!wrap.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry!.contentRect.width)));
    observer.observe(wrap.current);
    return () => observer.disconnect();
  }, []);

  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => Math.max(d.conversations, d.leads)))), [data]);
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 64)));

  const path = (key: 'conversations' | 'leads') => data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');

  // End labels: nudged apart only if they would collide, never detached.
  const last = data.at(-1);
  const ends = SERIES.map((s) => ({ ...s, value: last?.[s.key] ?? 0, y: y(last?.[s.key] ?? 0) }));
  if (ends.length === 2 && Math.abs(ends[0]!.y - ends[1]!.y) < 14) {
    const mid = (ends[0]!.y + ends[1]!.y) / 2;
    const upper = ends[0]!.value >= ends[1]!.value ? 0 : 1;
    ends[upper]!.y = mid - 7;
    ends[1 - upper]!.y = mid + 7;
  }

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * innerW;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round((px / innerW) * (data.length - 1)))));
  };

  const hovered = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-label="Legend">
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
          ))}
        </div>
        <button
          onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {view === 'chart' ? 'View as table' : 'View as chart'}
        </button>
      </div>

      {view === 'table' ? (
        <div className="scroll-thin max-h-[260px] overflow-auto px-4 pb-3">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 font-medium">Day</th>
                <th className="py-1.5 text-right font-medium">Conversations</th>
                <th className="py-1.5 text-right font-medium">Leads</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="py-1.5">{dayLabel(d.date, true)}</td>
                  <td className="py-1.5 text-right">{fmtNumber(d.conversations)}</td>
                  <td className="py-1.5 text-right">{fmtNumber(d.leads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="relative px-1">
          <svg width={width} height={HEIGHT} role="img" aria-label="Conversations and leads per day" className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                  {fmtNumber(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              i % labelEvery === 0 || i === data.length - 1 ? (
                <text key={d.date} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {dayLabel(d.date)}
                </text>
              ) : null,
            )}

            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--ring)" strokeWidth={1} />}

            {SERIES.map((s) => (
              <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}

            {hovered &&
              SERIES.map((s) => (
                <circle key={s.key} cx={x(hover!)} cy={y(hovered[s.key])} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              ))}

            {ends.map((e) => (
              <g key={e.key}>
                <line x1={x(data.length - 1) + 6} x2={x(data.length - 1) + 14} y1={e.y} y2={e.y} stroke={e.color} strokeWidth={2} strokeLinecap="round" />
                <text x={x(data.length - 1) + 18} y={e.y} dy="0.32em" className="fill-foreground text-[11px] font-medium tabular-nums">
                  {fmtNumber(e.value)} <tspan className="fill-muted-foreground font-normal">{e.label.toLowerCase()}</tspan>
                </text>
              </g>
            ))}

            <rect
              x={PAD.left}
              y={PAD.top}
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>

          {hovered && (
            <div
              className={cn(
                'pointer-events-none absolute top-2 z-10 min-w-36 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md',
              )}
              style={{ left: Math.min(Math.max(x(hover!) - 72, 4), width - 150) }}
            >
              <div className="mb-1 font-medium">{dayLabel(hovered.date, true)}</div>
              {SERIES.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-0.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
                    {s.label}
                  </span>
                  <span className="font-medium tabular-nums">{fmtNumber(hovered[s.key])}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
