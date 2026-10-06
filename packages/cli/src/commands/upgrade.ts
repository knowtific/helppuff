import { readFileSync } from 'node:fs';
import * as p from '@clack/prompts';
import { MIGRATIONS, newer } from '@helppuff/server';
import { assertKnown, bool } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { cloudflareSession } from '../engine/credentials.js';
import { deploy, liveVersion } from '../engine/deploy.js';
import { loadEnv } from '../engine/env.js';
import { loadProject, resourceName, saveProject, upgradeProjectFile, type ProjectInput } from '../engine/project.js';
import { readState, writeState } from '../engine/state.js';
import { latestVersion, PACKAGE_NAME, VERSION } from '../engine/version.js';
import type { Ctx } from './context.js';

/**
 * `helppuff upgrade` — bring a deployed assistant to this release, safely.
 *
 *   1. What is live (the Worker's /healthz), what this CLI is, what is newest.
 *   2. The plan: helppuff.json format changes, D1 migrations still to apply.
 *   3. A restore point: D1 Time Travel is always on, so the time just before
 *      the upgrade is enough to put the database back (`wrangler d1
 *      time-travel restore … --timestamp=…`, kept 7 days on the Free plan).
 *   4. The deploy itself — the same as `helppuff deploy`: migrations first,
 *      then the new Worker, then config.
 *
 * `--check` stops after step 2. Migrations only ever add (see the policy in
 * server/src/db/migrations.ts), so the previous release keeps working on the
 * upgraded database: rolling back is `npx @knowtific/helppuff@<version> deploy
 * --allow-downgrade`.
 */

type Pending = { id: number; name: string };

async function pendingMigrations(dir: string, d1DatabaseId: string | undefined, liveSchema: number | null): Promise<{ pending: Pending[]; source: 'database' | 'worker' | 'unknown' }> {
  const all = MIGRATIONS.map((m) => ({ id: m.id, name: m.name }));
  if (d1DatabaseId) {
    try {
      const cf = await cloudflareSession(loadEnv(dir));
      const rows = await cf.api.d1Query<{ id: number }>(cf.accountId, d1DatabaseId, 'SELECT id FROM _migrations');
      const done = new Set(rows.map((r) => Number(r.id)));
      return { pending: all.filter((m) => !done.has(m.id)), source: 'database' };
    } catch {
      // No credentials here, or an older database without the ledger: say what the Worker expects instead.
    }
  }
  if (liveSchema !== null) return { pending: all.filter((m) => m.id > liveSchema), source: 'worker' };
  return { pending: [], source: 'unknown' };
}

export async function upgradeCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['check', 'yes', 'y', 'allow-downgrade'], 'upgrade');
  const loaded = loadProject(ctx.cwd);
  const url = loaded.project.cloudflare.url;
  if (!url) throw new CliError('not_deployed', 'Nothing is deployed from this folder yet.', { hint: 'helppuff deploy' });

  ctx.out.progress('Checking versions…');
  const [live, latest] = await Promise.all([liveVersion(url), latestVersion()]);
  if (latest && newer(latest, VERSION)) {
    throw new CliError('cli_outdated', `This is helppuff ${VERSION}; ${latest} is the latest release.`, {
      hint: `Run the latest: npx ${PACKAGE_NAME}@latest upgrade`,
      details: { cli: VERSION, latest },
    });
  }
  if (live.version && newer(live.version, VERSION) && !ctx.flags['allow-downgrade']) {
    throw new CliError('downgrade', `The Worker already runs helppuff ${live.version}, newer than this ${VERSION}.`, {
      hint: `Use the newer CLI: npx ${PACKAGE_NAME}@latest upgrade`,
    });
  }

  const fileRaw = JSON.parse(readFileSync(loaded.file, 'utf8')) as Record<string, unknown>;
  const project = upgradeProjectFile(fileRaw);
  const migrations = await pendingMigrations(loaded.dir, loaded.project.cloudflare.d1DatabaseId, live.schema);
  const current = !project.changes.length && !migrations.pending.length && live.version === VERSION;
  const plan = {
    from: live.version,
    to: VERSION,
    latest,
    projectChanges: project.changes,
    migrations: migrations.pending,
    migrationsKnownFrom: migrations.source,
  };

  const describe = () => {
    process.stdout.write(
      [
        `${c.bold('Deployed')}  ${live.version ?? c.dim('unknown (a release from before version reporting)')}`,
        `${c.bold('Upgrade to')} ${VERSION}${latest && latest === VERSION ? c.dim(' (latest)') : ''}`,
        ...(project.changes.length ? [`${c.bold('helppuff.json')}`, ...project.changes.map((change) => `  • ${change}`)] : []),
        migrations.pending.length
          ? `${c.bold('Database')}  ${migrations.pending.length} migration(s): ${migrations.pending.map((m) => m.name).join(', ')}`
          : `${c.bold('Database')}  ${migrations.source === 'unknown' ? c.dim('checked during the deploy') : 'up to date'}`,
      ].join('\n') + '\n',
    );
  };

  if (ctx.flags['check']) {
    ctx.out.result({ ...plan, upToDate: current, next: current ? [] : [`npx ${PACKAGE_NAME}@latest upgrade --yes --json`] }, () => {
      describe();
      process.stdout.write(current ? c.green('Up to date.\n') : `Run ${c.cyan(`npx ${PACKAGE_NAME}@latest upgrade`)} to upgrade.\n`);
    });
    return 0;
  }

  if (!ctx.flags['json']) describe();
  const yes = bool(ctx.flags, 'yes') ?? bool(ctx.flags, 'y') ?? false;
  if (!yes) {
    if (!ctx.interactive) {
      throw new CliError('needs_confirmation', 'Upgrading changes the live assistant. Re-run with --yes to go ahead.', { exitCode: EXIT.usage, details: plan });
    }
    const go = await p.confirm({ message: current ? 'Everything is current. Deploy again anyway?' : 'Upgrade now?', initialValue: !current });
    if (p.isCancel(go) || !go) return 0;
  }

  // The moment before anything changes: D1 Time Travel can put the database back to it.
  const at = Math.floor(Date.now() / 1000);
  const database = resourceName(loaded.project.site);
  const restore = loaded.project.cloudflare.d1DatabaseId ? { timestamp: at, command: `npx wrangler d1 time-travel restore ${database} --timestamp=${at}` } : null;

  if (project.changes.length) saveProject(loaded.dir, project.raw as ProjectInput);

  const spinner = ctx.interactive ? p.spinner() : null;
  spinner?.start('Upgrading on your Cloudflare account');
  let result;
  try {
    result = await deploy(loadProject(ctx.cwd), {
      allowDowngrade: Boolean(ctx.flags['allow-downgrade']),
      progress: spinner ? (m) => spinner.message(m.trim()) : ctx.out.progress,
    });
    spinner?.stop(`Upgraded to ${VERSION}`);
  } catch (thrown) {
    spinner?.error('Upgrade failed');
    if (restore && thrown instanceof CliError) {
      throw new CliError(thrown.code, thrown.message, {
        hint: [thrown.hint, `If the database was changed, it can be restored to just before: ${restore.command}`].filter(Boolean).join('\n'),
        ...(thrown.details ? { details: thrown.details } : {}),
        exitCode: thrown.exitCode,
      });
    }
    throw thrown;
  }

  const state = readState(loaded.dir);
  state.upgrades = [...(state.upgrades ?? []), { from: live.version, to: VERSION, at: new Date(at * 1000).toISOString(), restoreTimestamp: restore?.timestamp ?? null }].slice(-20);
  writeState(loaded.dir, state);

  ctx.out.result({ ...plan, restore, deploy: result }, () => {
    for (const warning of result.warnings) process.stdout.write(`${c.yellow('!')} ${warning}\n`);
    ctx.out.success(`Now on helppuff ${VERSION}${live.version ? ` (was ${live.version})` : ''}.`);
    if (restore) process.stdout.write(c.dim(`To put the database back as it was (within 7 days): ${restore.command}\n`));
  });
  return 0;
}
