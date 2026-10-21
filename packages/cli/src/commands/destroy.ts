import { removeReplies } from '../engine/email-replies.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { cloudflareSession } from '../engine/credentials.js';
import { loadEnv } from '../engine/env.js';
import { GENERATED_DIR, aiSearchInstanceFor, loadProject, resourceName, updateProject, vectorizeIndexFor, workerNameFor } from '../engine/project.js';
import type { Ctx } from './context.js';

/**
 * `helppuff destroy` — remove everything this project created on Cloudflare:
 * the Worker (and its crawl Workflow), the KV namespace, the D1 database
 * (conversations, leads, knowledge text), the Vectorize index, and an AI
 * Search instance helppuff created, and the R2 bucket of photos and files.
 * Local files stay: helppuff.json, prompt.md and .env are untouched, so
 * `helppuff deploy` builds it all again.
 *
 * Irreversible, so it never runs without `--yes` (or typing the site id in
 * the terminal, which then also asks about the files bucket). `--keep-data`
 * keeps the database, the vector index and the files.
 */
export async function destroyCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['yes', 'y', 'keep-data', 'cf-account', 'account-id'], 'destroy');
  const loaded = loadProject(ctx.cwd);
  const { project } = loaded;
  const keepData = Boolean(ctx.flags['keep-data']);
  const confirmed = Boolean(ctx.flags['yes'] || ctx.flags['y']);
  const worker = workerNameFor(project);
  const name = resourceName(project.site);

  if (!confirmed && !ctx.interactive) {
    throw new CliError('needs_confirmation', `This deletes ${worker} and its data from Cloudflare. Re-run with --yes to confirm.`, { exitCode: EXIT.usage });
  }
  const cf = await cloudflareSession(loadEnv(loaded.dir), { accountId: str(ctx.flags, 'cf-account') ?? str(ctx.flags, 'account-id') });
  // The bucket is made by every deploy the account allows, files on or not; only look when it could go.
  const hasFiles = !keepData && (await cf.api.r2BucketExists(cf.accountId, name).catch(() => false));
  let deleteFiles = hasFiles;

  if (!confirmed) {
    p.note(
      [`Worker      ${worker} (and ${worker}-crawl)`, 'KV          config, rate limits', ...(keepData ? [] : ['D1          conversations, leads, knowledge text', 'Vectorize   the knowledge index'])].join('\n'),
      'Will be deleted',
    );
    const typed = await p.text({ message: `Type ${c.bold(project.site)} to delete it` });
    if (p.isCancel(typed) || String(typed).trim() !== project.site) {
      p.cancel('Nothing was deleted.');
      return 1;
    }
    if (hasFiles) {
      const answer = await p.confirm({
        message: `Also delete the R2 bucket ${name}, with every photo and file visitors and your team uploaded?`,
        initialValue: false,
      });
      if (p.isCancel(answer)) {
        p.cancel('Nothing was deleted.');
        return 1;
      }
      deleteFiles = answer;
    }
  }

  const removed: string[] = [];
  const failed: { resource: string; error: string }[] = [];
  const attempt = async (resource: string, work: () => Promise<unknown>) => {
    ctx.out.progress(`Deleting ${resource}…`);
    try {
      await work();
      removed.push(resource);
    } catch (thrown) {
      // Already gone is the outcome we wanted.
      if (thrown instanceof CliError && thrown.code === 'cloudflare_not_found') return;
      failed.push({ resource, error: (thrown as Error).message });
    }
  };

  // Answers by email: the rule that hands them to this Worker (Email Routing stays on the subdomain).
  const replies = project.customerEmails.inbound.domain;
  if (replies) await attempt(`Email Routing rule reply@${replies}`, () => removeReplies(cf.api, replies, project.customerEmails.inbound.ruleId));
  await attempt(`Worker ${worker}`, () => cf.api.deleteWorker(cf.accountId, worker));
  await attempt(`Workflow ${worker}-crawl`, () => cf.api.deleteWorkflow(cf.accountId, `${worker}-crawl`.slice(0, 64)));
  const kvId = project.cloudflare.kvNamespaceId ?? (await cf.api.kvNamespaces(cf.accountId)).find((ns) => ns.title === name)?.id;
  if (kvId) await attempt(`KV ${name}`, () => cf.api.deleteKvNamespace(cf.accountId, kvId));
  if (!keepData) {
    const dbId = project.cloudflare.d1DatabaseId;
    if (dbId) await attempt(`D1 ${name}`, () => cf.api.deleteD1Database(cf.accountId, dbId));
    const index = vectorizeIndexFor(project);
    if (index) await attempt(`Vectorize ${index}`, () => cf.api.deleteVectorizeIndex(cf.accountId, index));
    // Only an instance helppuff made for this site; a reused one belongs to someone else.
    const instance = aiSearchInstanceFor(project);
    if (instance === name) await attempt(`AI Search ${instance}`, () => cf.api.deleteAiSearchInstance(cf.accountId, instance));
    if (deleteFiles) await attempt(`R2 ${name}`, () => cf.api.deleteR2Bucket(cf.accountId, name));
  }
  const keptFiles = hasFiles && !deleteFiles ? name : undefined;

  if (!failed.length) {
    updateProject(loaded, (raw) => {
      const cloudflare = { ...((raw['cloudflare'] as Record<string, unknown>) ?? {}) };
      for (const key of ['url', 'kvNamespaceId', ...(keepData ? [] : ['d1DatabaseId', 'vectorizeIndex'])]) delete cloudflare[key];
      raw['cloudflare'] = cloudflare;
    });
    rmSync(join(loaded.dir, GENERATED_DIR), { recursive: true, force: true });
  }

  ctx.out.result({ removed, failed, keptData: keepData, ...(keptFiles ? { keptFilesBucket: keptFiles } : {}), next: failed.length ? ['helppuff destroy --yes   (retry)'] : ['helppuff deploy   (to build it again)'] }, () => {
    for (const r of removed) ctx.out.success(`Deleted ${r}`);
    for (const f of failed) ctx.out.warn(`${f.resource}: ${f.error}`);
    if (keptFiles) ctx.out.info(`Kept the R2 bucket ${keptFiles} and its files. \`helppuff destroy --yes\` deletes it too.`);
    if (!failed.length) ctx.out.info(c.dim('helppuff.json, prompt.md and .env are untouched; `helppuff deploy` rebuilds everything.'));
  });
  return failed.length ? 1 : 0;
}
