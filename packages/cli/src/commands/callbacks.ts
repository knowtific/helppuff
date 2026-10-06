import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi } from '../engine/admin-api.js';
import { loadProject } from '../engine/project.js';
import type { Ctx } from './context.js';

/**
 * `murmur callbacks` — the requests to be called back, the same as the
 * dashboard's Callbacks page.
 *
 *   list [--status open|done|dismissed|all]     waiting ones by default, oldest first
 *   done <id> [--note "…"]  |  dismiss <id> [--note "…"]  |  reopen <id>
 */

type Callback = {
  id: string;
  conversationId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  reason: string | null;
  status: 'open' | 'done' | 'dismissed';
  note: string | null;
  requestedAt: number;
};
type Listed = { items: Callback[]; counts: Record<string, number> };

const USAGE = 'Usage: murmur callbacks list [--status open|done|dismissed|all] | done <id> [--note …] | dismiss <id> [--note …] | reopen <id>';

export async function callbacksCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['status', 'note'], 'callbacks');
  const [sub = 'list', id] = ctx.positionals;
  const api = adminApi(loadProject(ctx.cwd));

  if (sub === 'list') {
    const status = str(ctx.flags, 'status') ?? 'open';
    const listed = await api.get<Listed>('/admin/api/callbacks', { status });
    ctx.out.result(listed, () => {
      if (!listed.items.length) process.stdout.write(c.dim(status === 'open' ? 'Nobody is waiting for a callback.\n' : `No ${status} callbacks.\n`));
      for (const cb of listed.items) {
        const reach = [cb.phone, cb.email].filter(Boolean).join(' · ');
        process.stdout.write(`${cb.id}  ${c.bold(cb.name ?? 'No name')}  ${reach}  ${c.dim(new Date(cb.requestedAt).toLocaleString())}\n`);
        if (cb.reason) process.stdout.write(`    ${c.dim(`“${cb.reason}”`)}\n`);
        if (cb.note) process.stdout.write(`    note: ${cb.note}\n`);
      }
      process.stdout.write(c.dim(`\n${listed.counts['open'] ?? 0} waiting · ${listed.counts['done'] ?? 0} done · ${listed.counts['dismissed'] ?? 0} dismissed\n`));
    });
    return 0;
  }

  const status = sub === 'done' ? 'done' : sub === 'dismiss' ? 'dismissed' : sub === 'reopen' ? 'open' : null;
  if (!status || !id) throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
  const note = str(ctx.flags, 'note');
  const updated = await api.send<Callback>('PATCH', `/admin/api/callbacks/${encodeURIComponent(id)}`, { status, ...(note !== undefined ? { note } : {}) });
  ctx.out.result(updated, () => ctx.out.success(`${updated.name ?? updated.id}: ${status === 'open' ? 'waiting again' : status}.`));
  return 0;
}
