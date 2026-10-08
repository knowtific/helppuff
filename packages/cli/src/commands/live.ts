import * as p from '@clack/prompts';
import { assertKnown, bool, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi } from '../engine/admin-api.js';
import { loadProject } from '../engine/project.js';
import type { Settings } from '@helppuff/server';
import { pullSettings } from './manage.js';
import type { Ctx } from './context.js';

/**
 * `helppuff live` — live chat: visitors can talk to a person on the team.
 *
 *   on [--wait <s>] [--close-after <min>] [--names | --no-names]
 *   off
 *   status        on or off, who can take chats, how many are waiting
 *
 * `helppuff telegram` — answer live chats from Telegram.
 *
 *   connect [--token <t>]   the bot token from @BotFather (an agent cannot make the bot)
 *   status | test | disconnect
 *
 * Both go through the admin API, like the dashboard: a change is live within
 * a minute and pulled into helppuff.json, so the next deploy keeps it.
 */

type LiveStatus = {
  enabled: boolean;
  hub: boolean;
  available: number;
  agents: { email: string; name: string | null; available: boolean }[];
  telegram: { connected: boolean; linked: boolean };
  live: number;
  unassigned: number;
  waiting: number;
};
type Telegram = { connected: boolean; linked: boolean; bot: { name: string; username: string } | null; chat: { title: string | null; topics: boolean } | null; linkCode: string | null; lastError: string | null };

const LIVE_USAGE = 'Usage: helppuff live on [--wait <seconds>] [--close-after <minutes>] [--names|--no-names] | off | status';
const TELEGRAM_USAGE = 'Usage: helppuff telegram connect [--token <bot token>] | status | test | disconnect';

export async function liveCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['wait', 'close-after', 'names'], 'live');
  const [sub = 'status'] = ctx.positionals;
  const loaded = loadProject(ctx.cwd);
  const api = adminApi(loaded);

  if (sub === 'status') {
    const status = await api.get<LiveStatus>('/admin/api/live/status');
    ctx.out.result(status, () => {
      process.stdout.write(`Live chat: ${status.enabled ? c.green('on') : c.dim('off')}\n`);
      if (!status.enabled) return void process.stdout.write(c.dim('Turn it on with `helppuff live on`.\n'));
      if (!status.hub) process.stdout.write(`${c.yellow('!')} This Worker has no live chat hub yet: run ${c.cyan('helppuff upgrade')}.\n`);
      const people = status.agents.filter((a) => a.available).map((a) => a.name ?? a.email);
      process.stdout.write(`Available now: ${people.length ? people.join(', ') : c.dim('nobody in the dashboard')}${status.telegram.linked ? ' + Telegram' : ''}\n`);
      process.stdout.write(`Live chats: ${status.live} (${status.unassigned} not taken, ${status.waiting} waiting for a reply)\n`);
      if (!people.length && !status.telegram.linked) {
        process.stdout.write(c.dim('Nobody can take chats: open the dashboard and switch to Available, or `helppuff telegram connect`. Until then visitors get the callback form.\n'));
      }
    });
    return 0;
  }
  if (sub !== 'on' && sub !== 'off') throw new CliError('usage', LIVE_USAGE, { exitCode: EXIT.usage });

  const wait = str(ctx.flags, 'wait');
  const closeAfter = str(ctx.flags, 'close-after');
  const names = bool(ctx.flags, 'names');
  const live = {
    enabled: sub === 'on',
    ...(wait ? { waitSeconds: Number(wait) } : {}),
    ...(closeAfter ? { closeAfterMinutes: Number(closeAfter) } : {}),
    ...(names === undefined ? {} : { showAgentName: names }),
  };
  const saved = await api.send<{ settings: Settings }>('PUT', '/admin/api/settings', { settings: { live } });
  if (!saved.settings.live) throw new CliError('outdated_worker', 'This Worker is older than live chat.', { hint: 'helppuff upgrade' });
  pullSettings(loaded, saved.settings);
  ctx.out.result({ live: saved.settings.live, next: sub === 'on' ? ['Open the dashboard and switch to Available', 'helppuff telegram connect'] : [] }, () => {
    ctx.out.success(`Live chat is ${sub === 'on' ? 'on' : 'off'} (within a minute), and saved in helppuff.json.`);
    if (sub === 'on') {
      process.stdout.write(
        c.dim('Someone must be able to take chats: open the dashboard (switch to Available, bottom of the menu), or connect Telegram with `helppuff telegram connect`.\n'),
      );
    }
  });
  return 0;
}

async function readToken(ctx: Ctx): Promise<string | null> {
  const given = str(ctx.flags, 'token');
  if (given) return given.trim();
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const piped = Buffer.concat(chunks).toString('utf8').trim();
    if (piped) return piped;
  }
  if (ctx.interactive) {
    const typed = await p.password({ message: 'Bot token from @BotFather', mask: '•' });
    if (p.isCancel(typed)) process.exit(130);
    return String(typed).trim() || null;
  }
  return null;
}

function printTelegram(t: Telegram): void {
  if (!t.connected) return void process.stdout.write(c.dim('Telegram is not connected. `helppuff telegram connect`\n'));
  process.stdout.write(`Bot: ${t.bot?.name} (@${t.bot?.username})\n`);
  if (t.linked) process.stdout.write(`Chat: ${t.chat?.title}${t.chat?.topics ? ' · one thread per chat' : ' · reply to a chat’s message to answer'}\n`);
  else {
    process.stdout.write(
      `Not linked yet. Add the bot to your team's group (Topics on, the bot an admin with "Manage topics"), or open a private chat with it, and send:\n  ${c.cyan(`/link ${t.linkCode}`)}\n`,
    );
  }
  if (t.lastError) process.stdout.write(`${c.yellow('Last error:')} ${t.lastError}\n`);
}

export async function telegramCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['token'], 'telegram');
  const [sub = 'status'] = ctx.positionals;
  const api = adminApi(loadProject(ctx.cwd));
  switch (sub) {
    case 'status': {
      const t = await api.get<Telegram>('/admin/api/live/telegram');
      ctx.out.result(t, () => printTelegram(t));
      return 0;
    }
    case 'connect': {
      const token = await readToken(ctx);
      if (!token) {
        return ctx.out.needsInput({
          questions: [{ ask: 'The bot token: in Telegram, message @BotFather, send /newbot, and copy the token (the person has to do this; an agent cannot)', flag: '--token' }],
        });
      }
      const t = await api.send<Telegram>('POST', '/admin/api/live/telegram', { token });
      ctx.out.result({ ...t, next: t.linkCode ? [`Send /link ${t.linkCode} in the Telegram chat to answer from`, 'helppuff telegram status'] : [] }, () => {
        ctx.out.success(`Connected ${t.bot?.name} (@${t.bot?.username}).`);
        printTelegram(t);
      });
      return 0;
    }
    case 'test': {
      await api.send('POST', '/admin/api/live/telegram/test', {});
      ctx.out.result({ sent: true }, () => ctx.out.success('Sent a test message. Check Telegram.'));
      return 0;
    }
    case 'disconnect': {
      await api.send('DELETE', '/admin/api/live/telegram');
      ctx.out.result({ connected: false }, () => ctx.out.success('Telegram disconnected. Live chats reach the dashboard only.'));
      return 0;
    }
    default:
      throw new CliError('usage', TELEGRAM_USAGE, { exitCode: EXIT.usage });
  }
}
