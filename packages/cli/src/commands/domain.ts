import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { embedSnippet, dashboardUrl } from '../engine/compile.js';
import { cloudflareSession } from '../engine/credentials.js';
import { attachDomain, domainAnswers, normalizeHostname } from '../engine/domain.js';
import { loadEnv } from '../engine/env.js';
import { dashboardEnabled, loadProject, updateProject, workerNameFor } from '../engine/project.js';
import { confirmDelete } from './confirm.js';
import type { Ctx } from './context.js';

const USAGE = 'Usage: helppuff domain [status] | add <hostname> | remove [<hostname>]';

/** Up to `seconds` for a new domain to answer: its certificate is usually issued within a minute or two. */
async function waitForDomain(hostname: string, seconds: number): Promise<boolean> {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    if (await domainAnswers(hostname)) return true;
    if (Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

/**
 * `helppuff domain` — a custom domain for the assistant (`chat.acme.com`),
 * through Workers Custom Domains (`engine/domain.ts`). CLI only: it needs the
 * Cloudflare login, which the Worker does not have.
 */
export async function domainCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['cf-account', 'account-id', 'cf-token', 'wait'], 'domain');
  const [sub = 'status', arg] = ctx.positionals;
  let loaded = loadProject(ctx.cwd);
  const workerUrl = loaded.project.cloudflare.url;
  if (!workerUrl) throw new CliError('not_deployed', 'Deploy first: the domain points at the deployed Worker.', { hint: 'helppuff deploy' });
  const worker = workerNameFor(loaded.project);
  const accountId = str(ctx.flags, 'cf-account') ?? str(ctx.flags, 'account-id') ?? loaded.project.cloudflare.accountId;
  const cf = await cloudflareSession(loadEnv(loaded.dir), { token: str(ctx.flags, 'cf-token'), accountId });

  switch (sub) {
    case 'status':
    case 'list': {
      const attached = await cf.api.workerDomains(cf.accountId, worker);
      const domain = loaded.project.cloudflare.domain ?? null;
      const live = domain ? await domainAnswers(domain) : null;
      const missing = Boolean(domain && !attached.some((d) => d.hostname === domain));
      ctx.out.result({ workerUrl, domain, attached: attached.map((d) => d.hostname), answers: live, missing }, () => {
        process.stdout.write(`workers.dev  ${workerUrl}\n`);
        if (!domain) {
          process.stdout.write(`domain       ${c.dim('none')}  (helppuff domain add chat.yourdomain.com)\n`);
          return;
        }
        process.stdout.write(`domain       https://${domain}  ${missing ? c.red('not attached: run helppuff domain add ' + domain) : live ? c.green('answers') : c.yellow('attached, not answering yet (the certificate can take a few minutes)')}\n`);
        const others = attached.filter((d) => d.hostname !== domain);
        if (others.length) process.stdout.write(`also         ${others.map((d) => d.hostname).join(', ')}\n`);
      });
      return missing ? EXIT.error : EXIT.ok;
    }

    case 'add': {
      if (!arg) throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
      const hostname = normalizeHostname(arg);
      const previous = loaded.project.cloudflare.domain;
      ctx.out.progress(`Pointing ${hostname} at ${worker}…`);
      await attachDomain(cf.api, cf.accountId, worker, hostname);
      loaded = updateProject(loaded, (raw) => {
        const cloudflare = (raw['cloudflare'] ?? {}) as Record<string, unknown>;
        cloudflare['domain'] = hostname;
        raw['cloudflare'] = cloudflare;
      });
      const seconds = Number(str(ctx.flags, 'wait') ?? (ctx.out.json ? '0' : '60'));
      if (seconds > 0) ctx.out.progress(`Waiting up to ${seconds}s for ${hostname} to answer…`);
      const answers = seconds > 0 ? await waitForDomain(hostname, Math.min(Math.max(seconds, 0), 600)) : await domainAnswers(hostname);
      const url = `https://${hostname}`;
      const result = {
        domain: hostname,
        url,
        answers,
        replaced: previous && previous !== hostname ? previous : null,
        embed: embedSnippet(url, loaded.project.site),
        dashboard: dashboardEnabled(loaded.project) ? dashboardUrl(url) : null,
      };
      ctx.out.result(result, () => {
        ctx.out.success(`${hostname} points at the assistant.${answers ? '' : ' Cloudflare is issuing its certificate; it usually answers within a few minutes (`helppuff domain` checks).'}`);
        process.stdout.write(`\nPut this on your site (the workers.dev script keeps working too):\n  ${result.embed}\n`);
        if (result.dashboard) process.stdout.write(`Dashboard: ${result.dashboard}\n`);
        if (result.replaced) process.stdout.write(c.dim(`${result.replaced} is still attached; \`helppuff domain remove ${result.replaced}\` detaches it.\n`));
      });
      return EXIT.ok;
    }

    case 'remove': {
      const hostname = arg ? normalizeHostname(arg) : loaded.project.cloudflare.domain;
      if (!hostname) throw new CliError('usage', 'There is no custom domain to remove.', { hint: 'helppuff domain', exitCode: EXIT.usage });
      const attached = (await cf.api.workerDomains(cf.accountId, worker)).find((d) => d.hostname === hostname);
      if (!(await confirmDelete(ctx, `Detach ${hostname} from the assistant?`, `Pages that load the widget from ${hostname} lose it until they use the workers.dev script (helppuff embed).`))) return 1;
      if (attached) await cf.api.detachWorkerDomain(cf.accountId, attached.id);
      if (loaded.project.cloudflare.domain === hostname) {
        loaded = updateProject(loaded, (raw) => {
          delete ((raw['cloudflare'] ?? {}) as Record<string, unknown>)['domain'];
        });
      }
      ctx.out.result({ domain: hostname, removed: true, embed: embedSnippet(workerUrl, loaded.project.site) }, () => {
        ctx.out.success(`Detached ${hostname}. The assistant answers on ${workerUrl}.`);
        process.stdout.write(c.dim('Its certificate stays in Cloudflare (SSL/TLS → Edge Certificates) until you delete it there.\n'));
      });
      return EXIT.ok;
    }

    default:
      throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
  }
}
