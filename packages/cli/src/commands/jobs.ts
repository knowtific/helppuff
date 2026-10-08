import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi, type AdminApi } from '../engine/admin-api.js';
import { loadProject } from '../engine/project.js';
import type { Ctx } from './context.js';

/**
 * `helppuff jobs` — requests, quotes and work on the site's pipeline, the
 * same as the dashboard's Jobs page and Settings → Jobs. A job is named by its
 * number (`1042`) or its id.
 *
 *   list [--status open|won|lost|all] [--search text]
 *   show <job>
 *   create [--title …] [--fields '{"service":"Hot water"}'] [--name …] [--email …] [--phone …] [--details …] [--value 450]
 *   move <job> <stage> [--reason …]      a stage by name or id
 *   update <job> <text…>                 a line in the job's history
 *   pipeline                             the stages, fields and quote questions
 *   template <id>                        start again from a template
 *   setup                                let the AI choose from the website
 */

type Stage = { id: string; name: string; kind: 'open' | 'won' | 'lost'; color: string };
type Field = { name: string; label: string; type: string; required: boolean; options: string[]; inQuote: boolean; archived: boolean };
type Pipeline = { template: string; itemSingular: string; itemPlural: string; chosenBy: string; reason: string | null; stages: Stage[]; fields: Field[]; quote: { enabled: boolean; label: string }; quotePreview: { ask: string }[] };
type Job = {
  id: string;
  number: number;
  title: string;
  details: string | null;
  stage: { id: string; name: string } | null;
  status: string;
  fields: Record<string, string>;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
  value: number | null;
  currency: string | null;
  assignedName: string | null;
  stale: boolean;
  createdAt: number;
};
type Detail = Job & { history: { at: number; actorName: string | null; kind: string; data: Record<string, unknown> | null }[] };

const USAGE =
  'Usage: helppuff jobs list [--status open|won|lost|all] [--search …] | show <job> | create [--title …] [--fields JSON] [--name …] [--email …] [--phone …] [--details …] [--value N] | move <job> <stage> [--reason …] | update <job> <text> | pipeline | template <id> | setup';

const usage = () => new CliError('usage', USAGE, { exitCode: EXIT.usage });

/** A job by number (`1042`, `#1042`) or id. */
async function resolve(api: AdminApi, ref: string): Promise<string> {
  const number = /^#?(\d+)$/.exec(ref)?.[1];
  if (!number) return ref;
  const found = await api.get<{ items: Job[] }>('/admin/api/jobs', { status: 'all', q: number });
  const job = found.items.find((j) => String(j.number) === number);
  if (!job) throw new CliError('not_found', `No job #${number}.`, { exitCode: EXIT.error, hint: 'helppuff jobs list --status all' });
  return job.id;
}

const line = (j: Job) =>
  `#${j.number}  ${c.bold(j.title)}  ${c.dim(j.stage?.name ?? '')}${j.stale ? c.yellow('  stale') : ''}${j.value !== null ? `  ${j.value}${j.currency ? ` ${j.currency}` : ''}` : ''}${j.contact?.name ? c.dim(`  ${j.contact.name}`) : ''}`;

export async function jobsCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['status', 'search', 'title', 'fields', 'name', 'email', 'phone', 'details', 'value', 'reason'], 'jobs');
  const [sub = 'list', first, ...rest] = ctx.positionals;
  const api = adminApi(loadProject(ctx.cwd));

  switch (sub) {
    case 'list': {
      const status = str(ctx.flags, 'status') ?? 'open';
      const search = str(ctx.flags, 'search');
      const listed = await api.get<{ items: Job[]; stages: (Stage & { count: number })[] }>('/admin/api/jobs', { status, ...(search ? { q: search } : {}) });
      ctx.out.result(listed, () => {
        if (!listed.items.length) process.stdout.write(c.dim(search ? 'Nothing matches.\n' : `No ${status === 'all' ? '' : `${status} `}jobs.\n`));
        for (const j of listed.items) process.stdout.write(`${line(j)}\n`);
        process.stdout.write(c.dim(`\n${listed.stages.map((s) => `${s.name} ${s.count}`).join(' · ')}\n`));
      });
      return 0;
    }
    case 'show': {
      if (!first) throw usage();
      const job = await api.get<Detail>(`/admin/api/jobs/${encodeURIComponent(await resolve(api, first))}`);
      ctx.out.result(job, () => {
        process.stdout.write(`${line(job)}\n`);
        if (job.contact) process.stdout.write(`${c.dim('contact')}  ${[job.contact.name, job.contact.email, job.contact.phone].filter(Boolean).join(' · ')}\n`);
        for (const [k, v] of Object.entries(job.fields)) process.stdout.write(`${c.dim(k.padEnd(16))} ${v}\n`);
        if (job.details) process.stdout.write(`\n${job.details}\n`);
        process.stdout.write(`\n${c.bold('History')}\n`);
        for (const e of job.history) process.stdout.write(`${c.dim(new Date(e.at).toLocaleString())}  ${e.kind}${e.data ? `  ${c.dim(JSON.stringify(e.data))}` : ''}${e.actorName ? c.dim(`  — ${e.actorName}`) : ''}\n`);
      });
      return 0;
    }
    case 'create': {
      let fields: unknown;
      const raw = str(ctx.flags, 'fields');
      if (raw) {
        try {
          fields = JSON.parse(raw) as unknown;
        } catch {
          throw new CliError('usage', '--fields is JSON: \'{"service":"Hot water","address":"Glebe"}\'.', { exitCode: EXIT.usage });
        }
      }
      const contact = Object.fromEntries((['name', 'email', 'phone'] as const).map((k) => [k, str(ctx.flags, k)]).filter(([, v]) => v));
      const value = str(ctx.flags, 'value');
      const title = str(ctx.flags, 'title');
      const details = str(ctx.flags, 'details');
      if (!title && !raw && !details && !Object.keys(contact).length) {
        throw new CliError('needs_input', 'Say what the job is: --title, --fields, --details or a contact.', { exitCode: EXIT.usage, hint: 'helppuff jobs pipeline lists the fields' });
      }
      const job = await api.send<Job>('POST', '/admin/api/jobs', {
        ...(title ? { title } : {}),
        ...(details ? { details } : {}),
        ...(fields ? { fields } : {}),
        ...(Object.keys(contact).length ? { contact } : {}),
        ...(value ? { value: Number(value) } : {}),
      });
      ctx.out.result(job, () => ctx.out.success(`Created #${job.number}: ${job.title} (${job.stage?.name ?? ''})`));
      return 0;
    }
    case 'move': {
      const to = rest.join(' ').trim();
      if (!first || !to) throw usage();
      const { pipeline } = await api.get<{ pipeline: Pipeline }>('/admin/api/jobs/pipeline');
      const stage = pipeline.stages.find((s) => s.id === to || s.name.toLowerCase() === to.toLowerCase());
      if (!stage) throw new CliError('usage', `No stage "${to}". Stages: ${pipeline.stages.map((s) => s.name).join(', ')}.`, { exitCode: EXIT.usage });
      const reason = str(ctx.flags, 'reason');
      const job = await api.send<Job>('POST', `/admin/api/jobs/${encodeURIComponent(await resolve(api, first))}/move`, { stageId: stage.id, ...(reason ? { lostReason: reason } : {}) });
      ctx.out.result(job, () => ctx.out.success(`#${job.number} is in ${stage.name}.`));
      return 0;
    }
    case 'update': {
      const text = rest.join(' ').trim();
      if (!first || !text) throw usage();
      const event = await api.send<Record<string, unknown>>('POST', `/admin/api/jobs/${encodeURIComponent(await resolve(api, first))}/updates`, { text });
      ctx.out.result(event, () => ctx.out.success('Added to its history.'));
      return 0;
    }
    case 'pipeline': {
      const { pipeline } = await api.get<{ pipeline: Pipeline }>('/admin/api/jobs/pipeline');
      ctx.out.result(pipeline, () => {
        process.stdout.write(`${c.bold(pipeline.itemPlural)}  ${c.dim(`template ${pipeline.template}, ${pipeline.chosenBy === 'ai' ? 'chosen by the AI' : pipeline.chosenBy === 'owner' ? 'edited' : 'the default'}`)}\n`);
        if (pipeline.reason) process.stdout.write(c.dim(`${pipeline.reason}\n`));
        process.stdout.write(`\n${c.bold('Stages')}\n`);
        for (const s of pipeline.stages) process.stdout.write(`  ${s.name}${s.kind === 'open' ? '' : c.dim(` (${s.kind})`)}  ${c.dim(s.id)}\n`);
        process.stdout.write(`\n${c.bold('Fields')}\n`);
        for (const f of pipeline.fields.filter((x) => !x.archived)) process.stdout.write(`  ${f.name.padEnd(18)} ${f.label}${f.required ? ' *' : ''}  ${c.dim(f.type + (f.options.length ? `: ${f.options.join(', ')}` : ''))}\n`);
        process.stdout.write(`\n${c.bold(`Quote questions`)} ${c.dim(pipeline.quote.enabled ? `(“${pipeline.quote.label}” on the widget)` : '(off)')}\n`);
        for (const q of pipeline.quotePreview) process.stdout.write(`  ${q.ask}\n`);
      });
      return 0;
    }
    case 'template': {
      if (!first) throw usage();
      const { pipeline } = await api.send<{ pipeline: Pipeline }>('POST', '/admin/api/jobs/pipeline/template', { template: first });
      ctx.out.result(pipeline, () => ctx.out.success(`Now: ${pipeline.template}. Stages: ${pipeline.stages.map((s) => s.name).join(' → ')}.`));
      return 0;
    }
    case 'setup': {
      const result = await api.send<{ template?: string; reason?: string | null; pipeline: Pipeline }>('POST', '/admin/api/jobs/setup', { force: true });
      ctx.out.result(result, () => {
        ctx.out.success(`${result.pipeline.itemPlural}: ${result.pipeline.template} (${result.pipeline.chosenBy === 'ai' ? 'chosen by the AI' : 'the default'}).`);
        if (result.pipeline.reason) process.stdout.write(c.dim(`${result.pipeline.reason}\n`));
      });
      return 0;
    }
    default:
      throw usage();
  }
}
