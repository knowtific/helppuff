import { BookOpen, ChevronDown, ChevronRight, FileText, Loader2, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CrawlProgress, PagePicker, PageStatusBadge, categoryLabel, useKnowledgeStatus } from '../components/knowledge';
import { PageHeader } from '../components/Shell';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Input, Segmented, Skeleton, Textarea } from '../components/ui';
import { api, uploadFile, type FileStatus, type KnowledgeFile, type KnowledgePage, type ManualEntry, type Me, type SearchResult, type Usage } from '../lib/api';
import { cn, fmtNumber, fmtRelative, pathOf, useData } from '../lib/utils';
import { Passages } from './Onboarding';

/**
 * The knowledge base (workers-ai): what the assistant has learned, from
 * where, and what it costs today. Same API as `helppuff knowledge …`.
 */

type Filter = 'all' | 'learned' | 'problems' | 'off';

const matches = (page: KnowledgePage, filter: Filter) =>
  filter === 'all' ||
  (filter === 'learned' && (page.status === 'indexed' || page.status === 'unchanged')) ||
  (filter === 'problems' && (page.status === 'error' || page.status === 'blocked' || page.status === 'skipped')) ||
  (filter === 'off' && !page.selected);

export function UsageMeter({ usage }: { usage: Usage }) {
  const pct = usage.budget > 0 ? Math.min(100, (usage.neurons / usage.budget) * 100) : 0;
  const tone = usage.state === 'exhausted' ? 'bg-danger' : usage.state === 'tight' ? 'bg-[#f59e0b]' : 'bg-primary';
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium">
          {fmtNumber(usage.messages)} answer{usage.messages === 1 ? '' : 's'} today
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {fmtNumber(usage.neurons)} / {fmtNumber(usage.budget)} neurons
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={usage.budget} aria-valuenow={usage.neurons} aria-label="Today's free budget used">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {usage.state === 'exhausted'
          ? 'Today’s budget is used: visitors get your contact details and a form until it resets at 00:00 UTC.'
          : usage.state === 'tight'
            ? `Nearly used — answers are kept shorter. About ${fmtNumber(usage.messagesLeft)} left today.`
            : `About ${fmtNumber(usage.messagesLeft)} more answers fit in today’s free allowance (resets 00:00 UTC).`}
      </p>
    </div>
  );
}

export function Knowledge({ me }: { me: Me }) {
  const site = me.sites[0]!;
  const crawl = useKnowledgeStatus(site.knowledge);
  const pages = useData(() => api<{ pages: KnowledgePage[] }>('/knowledge/pages'), [crawl.status?.run?.status, crawl.status?.chunks]);
  const [filter, setFilter] = useState<Filter>('all');
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  if (!site.knowledge) {
    return (
      <>
        <PageHeader title="Knowledge" />
        <Empty icon={<BookOpen />} title="Managed by your backend">
          This assistant uses the {site.connector} backend, which keeps its own knowledge. Update it with <code>helppuff knowledge sync</code>.
        </Empty>
      </>
    );
  }

  const recrawl = async (urls?: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await api('/knowledge/crawl', { method: 'POST', json: urls ? { urls } : {} });
      setChoosing(false);
      crawl.reload();
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };
  const running = crawl.status?.run?.status === 'running' || crawl.status?.run?.status === 'queued';
  const list = (pages.data?.pages ?? []).filter((p) => p.source !== 'facts' && p.source !== 'manual' && p.source !== 'file');

  return (
    <>
      <PageHeader
        title="Knowledge"
        description="What your assistant has learned, and where from."
        actions={
          <>
            <Button variant="outline" onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>
              Choose pages
            </Button>
            <Button onClick={() => void recrawl()} disabled={busy || running}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Re-learn site
            </Button>
          </>
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        {error && <ErrorNote error={error} />}
        {crawl.error && <ErrorNote error={crawl.error} onRetry={crawl.reload} />}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="px-4 py-3">{crawl.status ? <CrawlProgress run={crawl.status.run} chunks={crawl.status.chunks} /> : <Skeleton className="h-14" />}</Card>
          <Card className="px-4 py-3">{crawl.status ? <UsageMeter usage={crawl.status.usage} /> : <Skeleton className="h-14" />}</Card>
        </div>

        {choosing && (
          <Card>
            <CardHeader title="Choose pages" description="Unticked pages are removed from the knowledge base on the next crawl." />
            <div className="px-4 pb-4">
              <PagePicker busy={busy} startLabel="Crawl these pages" onStart={(urls) => void recrawl(urls)} />
            </div>
          </Card>
        )}

        <Collapsible
          id="pages"
          title="Website pages"
          summary={pages.data ? `${list.filter((p) => matches(p, 'learned')).length} learned${list.some((p) => matches(p, 'problems')) ? ` · ${list.filter((p) => matches(p, 'problems')).length} with problems` : ''}` : undefined}
          description={crawl.status ? `Re-learned ${crawl.status.schedule === 'off' ? 'only when you ask' : crawl.status.schedule}. Unchanged pages cost nothing.` : undefined}
          action={
              <Segmented
                label="Filter pages"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'learned', label: 'Learned' },
                  { value: 'problems', label: 'Problems' },
                  { value: 'off', label: 'Not used' },
                ]}
              />
          }
        >
          {pages.loading && !pages.data && <Skeleton className="mx-4 mb-4 h-32" />}
          {pages.data && list.length === 0 && (
            <Empty icon={<BookOpen />} title="No pages yet">
              Choose the pages to learn from to get started.
            </Empty>
          )}
          <ul className="divide-y border-t">
            {list.filter((p) => matches(p, filter)).map((page) => (
              <PageRow key={page.id} page={page} />
            ))}
          </ul>
        </Collapsible>

        <Files />

        <div className="grid gap-4 lg:grid-cols-2">
          <ManualKnowledge />
          <TestSearch />
        </div>
      </div>
    </>
  );
}

/** Which sections are open, remembered in this browser only. */
function useOpen(id: string, initial: boolean): [boolean, (open: boolean) => void] {
  const key = `hp-knowledge-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? initial : saved === '1';
    } catch {
      return initial;
    }
  });
  return [
    open,
    (next) => {
      setOpen(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // Private mode: the choice lasts for this page only.
      }
    },
  ];
}

/** A card whose body folds away: the header stays, with a one-line summary. */
function Collapsible({
  id,
  title,
  summary,
  description,
  action,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  summary?: string | undefined;
  description?: string | undefined;
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useOpen(id, defaultOpen);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open} aria-controls={`section-${id}`} onClick={() => setOpen(!open)}>
          <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} aria-hidden />
          <span className="min-w-0">
            <span className="flex items-baseline gap-2">
              <h3 className="text-[13px] font-medium">{title}</h3>
              {summary && <span className="truncate text-xs text-muted-foreground">{summary}</span>}
            </span>
            {open && description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
          </span>
        </button>
        {open && action}
      </div>
      {open && <div id={`section-${id}`}>{children}</div>}
    </Card>
  );
}

const FILE_STATUS: Record<FileStatus, { label: string; dot: string }> = {
  queued: { label: 'Queued', dot: '#a1a1aa' },
  reading: { label: 'Reading', dot: '#3b82f6' },
  learning: { label: 'Learning', dot: '#3b82f6' },
  indexed: { label: 'Learned', dot: '#16a34a' },
  error: { label: 'Failed', dot: '#dc2626' },
};
const ACCEPT = '.pdf,.docx,.md,.markdown,.txt';
const passages = (n: number) => `${n} passage${n === 1 ? '' : 's'}`;
const fmtSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Documents to learn from: price lists, brochures, policies. Uploading only
 * queues them; reading, cleaning and learning happen on Cloudflare in the
 * background, so this page can be closed. The list polls while any are busy.
 */
function Files() {
  const files = useData(() => api<{ files: KnowledgeFile[] }>('/knowledge/files'), []);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = files.data?.files ?? [];
  const busy = list.some((f) => f.status === 'queued' || f.status === 'reading' || f.status === 'learning');

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(files.reload, 3000);
    return () => clearInterval(timer);
  }, [busy]);

  const upload = async (picked: FileList | File[]) => {
    setError(null);
    for (const file of [...picked]) {
      setUploading((u) => [...u, file.name]);
      try {
        await uploadFile(file);
      } catch (thrown) {
        setError(new Error(`${file.name}: ${(thrown as Error).message}`));
      } finally {
        setUploading((u) => u.filter((name) => name !== file.name));
      }
      files.reload();
    }
  };
  const remove = async (file: KnowledgeFile) => {
    await api(`/knowledge/files/${file.id}`, { method: 'DELETE' }).catch((thrown: Error) => setError(thrown));
    files.reload();
  };
  const learned = list.filter((f) => f.status === 'indexed').length;

  return (
    <Collapsible
      id="files"
      title="Files"
      defaultOpen
      summary={list.length ? `${learned} learned${busy ? ' · working…' : ''}` : undefined}
      description="Price lists, brochures, policies: PDF, Word, Markdown or text, up to 10 MB. Read in the background — you can leave this page."
    >
      <div className="space-y-3 px-4 pb-4">
        <div
          className={cn('flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors', dragging && 'border-primary bg-subtle')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
          }}
        >
          <Upload className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-[13px]">Drop files here, or</p>
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading.length > 0}>
            {uploading.length ? <Loader2 className="animate-spin" /> : <Plus />}
            {uploading.length ? `Uploading ${uploading[0]}…` : 'Choose files'}
          </Button>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            aria-label="Upload files"
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = '';
            }}
          />
          <p className="text-[11px] text-muted-foreground">PDF, .docx, .md, .txt · scanned PDFs (images of text) can’t be read</p>
        </div>
        {error && <ErrorNote error={error} />}
        {files.error && <ErrorNote error={files.error} onRetry={files.reload} />}
      </div>
      {list.length > 0 && (
        <ul className="divide-y border-t">
          {list.map((file) => {
            const tone = FILE_STATUS[file.status] ?? FILE_STATUS.queued;
            return (
              <li key={file.id} className="flex items-center gap-3 px-4 py-2.5">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{file.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {fmtSize(file.size)}
                    {file.status === 'indexed' ? ` · ${passages(file.chunks)}` : ''}
                    {file.truncated ? ' · long: only the first part was learned' : ''}
                    {file.error ? ` · ${file.error}` : ''}
                  </span>
                </span>
                <span className="hidden text-xs text-muted-foreground sm:block">{fmtRelative(file.updatedAt)}</span>
                <Badge dot={tone.dot}>
                  {(file.status === 'reading' || file.status === 'learning' || file.status === 'queued') && <Loader2 className="size-3 animate-spin" aria-hidden />}
                  {tone.label}
                </Badge>
                <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${file.name}`} onClick={() => void remove(file)}>
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Collapsible>
  );
}

function PageRow({ page }: { page: KnowledgePage }) {
  const [open, setOpen] = useState(false);
  const chunks = useData(() => (open ? api<{ chunks: { id: string; headingPath: string; content: string; tokens: number }[] }>(`/knowledge/pages/${page.id}/chunks`) : Promise.resolve(null)), [open]);
  return (
    <li>
      <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!page.chunks}>
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90', !page.chunks && 'invisible')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{page.title || pathOf(page.url)}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {pathOf(page.url)} · {categoryLabel(page.category)}
            {page.error ? ` · ${page.error}` : ''}
          </span>
        </span>
        <span className="hidden text-xs text-muted-foreground tabular-nums sm:block">{page.chunks ? passages(page.chunks) : ''}</span>
        <span className="hidden text-xs text-muted-foreground sm:block">{page.crawledAt ? fmtRelative(page.crawledAt) : ''}</span>
        <PageStatusBadge status={page.selected ? page.status : 'discovered'} />
      </button>
      {open && (
        <ol className="space-y-2 bg-subtle/60 px-4 py-3 pl-10">
          {!chunks.data && <Skeleton className="h-12" />}
          {chunks.data?.chunks.map((c) => (
            <li key={c.id} className="rounded-md border bg-card px-3 py-2">
              <p className="text-xs text-muted-foreground">{c.headingPath}</p>
              <p className="mt-1 line-clamp-5 text-[13px] whitespace-pre-line">{c.content}</p>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function ManualKnowledge() {
  const entries = useData(() => api<{ entries: ManualEntry[] }>('/knowledge/manual'), []);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/knowledge/manual', { method: 'POST', json: { title, content } });
      setTitle('');
      setContent('');
      entries.reload();
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    await api(`/knowledge/manual/${id}`, { method: 'DELETE' }).catch((thrown: Error) => setError(thrown));
    entries.reload();
  };
  return (
    <Card>
      <CardHeader title="Your own answers" description="Things that aren’t on the site, or that it should say exactly — live as soon as you add them." />
      <ul className="divide-y border-t">
        {entries.data?.entries.map((entry) => (
          <li key={entry.id} className="flex items-start gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{entry.title}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{entry.content}</span>
            </span>
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${entry.title}`} onClick={() => void remove(entry.id)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2 border-t px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Warranty" aria-label="Title" required />
        <Textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="All installs carry a 5 year warranty on parts and labour." aria-label="Answer" required />
        {error && <p className="text-xs text-danger" role="alert">{error.message}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="outline" disabled={busy || !title.trim() || !content.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            Add answer
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TestSearch() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  return (
    <Card>
      <CardHeader title="Test a question" description="The passages the assistant would answer from, best first." />
      <div className="space-y-3 px-4 pb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            api<SearchResult>('/knowledge/search', { method: 'POST', json: { query } })
              .then(setResult, (thrown: Error) => setError(thrown))
              .finally(() => setBusy(false));
          }}
        >
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="How much is a service call?" aria-label="Question" />
          <Button type="submit" variant="outline" disabled={busy || !query.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Search />}
            Search
          </Button>
        </form>
        {error && <ErrorNote error={error} />}
        {result && <Passages result={result} />}
      </div>
    </Card>
  );
}
