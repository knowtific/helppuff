import { ArrowDownRight, ArrowUpRight, MessagesSquare } from 'lucide-react';
import { CrawlProgress, useKnowledgeStatus } from '../components/knowledge';
import { UsageMeter } from './Knowledge';
import { useState } from 'react';
import { ActivityChart } from '../components/ActivityChart';
import { PageHeader } from '../components/Shell';
import { Avatar, Card, CardHeader, Empty, ErrorNote, Segmented, Skeleton, StatusBadge } from '../components/ui';
import { api, type LeadStatus, type Me, type Overview as OverviewData, type Totals } from '../lib/api';
import { cn, flag, fmtDecimal, fmtNumber, fmtPercent, fmtRelative, href, pathOf, useData } from '../lib/utils';

type Range = '7' | '30' | '90';

/** A stat tile: the number is the chart. Delta against the previous period of the same length. */
function Stat({ label, value, previous, format }: { label: string; value: number; previous: number; format: (v: number) => string }) {
  const change = previous === 0 ? (value === 0 ? 0 : null) : (value - previous) / previous;
  const up = (change ?? 0) >= 0;
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{format(value)}</p>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {change === null ? (
          'new this period'
        ) : change === 0 ? (
          'no change'
        ) : (
          <>
            <span className={cn('inline-flex items-center font-medium text-foreground')}>
              {up ? <ArrowUpRight className="size-3.5" aria-label="up" /> : <ArrowDownRight className="size-3.5" aria-label="down" />}
              {fmtPercent(Math.abs(change))}
            </span>
            vs previous period
          </>
        )}
      </p>
    </Card>
  );
}

function Bars({ rows, label }: { rows: { key: string; label: string; count: number; href?: string }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="px-4 pb-4 text-[13px] text-muted-foreground">No data yet.</p>;
  return (
    <ul className="space-y-1 px-2 pb-3" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className="relative flex h-7 items-center justify-between rounded-md px-2 text-[13px]">
          <span
            className="absolute inset-y-0 left-0 rounded-md bg-muted"
            style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}
            aria-hidden
          />
          <span className="relative truncate pr-3">{row.label}</span>
          <span className="relative tabular-nums text-muted-foreground">{fmtNumber(row.count)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Knowledge and today's budget, for workers-ai. */
function KnowledgeStrip({ me }: { me: Me }) {
  const { status } = useKnowledgeStatus(Boolean(me.sites[0]?.knowledge));
  if (!me.sites[0]?.knowledge || !status) return null;
  if (!status.run) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card className="px-4 py-3">
        <CrawlProgress run={status.run} chunks={status.chunks} />
        <a href={href({ page: 'knowledge' })} className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground">
          Manage knowledge
        </a>
      </Card>
      <Card className="px-4 py-3">
        <UsageMeter usage={status.usage} />
      </Card>
    </div>
  );
}

export function Overview({ me }: { me: Me }) {
  const [range, setRange] = useState<Range>('30');
  const { data, error, loading, reload } = useData(
    () => api<OverviewData>(`/overview?days=${range}&tz=${-new Date().getTimezoneOffset()}`),
    [range],
  );

  const stats: { key: keyof Totals; label: string; format: (v: number) => string }[] = [
    { key: 'conversations', label: 'Conversations', format: fmtNumber },
    { key: 'leads', label: 'Leads', format: fmtNumber },
    { key: 'conversion', label: 'Became a lead', format: fmtPercent },
    { key: 'avgMessages', label: 'Messages per conversation', format: fmtDecimal },
  ];

  return (
    <>
      <PageHeader
        title="Analytics"
        description="How visitors are using your assistant."
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
        <KnowledgeStrip me={me} />
        {error && <ErrorNote error={error} onRetry={reload} />}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) =>
            data ? (
              <Stat key={s.key} label={s.label} value={data.totals[s.key]} previous={data.previous[s.key]} format={s.format} />
            ) : (
              <Skeleton key={s.key} className="h-[92px]" />
            ),
          )}
        </div>

        <Card>
          <CardHeader title="Activity" description={`Conversations and leads per day, last ${range} days`} />
          {data ? <ActivityChart data={data.series} /> : <Skeleton className="mx-4 mb-4 h-[230px]" />}
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Latest questions" description="What visitors opened with" action={<a href={href({ page: 'conversations' })} className="text-xs text-muted-foreground hover:text-foreground">View all</a>} />
            {data && data.recentQuestions.length === 0 && (
              <Empty icon={<MessagesSquare />} title="No conversations yet">
                Once visitors start chatting, their questions appear here.
              </Empty>
            )}
            <ul className="divide-y">
              {(data?.recentQuestions ?? []).map((q) => (
                <li key={q.id}>
                  <a href={href({ page: 'conversations', id: q.id })} className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-subtle">
                    <span className="truncate text-[13px]">{q.text}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtRelative(q.at)}</span>
                  </a>
                </li>
              ))}
              {loading && !data && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mx-4 my-3 h-4" />)}
            </ul>
          </Card>

          <Card>
            <CardHeader title="New leads" action={<a href={href({ page: 'leads' })} className="text-xs text-muted-foreground hover:text-foreground">View all</a>} />
            <ul className="divide-y">
              {(data?.recentLeads ?? []).map((lead) => (
                <li key={lead.id}>
                  <a
                    href={lead.conversationId ? href({ page: 'conversations', id: lead.conversationId }) : href({ page: 'leads' })}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle"
                  >
                    <Avatar name={lead.name ?? lead.email} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{lead.name ?? lead.email ?? lead.phone ?? 'Unknown'}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {(lead.name ? (lead.email ?? lead.phone) : lead.email && lead.phone ? lead.phone : null) ?? fmtRelative(lead.at)}
                      </span>
                    </span>
                    <StatusBadge status={lead.status as LeadStatus} />
                  </a>
                </li>
              ))}
              {data && data.recentLeads.length === 0 && <li className="px-4 pb-4 text-[13px] text-muted-foreground">No leads yet.</li>}
            </ul>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Where chats start" description="Pages visitors were on" />
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
