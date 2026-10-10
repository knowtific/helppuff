import { assertKnown } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi } from '../engine/admin-api.js';
import { loadProject } from '../engine/project.js';
import type { Ctx } from './context.js';

/**
 * `helppuff identity`: the site's identity secret, for signing logged-in
 * visitors in (the dashboard's Settings → Lead form → Signed-in visitors).
 * `rotate` makes a new one; tokens signed with the old one stop working.
 */
const USAGE = 'Usage: helppuff identity [rotate]';

export async function identityCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, [], 'identity');
  const [sub] = ctx.positionals;
  if (sub && sub !== 'rotate') throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
  const api = adminApi(loadProject(ctx.cwd));
  const result = sub === 'rotate' ? await api.send<{ site: string; version: number; secret: string }>('POST', '/admin/api/identity/rotate', {}) : await api.get<{ site: string; version: number; secret: string }>('/admin/api/identity');
  ctx.out.result(result, () => {
    if (sub === 'rotate') ctx.out.success(`New secret (version ${result.version}). Tokens signed with the old one no longer work: update your server.`);
    process.stdout.write(`${result.secret}\n`);
    process.stdout.write(
      c.dim(
        "\nSign who is logged in on your server (HS256, sub = your user id, exp at most a week), then on the page:\n  HelpPuff.identify({ name, email, token })\nKeep the secret on your server, e.g. as HELPPUFF_IDENTITY_SECRET.\n",
      ),
    );
  });
  return 0;
}
