import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi } from '../engine/admin-api.js';
import { loadProject } from '../engine/project.js';
import type { Ctx } from './context.js';

/**
 * `murmur webhooks` — endpoints that receive the site's events, the same as
 * Settings → Webhooks in the dashboard (stored on the Worker, not in murmur.json).
 *
 *   list
 *   add <url> [--events lead.captured,callback.requested] [--description "…"]
 *   remove <id> | test <id> | enable <id> | disable <id>
 *   events                     every event type and what it means
 */

type Webhook = { id: string; url: string; description: string | null; events: string[]; enabled: boolean; secret: string; lastStatus: string | null; lastError: string | null };
type Listed = { webhooks: Webhook[]; events: { type: string; description: string }[] };

const USAGE = 'Usage: murmur webhooks list | add <url> [--events a,b] [--description …] | remove <id> | test <id> | enable <id> | disable <id> | events';

export async function webhooksCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['events', 'description'], 'webhooks');
  const [sub = 'list', arg] = ctx.positionals;
  const api = adminApi(loadProject(ctx.cwd));
  const need = () => {
    if (!arg) throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
    return arg;
  };

  switch (sub) {
    case 'list': {
      const { webhooks } = await api.get<Listed>('/admin/api/webhooks');
      // The secrets stay out of plain output; --json has them, for the receiver's config.
      ctx.out.result({ webhooks }, () => {
        if (!webhooks.length) process.stdout.write(c.dim('No webhooks. Add one with `murmur webhooks add https://…`.\n'));
        for (const w of webhooks) {
          const state = !w.enabled ? c.dim('off') : w.lastStatus === 'failed' ? c.yellow('failing') : c.green('on');
          process.stdout.write(`${w.id}  ${state}  ${w.url}\n    ${c.dim(w.events.includes('*') ? 'all events' : w.events.join(', '))}${w.lastError ? c.dim(`  — last: ${w.lastError}`) : ''}\n`);
        }
      });
      return 0;
    }
    case 'events': {
      const { events } = await api.get<Listed>('/admin/api/webhooks');
      ctx.out.result({ events }, () => {
        for (const e of events) process.stdout.write(`${e.type.padEnd(26)} ${c.dim(e.description)}\n`);
      });
      return 0;
    }
    case 'add': {
      const events = str(ctx.flags, 'events')?.split(',').map((e) => e.trim()).filter(Boolean);
      const description = str(ctx.flags, 'description');
      const hook = await api.send<Webhook>('POST', '/admin/api/webhooks', { url: need(), ...(events ? { events } : {}), ...(description ? { description } : {}) });
      ctx.out.result(hook, () => {
        ctx.out.success(`Added ${hook.id} → ${hook.url}`);
        process.stdout.write(`Signing secret (give it to the receiver to verify X-Murmur-Signature): ${hook.secret}\n${c.dim(`Try it: murmur webhooks test ${hook.id}`)}\n`);
      });
      return 0;
    }
    case 'remove': {
      const id = need();
      await api.send('DELETE', `/admin/api/webhooks/${encodeURIComponent(id)}`);
      ctx.out.result({ id, removed: true }, () => ctx.out.success(`Removed ${id}.`));
      return 0;
    }
    case 'enable':
    case 'disable': {
      const id = need();
      const hook = await api.send<Webhook>('PATCH', `/admin/api/webhooks/${encodeURIComponent(id)}`, { enabled: sub === 'enable' });
      ctx.out.result(hook, () => ctx.out.success(`${id} is ${hook.enabled ? 'on' : 'off'}.`));
      return 0;
    }
    case 'test': {
      const id = need();
      const result = await api.send<{ ok: boolean; status: number | null; error: string | null; durationMs: number }>('POST', `/admin/api/webhooks/${encodeURIComponent(id)}/test`, {});
      ctx.out.result(result, () =>
        result.ok ? ctx.out.success(`Delivered (HTTP ${result.status}, ${result.durationMs} ms).`) : process.stdout.write(`${c.yellow('Failed:')} ${result.error ?? `HTTP ${result.status}`}\n`),
      );
      return result.ok ? 0 : EXIT.error;
    }
    default:
      throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
  }
}
