import { relative } from 'node:path';
import { promptHash } from '@murmur/server';
import { assertKnown, str } from '../args.js';
import { CliError } from '../errors.js';
import { c } from '../output.js';
import { loadEnv } from '../engine/env.js';
import { loadProject } from '../engine/project.js';
import {
  promptFile,
  promptHistory,
  promptSync,
  promptVersionText,
  pullPrompt,
  readLivePrompt,
  readLocalPrompt,
  remoteFor,
  type PromptSync,
} from '../engine/prompt.js';
import { readState } from '../engine/state.js';
import type { Ctx } from './context.js';

/**
 * `murmur prompt` — prompt.md against the live, versioned prompt.
 *
 *   status              in sync, ahead (deploy publishes), behind or diverged (pull first)
 *   pull [--version N]  write the live prompt (or version N, to restore it) into prompt.md
 *   history             every published version: who, where, when
 *   show [N]            print the live prompt, or version N
 */

const NEXT: Record<PromptSync, string> = {
  not_deployed: 'murmur deploy',
  untracked: 'murmur deploy — it records the first version',
  in_sync: 'edit prompt.md, then murmur deploy',
  ahead: 'murmur deploy — it publishes prompt.md as a new version',
  behind: 'murmur prompt pull',
  diverged: 'murmur prompt pull — your prompt.md is kept as prompt.mine.md to merge',
};

const DESCRIBE: Record<PromptSync, string> = {
  not_deployed: 'not deployed yet',
  untracked: 'deployed before versioning',
  in_sync: 'in sync with the live prompt',
  ahead: 'has edits to publish',
  behind: 'behind the live prompt',
  diverged: 'changed both here and live',
};

function versionFlag(ctx: Ctx, positional?: string): number | undefined {
  const raw = str(ctx.flags, 'version') ?? positional;
  if (raw === undefined) return undefined;
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) throw new CliError('usage', `"${raw}" is not a version number.`, { exitCode: 2 });
  return version;
}

export async function promptCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['version', 'limit'], 'prompt');
  const sub = ctx.positionals[0] ?? 'status';
  const loaded = loadProject(ctx.cwd);
  const site = loaded.project.site;
  const file = relative(ctx.cwd, promptFile(loaded)) || promptFile(loaded);

  if (!['status', 'pull', 'history', 'show'].includes(sub)) {
    throw new CliError('usage', `Unknown subcommand "prompt ${sub}".`, { exitCode: 2, hint: 'murmur prompt --help' });
  }

  if (sub === 'status' && !loaded.project.cloudflare.kvNamespaceId) {
    ctx.out.result({ status: 'not_deployed', file, next: NEXT.not_deployed }, () => ctx.out.info(`${file} is ${DESCRIBE.not_deployed}. Next: ${c.cyan(NEXT.not_deployed)}`));
    return 0;
  }
  const remote = await remoteFor(loaded, loadEnv(loaded.dir));

  if (sub === 'status') {
    const { live } = await readLivePrompt(remote, site);
    const base = readState(loaded.dir).prompt;
    const status = live && !live.editable ? null : promptSync(await promptHash(readLocalPrompt(loaded)), base, live);
    if (!status) {
      ctx.out.result({ status: 'not_versioned', file }, () => ctx.out.info('This backend keeps its prompt outside Murmur, so it is not versioned here.'));
      return 0;
    }
    const data = {
      status,
      file,
      live: live ? { version: live.version, publishedBy: live.meta?.by ?? null, source: live.meta?.source ?? null, at: live.meta?.at ?? null } : null,
      basedOn: base?.version ?? null,
      next: NEXT[status],
    };
    ctx.out.result(data, () => {
      const colour = status === 'in_sync' ? c.green : status === 'behind' || status === 'diverged' ? c.yellow : c.cyan;
      ctx.out.info(`${file} is ${colour(DESCRIBE[status])}.`);
      if (live) ctx.out.info(`  live      version ${live.version}${live.meta?.by ? c.dim(` · ${live.meta.by}`) : ''}${live.meta ? c.dim(` · ${live.meta.source}`) : ''}`);
      if (base) ctx.out.info(`  based on  version ${base.version}`);
      ctx.out.info(`  next      ${c.cyan(NEXT[status])}`);
    });
    return 0;
  }

  if (sub === 'pull') {
    const result = await pullPrompt(loaded, remote, { version: versionFlag(ctx) });
    const restoring = result.pulled !== result.live;
    ctx.out.result(
      {
        ...result,
        file,
        backup: result.backup ? relative(ctx.cwd, result.backup) : null,
        next: restoring ? `murmur deploy — publishes version ${result.pulled}'s text as a new version` : 'edit prompt.md, then murmur deploy',
      },
      () => {
        if (result.backup) ctx.out.warn(`Your unpublished edits are saved in ${relative(ctx.cwd, result.backup)} — merge what you need into ${file}.`);
        ctx.out.success(
          restoring
            ? `${file} now holds version ${result.pulled}. Run ${c.cyan('murmur deploy')} to make it live again (as version ${result.live + 1}).`
            : result.changed
              ? `${file} updated to live version ${result.live}.`
              : `${file} is already live version ${result.live}.`,
        );
      },
    );
    return 0;
  }

  if (sub === 'history') {
    const limit = Math.min(Math.max(Number(str(ctx.flags, 'limit') ?? 20) || 20, 1), 200);
    const versions = await promptHistory(remote, site, limit);
    ctx.out.result({ versions }, () => {
      if (!versions.length) ctx.out.info('No versions yet — the next `murmur deploy` records the first.');
      for (const v of versions) {
        const when = new Date(v.createdAt).toISOString().slice(0, 16).replace('T', ' ');
        const origin = v.source === 'restore' ? `restored v${v.restoredFrom}` : v.source;
        ctx.out.info(`${c.bold(`v${v.version}`.padEnd(5))} ${when}  ${origin.padEnd(12)} ${v.author ?? c.dim('—')}${v.note ? c.dim(`  ${v.note}`) : ''}`);
      }
    });
    return 0;
  }

  // show
  const version = versionFlag(ctx, ctx.positionals[1]);
  const { live } = await readLivePrompt(remote, site);
  if (!live) throw new CliError('not_deployed', 'There is no live prompt yet.', { hint: 'murmur deploy' });
  const text = version === undefined || version === live.version ? live.text : await promptVersionText(remote, site, version);
  ctx.out.result({ version: version ?? live.version, text }, () => process.stdout.write(`${text}\n`));
  return 0;
}
