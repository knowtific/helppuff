import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { AGENT_TEMPLATES, agentTemplate, type AgentFile } from '@helppuff/protocol/agents';
import { settingsSchema, upgradeSettings, type Settings } from '@helppuff/server';
import { assertKnown } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi } from '../engine/admin-api.js';
import { compile } from '../engine/compile.js';
import { loadEnv } from '../engine/env.js';
import { loadProject, type LoadedProject } from '../engine/project.js';
import { pullPrompt, remoteFor } from '../engine/prompt.js';
import { readState, writeState } from '../engine/state.js';
import { pullSettings } from './manage.js';
import type { Ctx } from './context.js';

/**
 * `helppuff agent`: the agent file, the whole assistant's setup in one JSON
 * file (the prompt, the tools, the behaviour and lead form settings). The
 * same API as the dashboard's Import & export page.
 *
 *   templates            the ready-made ones (the tutorials')
 *   export [file]        the live setup, secrets as `${NAME}` placeholders
 *   import <file|id>     check, then apply; `${NAME}` values come from .env
 *
 * After an import, prompt.md and helppuff.json are brought up to date, so a
 * later `deploy` publishes on top of it instead of refusing.
 */

const USAGE = 'Usage: helppuff agent templates | export [file.json] | import <file.json|template> [--dry-run]';

type Plan = {
  dryRun: boolean;
  ready: boolean;
  name: string;
  settings: string[];
  tools: { name: string; action: 'create' | 'replace' }[];
  prompt: { action: 'replace' | 'unchanged' | 'skipped'; version: number; reason?: string } | null;
  missingSecrets: { name: string; description: string }[];
};
type LiveSettings = { settings: Settings; hash: string };

function readAgent(ctx: Ctx, source: string): AgentFile {
  const template = agentTemplate(source);
  if (template && !existsSync(resolve(ctx.cwd, source))) return template.agent;
  try {
    return JSON.parse(readFileSync(resolve(ctx.cwd, source), 'utf8')) as AgentFile;
  } catch (thrown) {
    throw new CliError('usage', `Could not read ${source}: ${(thrown as Error).message}`, {
      hint: `A file from \`helppuff agent export\`, or a template: ${AGENT_TEMPLATES.map((t) => t.id).join(', ')}`,
      exitCode: EXIT.usage,
    });
  }
}

const placeholders = (agent: AgentFile) => [...new Set([...JSON.stringify(agent.tools ?? []).matchAll(/\$\{([A-Z][A-Z0-9_]{0,63})\}/g)].map((m) => m[1]!))];

function describePlan(plan: Plan): string {
  const lines = [`${c.bold(plan.name)}`];
  if (plan.settings.length) lines.push(`  settings  ${plan.settings.join(', ')}`);
  for (const t of plan.tools) lines.push(`  tool      ${t.name} ${c.dim(t.action === 'create' ? '(new)' : '(replaces yours)')}`);
  if (plan.prompt) lines.push(`  prompt    ${plan.prompt.action === 'replace' ? `replaced (yours stays in the history as v${plan.prompt.version})` : plan.prompt.action}${plan.prompt.reason ? c.dim(` — ${plan.prompt.reason}`) : ''}`);
  return `${lines.join('\n')}\n`;
}

/** Bring helppuff.json and prompt.md up to date with what is now live. What could not be pulled is returned as next steps. */
async function pullAfterImport(loaded: LoadedProject, cwd: string, plan: Plan): Promise<string[]> {
  const next: string[] = [];
  if (plan.settings.length) {
    try {
      const live = await adminApi(loaded).get<LiveSettings>('/admin/api/settings');
      const updated = pullSettings(loaded, settingsSchema.parse(upgradeSettings(live.settings)));
      compile(updated);
      writeState(loaded.dir, { ...readState(loaded.dir), settings: { hash: live.hash } });
    } catch {
      next.push('helppuff config pull');
    }
  }
  if (plan.prompt?.action === 'replace') {
    try {
      await pullPrompt(loaded, await remoteFor(loaded, loadEnv(cwd)));
    } catch {
      next.push('helppuff prompt pull');
    }
  }
  return next;
}

export async function agentCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['dry-run'], 'agent');
  const [sub, arg] = ctx.positionals;

  if (sub === 'templates') {
    const list = AGENT_TEMPLATES.map((t) => ({ id: t.id, title: t.title, summary: t.summary, needs: t.agent.needs.map((n) => n.name), tutorial: `https://github.com/knowtific/helppuff/wiki/${t.tutorial}` }));
    ctx.out.result({ templates: list }, () => {
      for (const t of list) process.stdout.write(`${c.bold(t.id.padEnd(26))} ${t.summary}\n${' '.repeat(27)}${c.dim(t.tutorial)}\n`);
      process.stdout.write(c.dim('\nImport one with `helppuff agent import <id>`; --dry-run shows what it changes first.\n'));
    });
    return 0;
  }

  const loaded = loadProject(ctx.cwd);
  const api = adminApi(loaded);

  if (sub === 'export') {
    const file = await api.get<AgentFile>('/admin/api/agent/export');
    const text = `${JSON.stringify(file, null, 2)}\n`;
    if (!arg) {
      process.stdout.write(ctx.out.json ? `${JSON.stringify({ ok: true, agent: file }, null, 2)}\n` : text);
      return 0;
    }
    writeFileSync(resolve(ctx.cwd, arg), text);
    ctx.out.result({ file: arg, tools: file.tools.length, needs: file.needs.map((n) => n.name) }, () =>
      ctx.out.success(`Wrote ${arg}: the prompt, ${file.tools.length} tool${file.tools.length === 1 ? '' : 's'} and the behaviour settings. Secrets are placeholders (${file.needs.map((n) => n.name).join(', ') || 'none'}).`),
    );
    return 0;
  }

  if (sub === 'import') {
    if (!arg) throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
    const agent = readAgent(ctx, arg);
    const env = loadEnv(ctx.cwd);
    const secrets = Object.fromEntries(placeholders(agent).filter((n) => env[n]).map((n) => [n, env[n]!]));
    const plan = await api.send<Plan>('POST', '/admin/api/agent/import', { agent, secrets, dryRun: true });
    if (ctx.flags['dry-run']) {
      ctx.out.result(plan, () => {
        process.stdout.write(describePlan(plan));
        if (plan.missingSecrets.length) process.stdout.write(c.yellow(`Needs ${plan.missingSecrets.map((s) => s.name).join(', ')} in .env first (helppuff secret set NAME).\n`));
      });
      return 0;
    }
    if (plan.missingSecrets.length) {
      ctx.out.needsInput({
        message: `${plan.missingSecrets.map((s) => s.name).join(' and ')} ${plan.missingSecrets.length === 1 ? 'is' : 'are'} not in .env yet: nothing was imported.`,
        questions: plan.missingSecrets.map((s) => ({
          id: s.name,
          ask: `${s.description || `The value of ${s.name}`}. The user stores it with \`helppuff secret set ${s.name}\`; never paste it into a chat.`,
          flag: `secret set ${s.name}`,
          kind: 'secret',
          required: true,
          envVar: s.name,
        })),
      });
      return EXIT.needsInput;
    }
    const done = await api.send<Plan>('POST', '/admin/api/agent/import', { agent, secrets });
    const next = await pullAfterImport(loaded, ctx.cwd, done);
    ctx.out.result({ ...done, next: [...next, 'helppuff ask "<a real visitor question>"'] }, () => {
      process.stdout.write(describePlan(done));
      ctx.out.success(`Imported. It is live now${next.length ? `; run ${next.map((n) => c.cyan(n)).join(' and ')} to bring it into this project` : `, and ${relative(ctx.cwd, loaded.dir) || 'this project'} is up to date`}. Try it with ${c.cyan('helppuff ask "…"')}.`);
    });
    return 0;
  }

  throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
}
