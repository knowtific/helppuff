import { EMAIL_PRESETS } from '@helppuff/protocol/notifications';
import type { ToolHeader } from '@helppuff/protocol/tools';
import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi } from '../engine/admin-api.js';
import { loadEnv } from '../engine/env.js';
import { loadProject } from '../engine/project.js';
import type { Ctx } from './context.js';
import { expand, headerFlags, mergeHeaders } from './request-flags.js';
import { confirmDelete } from './confirm.js';
import { cloudflareSession } from '../engine/credentials.js';
import { deploy } from '../engine/deploy.js';
import { normalizeSubdomain, removeReplies, repliesState, setUpReplies, suggestSubdomain, SUBADDRESSING_PATH } from '../engine/email-replies.js';
import { updateProject, workerNameFor, type LoadedProject } from '../engine/project.js';
import { readState, writeState } from '../engine/state.js';
import type { AdminApi } from '../engine/admin-api.js';

/**
 * `helppuff email` — the email service that sends the team's notifications,
 * the same as Settings → Notifications in the dashboard (stored on the
 * Worker). One request for any service with a send API; HelpPuff fills in
 * {{email.to}}, {{email.subject}}, {{email.text}} and {{email.html}}.
 * Who gets which email is each person's choice, in the dashboard.
 *
 *   show
 *   set --preset resend|postmark|sendgrid|brevo --from you@yourdomain.com --key '${RESEND_API_KEY}'
 *   set --url https://… [--method POST] [--header 'Name: value'] [--body '…']
 *   set --cloudflare --from hello@chat.yourdomain.com   (Cloudflare Email Service)
 *   test [--to someone@example.com]
 *   pause | resume | remove
 *   replies on <subdomain> | status | test | off   (customers answer by email)
 */

type Service = {
  kind?: 'request' | 'cloudflare';
  from?: string | null;
  method: string;
  url: string;
  headers: (ToolHeader & { set?: boolean })[];
  body: string;
  enabled: boolean;
  dashboardUrl: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

const USAGE = `Usage: helppuff email show | set --preset ${EMAIL_PRESETS.map((p) => p.id).join('|')} --from <address> --key '\${NAME}' | set --url <https://…> [--method POST] [--header 'Name: value'] [--body '…'] | set --cloudflare --from <address> | test [--to <address>] | pause | resume | remove | replies on <subdomain> [--enable] | replies status | replies test [--enable] | replies off`;

export async function emailCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['preset', 'from', 'key', 'url', 'method', 'header', 'body', 'to', 'cloudflare', 'enable', 'wait', 'cf-account', 'account-id', 'cf-token', 'yes', 'y'], 'email');
  const [sub = 'show'] = ctx.positionals;
  const loaded = loadProject(ctx.cwd);
  const api = adminApi(loaded);
  if (sub === 'replies') return repliesCommand(ctx, loaded, api);
  if (sub === 'set' && ctx.flags['cloudflare']) return cloudflareSending(ctx, loaded, api);
  const current = async () => (await api.get<{ service: Service | null }>('/admin/api/notifications/email')).service;

  switch (sub) {
    case 'show': {
      const service = await current();
      ctx.out.result({ service }, () => {
        if (!service) {
          process.stdout.write(c.dim("No email service. Set one up: helppuff email set --preset resend --from you@yourdomain.com --key '${RESEND_API_KEY}'\n"));
          return;
        }
        const state = !service.enabled ? c.dim('paused') : service.lastStatus === 'failed' ? c.yellow('failing') : c.green('on');
        process.stdout.write(`${state}  ${service.kind === 'cloudflare' ? `Cloudflare Email Service, from ${service.from}` : `${service.method} ${service.url}`}${service.lastError ? c.dim(`  — last: ${service.lastError}`) : ''}\n`);
        process.stdout.write(c.dim('Each person chooses their emails in the dashboard: Settings → Notifications.\n'));
      });
      return 0;
    }
    case 'set': {
      const env = loadEnv(ctx.cwd);
      const missing = new Set<string>();
      const body: Record<string, unknown> = {};
      const presetId = str(ctx.flags, 'preset');
      if (presetId) {
        const preset = EMAIL_PRESETS.find((p) => p.id === presetId);
        if (!preset) throw new CliError('usage', `Unknown preset ${presetId}: ${EMAIL_PRESETS.map((p) => p.id).join(', ')}, or --url … for any other service.`, { exitCode: EXIT.usage });
        const from = str(ctx.flags, 'from');
        const key = str(ctx.flags, 'key');
        if (!from || !key) {
          return ctx.out.needsInput({
            message: `${preset.name} needs the address to send from and its ${preset.key.label}.`,
            questions: [
              ...(!from ? [{ id: 'from', ask: `The address to send from: one on a domain verified in ${preset.name}.`, flag: '--from', kind: 'text', required: true }] : []),
              ...(!key ? [{ id: 'key', ask: `The ${preset.name} ${preset.key.label}: store it with \`helppuff secret set ${preset.id.toUpperCase()}_API_KEY\`, then pass --key '\${${preset.id.toUpperCase()}_API_KEY}'. Never paste it into a chat.`, flag: '--key', kind: 'secret', required: true }] : []),
            ],
          });
        }
        Object.assign(body, preset.request(from, expand(key, env, missing)));
      }
      const url = str(ctx.flags, 'url');
      if (url) body['url'] = url;
      const method = str(ctx.flags, 'method');
      if (method) body['method'] = method.toUpperCase();
      if (typeof ctx.flags['body'] === 'string') body['body'] = ctx.flags['body'];
      const given = headerFlags(ctx.flags['header']);
      if (given.length) body['headers'] = mergeHeaders((body['headers'] as ToolHeader[] | undefined) ?? (await current())?.headers ?? [], given, env, missing);
      if (missing.size) {
        return ctx.out.needsInput({
          message: `${[...missing].join(' and ')} ${missing.size === 1 ? 'is' : 'are'} not in .env yet: nothing was saved.`,
          questions: [...missing].map((name) => ({ id: name, ask: `The value of ${name}. The user stores it with \`helppuff secret set ${name}\`; never paste it into a chat.`, flag: `secret set ${name}`, kind: 'secret', required: true, envVar: name })),
        });
      }
      if (!Object.keys(body).length) throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
      const service = await api.send<Service>('PUT', '/admin/api/notifications/email', body);
      ctx.out.result(service, () => {
        ctx.out.success(`Email service saved: ${service.method} ${service.url}`);
        process.stdout.write(c.dim('Send yourself one: helppuff email test --to you@example.com. Each person chooses their emails in the dashboard: Settings → Notifications.\n'));
      });
      return 0;
    }
    case 'test': {
      const to = str(ctx.flags, 'to');
      if (!to) {
        return ctx.out.needsInput({ message: 'Which address should the test go to?', questions: [{ id: 'to', ask: 'An address to send the test email to.', flag: '--to', kind: 'text', required: true }] });
      }
      const result = await api.send<{ ok: boolean; status: number | null; error: string | null; to: string }>('POST', '/admin/api/notifications/email/test', { to });
      ctx.out.result(result, () =>
        result.ok ? ctx.out.success(`Sent to ${result.to} (HTTP ${result.status}).`) : process.stdout.write(`${c.yellow('Failed:')} ${result.error ?? `HTTP ${result.status}`}\n`),
      );
      return result.ok ? 0 : EXIT.error;
    }
    case 'pause':
    case 'resume': {
      const service = await api.send<Service>('PUT', '/admin/api/notifications/email', { enabled: sub === 'resume' });
      ctx.out.result(service, () => ctx.out.success(service.enabled ? 'Emails are on.' : 'Emails are paused: nobody gets any until you resume.'));
      return 0;
    }
    case 'remove': {
      if (!(await confirmDelete(ctx, 'Remove the email service?', 'Nobody gets notification emails until you set one up again.'))) return 1;
      await api.send('DELETE', '/admin/api/notifications/email');
      ctx.out.result({ removed: true }, () => ctx.out.success('Removed the email service. Everyone keeps their choices for when you set one up again.'));
      return 0;
    }
    default:
      throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
  }
}

type RepliesStatus = {
  settings: { inbound: { enabled: boolean; domain?: string; ruleId?: string } };
  service: { name: string | null; sendsReplyTo: boolean; canAddReplyTo: boolean } | null;
  live: boolean;
  inbound: { domain: string | null; verifiedAt: number | null; address: string | null };
  ready: { copy: boolean; replies: boolean; inbound: boolean };
};
type Saved = { settings: Record<string, unknown>; hash: string; customerEmails?: { inbound: { enabled: boolean } } };

/** The Worker answers with a 404 for routes it does not know: an older version. */
async function newerWorker<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (thrown) {
    if (thrown instanceof CliError && thrown.details?.['status'] === 404) {
      throw new CliError('outdated_worker', 'This Worker is older than customer emails.', { hint: 'helppuff upgrade (or helppuff deploy), then run this again.' });
    }
    throw thrown;
  }
}

function saveInbound(loaded: LoadedProject, inbound: { domain?: string | null; ruleId?: string | null; enabled?: boolean }): LoadedProject {
  return updateProject(loaded, (raw) => {
    const emails = (raw['customerEmails'] ?? {}) as Record<string, unknown>;
    const current = (emails['inbound'] ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(inbound)) {
      if (value === null || value === undefined) delete next[key];
      else next[key] = value;
    }
    if (!next['domain']) delete next['enabled'];
    emails['inbound'] = next;
    if (!Object.keys(next).length) delete emails['inbound'];
    if (Object.keys(emails).length) raw['customerEmails'] = emails;
    else delete raw['customerEmails'];
  });
}

/** Send the test email to the reply address and wait for it to arrive; `--enable` then turns answers by email on. */
async function testReplies(ctx: Ctx, loaded: LoadedProject, api: AdminApi): Promise<number> {
  const before = await newerWorker(() => api.get<RepliesStatus>('/admin/api/customer-emails/status'));
  if (!before.inbound.domain) throw new CliError('usage', 'Set the reply address up first: helppuff email replies on <subdomain>', { exitCode: EXIT.usage });
  ctx.out.progress(`Sending a test email to ${before.inbound.address}…`);
  const sent = await api.send<{ ok: boolean; error: string | null; to: string }>('POST', '/admin/api/customer-emails/test', {});
  if (!sent.ok) {
    ctx.out.result({ sent, verified: false }, () => process.stdout.write(`${c.yellow('The email service refused the test:')} ${sent.error ?? 'unknown error'}\n`));
    return EXIT.error;
  }
  const seconds = Math.min(Math.max(Number(str(ctx.flags, 'wait') ?? '60') || 0, 0), 600);
  if (seconds) ctx.out.progress(`Waiting up to ${seconds}s for it to arrive…`);
  let status: RepliesStatus;
  for (const until = Date.now() + seconds * 1000; ; ) {
    status = await api.get<RepliesStatus>('/admin/api/customer-emails/status');
    if (status.inbound.verifiedAt && status.inbound.verifiedAt !== before.inbound.verifiedAt) break;
    if (Date.now() >= until) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  const verified = Boolean(status.inbound.verifiedAt && status.inbound.verifiedAt !== before.inbound.verifiedAt);
  let enabled = status.settings.inbound.enabled;
  if (verified && ctx.flags['enable'] && !enabled) {
    const saved = await api.send<Saved>('PUT', '/admin/api/settings', { settings: { customerEmails: { inbound: { enabled: true } } } });
    saveInbound(loaded, { enabled: true });
    writeState(loaded.dir, { ...readState(loaded.dir), settings: { hash: saved.hash } });
    enabled = true;
  }
  const next = verified
    ? [
        ...(enabled ? [] : ['Turn it on in the dashboard (Settings → Customer emails), or: helppuff email replies test --enable']),
        ...(status.service && !status.service.sendsReplyTo ? ['The email service\'s request has no {{email.replyTo}}: Settings → Customer emails → Add it for me'] : []),
        ...(status.live ? [] : ['Turn live chat on (helppuff live on): the team answers there']),
      ]
    : ['DNS can take a few minutes: run helppuff email replies test again', SUBADDRESSING_PATH, 'Check the email service sends from a verified address (helppuff email test --to you@…)'];
  ctx.out.result({ domain: status.inbound.domain, sent: true, verified, enabled, next }, () => {
    if (verified) ctx.out.success(`The test arrived: customers can answer by email${enabled ? ' (on now).' : '.'}`);
    else process.stdout.write(`${c.yellow('The test has not arrived yet.')} Check:\n${next.map((n) => `  • ${n}`).join('\n')}\n`);
    if (verified && next.length) process.stdout.write(next.map((n) => c.dim(`  • ${n}`)).join('\n') + '\n');
  });
  return verified ? EXIT.ok : EXIT.error;
}

/**
 * `helppuff email replies` — customers answer by email (Customer emails, C):
 * Cloudflare Email Routing on a subdomain hands their replies to the Worker.
 */
async function repliesCommand(ctx: Ctx, loaded: LoadedProject, api: AdminApi): Promise<number> {
  const [, action = 'status', arg] = ctx.positionals;
  const worker = workerNameFor(loaded.project);
  const session = () => cloudflareSession(loadEnv(loaded.dir), { token: str(ctx.flags, 'cf-token'), accountId: str(ctx.flags, 'cf-account') ?? str(ctx.flags, 'account-id') ?? loaded.project.cloudflare.accountId });
  const domain = loaded.project.customerEmails.inbound.domain;

  switch (action) {
    case 'status': {
      if (!domain) {
        const suggestion = suggestSubdomain(loaded.project.website ?? loaded.project.origins[0]);
        ctx.out.result({ domain: null, next: [`helppuff email replies on ${suggestion ?? 'chat.yourdomain.com'}`] }, () =>
          process.stdout.write(c.dim(`Answers by email are not set up. helppuff email replies on ${suggestion ?? 'chat.yourdomain.com'}\n`)),
        );
        return EXIT.ok;
      }
      const cf = await session();
      const [state, live] = await Promise.all([repliesState(cf.api, domain), newerWorker(() => api.get<RepliesStatus>('/admin/api/customer-emails/status'))]);
      const ruleOk = Boolean(state.rule?.enabled && state.rule.worker === worker);
      const result = { domain, receiving: state.receiving, subaddressing: state.subaddressing, rule: state.rule, ruleOk, verifiedAt: live.inbound.verifiedAt, enabled: live.settings.inbound.enabled, ready: live.ready.inbound };
      ctx.out.result(result, () => {
        const mark = (ok: boolean | null) => (ok ? c.green('✓') : ok === null ? c.dim('?') : c.red('✗'));
        process.stdout.write(`${mark(state.receiving)} ${domain} receives mail at Cloudflare\n`);
        process.stdout.write(`${mark(state.subaddressing)} sub-addressing${state.subaddressing === false ? c.dim(` (${SUBADDRESSING_PATH})`) : ''}\n`);
        process.stdout.write(`${mark(ruleOk)} reply@${domain} → ${state.rule?.worker ?? 'no rule'}\n`);
        process.stdout.write(`${mark(Boolean(live.inbound.verifiedAt))} a test arrived${live.inbound.verifiedAt ? ` ${new Date(live.inbound.verifiedAt).toISOString()}` : c.dim(' (helppuff email replies test)')}\n`);
        process.stdout.write(`${mark(live.settings.inbound.enabled)} answers by email are ${live.settings.inbound.enabled ? 'on' : 'off'}\n`);
      });
      return ruleOk && state.receiving ? EXIT.ok : EXIT.error;
    }

    case 'on': {
      if (!arg) {
        const suggestion = suggestSubdomain(loaded.project.website ?? loaded.project.origins[0]);
        return ctx.out.needsInput({
          message: 'Which subdomain should receive customers\' replies? Its mail is handled by Cloudflare from then on, so never the domain itself or one your inbox uses.',
          questions: [{ id: 'subdomain', ask: `A subdomain of a domain on Cloudflare in this account${suggestion ? `, e.g. ${suggestion}` : ''}.`, flag: 'email replies on <subdomain>', kind: 'text', required: true, ...(suggestion ? { default: suggestion } : {}) }],
        });
      }
      const subdomain = normalizeSubdomain(arg);
      if (!loaded.project.cloudflare.url) throw new CliError('not_deployed', 'Deploy first: replies go to the deployed Worker.', { hint: 'helppuff deploy' });
      const cf = await session();
      const state = await setUpReplies(cf.api, subdomain, worker, ctx.out.progress);
      const saved = await newerWorker(() => api.send<Saved>('PUT', '/admin/api/customer-emails/inbound', { domain: subdomain, ruleId: state.rule?.id ?? null }));
      let updated = saveInbound(loaded, { domain: subdomain, ruleId: state.rule?.id ?? null, enabled: saved.customerEmails?.inbound.enabled ?? false });
      writeState(updated.dir, { ...readState(updated.dir), settings: { hash: saved.hash } });
      if (state.subaddressing === false) {
        ctx.out.progress(`Receiving at ${subdomain}; the rule hands reply@${subdomain} to ${worker}.`);
        return ctx.out.needsInput({
          message: `One click left: turn on sub-addressing for ${state.zone.name}, so reply+…@${subdomain} reaches the rule. Then run: helppuff email replies test${ctx.flags['enable'] ? ' --enable' : ''}`,
          questions: [{ id: 'subaddressing', ask: SUBADDRESSING_PATH, flag: `email replies test${ctx.flags['enable'] ? ' --enable' : ''}`, kind: 'confirm', required: true }],
        });
      }
      updated = loadProject(updated.dir);
      return testReplies(ctx, updated, api);
    }

    case 'test':
      return testReplies(ctx, loaded, api);

    case 'off': {
      if (!domain) {
        ctx.out.result({ removed: false, domain: null }, () => process.stdout.write(c.dim('Answers by email are not set up.\n')));
        return EXIT.ok;
      }
      if (!(await confirmDelete(ctx, `Stop receiving replies at ${domain}?`, `The rule for reply@${domain} is deleted; customers' answers by email are refused from then on.`))) return 1;
      const cf = await session();
      const removed = await removeReplies(cf.api, domain, loaded.project.customerEmails.inbound.ruleId);
      const saved = await newerWorker(() => api.send<Saved>('PUT', '/admin/api/customer-emails/inbound', { domain: null }));
      const updated = saveInbound(loaded, { domain: null, ruleId: null, enabled: false });
      writeState(updated.dir, { ...readState(updated.dir), settings: { hash: saved.hash } });
      ctx.out.result({ removed: true, rule: removed, domain, emailRoutingStillOn: domain }, () => {
        ctx.out.success(`Answers by email are off; the rule for reply@${domain} is ${removed ? 'deleted' : 'gone'}.`);
        process.stdout.write(c.dim(`Email Routing stays on ${domain}. To remove it: Cloudflare dashboard → Email → Email Routing → Settings → Subdomains.\n`));
      });
      return EXIT.ok;
    }

    default:
      throw new CliError('usage', 'Usage: helppuff email replies on <subdomain> [--enable] | status | test [--enable] | off', { exitCode: EXIT.usage });
  }
}

/** `helppuff email set --cloudflare --from …`: send with Cloudflare Email Service, through the Worker's binding. */
async function cloudflareSending(ctx: Ctx, loaded: LoadedProject, api: AdminApi): Promise<number> {
  const from = str(ctx.flags, 'from')?.trim().toLowerCase();
  if (!from) {
    return ctx.out.needsInput({
      message: 'Cloudflare Email Service needs the address to send from, on a domain on Cloudflare in this account.',
      questions: [{ id: 'from', ask: 'The address to send from, e.g. hello@chat.yourdomain.com.', flag: '--from', kind: 'text', required: true }],
    });
  }
  const domain = from.split('@')[1] ?? '';
  if (!/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(from)) throw new CliError('usage', `${from} is not an email address.`, { exitCode: EXIT.usage });
  if (!loaded.project.cloudflare.url) throw new CliError('not_deployed', 'Deploy first.', { hint: 'helppuff deploy' });
  const cf = await cloudflareSession(loadEnv(loaded.dir), { token: str(ctx.flags, 'cf-token'), accountId: str(ctx.flags, 'cf-account') ?? str(ctx.flags, 'account-id') ?? loaded.project.cloudflare.accountId });
  const zone = await cf.api.findZone(domain);
  if (!zone) {
    throw new CliError('email_domain_not_on_cloudflare', `${domain} is not on Cloudflare in this account; Cloudflare Email Service sends only from domains there.`, {
      hint: 'Use a domain on this account, or a service like Resend: helppuff email set --preset resend …',
      exitCode: EXIT.usage,
    });
  }
  const onboarded = (await cf.api.emailSendingSubdomains(zone.id)).some((d) => d.name === domain);
  if (!onboarded) {
    ctx.out.progress(`Onboarding ${domain} for sending (Cloudflare adds its SPF, DKIM and DMARC records)…`);
    await cf.api.enableEmailSending(zone.id, domain);
  }
  const updated = updateProject(loaded, (raw) => {
    const email = (raw['email'] ?? {}) as Record<string, unknown>;
    email['cloudflare'] = { from };
    raw['email'] = email;
  });
  ctx.out.progress('Deploying with the email binding…');
  await deploy(updated, { knowledge: 'skip', progress: ctx.out.progress, cf: { accountId: cf.accountId } });
  const service = await api.send<Service>('PUT', '/admin/api/notifications/email', { kind: 'cloudflare', from });
  const next = ['helppuff email test --to you@yourdomain.com', 'Emailing customers (any address not verified in Cloudflare) needs Workers Paid; the team\'s emails work on Free when each address is verified (Email Routing → Destination addresses).'];
  ctx.out.result({ service, domain, onboarded: !onboarded, next }, () => {
    ctx.out.success(`Sending with Cloudflare Email Service, from ${from}.`);
    process.stdout.write(c.dim(next.map((n) => `  • ${n}`).join('\n') + '\n'));
  });
  return EXIT.ok;
}
