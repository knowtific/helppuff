import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import type { ToolHeader } from '@helppuff/protocol/tools';
import { adminApi } from '../engine/admin-api.js';
import { loadEnv } from '../engine/env.js';
import { loadProject } from '../engine/project.js';
import type { Ctx } from './context.js';
import { headerFlags, mergeHeaders } from './request-flags.js';

/**
 * `helppuff webhooks` — endpoints that receive the site's events, the same as
 * Settings → Webhooks in the dashboard (stored on the Worker, not in helppuff.json).
 *
 *   list
 *   add <url> [--events lead.captured,callback.requested] [--description "…"]
 *       [--method POST] [--header 'Name: value'] [--body '{"text": "{{data.name}}"}']
 *   set <id> [--url …] [--events …] [the same request flags] [--format helppuff|custom]
 *   remove <id> | test <id> | enable <id> | disable <id>
 *
 * A request flag makes it a custom webhook: your own request (for a service
 * with its own format) instead of the signed envelope. `${NAME}` in a header
 * is read from .env; credential headers are stored encrypted.
 *   events                     every event type and what it means
 */

type Webhook = { id: string; url: string; description: string | null; events: string[]; enabled: boolean; secret: string; lastStatus: string | null; lastError: string | null; format?: 'helppuff' | 'custom'; method?: string; headers?: (ToolHeader & { set?: boolean })[]; body?: string };
type Listed = { webhooks: Webhook[]; events: { type: string; description: string }[] };

const USAGE =
  "Usage: helppuff webhooks list | add <url> [--events a,b] [--description …] [--method POST] [--header 'Name: value'] [--body '…'] | set <id> [--url …] [the same flags] [--format helppuff|custom] | remove <id> | test <id> | enable <id> | disable <id> | events";

/** What the flags change; a request flag makes it custom. */
function fromFlags(ctx: Ctx, current: Webhook | null): { body: Record<string, unknown>; missing: string[] } {
  const f = ctx.flags;
  const body: Record<string, unknown> = {};
  const events = str(f, 'events')?.split(',').map((e) => e.trim()).filter(Boolean);
  if (events) body['events'] = events;
  const description = str(f, 'description');
  if (description) body['description'] = description;
  const url = str(f, 'url');
  if (url) body['url'] = url;
  const missing = new Set<string>();
  const given = headerFlags(f['header']);
  const method = str(f, 'method');
  if (given.length || method || typeof f['body'] === 'string') body['format'] = 'custom';
  if (method) body['method'] = method.toUpperCase();
  if (typeof f['body'] === 'string') body['body'] = f['body'];
  if (given.length) body['headers'] = mergeHeaders(current?.headers ?? [], given, loadEnv(ctx.cwd), missing);
  const format = str(f, 'format');
  if (format) {
    if (format !== 'helppuff' && format !== 'custom') throw new CliError('usage', '--format is helppuff (the signed envelope) or custom (your own request).', { exitCode: EXIT.usage });
    body['format'] = format;
  }
  return { body, missing: [...missing] };
}

export async function webhooksCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['events', 'description', 'url', 'method', 'header', 'body', 'format'], 'webhooks');
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
        if (!webhooks.length) process.stdout.write(c.dim('No webhooks. Add one with `helppuff webhooks add https://…`.\n'));
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
    case 'add':
    case 'set': {
      const id = need();
      const current = sub === 'set' ? (await api.get<Listed>('/admin/api/webhooks')).webhooks.find((w) => w.id === id) : null;
      if (sub === 'set' && !current) throw new CliError('not_found', `No webhook ${id}.`, { hint: 'helppuff webhooks list', exitCode: EXIT.usage });
      const { body, missing } = fromFlags(ctx, current ?? null);
      if (missing.length) {
        return ctx.out.needsInput({
          message: `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not in .env yet: nothing was saved.`,
          questions: missing.map((name) => ({ id: name, ask: `The value of ${name}. The user stores it with \`helppuff secret set ${name}\`; never paste it into a chat.`, flag: `secret set ${name}`, kind: 'secret', required: true, envVar: name })),
        });
      }
      if (sub === 'set') {
        const hook = await api.send<Webhook>('PATCH', `/admin/api/webhooks/${encodeURIComponent(id)}`, body);
        ctx.out.result(hook, () => ctx.out.success(`Changed ${hook.id}${hook.format === 'custom' ? ' (your own request)' : ''}.`));
        return 0;
      }
      const hook = await api.send<Webhook>('POST', '/admin/api/webhooks', { ...body, url: id });
      ctx.out.result(hook, () => {
        ctx.out.success(`Added ${hook.id} → ${hook.url}`);
        process.stdout.write(`Signing secret (give it to the receiver to verify X-HelpPuff-Signature): ${hook.secret}\n${c.dim(`Try it: helppuff webhooks test ${hook.id}`)}\n`);
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
