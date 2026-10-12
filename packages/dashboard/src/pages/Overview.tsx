import { AlertTriangle, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ActivityChart } from '../components/ActivityChart';
import { QuestionsToAnswer } from '../components/Gaps';
import { PageHeader } from '../components/Shell';
import { Card, CardHeader, ErrorNote, Segmented, Skeleton } from '../components/ui';
import { api, type Headline, type HealthIssue, type Insights, type Me, type Overview as OverviewData } from '../lib/api';
import { cn, flag, fmtDecimal, fmtNumber, fmtPercent, href, pathOf, useData } from '../lib/utils';

/**
 * Analytics: is the assistant helping? What it handles on its own, where it
 * needs the team, what visitors ask that it cannot answer, what it brings in
 * (contacts, jobs, bookings), and what is broken. Summary first (what needs
 * attention, the headline numbers), detail below.
 */

type Range = '7' | '30' | '90';

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${fmtDecimal(seconds / 3600)} h`;
}

/**
 * A headline number against the period before. `better` says which way is
 * good, so a rise in "couldn't answer" reads as worse in words, not colour alone.
 */
function Stat({ label, value, previous, format, hint, better = 'up' }: { label: string; value: number; previous: number | null; format: (v: number) => string; hint?: string; better?: 'up' | 'down' }) {
  const change = previous === null ? undefined : previous === 0 ? (value === 0 ? 0 : null) : (value - previous) / previous;
  const up = (change ?? 0) >= 0;
  const worse = change ? (better === 'up' ? !up : up) : false;
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{format(value)}</p>
      {hint && <p className="text-xs text-muted-foreground tabular-nums">{hint}</p>}
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {change === undefined ? null : change === null ? (
          'new this period'
        ) : change === 0 ? (
          'no change'
        ) : (
          <>
            <span className={cn('inline-flex items-center font-medium', worse ? 'text-danger' : 'text-foreground')}>
              {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
              {fmtPercent(Math.abs(change))}
            </span>
            {worse ? 'worse' : 'better'}
          </>
        )}
      </p>
    </Card>
  );
}

/** Horizontal bars, one hue: amounts side by side, each with its label and count. */
function Bars({ rows, label, total, empty = 'Nothing yet.' }: { rows: { key: string; label: ReactNode; count: number; href?: string }[]; label: string; total?: number; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.some((r) => r.count > 0)) return <p className="px-4 pb-4 text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1 px-2 pb-3" aria-label={label}>
      {rows.map((row) => {
        const inner = (
          <>
            <span className="absolute inset-y-0 left-0 rounded-md bg-muted" style={{ width: `${Math.max(row.count ? 3 : 0, (row.count / max) * 100)}%` }} aria-hidden />
            <span className="relative min-w-0 truncate pr-3">{row.label}</span>
            <span className="relative shrink-0 tabular-nums text-muted-foreground">
              {fmtNumber(row.count)}
              {total ? <span className="ml-1.5 text-xs">{fmtPercent(share(row.count, total))}</span> : null}
            </span>
          </>
        );
        return (
          <li key={row.key}>
            {row.href ? (
              <a href={row.href} className="relative flex h-7 items-center justify-between rounded-md px-2 text-[13px] hover:bg-subtle">
                {inner}
              </a>
            ) : (
              <span className="relative flex h-7 items-center justify-between rounded-md px-2 text-[13px]">{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A small labelled number inside a card. */
function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Figures({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 border-t px-4 py-3 sm:grid-cols-4">{children}</div>;
}

/** Chats by hour of the day, in your time zone: when someone should be around for live chat. */
function Hours({ hours }: { hours: number[] }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...hours);
  if (!hours.some(Boolean)) return <p className="px-4 pb-4 text-[13px] text-muted-foreground">Nothing yet.</p>;
  const busiest = hours.indexOf(Math.max(...hours));
  return (
    <div className="px-4 pb-3">
      {table ? (
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left font-normal">Hour</th>
              <th className="py-1 text-right font-normal">Chats</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((count, h) => (
              <tr key={h} className="border-t">
                <td className="py-0.5">{`${String(h).padStart(2, '0')}:00`}</td>
                <td className="py-0.5 text-right">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="flex h-28 items-end gap-[2px]" role="img" aria-label={`Chats by hour of the day; busiest at ${busiest}:00`}>
            {hours.map((count, h) => (
              <div key={h} className="group relative flex h-full flex-1 items-end" title={`${String(h).padStart(2, '0')}:00 – ${count} ${count === 1 ? 'chat' : 'chats'}`}>
                <div className="w-full rounded-t-[4px] bg-[var(--series-1)] opacity-80 group-hover:opacity-100" style={{ height: count ? `${Math.max(4, (count / max) * 100)}%` : 0 }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums" aria-hidden>
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:00</span>
          </div>
        </>
      )}
      <button type="button" onClick={() => setTable(!table)} className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        {table ? 'Show the chart' : 'Show as a table'}
      </button>
    </div>
  );
}

const HEALTH_LINK: Record<HealthIssue['kind'], string> = { webhook: 'Open webhooks', email: 'Open notifications', tool: 'Open the tools', budget: 'Open Advanced', knowledge: 'Open knowledge' };

/** What is broken, before anything else on the page. Nothing broken, nothing shown. */
function NeedsAttention({ issues }: { issues: HealthIssue[] }) {
  if (!issues.length) return null;
  return (
    <Card className="border-[#d97706]/40">
      <CardHeader title={<span className="flex items-center gap-1.5"><AlertTriangle className="size-4 text-[#d97706]" aria-hidden /> Needs attention</span>} description="Something is not working as it should. Each one says where to fix it." />
      <ul className="divide-y border-t">
        {issues.map((issue, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{issue.title}</span>
              {issue.detail && <span className="block truncate text-xs text-muted-foreground">{issue.detail}</span>}
            </span>
            <a href={issue.page} className="shrink-0 text-xs font-medium text-foreground underline-offset-2 hover:underline">
              {HEALTH_LINK[issue.kind]}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const OUTCOMES: { key: keyof Insights['outcomes']; label: string }[] = [
  { key: 'answered', label: 'Answered' },
  { key: 'booked', label: 'Booked a time or a job' },
  { key: 'lead_captured', label: 'Left their details' },
  { key: 'callback_requested', label: 'Asked for a callback' },
  { key: 'unanswered', label: 'Could not answer' },
  { key: 'abandoned', label: 'Left without an answer' },
  { key: 'pending', label: 'Not summarised yet' },
];

function money(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 0 }).format(value);
  } catch {
    return fmtNumber(value);
  }
}

export function Overview({ me }: { me: Me }) {
  const [range, setRange] = useState<Range>('30');
  const { data, error, reload } = useData(() => api<OverviewData>(`/overview?days=${range}&tz=${-new Date().getTimezoneOffset()}`), [range]);
  const site = me.sites[0];
  const head = data?.headline;
  const ins = data?.insights;
  const rate = (h: Headline | undefined) => (h ? share(h.resolved, h.summarized) : 0);
  const helpful = (h: Headline | undefined) => (h ? share(h.ratedUp, h.ratedUp + h.ratedDown) : 0);
  const escalation = (h: Headline | undefined, conversations: number) => (h ? share(h.needsPerson ?? h.escalated, conversations) : 0);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Is the assistant helping? What it handles on its own, where it needs your team, what it brings in, and what is broken."
        help="Dashboard#analytics"
        actions={
          <Segmented
            label="Date range"
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
            ]}
          />
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        {error && <ErrorNote error={error} onRetry={reload} />}
        {data?.health && <NeedsAttention issues={data.health} />}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {data ? (
            <>
              <Stat label="Conversations" value={data.totals.conversations} previous={data.previous.conversations} format={fmtNumber} />
              <Stat
                label="Solved by the assistant"
                value={rate(head?.current)}
                previous={head ? rate(head.previous) : null}
                format={fmtPercent}
                hint={head ? `${fmtNumber(head.current.resolved)} of ${fmtNumber(head.current.summarized)} summarised, no person needed` : undefined}
              />
              <Stat label="Became a contact" value={data.totals.conversion} previous={data.previous.conversion} format={fmtPercent} hint={`${fmtNumber(data.totals.leads)} contacts`} />
              <Stat
                label="Needed a person"
                value={escalation(head?.current, data.totals.conversations)}
                previous={head ? escalation(head.previous, data.previous.conversations) : null}
                format={fmtPercent}
                hint={head ? `${fmtNumber(head.current.escalated)} live chats, ${fmtNumber(head.current.callbacks)} callbacks` : undefined}
                better="down"
              />
              <Stat label="Could not answer" value={head?.current.unanswered ?? 0} previous={head ? head.previous.unanswered : null} format={fmtNumber} hint="conversations with a question it could not answer" better="down" />
              <Stat
                label="Rated helpful"
                value={helpful(head?.current)}
                previous={head && head.previous.ratedUp + head.previous.ratedDown ? helpful(head.previous) : null}
                format={fmtPercent}
                hint={head ? `${fmtNumber(head.current.ratedUp)} 👍 · ${fmtNumber(head.current.ratedDown)} 👎` : undefined}
              />
            </>
          ) : (
            [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[108px]" />)
          )}
        </div>

        <Card>
          <CardHeader title="Activity" description={`Conversations and leads per day, last ${range} days`} />
          {data ? <ActivityChart data={data.series} /> : <Skeleton className="mx-4 mb-4 h-[230px]" />}
        </Card>

        {ins && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="How conversations ended" tip={{ label: 'About how conversations ended', text: 'From the AI summary of each conversation, five minutes after it goes quiet.' }} />
                <Bars label="How conversations ended" total={data!.totals.conversations} rows={OUTCOMES.map((o) => ({ key: o.key, label: o.label, count: ins.outcomes[o.key] }))} />
              </Card>
              <Card>
                <CardHeader title="Engagement" description="How visitors use the chat" />
                <Figures>
                  <Figure label="Messages per conversation" value={fmtDecimal(ins.engagement.avgMessages)} hint="visitor and assistant" />
                  <Figure label="Typical length" value={duration(ins.engagement.medianSeconds)} hint="first to last message" />
                  <Figure label="Left after one message" value={fmtPercent(share(ins.engagement.oneMessage, data!.totals.conversations))} hint={`${fmtNumber(ins.engagement.oneMessage)} conversations`} />
                  <Figure label="Came back" value={fmtNumber(ins.engagement.returningVisitors)} hint="visitors who chatted before" />
                </Figures>
                <div className="grid gap-x-4 border-t sm:grid-cols-2">
                  <div>
                    <p className="px-4 pt-3 pb-1 text-xs font-medium">Mood</p>
                    <Bars label="Mood" rows={[{ key: 'positive', label: 'Positive', count: ins.sentiment.positive }, { key: 'neutral', label: 'Neutral', count: ins.sentiment.neutral }, { key: 'negative', label: 'Negative', count: ins.sentiment.negative }]} />
                  </div>
                  <div>
                    <p className="px-4 pt-3 pb-1 text-xs font-medium">Lead quality</p>
                    <Bars label="Lead quality" rows={[{ key: 'hot', label: 'Hot', count: ins.leadQuality.hot }, { key: 'warm', label: 'Warm', count: ins.leadQuality.warm }, { key: 'cold', label: 'Cold', count: ins.leadQuality.cold }]} />
                  </div>
                </div>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {site?.knowledge ? (
                <QuestionsToAnswer limit={8} />
              ) : (
                <Card>
                  <CardHeader title="Questions it could not answer" tip={{ label: 'About questions it could not answer', text: 'From the AI summaries, most asked first: what to add to your knowledge source.' }} />
                  <Bars
                    label="Questions it could not answer"
                    empty="None in this period."
                    rows={ins.unansweredQuestions.map((q, i) => ({ key: `${i}`, label: q.text, count: q.count, href: href({ page: 'conversations', id: q.conversationId }) }))}
                  />
                </Card>
              )}
              <Card>
                <CardHeader title="What visitors ask about" tip={{ label: 'About topics', text: 'Topics from the AI summaries.' }} />
                <Bars label="Topics" rows={ins.topics.map((t, i) => ({ key: `${i}`, label: t.topic, count: t.count }))} />
              </Card>
            </div>

            {(site?.live || ins.live.requested > 0 || ins.callbacks.requested > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Live chat" description="Visitors who asked for a person" action={<a href={href({ page: 'conversations' })} className="text-xs text-muted-foreground hover:text-foreground">Conversations</a>} />
                  <Figures>
                    <Figure label="Asked for a person" value={fmtNumber(ins.live.requested)} />
                    <Figure label="Answered" value={fmtNumber(ins.live.answered)} hint={ins.live.requested ? fmtPercent(share(ins.live.answered, ins.live.requested)) : undefined} />
                    <Figure label="Nobody took it" value={fmtNumber(ins.live.missed)} hint="offered the callback form" />
                    <Figure label="Typical wait" value={duration(ins.live.medianWaitSeconds)} hint="to the team’s first reply" />
                  </Figures>
                  {ins.live.byPerson.length > 0 && (
                    <div className="border-t">
                      <p className="px-4 pt-3 pb-1 text-xs font-medium">Taken by</p>
                      <Bars label="Live chats by person" rows={ins.live.byPerson.map((p) => ({ key: p.name, label: p.name, count: p.count }))} />
                    </div>
                  )}
                </Card>
                <Card>
                  <CardHeader title="Callbacks" description="Visitors who asked to be called back" action={<a href={href({ page: 'callbacks' })} className="text-xs text-muted-foreground hover:text-foreground">Callbacks</a>} />
                  <Figures>
                    <Figure label="Requested" value={fmtNumber(ins.callbacks.requested)} />
                    <Figure label="Done" value={fmtNumber(ins.callbacks.done)} />
                    <Figure label="Still waiting" value={fmtNumber(ins.callbacks.open)} hint={data!.openCallbacks ? `${fmtNumber(data!.openCallbacks)} waiting now, any period` : undefined} />
                    <Figure label="Typical time to call back" value={ins.callbacks.medianHoursToDone === null ? '—' : `${fmtDecimal(ins.callbacks.medianHoursToDone)} h`} />
                  </Figures>
                </Card>
              </div>
            )}

            {(ins.jobs.created > 0 || ins.jobs.won > 0 || ins.appointments.booked > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Jobs" description="Requests and work it brought in" action={<a href={href({ page: 'jobs' })} className="text-xs text-muted-foreground hover:text-foreground">Jobs</a>} />
                  <Figures>
                    <Figure label="New jobs" value={fmtNumber(ins.jobs.created)} hint={`${fmtNumber(ins.jobs.fromChat)} from the chat`} />
                    <Figure label="Won" value={fmtNumber(ins.jobs.won)} />
                    <Figure label="Won value" value={money(ins.jobs.wonValue, ins.jobs.currency)} />
                    <Figure label="Lost" value={fmtNumber(ins.jobs.lost)} />
                  </Figures>
                </Card>
                <Card>
                  <CardHeader title="Bookings" description="Appointments made in this period" action={<a href={href({ page: 'calendar' })} className="text-xs text-muted-foreground hover:text-foreground">Calendar</a>} />
                  <Figures>
                    <Figure label="Booked" value={fmtNumber(ins.appointments.booked)} hint={`${fmtNumber(ins.appointments.fromChat)} by visitors in the chat`} />
                    <Figure label="Completed" value={fmtNumber(ins.appointments.completed)} />
                    <Figure label="No-shows" value={fmtNumber(ins.appointments.noShow)} />
                    <Figure label="Cancelled" value={fmtNumber(ins.appointments.cancelled)} />
                  </Figures>
                </Card>
              </div>
            )}
          </>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="When visitors chat" tip={{ label: 'About when visitors chat', text: 'Conversations by hour of the day, in your time zone: when someone should be around for live chat.' }} />
            {ins ? <Hours hours={ins.hours} /> : <Skeleton className="mx-4 mb-4 h-28" />}
          </Card>
          <Card>
            <CardHeader title="Where chats start" tip={{ label: 'About where chats start', text: 'Pages visitors were on' }} />
            {data && <Bars label="Top pages" rows={data.topPages.map((p) => ({ key: p.url, label: pathOf(p.url), count: p.count }))} />}
          </Card>
          <Card>
            <CardHeader title="Countries" />
            {data && <Bars label="Countries" rows={data.countries.map((c) => ({ key: c.country, label: `${flag(c.country)} ${c.country}`.trim(), count: c.count }))} />}
          </Card>
        </div>
      </div>
    </>
  );
}
