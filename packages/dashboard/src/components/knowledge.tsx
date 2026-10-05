import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Plus, RefreshCw, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type CrawlRun, type DiscoveredUrl, type Discovery, type KnowledgeStatus, type PageStatus } from '../lib/api';
import { cn, fmtNumber, fmtRelative, pathOf } from '../lib/utils';
import { Badge, Button, Input } from './ui';

/** Categories in the order a business owner thinks about them. */
const CATEGORY_ORDER = ['home', 'service', 'product', 'pricing', 'faq', 'contact', 'location', 'about', 'team', 'booking', 'testimonials', 'blog', 'other', 'legal'];
const CATEGORY_LABEL: Record<string, string> = {
  home: 'Home',
  service: 'Services',
  product: 'Products',
  pricing: 'Pricing',
  faq: 'Questions & help',
  contact: 'Contact',
  location: 'Locations & areas',
  about: 'About',
  team: 'Team',
  booking: 'Booking',
  testimonials: 'Reviews',
  blog: 'Blog & news',
  other: 'Other pages',
  legal: 'Legal',
};

export const categoryLabel = (category: string | null | undefined) => CATEGORY_LABEL[category ?? 'other'] ?? category ?? 'Other';

const STATUS_TONE: Record<PageStatus, { label: string; dot: string }> = {
  discovered: { label: 'Not crawled', dot: '#a1a1aa' },
  queued: { label: 'Queued', dot: '#a1a1aa' },
  fetched: { label: 'Reading', dot: '#3b82f6' },
  indexed: { label: 'Learned', dot: '#16a34a' },
  unchanged: { label: 'Up to date', dot: '#16a34a' },
  skipped: { label: 'Skipped', dot: '#f59e0b' },
  blocked: { label: 'Blocked', dot: '#dc2626' },
  error: { label: 'Failed', dot: '#dc2626' },
};
export function PageStatusBadge({ status }: { status: PageStatus }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.discovered;
  return <Badge dot={tone.dot}>{tone.label}</Badge>;
}

/**
 * The crawl checklist: every page found, grouped by what it is,
 * with the useful ones pre-ticked. Owners untick, add, or tick a whole group.
 */
export function PagePicker({
  onStart,
  busy,
  startLabel = 'Learn from these pages',
  initial,
}: {
  onStart: (urls: string[]) => void;
  busy: boolean;
  startLabel?: string;
  /** Already discovered: skip reading the site again. */
  initial?: Discovery;
}) {
  const [discovery, setDiscovery] = useState<Discovery | null>(initial ?? null);
  const [error, setError] = useState<Error | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.urls.filter((u) => u.selected).map((u) => u.url) ?? []));
  const [extra, setExtra] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = () => {
    setError(null);
    setDiscovery(null);
    api<Discovery>('/knowledge/discover', { method: 'POST', json: {} }).then(
      (found) => {
        setDiscovery(found);
        setSelected(new Set(found.urls.filter((u) => u.selected).map((u) => u.url)));
      },
      (thrown: Error) => setError(thrown),
    );
  };
  useEffect(() => {
    if (!initial) load();
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, DiscoveredUrl[]>();
    for (const u of discovery?.urls ?? []) map.set(u.category, [...(map.get(u.category) ?? []), u]);
    return [...map].sort(([a], [b]) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  }, [discovery]);

  const toggle = (url: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  const setGroup = (urls: DiscoveredUrl[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const u of urls) {
        if (on) next.add(u.url);
        else next.delete(u.url);
      }
      return next;
    });

  const addExtra = () => {
    const urls = extra.split(/[\s,]+/).filter((u) => /^https?:\/\//.test(u));
    if (!urls.length || !discovery) return;
    setDiscovery({ ...discovery, urls: [...discovery.urls, ...urls.filter((u) => !discovery.urls.some((d) => d.url === u)).map((url) => ({ url, source: 'link' as const, category: 'other', suggested: true, selected: true, status: 'discovered' as const, title: null, error: null }))] });
    setSelected((current) => new Set([...current, ...urls]));
    setExtra('');
  };

  if (error) {
    return (
      <div className="space-y-3 rounded-md border border-danger/30 bg-danger/5 p-4 text-[13px]">
        <p className="text-danger">{error.message}</p>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw /> Try again
        </Button>
      </div>
    );
  }
  if (!discovery) {
    return (
      <div className="flex items-center gap-2 py-10 text-[13px] text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Reading your home page, robots.txt and sitemaps…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {discovery.warnings.map((warning) => (
        <p key={warning} className="flex items-start gap-2 rounded-md border bg-subtle px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden /> {warning}
        </p>
      ))}
      <div className="divide-y rounded-md border">
        {groups.map(([category, urls]) => {
          const on = urls.filter((u) => selected.has(u.url)).length;
          const expanded = open.has(category);
          return (
            <section key={category}>
              <div className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  aria-label={`Select all ${categoryLabel(category)}`}
                  checked={on === urls.length}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && on < urls.length;
                  }}
                  onChange={(e) => setGroup(urls, e.target.checked)}
                />
                <button
                  type="button"
                  className="flex flex-1 items-center justify-between gap-2 text-left text-[13px]"
                  aria-expanded={expanded}
                  onClick={() => setOpen((s) => (s.has(category) ? new Set([...s].filter((c) => c !== category)) : new Set([...s, category])))}
                >
                  <span className="font-medium">{categoryLabel(category)}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {on} of {urls.length}
                    <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden />
                  </span>
                </button>
              </div>
              {expanded && (
                <ul className="max-h-72 overflow-auto border-t bg-subtle/50 py-1 scroll-thin">
                  {urls.map((u) => (
                    <li key={u.url}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-1.5 pl-10 text-[13px] hover:bg-muted/50">
                        <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={selected.has(u.url)} onChange={() => toggle(u.url)} />
                        <span className="min-w-0 flex-1 truncate" title={u.url}>
                          {pathOf(u.url)}
                        </span>
                        {u.status !== 'discovered' && <PageStatusBadge status={u.status} />}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Input
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addExtra())}
          placeholder="Add a page the list missed: https://…"
          aria-label="Add a page"
        />
        <Button variant="outline" onClick={addExtra} disabled={!extra.trim()}>
          <Plus /> Add
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-xs text-muted-foreground">
          {fmtNumber(selected.size)} page{selected.size === 1 ? '' : 's'} selected. Legal pages and archives start unticked.
        </p>
        <Button onClick={() => onStart([...selected])} disabled={busy || selected.size === 0}>
          {busy && <Loader2 className="animate-spin" />}
          {startLabel}
        </Button>
      </div>
    </div>
  );
}

/** Polls the knowledge status while a crawl runs, so progress is live (the crawl itself runs on Cloudflare). */
export function useKnowledgeStatus(enabled = true): { status: KnowledgeStatus | null; error: Error | null; reload: () => void } {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () =>
      api<KnowledgeStatus>('/knowledge/status').then(
        (next) => {
          if (!live) return;
          setStatus(next);
          setError(null);
          if (next.run && (next.run.status === 'queued' || next.run.status === 'running')) timer = setTimeout(poll, 3000);
        },
        (thrown: Error) => live && setError(thrown),
      );
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, tick]);
  return { status, error, reload: () => setTick((t) => t + 1) };
}

export function CrawlProgress({ run, chunks }: { run: CrawlRun | null; chunks: number }) {
  if (!run) return <p className="text-[13px] text-muted-foreground">Nothing has been crawled yet.</p>;
  const finished = run.done + run.failed;
  const pct = run.total ? Math.round((finished / run.total) * 100) : 0;
  const active = run.status === 'queued' || run.status === 'running';
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="flex items-center gap-2 font-medium">
          {active ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : run.status === 'done' ? (
            <CheckCircle2 className="size-4 text-[#16a34a]" aria-hidden />
          ) : (
            <XCircle className="size-4 text-danger" aria-hidden />
          )}
          {active ? `Learning from your site — ${finished} of ${run.total} pages` : run.status === 'done' ? 'Finished learning your site' : `Crawl ${run.status}`}
        </span>
        <span className="text-xs text-muted-foreground">{fmtNumber(chunks)} passages</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Crawl progress"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${active ? Math.max(pct, 3) : 100}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {active
          ? 'This runs on Cloudflare in the background — you can keep going, or close this page.'
          : `${run.done} learned${run.failed ? `, ${run.failed} skipped or failed` : ''} · ${run.finishedAt ? fmtRelative(run.finishedAt) : ''}`}
      </p>
    </div>
  );
}
