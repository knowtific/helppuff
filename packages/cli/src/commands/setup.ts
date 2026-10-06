import * as p from '@clack/prompts';
import { assertKnown, bool, str } from '../args.js';
import { CliError } from '../errors.js';
import { c } from '../output.js';
import { runtimeVersion, writeWorker } from '../engine/build.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { openBrowser } from '../engine/browser.js';
import { compile, DEV_PORT } from '../engine/compile.js';
import { cloudflareSession } from '../engine/credentials.js';
import { deploy, type CrawlRequest, type DeployResult } from '../engine/deploy.js';
import { loadEnv } from '../engine/env.js';
import { LOGGED_IN, runInit, type InitResult } from '../engine/init.js';
import { wranglerLogin } from '../engine/wrangler-auth.js';
import { syncKnowledge, type IndexingStatus, type SyncResult } from '../engine/knowledge.js';
import { aiSearchInstanceFor, hasKnowledge, loadProject, updateProject, usesHelpPuffKnowledge, type LoadedProject, type Project } from '../engine/project.js';
import type { Answers, Question } from '../engine/questions.js';
import { writeSchemaFile } from '../engine/schema.js';
import { readState, writeState, type State } from '../engine/state.js';
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
  if (question.help && question.kind === 'confirm') p.note(question.help, 'The default setup');
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
  if (typeof f['defaults'] === 'boolean') answers.defaults = f['defaults'];
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
  set('cfAccount', str(f, 'cf-account') ?? str(f, 'account-id'));
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
    ['url', 'name', 'defaults', 'backend', 'model', 'api-key', 'ai-search', 'ai-search-endpoint', 'http-url', 'http-mode', 'http-token', 'retell-agent', 'docs', 'cf-token', 'cf-account', 'account-id', 'admin-email', 'admin-password', 'dashboard', 'agent-name', 'goal', 'notes', 'lead-form', 'yes', 'y', 'deploy', 'force', 'crawl', 'crawl-file', 'onboarding', 'browser', 'non-interactive'],
    'init',
  );
  const { out } = ctx;
  const browser = ctx.interactive && ctx.flags['browser'] !== false;
  const crawl = crawlFrom(ctx);
  // A bad --onboarding fails here, before anything is written.
  onboardingFrom(ctx, browser, crawl);
  if (ctx.interactive) p.intro(c.bold(' An AI assistant for your website '));

  // In the wizard, the knowledge base starts building while the last few
  // questions are answered; its progress is shown once they are done.
  let knowledgeProgress = 'Building the knowledge base…';
  const result: InitResult = await runInit({
    cwd: ctx.cwd,
    answers: answersFrom(ctx),
    ask: ctx.interactive ? ask : null,
    yes: Boolean(ctx.flags['yes'] || ctx.flags['y']),
    force: Boolean(ctx.flags['force']),
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
      next: 'Ask the user these questions, then re-run `helppuff init` with the given flags plus everything already known.',
    });
  }

  for (const warning of result.warnings) out.warn(warning);
  const project = result.project;
  const onboarding = projectOnboarding(ctx, result.dir, browser, crawl);
  const handOver = agentOnboarding(ctx, project, onboarding);
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
      spinner.error(`Knowledge was not ready: ${(outcome.error as Error).message}. Run \`helppuff knowledge sync\` to retry.`);
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

  // A person at a terminal gets it deployed straight away; an agent asks with --deploy.
  const deployFlag = bool(ctx.flags, 'deploy');
  const shouldDeploy = deployFlag ?? ctx.interactive;
  if (ctx.interactive && result.adminPassword) {
    p.note(
      `Email     ${project.dashboard.adminEmail}\nPassword  ${c.bold(result.adminPassword)}\n\n${c.dim('Shown once — it is stored only as a hash.')}`,
      'Dashboard sign-in',
    );
  }

  if (!shouldDeploy) {
    await finishKnowledge();
    const next = `helppuff deploy${handOver === 'dashboard' ? ' --onboarding dashboard' : ''}`;
    out.result({ ...summary, next: [`${next} --json`] }, () => p.outro(`Next: ${c.cyan(next)}`));
    return 0;
  }

  // A person normally picks pages on the setup page. An agent or --no-browser
  // run defaults to doing that work itself, unless it explicitly hands
  // onboarding to the user with --onboarding dashboard.
  // A background job owns the knowledge; deploy must not start a second one.
  const deployed = await runDeploy(ctx, {
    ...(knowledgeReady || result.background ? { knowledge: 'skip' as const } : {}),
    ...(crawl ? { crawl } : {}),
    unattended: unattendedFrom(ctx, onboarding),
  });
  if (!storeInConfig && result.background) await finishKnowledge();
  if (deployed.setupUrl && browser) openBrowser(deployed.setupUrl);
  out.result({ ...summary, deploy: deployed, next: nextSteps(deployed, handOver) }, () => printDeployed(deployed, ctx.interactive, onboarding === 'defaults'));
  return 0;
}

async function runDeploy(ctx: Ctx, options: Parameters<typeof deploy>[1], loaded: LoadedProject = loadProject(ctx.cwd)): Promise<DeployResult> {
  writeSchemaFile(loaded.dir);
  const spinner = ctx.interactive ? p.spinner() : null;
  spinner?.start('Setting up on your Cloudflare account');
  try {
    const result = await deploy(loaded, {
      ...options,
      progress: spinner ? (m) => spinner.message(m.trim()) : ctx.out.progress,
    });
    spinner?.stop(result.healthy ? 'Live on Cloudflare' : 'Deployed — it can take a minute to answer');
    return result;
  } catch (thrown) {
    spinner?.error('Deploy failed');
    throw thrown;
  }
}

/** `--crawl all | suggested | none | <globs>` and `--crawl-file urls.txt`. */
export function crawlFrom(ctx: Ctx): CrawlRequest | undefined {
  const file = str(ctx.flags, 'crawl-file');
  if (file) {
    const path = resolve(ctx.cwd, file);
    if (!existsSync(path)) throw new CliError('usage', `No such file: ${file}`, { exitCode: 2 });
    return { mode: 'urls', urls: readFileSync(path, 'utf8').split(/\s+/).filter((u) => /^https?:\/\//.test(u)) };
  }
  const value = str(ctx.flags, 'crawl');
  if (!value || value === 'none') return undefined;
  if (value === 'all' || value === 'suggested') return { mode: value };
  return { mode: 'match', include: value.split(',').map((g) => g.trim()).filter(Boolean) };
}

type OnboardingMode = NonNullable<State['onboarding']>;

/**
 * Who does onboarding: HelpPuff (`defaults`: learn the suggested pages, read
 * the business details) or the user on the setup page (`dashboard`). An
 * explicit --onboarding wins; then the choice an earlier init or deploy saved
 * (unless pages were asked for with --crawl); then a person with a browser
 * gets the setup page and anyone else the defaults.
 */
export function onboardingFrom(ctx: Ctx, browser: boolean, crawl: CrawlRequest | undefined, saved?: OnboardingMode): OnboardingMode {
  const value = str(ctx.flags, 'onboarding');
  if (value !== undefined && value !== 'defaults' && value !== 'dashboard') {
    throw new CliError('usage', `--onboarding must be "defaults" or "dashboard"; got "${value}".`, { exitCode: 2 });
  }
  if (value === 'dashboard' && crawl) {
    throw new CliError('usage', '--onboarding dashboard cannot be combined with --crawl or --crawl-file; the user chooses pages in the dashboard.', { exitCode: 2 });
  }
  if (value) return value;
  if (saved && !crawl) return saved;
  return browser ? 'dashboard' : 'defaults';
}

/** onboardingFrom for a project folder: an explicit --onboarding is saved in .helppuff/state.json for the next deploy. */
export function projectOnboarding(ctx: Ctx, dir: string, browser: boolean, crawl: CrawlRequest | undefined): OnboardingMode {
  const state = readState(dir);
  const mode = onboardingFrom(ctx, browser, crawl, state.onboarding);
  if (str(ctx.flags, 'onboarding') && !ctx.flags['dry-run'] && state.onboarding !== mode) writeState(dir, { ...state, onboarding: mode });
  return mode;
}

/** Whether deploy does onboarding itself. `--crawl none` learns nothing now, whoever onboards. */
export function unattendedFrom(ctx: Ctx, onboarding: OnboardingMode): boolean {
  return onboarding === 'defaults' && str(ctx.flags, 'crawl') !== 'none';
}

/**
 * The onboarding an agent's next steps describe. Only workers-ai has a setup
 * page that chooses pages; other backends learn during deploy, so for them it
 * is always the defaults.
 */
function agentOnboarding(ctx: Ctx, project: Project, onboarding: OnboardingMode): OnboardingMode {
  if (usesHelpPuffKnowledge(project)) return onboarding;
  if (str(ctx.flags, 'onboarding') === 'dashboard') ctx.out.warn(`--onboarding dashboard applies to the workers-ai backend only; ignored for ${project.backend.type}.`);
  return 'defaults';
}

export function nextSteps(result: DeployResult, onboarding: OnboardingMode = 'defaults'): string[] {
  if (onboarding === 'dashboard') {
    const link = result.setupUrl
      ? `the dashboard setup link ${result.setupUrl} (one-time, 24h)`
      : `the dashboard ${result.dashboard ?? result.url} (if they cannot sign in, \`helppuff dashboard --json\` makes a sign-in link)`;
    return [
      `Give the user ${link}. They will choose the pages and confirm business details there; nothing is learned until they do.`,
      `You can add the widget now with deploy.embed and share the demo ${result.preview}.`,
      'helppuff knowledge status --json   (test answers with `helppuff ask` only once the user has started learning and it has finished)',
    ];
  }
  return [
    ...(result.crawl ? ['helppuff knowledge status --json   (learning runs in the background on Cloudflare; nothing to wait for)'] : []),
    'helppuff ask "<a question a visitor would ask>" --json',
    result.setupUrl
      ? `Give the user three things: the dashboard link ${result.setupUrl} (one-time, 24h: they create their sign-in there), the script (deploy.embed) and the demo ${result.preview}`
      : `Give the user three things: the dashboard ${result.dashboard ?? result.url}, the script (deploy.embed) and the demo ${result.preview}`,
  ];
}

/**
 * For a person about to do onboarding: one link, nothing else — the setup
 * page until the assistant is set up, then the dashboard (where the test
 * chat, the snippet and the demo link live).
 *
 * When onboarding was done here instead (`unattended`: an agent, or
 * --no-browser), the result: the dashboard, the script and the demo.
 * Warnings still show — they are things to act on.
 */
function printDeployed(result: DeployResult, wizard = false, unattended = false): void {
  for (const warning of result.warnings) (wizard ? p.log.warn : (m: string) => process.stdout.write(`${c.yellow('!')} ${m}\n`))(warning);
  const dashboard = result.setupUrl
    ? `${c.cyan(result.setupUrl)} ${c.dim('(one-time link: create your sign-in)')}`
    : result.dashboard
      ? c.cyan(result.dashboard)
      : null;
  const lines = unattended
    ? [
        ...(dashboard ? [`Dashboard  ${dashboard}`] : []),
        `Demo       ${c.cyan(result.preview)}`,
        `Script     ${result.embed}`,
        ...(result.crawl ? [c.dim(`Learning ${result.crawl.total} pages in the background on Cloudflare — answers improve as it goes.`)] : []),
      ]
    : [result.setupUrl ? `Finish setting up: ${dashboard}` : dashboard ? `Dashboard: ${dashboard}` : `Live: ${c.cyan(result.preview)}`];
  if (wizard) p.outro(lines.join('\n'));
  else process.stdout.write(`${lines.join('\n')}\n`);
}

export async function deployCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['knowledge', 'skip-knowledge', 'force', 'dry-run', 'cf-account', 'account-id', 'crawl', 'crawl-file', 'onboarding', 'overwrite-settings', 'allow-downgrade', 'browser', 'yes', 'y', 'non-interactive'], 'deploy');
  const knowledge = ctx.flags['knowledge'] ? 'force' : ctx.flags['skip-knowledge'] ? 'skip' : 'auto';
  const crawl = crawlFrom(ctx);
  const browser = ctx.interactive && ctx.flags['browser'] !== false;
  const loaded = loadProject(ctx.cwd);
  const onboarding = projectOnboarding(ctx, loaded.dir, browser, crawl);
  const result = await runDeploy(ctx, {
    unattended: unattendedFrom(ctx, onboarding),
    knowledge,
    forceWorker: Boolean(ctx.flags['force']),
    dryRun: Boolean(ctx.flags['dry-run']),
    overwriteSettings: Boolean(ctx.flags['overwrite-settings']),
    allowDowngrade: Boolean(ctx.flags['allow-downgrade']),
    cf: { accountId: str(ctx.flags, 'cf-account') ?? str(ctx.flags, 'account-id') },
    ...(crawl ? { crawl } : {}),
  }, loaded);
  if (result.setupUrl && browser) openBrowser(result.setupUrl);
  ctx.out.result({ ...result, next: nextSteps(result, agentOnboarding(ctx, loaded.project, onboarding)) }, () => printDeployed(result, false, onboarding === 'defaults'));
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
  const devVars: Record<string, string> = {
    HELPPUFF_SECRET: env['HELPPUFF_SECRET'] ?? 'dev-secret-dev-secret-dev-secret-0000',
    ADMIN_API_KEY: env['ADMIN_API_KEY'] ?? 'dev-admin-key-dev-admin-key-dev-admin-key',
    HELPPUFF_LOG: '1',
  };
  const missing: string[] = [];
  for (const name of compiled.secrets) {
    if (env[name]) devVars[name] = env[name]!;
    else if (!devVars[name]) missing.push(name);
  }
  if (missing.length) ctx.out.warn(`Not set in .env: ${missing.join(', ')} — replies will fail until you run \`helppuff secret set\`.`);

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
  return `${status.indexed} indexed, ${status.pending} in progress — ${source}. It is live now; answers get better as this finishes (\`helppuff knowledge status\`).`;
}
