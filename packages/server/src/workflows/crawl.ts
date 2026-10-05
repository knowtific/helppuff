import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { runCrawlPart, runFileJob, type CrawlParams, type FileParams, type Notify, type StepLike } from '@murmur/rag';
import { requireKnowledgeEnv } from '../knowledge/env.js';
import { emitTo } from '../webhooks/deliver.js';

/**
 * The background work of the knowledge base: a Cloudflare Workflow,
 * so it survives the person who started it closing the page, and each step
 * is retried on its own. Two jobs share the one binding:
 *
 *  - a crawl part (`runCrawlPart`), which chains the next instance when its
 *    batch is done;
 *  - an uploaded file (`runFileJob`, params `kind: 'file'`).
 *
 * The logic lives in `@murmur/rag`; this class only adapts the Workflows API.
 * Imported only by the Worker entry: `cloudflare:workers` exists nowhere else.
 */
export class CrawlWorkflow extends WorkflowEntrypoint<Record<string, unknown>, CrawlParams | FileParams> {
  override async run(event: Readonly<WorkflowEvent<CrawlParams | FileParams>>, step: WorkflowStep): Promise<unknown> {
    const env = requireKnowledgeEnv(this.env);
    const steps: StepLike = {
      do: (name, run) =>
        step.do(name, { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' }, timeout: '3 minutes' }, run as () => Promise<never>),
      sleep: (name, ms) => step.sleep(name, ms),
    };
    const payload = event.payload;
    // The site's webhooks hear when learning finishes; a failing endpoint never fails the job.
    const notify: Notify = (type, data) => emitTo({ db: env.db, fetch: globalThis.fetch.bind(globalThis) }, payload.siteId, type, data).catch(() => {});
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
      startNext: async (params) => {
        await env.workflow?.create({ id: `${params.runId}-${params.part}`, params });
      },
      notify,
      startFile: async (params) => {
        await env.workflow?.create({ id: `file-${params.fileId}-${Date.now().toString(36)}`, params });
      },
    }, crawl);
  }
}
