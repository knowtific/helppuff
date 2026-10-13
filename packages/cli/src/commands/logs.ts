import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { cloudflareSession } from '../engine/credentials.js';
import { loadEnv } from '../engine/env.js';
import { loadProject, workerNameFor } from '../engine/project.js';
import { collectWranglerTail, runWrangler } from '../engine/wrangler.js';
import type { Ctx } from './context.js';

/** Tail the deployed Worker through the bundled Wrangler, using the project's Cloudflare credentials. */
export async function logsCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['cf-token', 'cf-account', 'account-id', 'method', 'search', 'seconds'], 'logs');
  if (ctx.positionals.length) throw new CliError('usage', 'Usage: helppuff logs [--method POST] [--search text] [--seconds 15 --json]', { exitCode: EXIT.usage });
  if (!ctx.out.json && ctx.flags['seconds'] !== undefined) throw new CliError('usage', '--seconds is for bounded --json output; press Ctrl-C to stop the live tail.', { exitCode: EXIT.usage });
  const seconds = ctx.out.json ? Number(str(ctx.flags, 'seconds') ?? '15') : null;
  if (seconds !== null && (!Number.isInteger(seconds) || seconds < 1 || seconds > 300)) {
    throw new CliError('usage', '--seconds must be a whole number from 1 to 300.', { exitCode: EXIT.usage });
  }
  const loaded = loadProject(ctx.cwd);
  if (!loaded.project.cloudflare.url) throw new CliError('not_deployed', 'There is no deployed Worker to tail.', { hint: 'Run `helppuff deploy` first.' });
  const worker = workerNameFor(loaded.project);
  const accountId = str(ctx.flags, 'cf-account') ?? str(ctx.flags, 'account-id') ?? loaded.project.cloudflare.accountId;
  const cf = await cloudflareSession(loadEnv(loaded.dir), { token: str(ctx.flags, 'cf-token'), accountId });
  const auth = { accountId: cf.accountId, ...(cf.source === 'api-token' ? { token: cf.token } : {}) };
  const args = ['tail', worker];
  for (const flag of ['method', 'search'] as const) {
    const value = str(ctx.flags, flag);
    if (value) args.push(`--${flag}`, value);
  }

  if (seconds !== null) {
    const result = await collectWranglerTail(args, { cwd: loaded.dir, auth, durationMs: seconds * 1000 });
    if (result.code !== 0) {
      throw new CliError('cloudflare_tail_failed', `Could not read logs for ${worker}.`, {
        hint: 'Check Cloudflare access and give the token Workers Tail Read permission for this Worker. Run `helppuff doctor` for account access.',
        exitCode: EXIT.auth,
      });
    }
    ctx.out.result({ worker, seconds, events: result.events, truncated: result.truncated });
    return EXIT.ok;
  }

  ctx.out.info(`Tailing ${worker} on Cloudflare. Press Ctrl-C to stop.`);
  const result = await runWrangler(args, { cwd: loaded.dir, auth, inherit: true });
  if (result.code !== 0) {
    throw new CliError('cloudflare_tail_failed', `Could not read logs for ${worker}.`, {
      hint: 'Check Cloudflare access and give the token Workers Tail Read permission for this Worker. Run `helppuff doctor` for account access.',
      exitCode: EXIT.auth,
    });
  }
  return EXIT.ok;
}
