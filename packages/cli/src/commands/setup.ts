import * as p from '@clack/prompts';
import { assertKnown, bool, str } from '../args.js';
import { CliError } from '../errors.js';
import { c } from '../output.js';
import { runtimeVersion, writeWorker } from '../engine/build.js';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { compile, DEV_PORT } from '../engine/compile.js';
import { cloudflareSession } from '../engine/credentials.js';
import { deploy, type DeployResult } from '../engine/deploy.js';
import { loadEnv } from '../engine/env.js';
import { LOGGED_IN, runInit, type InitResult } from '../engine/init.js';
import { wranglerLogin } from '../engine/wrangler-auth.js';
import { indexingStatus, syncKnowledge, type IndexingStatus, type SyncResult } from '../engine/knowledge.js';
import { aiSearchInstanceFor, hasKnowledge, loadProject, updateProject } from '../engine/project.js';
import type { Answers, Question } from '../engine/questions.js';
import { writeSchemaFile } from '../engine/schema.js';
import { runWrangler } from '../engine/wrangler.js';
import type { Ctx } from './context.js';

/** Terminal prompts for the wizard. Cancelling (Ctrl-C) exits cleanly. */
async function ask(question: Question): Promise<unknown> {
  if (question.id === 'cfToken') {
    const how = await p.select({
      message: 'Connect your Cloudflare account',
      options: [
        { value: 'login', label: 'Log in with the browser', hint: 'recommended · no token to create' },
        { value: 'token', label: 'Paste an API token' },
      ],
      initialValue: 'login',
    });
    if (p.isCancel(how)) {
      p.cancel('Setup cancelled. Nothing was written.');
      process.exit(130);
    }
    if (how === 'login') {
      p.log.step('Opening the Cloudflare login in your browser…');
      if (await wranglerLogin()) return LOGGED_IN;
      p.log.warn('The login did not complete; paste a token instead.');
    }
  }
  if (question.help && question.kind === 'secret') p.note(question.id === 'cfToken' ? question.help.split('\n').slice(1).join('\n') : question.help);
  let value: unknown;
  switch (question.kind) {
    case 'select':
      value = await p.select({
        message: question.ask,
        options: (question.options ?? []).map((o) => ({ value: o.value, label: o.label, ...(o.hint ? { hint: o.hint } : {}) })),
        ...(typeof question.default === 'string' ? { initialValue: question.default } : {}),
      });
      break;
    case 'secret':
      value = await p.password({ message: question.ask, mask: '•' });
      break;
    case 'confirm':
      value = await p.confirm({ message: question.ask, initialValue: question.default !== false });
      break;
    case 'list': {
      const text = await p.text({
        message: question.ask,
        placeholder: typeof question.default === 'string' ? question.default : 'Enter to skip',
        defaultValue: typeof question.default === 'string' ? question.default : '',
      });
      value = p.isCancel(text) ? text : String(text).split(',').map((s) => s.trim()).filter(Boolean);
      break;
    }
    default:
      value = await p.text({
        message: question.ask,
        ...(typeof question.default === 'string' ? { placeholder: question.default, defaultValue: question.default } : {}),
      });
  }
  if (p.isCancel(value)) {
    p.cancel('Setup cancelled. Nothing was written.');
    process.exit(130);
  }
  return typeof value === 'string' ? value.trim() : value;
}

function answersFrom(ctx: Ctx): Answers {
  const f = ctx.flags;
  const answers: Answers = {};
  const set = <K extends keyof Answers>(key: K, value: Answers[K] | undefined) => {
    if (value !== undefined) answers[key] = value;
  };
  set('website', str(f, 'url'));
  set('name', str(f, 'name'));
  set('backend', str(f, 'backend') as Answers['backend']);
  set('model', str(f, 'model'));
  set('apiKey', str(f, 'api-key'));
  set('aiSearch', str(f, 'ai-search'));
  const endpoint = str(f, 'ai-search-endpoint');
  if (endpoint) {
    answers.aiSearch = 'endpoint';
    answers.endpoint = endpoint;
  }
  set('httpUrl', str(f, 'http-url'));
  set('httpMode', str(f, 'http-mode') as Answers['httpMode']);
  set('httpToken', str(f, 'http-token'));
  set('retellAgent', str(f, 'retell-agent'));
  if (Array.isArray(f['docs'])) answers.docs = f['docs'];
  else if (f['docs'] === false) answers.docs = [];
  set('cfToken', str(f, 'cf-token'));
  set('cfAccount', str(f, 'cf-account'));
  set('adminEmail', str(f, 'admin-email')?.toLowerCase());
  set('adminPassword', str(f, 'admin-password'));
  if (f['dashboard'] === false) answers.dashboard = false;
  set('agentName', str(f, 'agent-name'));
  set('goal', str(f, 'goal') as Answers['goal']);
  set('notes', str(f, 'notes'));
  set('leadForm', str(f, 'lead-form'));
  return answers;
}

export async function initCommand(ctx: Ctx): Promise<number> {
  assertKnown(
    ctx.flags,
    ['url', 'name', 'backend', 'model', 'api-key', 'ai-search', 'ai-search-endpoint', 'http-url', 'http-mode', 'http-token', 'retell-agent', 'docs', 'cf-token', 'cf-account', 'admin-email', 'admin-password', 'dashboard', 'agent-name', 'goal', 'notes', 'lead-form', 'yes', 'y', 'deploy', 'force', 'agent-files'],
    'init',
  );
  const { out } = ctx;
  if (ctx.interactive) p.intro(c.bold(' murmur · set up your chat assistant '));

  // In the wizard, the knowledge base starts building while the last few
  // questions are answered; its progress is shown once they are done.
  let knowledgeProgress = 'Building the knowledge base…';
  const result: InitResult = await runInit({
    cwd: ctx.cwd,
    answers: answersFrom(ctx),
    ask: ctx.interactive ? ask : null,
    yes: Boolean(ctx.flags['yes'] || ctx.flags['y']),
    force: Boolean(ctx.flags['force']),
    agentFiles: ctx.flags['agent-files'] !== false,
    progress: ctx.interactive ? (m) => p.log.step(m) : out.progress,
    ...(ctx.interactive
      ? {
          background: async (draft, env) => {
            if (!hasKnowledge(draft.project) || !['cloudflare', 'anthropic', 'openai', 'gemini'].includes(draft.project.backend.type)) {
              return null;
            }
            p.log.info('Building the knowledge base in the background while we finish up…');
            const cf = aiSearchInstanceFor(draft.project) ? await cloudflareSession(env) : undefined;
            return syncKnowledge(draft, { env, ...(cf ? { cf } : {}), progress: (m) => (knowledgeProgress = m.trim()) });
          },
        }
      : {}),
  });

  if (result.status === 'needs_input') {
    return out.needsInput({
      questions: result.questions,
      assumed: result.assumed,
      known: result.known,
      next: 'Ask the user these questions, then re-run `murmur init` with the given flags plus everything already known.',
    });
  }

  for (const warning of result.warnings) out.warn(warning);
  const project = result.project;
  const summary = {
    status: 'created',
    site: project.site,
    name: project.name,
    backend: project.backend.type,
    files: result.files,
    secretsStored: result.secrets,
    assumed: result.assumed,
    ...(project.dashboard.adminEmail
      ? {
          dashboardLogin: {
            email: project.dashboard.adminEmail,
            ...(result.adminPassword
              ? { password: result.adminPassword, note: 'Generated password — show it to the user once; it is stored only as a hash.' }
              : {}),
          },
        }
      : {}),
  };

  // The background knowledge job. OpenAI / Gemini stores are named in the
  // config, so they finish before deploying; AI Search is bound by name, so
  // the assistant goes live first and the uploads finish after.
  let knowledgeReady = false;
  const finishKnowledge = async () => {
    if (result.status !== 'created' || !result.background) return;
    const spinner = p.spinner();
    spinner.start(knowledgeProgress);
    const timer = setInterval(() => spinner.message(knowledgeProgress), 400);
    const outcome = (await result.background) as (SyncResult & { error?: never }) | { error: unknown } | null;
    clearInterval(timer);
    if (outcome && 'error' in outcome && outcome.error) {
      spinner.error(`Knowledge was not ready: ${(outcome.error as Error).message}. Run \`murmur knowledge sync\` to retry.`);
    } else if (outcome && 'target' in outcome) {
      if (outcome.backendUpdate) {
        updateProject(loadProject(ctx.cwd), (raw) => Object.assign(raw['backend'] as object, outcome.backendUpdate));
      }
      knowledgeReady = true;
      spinner.stop(
        outcome.uploaded
          ? `Knowledge: ${outcome.uploaded} document(s) → ${outcome.target}`
          : `Knowledge: ${outcome.target} is indexing your site in the background`,
      );
    } else {
      spinner.stop('Knowledge: nothing to index');
    }
  };
  const storeInConfig = project.backend.type === 'openai' || project.backend.type === 'gemini';
  if (storeInConfig) await finishKnowledge();

  const deployFlag = bool(ctx.flags, 'deploy');
  let shouldDeploy = deployFlag ?? false;
  if (ctx.interactive) {
    p.log.success(`Wrote ${result.files.join(', ')}${result.secrets.length ? ` and ${result.secrets.length} secret(s) to .env` : ''}`);
    if (Object.keys(result.assumed).length) {
      p.log.info(`Defaults: ${Object.entries(result.assumed).map(([k, v]) => `${k} = ${v}`).join(' · ')}`);
    }
    if (result.adminPassword) {
      p.note(
        `Email     ${project.dashboard.adminEmail}\nPassword  ${c.bold(result.adminPassword)}\n\n${c.dim('Save it now — it is stored only as a hash. Change it any time with `murmur users reset`.')}`,
        'Dashboard sign-in',
      );
    }
    if (deployFlag === undefined) {
      const answer = await p.confirm({ message: 'Deploy it to Cloudflare now?', initialValue: true });
      shouldDeploy = !p.isCancel(answer) && answer === true;
    }
  }

  if (!shouldDeploy) {
    await finishKnowledge();
    out.result({ ...summary, next: ['murmur deploy --json', 'murmur chat "<question>" --json'] }, () => {
      p.outro(`Next: ${c.cyan('murmur deploy')}  — then ${c.cyan('murmur chat "a question"')} to test it.`);
    });
    return 0;
  }

  // A background job owns the knowledge; deploy must not start a second one.
  const deployed = await runDeploy(ctx, knowledgeReady || result.background ? { knowledge: 'skip' } : {});
  out.result({ ...summary, deploy: deployed }, () => printDeployed(deployed, !result.background));
  if (!storeInConfig && result.background) {
    await finishKnowledge();
    p.outro(`Test it: ${c.cyan('murmur chat "a question a visitor would ask"')}`);
  }
  return 0;
}

async function runDeploy(ctx: Ctx, options: Parameters<typeof deploy>[1]): Promise<DeployResult> {
  const loaded = loadProject(ctx.cwd);
  writeSchemaFile(loaded.dir);
  const spinner = ctx.interactive ? p.spinner() : null;
  spinner?.start('Deploying');
  try {
    const result = await deploy(loaded, {
      ...options,
      progress: spinner ? (m) => spinner.message(m) : ctx.out.progress,
    });
    spinner?.stop(result.healthy ? 'Deployed' : 'Deployed (still starting up)');
    return result;
  } catch (thrown) {
    spinner?.error('Deploy failed');
    throw thrown;
  }
}

function printDeployed(result: DeployResult, first = false): void {
  const lines = [
    `${c.bold('Preview')}   ${c.cyan(result.preview)}`,
    ...(result.dashboard ? [`${c.bold('Dashboard')} ${c.cyan(result.dashboard)}`] : []),
    `${c.bold('Embed')}     ${result.embed}`,
    `${c.bold('Account')}   ${result.account.name ?? result.account.id}`,
  ];
  if (result.knowledge && result.knowledge.target !== 'none') {
    lines.push(`${c.bold('Knowledge')} ${result.knowledge.uploaded} document(s) → ${result.knowledge.target}`);
  }
  if (result.indexing) lines.push(`${c.bold('Indexing')}  ${describeIndexing(result.indexing)}`);
  if (result.secretsUploaded.length) lines.push(`${c.bold('Secrets')}   ${result.secretsUploaded.join(', ')}`);
  if (!result.workerDeployed) lines.push(c.dim('Only content changed, so the Worker was not re-uploaded.'));
  for (const warning of result.warnings) lines.push(`${c.yellow('!')} ${warning}`);
  if (first) {
    p.note(lines.join('\n'), 'Your assistant is live');
    p.outro(`Test it: ${c.cyan('murmur chat "a question a visitor would ask"')}`);
  } else {
    process.stdout.write(`${lines.join('\n')}\n`);
  }
}

export async function deployCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['knowledge', 'skip-knowledge', 'force', 'dry-run', 'cf-account'], 'deploy');
  const knowledge = ctx.flags['knowledge'] ? 'force' : ctx.flags['skip-knowledge'] ? 'skip' : 'auto';
  const result = await runDeploy(ctx, {
    knowledge,
    forceWorker: Boolean(ctx.flags['force']),
    dryRun: Boolean(ctx.flags['dry-run']),
    cf: { accountId: str(ctx.flags, 'cf-account') },
  });
  ctx.out.result({ ...result, next: [`murmur chat "<question>" --json`] }, () => printDeployed(result));
  return 0;
}

export async function devCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['port'], 'dev');
  const loaded = loadProject(ctx.cwd);
  const env = loadEnv(loaded.dir);
  const wanted = Number(str(ctx.flags, 'port') ?? DEV_PORT);
  const port = await freePort(wanted);
  if (port !== wanted) ctx.out.warn(`Port ${wanted} is in use; using ${port}.`);
  const compiled = compile(loaded, { dev: true, devPort: port, runtimeVersion: runtimeVersion() });
  const devVars: Record<string, string> = { MURMUR_SECRET: env['MURMUR_SECRET'] ?? 'dev-secret-dev-secret-dev-secret-0000', MURMUR_LOG: '1' };
  const missing: string[] = [];
  for (const name of compiled.secrets) {
    if (env[name]) devVars[name] = env[name]!;
    else if (name !== 'MURMUR_SECRET') missing.push(name);
  }
  if (missing.length) ctx.out.warn(`Not set in .env: ${missing.join(', ')} — replies will fail until you run \`murmur secret set\`.`);

  const auth = aiSearchInstanceFor(loaded.project)
    ? await cloudflareSession(env)
        .then((s) => ({ accountId: s.accountId, ...(s.source === 'api-token' ? { token: s.token } : {}) }))
        .catch(() => undefined)
    : undefined;
  const dir = writeWorker(loaded.dir, compiled, loaded.project, { dev: true, devVars });
  writeFileSync(join(dir, 'port'), String(port));
  ctx.out.info(`Starting on http://localhost:${port} — open it to try the widget. Ctrl-C to stop.`);
  const { code } = await runWrangler(['dev', '--config', 'wrangler.json', '--port', String(port)], {
    cwd: dir,
    inherit: true,
    ...(auth ? { auth } : {}),
  });
  return code;
}

/** The first free port from `start`, so a dev server already running is left alone. */
function freePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(start < 65535 ? freePort(start + 1) : start));
    server.listen(start, '127.0.0.1', () => server.close(() => resolve(start)));
  });
}

export function describeIndexing(status: IndexingStatus): string {
  const source = status.crawler ? `Cloudflare is crawling ${status.crawler}` : `instance ${status.instance}`;
  if (status.done) return `${status.indexed} document(s) indexed (${source})${status.failed ? `, ${status.failed} failed` : ''}`;
  return `${status.indexed} indexed, ${status.pending} in progress — ${source}. It is live now; answers get better as this finishes (\`murmur knowledge status\`).`;
}

export async function knowledgeCommand(ctx: Ctx): Promise<number> {
  const sub = ctx.positionals[0];
  if (sub === 'status') {
    assertKnown(ctx.flags, [], 'knowledge');
    const loaded = loadProject(ctx.cwd);
    const cf = await cloudflareSession(loadEnv(loaded.dir));
    const status = await indexingStatus(cf.api, cf.accountId, loaded.project);
    ctx.out.result({ indexing: status }, () =>
      process.stdout.write(`${status ? describeIndexing(status) : 'This backend has no AI Search index; see `murmur status`.'}\n`),
    );
    return 0;
  }
  if (sub !== 'sync') {
    throw new CliError('usage', 'Usage: murmur knowledge sync | status', { exitCode: 2, hint: 'murmur knowledge --help' });
  }
  assertKnown(ctx.flags, [], 'knowledge');
  const loaded = loadProject(ctx.cwd);
  const env = loadEnv(loaded.dir);
  const needsCloudflare = Boolean(aiSearchInstanceFor(loaded.project));
  const cf = needsCloudflare ? await cloudflareSession(env) : undefined;
  const result = await syncKnowledge(loaded, { env, progress: ctx.out.progress, ...(cf ? { cf } : {}) });
  if (result.backendUpdate) {
    updateProject(loaded, (raw) => Object.assign(raw['backend'] as object, result.backendUpdate));
  }
  const next = result.backendUpdate ? ['murmur deploy --json   (publishes the new store id)'] : [];
  ctx.out.result({ ...result, next }, () => {
    ctx.out.success(
      result.target === 'none'
        ? 'Nothing to sync: this backend has no knowledge base, or there is no website or files configured.'
        : `${result.uploaded} document(s) → ${result.target} (${result.pages} page(s), ${result.files} file(s)${result.removed ? `, ${result.removed} removed` : ''})`,
    );
    for (const skipped of result.skipped) ctx.out.warn(`Skipped ${skipped}`);
    if (next.length) ctx.out.info(`Run ${c.cyan('murmur deploy')} to switch the assistant to the new knowledge.`);
  });
  return 0;
}
