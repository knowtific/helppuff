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
 *   test [--to someone@example.com]
 *   pause | resume | remove
 */

type Service = {
  method: string;
  url: string;
  headers: (ToolHeader & { set?: boolean })[];
  body: string;
  enabled: boolean;
  dashboardUrl: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

const USAGE = `Usage: helppuff email show | set --preset ${EMAIL_PRESETS.map((p) => p.id).join('|')} --from <address> --key '\${NAME}' | set --url <https://…> [--method POST] [--header 'Name: value'] [--body '…'] | test [--to <address>] | pause | resume | remove`;

export async function emailCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['preset', 'from', 'key', 'url', 'method', 'header', 'body', 'to'], 'email');
  const [sub = 'show'] = ctx.positionals;
  const api = adminApi(loadProject(ctx.cwd));
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
        process.stdout.write(`${state}  ${service.method} ${service.url}${service.lastError ? c.dim(`  — last: ${service.lastError}`) : ''}\n`);
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
      await api.send('DELETE', '/admin/api/notifications/email');
      ctx.out.result({ removed: true }, () => ctx.out.success('Removed the email service. Everyone keeps their choices for when you set one up again.'));
      return 0;
    }
    default:
      throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
  }
}
