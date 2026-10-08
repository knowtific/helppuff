import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { runCrawlPart, runFileJob, type CrawlParams, type FileParams, type Notify, type StepLike } from '@helppuff/rag';
import { runConversationJob, type ConversationParams } from '../conversations/complete.js';
import type { AiRunner } from '../conversations/summary.js';
import { dbFrom } from '../db/d1.js';
import { requireKnowledgeEnv } from '../knowledge/env.js';
import { emitTo, runWebhookRetry, workflowRetry, type WebhookRetryParams } from '../webhooks/deliver.js';
import { setupAfterLearning } from '../jobs/setup.js';
import { suggestAfterLearning } from '../home/suggest.js';
import { DEFAULT_CHAT_MODEL } from '../knowledge/env.js';
import type { KvStore } from '@helppuff/connector-types';

/**
 * The Worker's background jobs: one Cloudflare Workflow, so each job survives
 * the request that started it, and each step is retried on its own. Four
 * kinds share the one binding (`CRAWL_WORKFLOW`; the class keeps its first
 * name so existing deployments update in place):
 *
 *  - a crawl part (`runCrawlPart`), which chains the next instance;
 *  - an uploaded file (`runFileJob`, `kind: 'file'`);
 *  - a conversation's end (`runConversationJob`, `kind: 'conversation'`):
 *    summary, labels and `conversation.completed`;
 *  - a webhook delivery that failed (`runWebhookRetry`, `kind: 'webhook'`),
 *    retried over hours.
 *
 * The logic lives elsewhere and is tested against a fake step API; this
 * class only adapts the Workflows API. Imported only by the Worker entry:
 * `cloudflare:workers` exists nowhere else.
 */

type Job = CrawlParams | FileParams | ConversationParams | WebhookRetryParams;

export class CrawlWorkflow extends WorkflowEntrypoint<Record<string, unknown>, Job> {
  override async run(event: Readonly<WorkflowEvent<Job>>, step: WorkflowStep): Promise<unknown> {
    const steps: StepLike = {
      do: (name, run) =>
        step.do(name, { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' }, timeout: '3 minutes' }, run as () => Promise<never>),
      sleep: (name, ms) => step.sleep(name, ms),
    };
    const payload = event.payload;
    const fetcher = globalThis.fetch.bind(globalThis);

    // Jobs that need only the database: they run for every backend with a dashboard.
    if ('kind' in payload && (payload.kind === 'conversation' || payload.kind === 'webhook')) {
      const db = dbFrom(this.env);
      if (!db) throw new Error('No D1 binding.');
      if (payload.kind === 'webhook') return runWebhookRetry(steps, { db, fetch: fetcher }, payload);
      const ai = this.env['AI'] as Partial<AiRunner> | undefined;
      return runConversationJob(
        steps,
        { db, fetch: fetcher, retry: workflowRetry(this.env), ...(ai && typeof ai.run === 'function' ? { ai: ai as AiRunner } : {}) },
        payload,
      );
    }

    const env = requireKnowledgeEnv(this.env);
    // The site's webhooks hear when learning finishes; a failing endpoint never fails the job.
    // Learning the site the first time also sets Jobs and the home screen up from it (once; never over the owner's).
    const notify: Notify = async (type, data) => {
      await emitTo({ db: env.db, fetch: fetcher, retry: workflowRetry(this.env) }, payload.siteId, type, data).catch(() => {});
      if (type !== 'knowledge.crawl.finished') return;
      const ai = this.env['AI'] as Partial<AiRunner> | undefined;
      const runner = ai && typeof ai.run === 'function' ? (ai as AiRunner) : undefined;
      const kv = this.env['HELPPUFF_KV'] as KvStore | undefined;
      await setupAfterLearning({ db: env.db, ai: runner, kv, now: () => Date.now() }, payload.siteId).catch(() => {});
      // And the widget's home screen: useful pages as links, the questions visitors ask (once; the owner's own win).
      await suggestAfterLearning({ db: env.db, ai: runner, kv, model: DEFAULT_CHAT_MODEL, now: () => Date.now() }, payload.siteId, '').catch(() => {});
    };
    if ('kind' in payload && payload.kind === 'file') {
      if (!env.uploads) throw new Error('No KV binding to read the upload from.');
      return runFileJob(steps, { db: env.db, ai: env.ai, vectors: env.vectors, uploads: env.uploads, toMarkdown: env.toMarkdown, notify }, payload);
    }
    const crawl = payload as CrawlParams;
    return runCrawlPart(steps, {
      db: env.db,
      ai: env.ai,
      vectors: env.vectors,
      browser: env.browser,
      notify,
      startNext: async (params) => {
        await env.workflow?.create({ id: `${params.runId}-${params.part}`, params });
      },
      startFile: async (params) => {
        await env.workflow?.create({ id: `file-${params.fileId}-${Date.now().toString(36)}`, params });
      },
    }, crawl);
  }
}
