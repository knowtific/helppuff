import type { StepLike } from '@helppuff/rag';
import { resolveSite } from '../config/site.js';
import type { RequestCtx } from '../core/request.js';
import type { D1Like } from '../db/d1.js';
import { aiSettingsFor } from '../knowledge/env.js';
import { emitTo, type WebhookRetryParams } from '../webhooks/deliver.js';
import { summarizeConversation, type AiRunner } from './summary.js';
import { parseJsonObject } from '../admin/inbox.js';
import { afterToolIds, runAfterTool } from '../tools/chat.js';
import { parseData } from '../tools/run.js';

/**
 * The end of a conversation, as a background job (the Worker's Workflow).
 *
 * A conversation has no "end" a visitor reliably sends: they just stop. So
 * each conversation gets one Workflow instance that sleeps until five minutes
 * after its last message, checks (the visitor may have written again, and it
 * sleeps on), and then:
 *
 *   1. summarises and labels it (intent, sentiment, lead quality, outcome,
 *      topics, unanswered questions), saved for the dashboard;
 *   2. calls the site's after-chat tools (the Prompt page) with all of it;
 *   3. sends `conversation.completed` to the site's webhooks, with the
 *      summary, the lead, the transcript and the tools' data.
 *
 * Sleeping instances cost nothing on the Free plan (they do not count towards
 * the concurrency limit). Each step is retried on its own; a summary that
 * keeps failing is skipped rather than holding the event back. A visitor who
 * comes back after it ran starts a new one (`recordTurn`).
 */

export type ConversationParams = {
  kind: 'conversation';
  siteId: string;
  conversationId: string;
  /** Workers AI model for the summary; null when there is no AI binding. */
  model: string | null;
  /** The site's daily neuron budget: no summary once it is spent. 0 = no limit. */
  budget: number;
  idleMs?: number;
};

export const IDLE_MS = 5 * 60_000;
/** A conversation still going after this long is completed anyway, and again when it really ends. */
const MAX_OPEN_MS = 2 * 3600_000;
const MAX_CHECKS = 40;
const TRANSCRIPT_LIMIT = 200;

export type ConversationJobDeps = {
  db: D1Like;
  ai?: AiRunner | undefined;
  fetch: typeof fetch;
  now?: () => number;
  log?: (event: string, data?: object) => void;
  /** Hand a failed webhook delivery to the Workflow for later tries. */
  retry?: ((params: WebhookRetryParams) => Promise<void>) | undefined;
  /** HELPPUFF_SECRET: opens the after-chat tools' secret headers. Without it they do not run. */
  secret?: string | undefined;
};

/** The model summaries use: HELPPUFF_SUMMARY_MODEL, else the site's own chat model. */
export async function summaryModel(ctx: RequestCtx, siteId: string): Promise<string> {
  const configured = ctx.env['HELPPUFF_SUMMARY_MODEL'];
  if (typeof configured === 'string' && configured) return configured;
  return aiSettingsFor(await resolveSite(ctx, siteId)).chatModel;
}

type WorkflowCreate = { create(options: { id?: string; params: unknown }): Promise<unknown> };

/**
 * Start a conversation's job (after the response; never blocks or fails it).
 * Without a Workflow binding (an older deployment, local tests) nothing happens.
 */
export function startConversationJob(ctx: RequestCtx, siteId: string, conversationId: string, instance = `conv-${conversationId}`): void {
  const workflow = ctx.env['CRAWL_WORKFLOW'] as Partial<WorkflowCreate> | undefined;
  if (!workflow || typeof workflow.create !== 'function') return;
  ctx.platform.waitUntil(
    (async () => {
      const site = await resolveSite(ctx, siteId);
      const budget = Number((site.connector.options as { budget?: { dailyNeurons?: unknown } } | undefined)?.budget?.dailyNeurons ?? 0) || 0;
      const params: ConversationParams = {
        kind: 'conversation',
        siteId,
        conversationId,
        model: ctx.env['AI'] ? await summaryModel(ctx, siteId) : null,
        budget,
      };
      await workflow.create!({ id: instance.slice(0, 100), params });
    })().catch(() => {
      // Already started (the id is the conversation's), or Workflows unavailable: the dashboard can still summarise.
      ctx.platform.log('conversation.job_not_started');
    }),
  );
}

type Row = { started_at: number; last_at: number; completed_at: number | null; status: string | null };

/** A live chat (a person answering) is not over after five quiet minutes: it waits until it closes. */
const LIVE_IDLE_MS = 60 * 60_000;

export async function runConversationJob(step: StepLike, deps: ConversationJobDeps, params: ConversationParams): Promise<{ status: 'completed' | 'skipped' }> {
  const now = deps.now ?? Date.now;
  const idle = params.idleMs ?? IDLE_MS;

  // Sleep until the conversation has been quiet for `idle`. The clock is only
  // read inside steps, so a replayed instance makes the same decisions.
  for (let check = 0; ; check++) {
    const wait = await step.do(`check:${check}`, async () => {
      const row = await deps.db.prepare('SELECT started_at, last_at, completed_at, status FROM conversations WHERE id = ?').bind(params.conversationId).first<Row>();
      // Recording runs after the response, so the row can lag a moment; give up if it never comes.
      if (!row) return check < 3 ? idle : -1;
      if (row.completed_at) return -1;
      const t = now();
      const due = row.last_at + (row.status === 'live' ? Math.max(idle, LIVE_IDLE_MS) : idle);
      if (due <= t || t - row.started_at > MAX_OPEN_MS || check >= MAX_CHECKS) return 0;
      return due - t;
    });
    if (wait < 0) return { status: 'skipped' };
    if (wait === 0) break;
    await step.sleep(`idle:${check}`, wait);
  }

  // A summary is worth having but never worth losing the event over.
  try {
    await step.do('summarize', async () => {
      if (!deps.ai || !params.model) return false;
      if (params.budget > 0) {
        const day = new Date(now()).toISOString().slice(0, 10);
        const used = (await deps.db.prepare('SELECT neurons_est AS n FROM usage_daily WHERE day = ? AND site_id = ?').bind(day, params.siteId).first<{ n: number }>())?.n ?? 0;
        if (used >= params.budget) return false;
      }
      const result = await summarizeConversation({ db: deps.db, ai: deps.ai, now }, params.conversationId, params.model);
      return Boolean(result);
    });
  } catch {
    deps.log?.('conversation.summary_failed');
  }

  // The site's after-chat tools, one step each (retried on a 5xx or a timeout), before the event, so it carries what they returned.
  if (deps.secret) {
    const tools = await step.do('tools', () => afterToolIds(deps.db, params.siteId, now())).catch(() => [] as string[]);
    for (const toolId of tools) {
      try {
        await step.do(`tool:${toolId}`, async () => runAfterTool({ db: deps.db, fetch: deps.fetch, secret: deps.secret, now, log: deps.log }, params.siteId, toolId, await completedEvent(deps.db, params.conversationId)));
      } catch {
        deps.log?.('conversation.tool_failed');
      }
    }
  }

  const sent = await step.do('complete', async () => {
    // Claimed first, so a retried step (or a second instance) never sends it twice.
    const claim = (await deps.db
      .prepare('UPDATE conversations SET completed_at = ? WHERE id = ? AND completed_at IS NULL')
      .bind(now(), params.conversationId)
      .run()) as { meta?: { changes?: number }; changes?: number } | undefined;
    if ((claim?.meta?.changes ?? claim?.changes ?? 1) === 0) return false;
    await emitTo({ db: deps.db, fetch: deps.fetch, now, retry: deps.retry, ...(deps.log ? { log: deps.log } : {}) }, params.siteId, 'conversation.completed', await completedEvent(deps.db, params.conversationId));
    return true;
  });
  return { status: sent ? 'completed' : 'skipped' };
}

/** `conversation.completed`'s data: the conversation, its summary and labels, the lead, the transcript. */
async function completedEvent(db: D1Like, id: string): Promise<Record<string, unknown>> {
  const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first<Record<string, unknown>>();
  const [messages, lead, tags] = await Promise.all([
    db
      .prepare('SELECT role, type, text, ts, author FROM messages WHERE conversation_id = ? ORDER BY ts, id')
      .bind(id)
      .all<{ role: string; type: string; text: string | null; ts: number; author: string | null }>(),
    row?.['lead_id'] ? db.prepare('SELECT name, email, phone, company, fields, attributes, status, source FROM leads WHERE id = ?').bind(row['lead_id']).first<Record<string, unknown>>() : null,
    db
      .prepare('SELECT l.name FROM conversation_labels cl JOIN labels l ON l.id = cl.label_id WHERE cl.conversation_id = ? ORDER BY l.name COLLATE NOCASE')
      .bind(id)
      .all<{ name: string }>()
      .catch(() => ({ results: [] as { name: string }[] })),
  ]);
  let summary: Record<string, unknown> | null = null;
  try {
    summary = typeof row?.['summary'] === 'string' ? (JSON.parse(row['summary']) as Record<string, unknown>) : null;
  } catch {
    // Left null.
  }
  let fields: unknown = null;
  try {
    fields = typeof lead?.['fields'] === 'string' ? JSON.parse(lead['fields']) : null;
  } catch {
    // Left null.
  }
  const transcript = messages.results.filter((m) => m.text).slice(-TRANSCRIPT_LIMIT);
  return {
    conversationId: id,
    startedAt: row?.['started_at'] ? new Date(Number(row['started_at'])).toISOString() : null,
    lastMessageAt: row?.['last_at'] ? new Date(Number(row['last_at'])).toISOString() : null,
    messageCount: row?.['message_count'] ?? 0,
    page: { url: row?.['page_url'] ?? null, title: row?.['page_title'] ?? null, referrer: row?.['referrer'] ?? null },
    country: row?.['country'] ?? null,
    summary: summary?.['summary'] ?? null,
    labels: summary
      ? {
          intent: summary['intent'] ?? null,
          sentiment: summary['sentiment'] ?? null,
          leadQuality: summary['leadQuality'] ?? null,
          outcome: summary['outcome'] ?? null,
          topics: summary['topics'] ?? [],
        }
      : null,
    unanswered: summary?.['unanswered'] ?? [],
    followUp: summary?.['followUp'] ?? null,
    /** The site's own labels on it (Settings → Labels), by the team or the AI. */
    tags: tags.results.map((t) => t.name),
    attributes: parseJsonObject(row?.['attributes']),
    /** What the site's tools returned or saved, by tool name. */
    data: parseData(row?.['data']),
    /** The signed-in visitor, verified (a signed identity, or the API's user); null when nobody signed in. */
    user: (() => {
      const user = parseData(row?.['user']);
      return typeof user['id'] === 'string' ? user : null;
    })(),
    assignedTo: row?.['assigned_to'] ?? null,
    lead: lead
      ? { name: lead['name'] ?? null, email: lead['email'] ?? null, phone: lead['phone'] ?? null, company: lead['company'] ?? null, status: lead['status'], source: lead['source'], fields, attributes: parseJsonObject(lead['attributes']) }
      : null,
    transcript: transcript.map((m) => ({ role: m.role === 'user' ? 'visitor' : m.author ? 'team' : 'assistant', text: m.text, at: new Date(m.ts).toISOString() })),
  };
}
