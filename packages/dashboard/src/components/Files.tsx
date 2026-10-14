import { FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatBytes, isImageType } from '@helppuff/protocol/files';
import { attachJobFile, isMember, jobFiles, removeJobFile, type Me, type StoredFile } from '../lib/api';
import { cn, useData } from '../lib/utils';
import { HelpLink } from './Shell';
import { SideSection } from './inbox';
import { Button, ErrorNote } from './ui';

/**
 * Photos and files (R2): a grid of them in a transcript or on a job, and a
 * job's Files section. Every link is signed by the Worker and expires, so a
 * page left open for a day needs a reload to open them again.
 */

/** Photos as thumbnails, other files as chips; each opens in a new tab. */
export function FileGrid({ files, onRemove, className }: { files: StoredFile[]; onRemove?: ((file: StoredFile) => void) | undefined; className?: string }) {
  if (!files.length) return null;
  return (
    <ul className={cn('flex flex-wrap gap-2', className)}>
      {files.map((file) => (
        <li key={file.id} className="group relative">
          {file.removed || !file.url ? (
            <span className="flex h-9 items-center gap-1.5 rounded-md border bg-subtle px-2.5 text-xs text-muted-foreground">
              <FileText className="size-3.5" aria-hidden />
              {file.name} (removed)
            </span>
          ) : isImageType(file.type) ? (
            <a href={file.url} target="_blank" rel="noopener noreferrer" className="block size-24 overflow-hidden rounded-md border bg-subtle" title={`${file.name} · ${formatBytes(file.size)}`}>
              <img src={file.url} alt={file.name} loading="lazy" className="size-full object-cover" />
            </a>
          ) : (
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 max-w-60 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs hover:bg-subtle"
              title={file.name}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
            </a>
          )}
          {onRemove && !file.removed && (
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              onClick={() => onRemove(file)}
              className="absolute -right-1.5 -top-1.5 hidden rounded-full border bg-card p-1 text-muted-foreground shadow-sm hover:text-danger focus-visible:flex group-hover:flex"
            >
              <Trash2 className="size-3" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A job's photos and files: drop or choose to attach; the chat's photos below. Hidden while files on jobs are off and there are none. */
export function JobFilesSection({ jobId, me, onChanged }: { jobId: string; me: Me; onChanged: () => void }) {
  const { data, error, reload } = useData(() => jobFiles(jobId), [jobId]);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [failed, setFailed] = useState<Error | null>(null);
  const [dragging, setDragging] = useState(false);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data || (!data.enabled && !data.files.length && !data.fromChat.length)) return null;
  const canAttach = data.enabled && data.storage;

  const attach = async (list: FileList) => {
    setFailed(null);
    try {
      for (const [i, file] of [...list].entries()) {
        setUploading(list.length > 1 ? `${i + 1} of ${list.length}` : file.name);
        await attachJobFile(jobId, file);
      }
    } catch (thrown) {
      setFailed(thrown as Error);
    } finally {
      setUploading(null);
      reload();
      onChanged();
    }
  };
  const remove = async (file: StoredFile) => {
    if (!window.confirm(`Remove ${file.name}?`)) return;
    setFailed(null);
    try {
      await removeJobFile(jobId, file.id);
    } catch (thrown) {
      setFailed(thrown as Error);
    }
    reload();
    onChanged();
  };
  const mayRemove = (file: StoredFile) => !isMember(me) || file.uploadedBy === me.admin.email;

  return (
    <SideSection title="Files">
      <div
        className={cn('space-y-2 rounded-md transition-colors', dragging && 'bg-subtle outline-dashed outline-1 outline-primary')}
        onDragOver={(e) => {
          if (!canAttach) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (canAttach && e.dataTransfer.files.length) void attach(e.dataTransfer.files);
        }}
      >
        <FileGrid files={data.files} onRemove={(file) => mayRemove(file) && void remove(file)} />
        {canAttach ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading !== null}>
              {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
              {uploading ? `Uploading ${uploading}…` : 'Attach files'}
            </Button>
            <span className="text-[11px] text-muted-foreground">or drop them here · up to {data.maxMb} MB</span>
            <input
              ref={input}
              type="file"
              multiple
              className="sr-only"
              aria-label="Attach files"
              onChange={(e) => {
                if (e.target.files?.length) void attach(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        ) : (
          data.enabled && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              File storage is not set up on this deployment yet.
              <HelpLink page="Files" label="How to set it up" />
            </p>
          )
        )}
        {failed && <ErrorNote error={failed} />}
        {data.fromChat.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] text-muted-foreground">Sent in the chat</p>
            <FileGrid files={data.fromChat} />
          </div>
        )}
      </div>
    </SideSection>
  );
}
