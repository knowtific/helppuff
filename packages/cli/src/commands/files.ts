import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi } from '../engine/admin-api.js';
import { loadProject } from '../engine/project.js';
import type { FilesConfig, Settings } from '@helppuff/server';
import { pullSettings } from './manage.js';
import type { Ctx } from './context.js';

/**
 * `helppuff files` — photos and files on R2, the same as Settings → Advanced
 * → Files in the dashboard. Off by default; chat and jobs turn on separately.
 *
 *   status
 *   chat live|always|off      visitors send photos and PDFs (`live`: only while a person has the chat)
 *   jobs on|off               the team attaches files to jobs
 *   ai on|off [--model <id>]  the assistant learns what is in photos (a vision model describes each)
 *   limits [--max-chat-mb N] [--max-job-mb N] [--per-conversation N] [--keep-days N]
 *
 * Saved through the admin API like the dashboard: live within a minute and
 * pulled into helppuff.json, so the next deploy keeps it.
 */

const USAGE = 'Usage: helppuff files status | chat live|always|off | jobs on|off | ai on|off [--model <id>] | limits [--max-chat-mb N] [--max-job-mb N] [--per-conversation N] [--keep-days N]';
const usage = () => new CliError('usage', USAGE, { exitCode: EXIT.usage });

type Saved = { settings: Settings; storage?: boolean };

const R2_STEPS = [
  'Turn on R2 once for the Cloudflare account: https://dash.cloudflare.com/?to=/:account/r2/overview (free up to 10 GB)',
  'helppuff deploy',
];

function print(files: FilesConfig, storage: boolean): void {
  const chat = files.chat === 'off' ? c.dim('off') : files.chat === 'live' ? c.green('on, during live chat') : c.green('on, any time');
  process.stdout.write(`Photos in the chat: ${chat}\n`);
  process.stdout.write(`Files on jobs:      ${files.jobs ? c.green('on') : c.dim('off')}\n`);
  process.stdout.write(`AI sees photos:     ${files.aiSeesPhotos ? `${c.green('on')} ${c.dim(files.visionModel)}` : c.dim('off')}\n`);
  process.stdout.write(c.dim(`Up to ${files.maxChatMb} MB from visitors (${files.perConversation} a chat, kept ${files.keepChatDays} days), ${files.maxJobMb} MB on jobs.\n`));
  if (!storage) process.stdout.write(`${c.yellow('!')} No file storage on this deployment yet: ${R2_STEPS.join(', then ')}.\n`);
}

const number = (value: string | undefined, flag: string): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new CliError('usage', `--${flag} takes a positive number.`, { exitCode: EXIT.usage });
  return n;
};

export async function filesCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['model', 'max-chat-mb', 'max-job-mb', 'per-conversation', 'keep-days'], 'files');
  const [sub = 'status', value] = ctx.positionals;
  const loaded = loadProject(ctx.cwd);
  const api = adminApi(loaded);

  if (sub === 'status') {
    const live = await api.get<{ settings: Settings; storage?: boolean }>('/admin/api/settings');
    if (!live.settings.files) throw new CliError('outdated_worker', 'This Worker is older than files.', { hint: 'helppuff upgrade' });
    const files = live.settings.files;
    const storage = live.storage ?? false;
    ctx.out.result({ files, storage, ...(storage ? {} : { next: R2_STEPS }) }, () => print(files, storage));
    return 0;
  }

  let patch: Partial<FilesConfig>;
  if (sub === 'chat') {
    if (value !== 'live' && value !== 'always' && value !== 'off') {
      if (value === 'on') throw new CliError('usage', 'Say when: `helppuff files chat live` (only while a person has the chat) or `always`.', { exitCode: EXIT.usage });
      throw usage();
    }
    patch = { chat: value };
  } else if (sub === 'jobs') {
    if (value !== 'on' && value !== 'off') throw usage();
    patch = { jobs: value === 'on' };
  } else if (sub === 'ai') {
    if (value !== 'on' && value !== 'off') throw usage();
    const model = str(ctx.flags, 'model');
    patch = { aiSeesPhotos: value === 'on', ...(model ? { visionModel: model } : {}) };
  } else if (sub === 'limits') {
    const limits = {
      maxChatMb: number(str(ctx.flags, 'max-chat-mb'), 'max-chat-mb'),
      maxJobMb: number(str(ctx.flags, 'max-job-mb'), 'max-job-mb'),
      perConversation: number(str(ctx.flags, 'per-conversation'), 'per-conversation'),
      keepChatDays: number(str(ctx.flags, 'keep-days'), 'keep-days'),
    };
    patch = Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined));
    if (!Object.keys(patch).length) throw usage();
  } else {
    throw usage();
  }

  const saved = await api.send<Saved>('PUT', '/admin/api/settings', { settings: { files: patch } });
  if (!saved.settings.files) throw new CliError('outdated_worker', 'This Worker is older than files.', { hint: 'helppuff upgrade' });
  pullSettings(loaded, saved.settings);
  const files = saved.settings.files;
  const storage = saved.storage ?? false;
  const on = files.chat !== 'off' || files.jobs;
  const next = on && !storage ? R2_STEPS : [];
  ctx.out.result({ files, storage, next }, () => {
    ctx.out.success('Saved (live within a minute) and in helppuff.json.');
    print(files, storage);
    if (sub === 'ai' && files.aiSeesPhotos && files.chat !== 'always') {
      process.stdout.write(c.dim('The assistant only reads photos sent to it: `helppuff files chat always`. In live chat the team sees them.\n'));
    }
  });
  return 0;
}
