import * as p from '@clack/prompts';
import { assertKnown, str } from '../args.js';
import { CliError } from '../errors.js';
import { c } from '../output.js';
import { generatePassword, hashPassword, requireDashboardDb, setOwnerPassword, validatePassword, waitForSignIn } from '../engine/admins.js';
import { dashboardUrl } from '../engine/compile.js';
import { cloudflareSession } from '../engine/credentials.js';
import { loadEnv } from '../engine/env.js';
import { loadProject } from '../engine/project.js';
import { adminApi } from '../engine/admin-api.js';
import { openBrowser } from '../engine/browser.js';
import type { Ctx } from './context.js';

/**
 * `helppuff users` — who can sign in to the dashboard.
 *
 *   add <email> [--password p] [--role admin|member]   a teammate (password generated if omitted)
 *   role <email> admin|member      what they can do: members see the inbox only
 *   remove <email>
 *   reset <email> [--password p]   a new password, for the owner or a teammate
 *   list
 */

async function passwordFor(ctx: Ctx): Promise<{ password: string; generated: boolean }> {
  const given = str(ctx.flags, 'password');
  if (given) {
    validatePassword(given);
    return { password: given, generated: false };
  }
  if (ctx.interactive) {
    const typed = await p.password({ message: 'New password (Enter to generate one)', mask: '•' });
    if (p.isCancel(typed)) process.exit(130);
    if (typed) {
      validatePassword(String(typed));
      return { password: String(typed), generated: false };
    }
  }
  return { password: generatePassword(), generated: true };
}

export async function usersCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['password', 'role'], 'users');
  const [sub, rawEmail, rawRole] = ctx.positionals;
  const email = rawEmail?.trim().toLowerCase();
  const loaded = loadProject(ctx.cwd);
  const owner = loaded.project.dashboard.adminEmail?.toLowerCase();
  const env = loadEnv(loaded.dir);

  if (sub === 'reset' && email && email === owner) {
    const cf = loaded.project.cloudflare.url ? await cloudflareSession(env).catch(() => null) : null;
    const { password, generated } = await passwordFor(ctx);
    const live = await setOwnerPassword(loaded, password, cf);
    let active = false;
    if (live && loaded.project.cloudflare.url) {
      ctx.out.progress('Waiting for the new password to reach every Cloudflare location…');
      active = await waitForSignIn(loaded.project.cloudflare.url, email, password, loadEnv(loaded.dir)['HELPPUFF_SECRET']);
    }
    ctx.out.result({ email, updated: live ? 'worker and .env' : '.env (deploy to publish)', active, ...(generated ? { password } : {}) }, () => {
      ctx.out.success(
        `Password for ${email} ${live ? (active ? 'changed — sign in now' : 'changed; it can take a minute to apply everywhere') : 'saved; run `helppuff deploy` to publish it'}.`,
      );
      if (generated) ctx.out.info(`  New password: ${c.bold(password)}  ${c.dim('(shown once)')}`);
    });
    return 0;
  }

  const databaseId = requireDashboardDb(loaded);
  const cf = await cloudflareSession(env);
  const query = (sql: string, params: unknown[] = []) => cf.api.d1Query(cf.accountId, databaseId, sql, params);

  switch (sub) {
    case 'list': {
      const rows = await query("SELECT email, COALESCE(role, 'admin') AS role, created_at, last_login_at FROM admins ORDER BY created_at");
      const users = [
        ...(owner ? [{ email: owner, role: 'owner', lastLoginAt: null }] : []),
        ...rows.map((r) => ({ email: String(r['email']), role: String(r['role']), lastLoginAt: r['last_login_at'] ?? null })),
      ];
      ctx.out.result({ users, dashboard: loaded.project.cloudflare.url ? dashboardUrl(loaded.project.cloudflare.url) : null }, () => {
        for (const user of users) process.stdout.write(`${user.email.padEnd(36)} ${c.dim(user.role)}\n`);
      });
      return 0;
    }
    case 'add':
    case 'reset': {
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new CliError('usage', `Usage: helppuff users ${sub} <email> [--password <p>]`, { exitCode: 2 });
      }
      if (email === owner) throw new CliError('usage', `${email} is the owner; use \`helppuff users reset ${email}\`.`, { exitCode: 2 });
      const exists = (await query('SELECT email FROM admins WHERE email = ?', [email])).length > 0;
      if (sub === 'add' && exists) throw new CliError('user_exists', `${email} can already sign in.`, { hint: `helppuff users reset ${email}` });
      if (sub === 'reset' && !exists) throw new CliError('no_user', `${email} is not a dashboard user.`, { hint: `helppuff users add ${email}` });
      const role = str(ctx.flags, 'role') ?? 'admin';
      if (role !== 'admin' && role !== 'member') throw new CliError('usage', '--role is admin (everything) or member (conversations, jobs, contacts, callbacks, live chat).', { exitCode: 2 });
      const { password, generated } = await passwordFor(ctx);
      if (sub === 'add') {
        await query('INSERT INTO admins (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)', [email, hashPassword(password), role, Date.now()]);
      } else {
        await query('UPDATE admins SET password_hash = ? WHERE email = ?', [hashPassword(password), email]);
      }
      ctx.out.result({ email, action: sub === 'add' ? 'added' : 'reset', ...(sub === 'add' ? { role } : {}), ...(generated ? { password } : {}) }, () => {
        ctx.out.success(`${email} ${sub === 'add' ? `can now sign in, as ${role === 'member' ? 'a member' : 'an admin'}` : 'has a new password'}.`);
        if (generated) ctx.out.info(`  Password: ${c.bold(password)}  ${c.dim('(shown once — share it privately)')}`);
      });
      return 0;
    }
    case 'role': {
      if (!email || (rawRole !== 'admin' && rawRole !== 'member')) throw new CliError('usage', 'Usage: helppuff users role <email> admin|member', { exitCode: 2 });
      if (email === owner) throw new CliError('usage', 'The owner always has full access.', { exitCode: 2 });
      if (!(await query('SELECT email FROM admins WHERE email = ?', [email])).length) throw new CliError('no_user', `${email} is not a dashboard user.`, { hint: `helppuff users add ${email} --role ${rawRole}` });
      await query('UPDATE admins SET role = ? WHERE email = ?', [rawRole, email]);
      ctx.out.result({ email, role: rawRole }, () => ctx.out.success(`${email} is now ${rawRole === 'member' ? 'a member (the inbox only)' : 'an admin'}.`));
      return 0;
    }
    case 'remove': {
      if (!email) throw new CliError('usage', 'Usage: helppuff users remove <email>', { exitCode: 2 });
      if (email === owner) throw new CliError('usage', 'The owner cannot be removed; change dashboard.adminEmail instead.', { exitCode: 2 });
      await query('DELETE FROM admins WHERE email = ?', [email]);
      ctx.out.result({ email, action: 'removed' }, () => ctx.out.success(`${email} can no longer sign in.`));
      return 0;
    }
    default:
      throw new CliError('usage', 'Usage: helppuff users list | add <email> [--role admin|member] | role <email> admin|member | remove <email> | reset <email>', { exitCode: 2 });
  }
}

/**
 * `helppuff dashboard` — a one-time sign-in link (15 minutes), or the setup
 * link when nobody has claimed the dashboard yet. The recovery path for a
 * lost password: whoever holds the project's admin key can always get in.
 */
export async function dashboardCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['email', 'browser'], 'dashboard');
  const loaded = loadProject(ctx.cwd);
  if (!loaded.project.dashboard.enabled) throw new CliError('dashboard_disabled', 'The dashboard is turned off in helppuff.json.');
  const url = loaded.project.cloudflare.url;
  if (!url) throw new CliError('not_deployed', 'Deploy first to get a dashboard.', { hint: 'helppuff deploy' });
  const dashboard = dashboardUrl(url);
  if (loadEnv(loaded.dir)['ADMIN_API_KEY']) {
    const api = adminApi(loaded);
    const email = str(ctx.flags, 'email');
    let link: { url: string; kind: string; email: string | null; expiresAt: number };
    try {
      link = await api.send('POST', '/admin/api/links', { kind: 'login', ...(email ? { email } : {}) });
    } catch (thrown) {
      if (!(thrown instanceof CliError) || !/setup link|no accounts/i.test(thrown.message)) throw thrown;
      link = await api.send('POST', '/admin/api/links', { kind: 'setup' });
    }
    if (ctx.interactive && ctx.flags['browser'] !== false) openBrowser(link.url);
    ctx.out.result({ dashboard, link: link.url, kind: link.kind, email: link.email, expiresAt: link.expiresAt }, () => {
      process.stdout.write(`${c.cyan(link.url)}\n`);
      process.stdout.write(
        c.dim(
          link.kind === 'setup'
            ? 'Opens the setup page, where you create the first dashboard account. Valid 24 hours, once.\n'
            : `Signs ${link.email} in once, within 15 minutes. Do not share it.\n`,
        ),
      );
    });
    return 0;
  }
  ctx.out.result({ dashboard, email: loaded.project.dashboard.adminEmail ?? null }, () => {
    process.stdout.write(`${dashboard}\n${c.dim(`Sign in as ${loaded.project.dashboard.adminEmail ?? '(no admin set)'}.`)}\n`);
  });
  return 0;
}
