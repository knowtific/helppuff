import { Check, Loader2, MessageSquare, X } from 'lucide-react';
import { useState } from 'react';
import { api, type Gap, type GapList } from '../lib/api';
import { fmtNumber, fmtRelative, href, useData } from '../lib/utils';
import { Button, Card, CardHeader, ErrorNote, Skeleton, Textarea, useModal } from './ui';

/**
 * Questions to answer: what visitors asked about the business that the
 * assistant could not answer and the knowledge base does not cover (found
 * after each conversation). Answer one and it becomes one of "Your own
 * answers", live at once; dismiss one that is not for visitors.
 */
export function QuestionsToAnswer({ limit = 50, onAnswered }: { limit?: number; onAnswered?: () => void }) {
  const { data, error, reload } = useData(() => api<GapList>(`/knowledge/gaps?status=open&limit=${limit}`), [limit]);
  const [answering, setAnswering] = useState<Gap | null>(null);
  const [failed, setFailed] = useState<Error | null>(null);
  const dismiss = async (gap: Gap) => {
    setFailed(null);
    try {
      await api(`/knowledge/gaps/${gap.id}`, { method: 'PATCH', json: { status: 'dismissed' } });
      reload();
    } catch (thrown) {
      setFailed(thrown as Error);
    }
  };
  const open = data?.counts.open ?? 0;
  return (
    <Card>
      <CardHeader
        title={open ? `Questions to answer (${fmtNumber(open)})` : 'Questions to answer'}
        tip={{
          label: 'About questions to answer',
          text: 'Visitors asked these about your business; the assistant could not answer and your knowledge base does not cover them. Off-topic questions, and ones your instructions say not to answer, are left out. Answer once and the assistant knows it from the next chat.',
        }}
        description={data?.counts.answered ? `${fmtNumber(data.counts.answered)} answered so far` : undefined}
      />
      {error && (
        <div className="px-4 pb-3">
          <ErrorNote error={error} onRetry={reload} />
        </div>
      )}
      {!data && !error && <Skeleton className="mx-4 mb-4 h-16" />}
      {data && !data.gaps.length && (
        <p className="flex items-center gap-2 border-t px-4 py-3 text-[13px] text-muted-foreground">
          <Check className="size-4" aria-hidden /> Nothing to answer: everything visitors asked is covered.
        </p>
      )}
      {data && data.gaps.length > 0 && (
        <ul className="divide-y border-t">
          {data.gaps.map((gap) => (
            <li key={gap.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{gap.question}</span>
                <span className="block text-xs text-muted-foreground">
                  Asked {gap.count === 1 ? 'once' : `${fmtNumber(gap.count)} times`}, last {fmtRelative(gap.lastAskedAt)}
                  {gap.conversationId && (
                    <>
                      {' · '}
                      <a href={href({ page: 'conversations', id: gap.conversationId })} className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline">
                        <MessageSquare className="size-3" aria-hidden /> the conversation
                      </a>
                    </>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <Button size="sm" onClick={() => setAnswering(gap)}>
                  Answer
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void dismiss(gap)} aria-label={`Dismiss: ${gap.question}`} title="Not something to answer">
                  <X /> Dismiss
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <div className="border-t px-4 py-2">
          <ErrorNote error={failed} />
        </div>
      )}
      {answering && (
        <AnswerDialog
          gap={answering}
          onClose={() => setAnswering(null)}
          onSaved={() => {
            setAnswering(null);
            reload();
            onAnswered?.();
          }}
        />
      )}
    </Card>
  );
}

/** The answer, saved as one of "Your own answers" with the question as its title. */
export function AnswerDialog({ gap, onClose, onSaved }: { gap: Gap; onClose: () => void; onSaved: () => void }) {
  const ref = useModal<HTMLDivElement>(onClose);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/knowledge/gaps/${gap.id}/answer`, { method: 'POST', json: { answer } });
      onSaved();
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={ref} className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-labelledby={`answer-${gap.id}`}>
      <Card className="w-full max-w-lg">
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">A visitor asked</p>
              <h2 id={`answer-${gap.id}`} className="text-[15px] font-semibold">
                {gap.question}
              </h2>
            </div>
            <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
              <X />
            </Button>
          </div>
          <label className="block space-y-1.5">
            <span className="block text-xs font-medium">Your answer</span>
            <Textarea rows={5} required value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="What the assistant should tell visitors who ask this." />
            <span className="block text-xs text-muted-foreground">Saved to your knowledge base as one of “Your own answers”. The assistant uses it from the next chat.</span>
          </label>
          {error && <ErrorNote error={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !answer.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Save answer
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
