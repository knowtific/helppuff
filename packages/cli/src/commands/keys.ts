import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi, ADMIN_KEY_ALIAS, ADMIN_KEY_ENV } from '../engine/admin-api.js';
import { loadEnv, writeEnvVar } from '../engine/env.js';
import { loadProject } from '../engine/project.js';
import type { Ctx } from './context.js';

/**
 * `helppuff keys` — API keys for the public API (`/api/v1`), the same as
 * Settings → API keys in the dashboard.
 *
 *   list
 *   create <name> [--preset chat|crm|read|full | --scopes a,b] [--expires <days>] [--allow-ips a,b] [--rate <n>] [--save NAME]
 *   revoke <id>
 */

type KeyView = { id: string; name: string; prefix: string; scopes: string[]; allowIps: string[]; ratePerMinute: number; createdBy: string | null; createdAt: number; expiresAt: number | null; lastUsedAt: number | null; revokedAt: number | null };

const USAGE = 'Usage: helppuff keys list | create <name> [--preset chat|crm|read|full | --scopes a,b] [--expires <days>] [--allow-ips a,b] [--rate <n>] [--save NAME] | revoke <id>';
const day = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'never');

export async function keysCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['preset', 'scopes', 'expires', 'allow-ips', 'rate', 'save'], 'keys');
  const [sub = 'list', arg] = ctx.positionals;
  const loaded = loadProject(ctx.cwd);
  const api = adminApi(loaded);

  switch (sub) {
    case 'list': {
      const { keys } = await api.get<{ keys: KeyView[] }>('/admin/api/keys');
      ctx.out.result({ keys }, () => {
        if (!keys.length) process.stdout.write(c.dim('No API keys. Make one with `helppuff keys create "My backend" --preset chat`.\n'));
        for (const k of keys) {
          const state = k.revokedAt ? c.dim('revoked') : k.expiresAt && k.expiresAt < Date.now() ? c.yellow('expired') : c.green('active');
          process.stdout.write(`${k.prefix}…  ${state}  ${k.name}\n    ${c.dim(`${k.scopes.join(', ')} · ${k.ratePerMinute}/min · expires ${day(k.expiresAt)} · last used ${day(k.lastUsedAt)}`)}\n`);
        }
      });
      return 0;
    }
    case 'create': {
      if (!arg) {
        return ctx.out.needsInput({
          questions: [{ ask: 'A name for the key (what uses it)', flag: 'keys create <name>' }, { ask: 'What it may do', flag: '--preset', options: [{ value: 'chat' }, { value: 'crm' }, { value: 'read' }, { value: 'full' }] }],
        });
      }
      const scopes = str(ctx.flags, 'scopes')?.split(',').map((s) => s.trim()).filter(Boolean);
      const preset = str(ctx.flags, 'preset');
      if (!scopes && !preset) throw new CliError('usage', 'Say what the key may do: --preset chat|crm|read|full, or --scopes chat,leads:read.', { exitCode: EXIT.usage });
      const expires = str(ctx.flags, 'expires');
      const rate = str(ctx.flags, 'rate');
      const allowIps = str(ctx.flags, 'allow-ips')?.split(',').map((s) => s.trim()).filter(Boolean);
      const made = await api.send<KeyView & { key: string }>('POST', '/admin/api/keys', {
        name: arg,
        ...(scopes ? { scopes } : { preset }),
        ...(expires ? { expiresInDays: Number(expires) } : {}),
        ...(rate ? { ratePerMinute: Number(rate) } : {}),
        ...(allowIps ? { allowIps } : {}),
      });
      const save = str(ctx.flags, 'save');
      if (save) {
        // Kept in .env (gitignored) instead of the output, so it never lands in a terminal log or an agent's transcript.
        writeEnvVar(loaded.dir, save, made.key);
        const { key: _key, ...rest } = made;
        ctx.out.result({ ...rest, savedAs: save }, () => ctx.out.success(`Made ${made.prefix}… (${made.scopes.join(', ')}) and saved it in .env as ${save}.`));
        return 0;
      }
      ctx.out.result(made, () => {
        ctx.out.success(`Made ${made.name} (${made.scopes.join(', ')}).`);
        process.stdout.write(`\n  ${made.key}\n\n${c.yellow('Shown once.')} Store it in your secrets manager; it cannot be shown again.\n`);
      });
      return 0;
    }
    case 'revoke': {
      if (!arg) throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
      const revoked = await api.send<KeyView>('DELETE', `/admin/api/keys/${encodeURIComponent(arg)}`);
      ctx.out.result(revoked, () => ctx.out.success(`Revoked ${revoked.prefix}… — refused everywhere within 30 seconds.`));
      return 0;
    }
    default:
      throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
  }
}

/**
 * `helppuff api <METHOD> <path> [--data '{…}' | --data @file.json]` — call any
 * public API endpoint (`/api/v1`) with this project's admin key. The quickest
 * way for an agent to use something the CLI has no command for.
 */
export async function apiCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['data'], 'api');
  const [rawMethod, rawPath] = ctx.positionals;
  const method = rawMethod?.toUpperCase();
  if (!method || !rawPath || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new CliError('usage', 'Usage: helppuff api <GET|POST|PUT|PATCH|DELETE> <path> [--data \'{…}\' | --data @file.json]', { exitCode: EXIT.usage });
  }
  const loaded = loadProject(ctx.cwd);
  const url = loaded.project.cloudflare.url?.replace(/\/$/, '');
  if (!url) throw new CliError('not_deployed', 'This assistant has not been deployed yet.', { hint: 'helppuff deploy' });
  const env = loadEnv(loaded.dir);
  const key = env[ADMIN_KEY_ENV] || env[ADMIN_KEY_ALIAS];
  if (!key) throw new CliError('no_admin_key', `No ${ADMIN_KEY_ENV} in .env.`, { hint: '`helppuff deploy` generates it.', exitCode: EXIT.auth });
  const data = str(ctx.flags, 'data');
  const body = data === undefined ? undefined : data.startsWith('@') ? readFileSync(resolve(ctx.cwd, data.slice(1)), 'utf8') : data;
  if (body !== undefined) {
    try {
      JSON.parse(body);
    } catch {
      throw new CliError('usage', '--data must be JSON (or @file.json).', { exitCode: EXIT.usage });
    }
  }
  const path = rawPath.replace(/^\/?(api\/v1)?\/?/, '/');
  let response: Response;
  try {
    response = await fetch(`${url}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body } : {}),
    });
  } catch (thrown) {
    throw new CliError('network', `Could not reach ${url}: ${(thrown as Error).message}`, { hint: 'Check the address, or run `helppuff doctor`.' });
  }
  const text = await response.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // CSV and other text stay text.
  }
  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new CliError(error?.code ?? 'api_error', error?.message ?? `HTTP ${response.status}`, { details: { status: response.status, path }, exitCode: response.status === 401 ? EXIT.auth : EXIT.error });
  }
  if (ctx.out.json) process.stdout.write(`${JSON.stringify({ ok: true, status: response.status, body: json }, null, 2)}\n`);
  else process.stdout.write(typeof json === 'string' ? json : `${JSON.stringify(json, null, 2)}\n`);
  return 0;
}
