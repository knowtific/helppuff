import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError } from '../errors.js';
import { generatePassword, gitEmail, hashPassword } from './admins.js';
import { CloudflareApi } from './cloudflare.js';
import { ensureGitignore, loadEnv, writeEnvVar } from './env.js';
import { generateProject, writeAgentFiles } from './generate.js';
import { checkKey } from './providers.js';
import { PROJECT_FILE, PROMPT_FILE, parseProject, saveProject, type BackendType, type LoadedProject, type Project } from './project.js';
import {
  LATE_QUESTIONS,
  LEAD_FORM_FIELDS,
  PROVIDER_KEYS,
  defaultAnswer,
  describeForAgent,
  pendingQuestions,
  type Answers,
  type Facts,
  type Question,
} from './questions.js';
import { writeSchemaFile } from './schema.js';
import { inspectSite, normalizeUrl } from './site.js';
import { wranglerOAuthToken } from './wrangler-auth.js';

/**
 * `murmur init` without the terminal: gather facts, work out what is still
 * unknown, then either ask (through `ask`, the wizard) or hand the questions
 * back (for an agent), and finally write the project.
 */

export type Ask = (question: Question) => Promise<unknown>;

/** Returned by a wizard that ran `wrangler login` instead of taking a token. */
export const LOGGED_IN = Symbol('wrangler-login');

export type InitResult =
  | { status: 'needs_input'; questions: ReturnType<typeof describeForAgent>[]; assumed: Record<string, unknown>; known: Answers }
  | {
      status: 'created';
      dir: string;
      project: Project;
      files: string[];
      secrets: string[];
      assumed: Record<string, string>;
      site: { name: string | null; accent: string | null; reachable: boolean } | null;
      /** The background knowledge job, when one was started: await before exiting. */
      background?: Promise<unknown>;
      /** Only when murmur generated it: shown once, never stored in clear. */
      adminPassword?: string;
      warnings: string[];
    };

const BACKENDS: BackendType[] = ['cloudflare', 'openai', 'gemini', 'anthropic', 'http', 'retell', 'echo'];

/** Check one answer; returns an error message, or null when it is fine. */
export function validateAnswer(question: Question, value: unknown, facts: Facts): string | null {
  if (value === undefined || value === '') return question.required ? 'This one is needed.' : null;
  switch (question.id) {
    case 'website':
      if (value === 'none') return null;
      try {
        normalizeUrl(String(value));
        return null;
      } catch (thrown) {
        return (thrown as Error).message;
      }
    case 'backend':
      return BACKENDS.includes(value as BackendType) ? null : `Pick one of: ${BACKENDS.join(', ')}`;
    case 'httpUrl':
    case 'endpoint':
      try {
        const url = new URL(String(value));
        return url.protocol === 'https:' || url.hostname === 'localhost' ? null : 'Use an https:// URL.';
      } catch {
        return 'That is not a URL.';
      }
    case 'httpMode':
      return value === 'murmur' || value === 'openai' ? null : 'Use murmur or openai.';
    case 'adminEmail':
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value)) ? null : 'That is not an email address.';
    case 'adminPassword':
      return String(value).length >= 10 ? null : 'Use at least 10 characters, or leave it empty to generate one.';
    case 'goal':
      return ['answer', 'leads', 'book', 'sell'].includes(String(value)) ? null : 'Use answer, leads, book or sell.';
    case 'leadForm': {
      if (value === 'none') return null;
      const fields = String(value).split(',').map((s) => s.trim());
      return fields.length > 0 && fields.every((f) => (LEAD_FORM_FIELDS as readonly string[]).includes(f))
        ? null
        : 'Use none, or fields from name,email,phone.';
    }
    case 'agentName':
      return String(value).length <= 60 ? null : 'Keep it under 60 characters.';
    case 'cfAccount':
      return facts.accounts && !facts.accounts.some((a) => a.id === value) ? 'That account is not available to this token.' : null;
    case 'aiSearch':
      return value === 'new' || value === 'endpoint' || /^[a-z0-9][a-z0-9_-]{0,63}$/.test(String(value))
        ? null
        : 'Use new, endpoint, or an instance name.';
    default:
      return null;
  }
}

async function gatherFacts(answers: Answers, facts: Facts, doFetch: typeof fetch, progress?: (m: string) => void) {
  if (answers.website && answers.website !== 'none' && facts.site === undefined) {
    progress?.(`Looking at ${answers.website}…`);
    facts.site = await inspectSite(answers.website, doFetch);
    if (!facts.site.reachable) progress?.(`Could not load ${facts.site.url}; using defaults for name and colour.`);
  }

  if (facts.cloudflareLogin === undefined) {
    facts.cloudflareLogin = !answers.cfToken && !facts.env['CLOUDFLARE_API_TOKEN'] && Boolean(await wranglerOAuthToken());
  }
  const token = answers.cfToken || facts.env['CLOUDFLARE_API_TOKEN'] || (facts.cloudflareLogin ? await wranglerOAuthToken() : null);
  if (token && facts.accounts === undefined) {
    progress?.('Checking the Cloudflare token…');
    try {
      facts.accounts = await new CloudflareApi(token, doFetch).accounts();
    } catch (thrown) {
      if (facts.env['CLOUDFLARE_ACCOUNT_ID']) facts.accounts = null;
      else throw thrown;
    }
  }

  const account =
    answers.cfAccount || facts.env['CLOUDFLARE_ACCOUNT_ID'] || (facts.accounts?.length === 1 ? facts.accounts[0]!.id : undefined);
  const wantsSearch = answers.backend === 'cloudflare' || answers.backend === 'anthropic';
  if (token && account && wantsSearch && facts.instances === undefined) {
    try {
      facts.instances = await new CloudflareApi(token, doFetch).aiSearchInstances(account);
    } catch {
      facts.instances = null;
    }
  }
}

export async function runInit(options: {
  cwd: string;
  answers: Answers;
  ask?: Ask | null;
  yes?: boolean;
  force?: boolean;
  agentFiles?: boolean;
  fetch?: typeof fetch;
  progress?: (message: string) => void;
  /**
   * Started once, as soon as only the late questions remain: the draft
   * project is complete enough to build the knowledge base while the owner
   * answers the rest.
   */
  background?: (draft: LoadedProject, env: Record<string, string>) => Promise<unknown>;
}): Promise<InitResult> {
  const { cwd, progress } = options;
  const doFetch = options.fetch ?? fetch;
  if (existsSync(join(cwd, PROJECT_FILE)) && !options.force) {
    throw new CliError('project_exists', `${PROJECT_FILE} already exists here.`, {
      hint: 'Edit it and run `murmur deploy`, or pass --force to start over.',
    });
  }

  const answers: Answers = { ...options.answers };
  const assumed: Record<string, string> = {};
  const facts: Facts = {
    env: loadEnv(cwd),
    knowledgeDir: existsSync(join(cwd, 'knowledge')) ? './knowledge' : null,
    gitEmail: gitEmail(cwd),
  };

  let background: Promise<unknown> | undefined;
  const startBackground = () => {
    if (background || !options.background) return;
    const draft = generateProject(answers, facts);
    const project = parseProject(draft.project);
    const loaded: LoadedProject = { dir: cwd, file: join(cwd, PROJECT_FILE), raw: draft.project as Record<string, unknown>, project };
    background = options.background(loaded, { ...facts.env, ...draft.secrets }).catch((thrown: unknown) => ({ error: thrown }));
  };

  for (let round = 0; round < 40; round++) {
    await gatherFacts(answers, facts, doFetch, progress);
    const pending = pendingQuestions(answers, facts);
    if (pending.every((q) => LATE_QUESTIONS.includes(q.id))) startBackground();
    if (pending.length === 0) break;

    if (options.ask) {
      const next = pending.find((q) => q.required || q.wizard);
      if (!next) break;
      const value = await options.ask(next);
      if (value === LOGGED_IN) {
        facts.cloudflareLogin = undefined;
        facts.accounts = undefined;
        continue;
      }
      const problem = validateAnswer(next, value, facts);
      if (problem) {
        progress?.(problem);
        continue;
      }
      (answers as Record<string, unknown>)[next.id] = value === '' && next.kind !== 'secret' ? defaultAnswer(next) : value;
      if (next.id === 'backend') facts.instances = undefined;
      continue;
    }

    const blocking = pending.filter((q) => q.required && !(options.yes && q.default !== undefined));
    if (blocking.length > 0) {
      return {
        status: 'needs_input',
        questions: blocking.map(describeForAgent),
        assumed: Object.fromEntries(
          pending.filter((q) => !blocking.includes(q) && q.default !== undefined).map((q) => [q.id, q.default]),
        ),
        known: redactAnswers(answers),
      };
    }
    // Everything left has a default: take them all and look again, since
    // an answer (the backend, say) can open new questions.
    for (const q of pending) {
      const value = defaultAnswer(q);
      (answers as Record<string, unknown>)[q.id] = value;
      if (q.default !== undefined && q.default !== '') assumed[q.id] = String(q.default);
    }
  }

  for (const [id, value] of Object.entries(answers)) {
    const question = { id, required: false, kind: 'text' } as Question;
    const problem = validateAnswer(question, value, facts);
    if (problem) throw new CliError('invalid_answer', `--${id}: ${problem}`, { exitCode: 2 });
  }

  const warnings: string[] = [];
  const backend = answers.backend ?? 'cloudflare';
  const keyName = PROVIDER_KEYS[backend];
  const key = answers.apiKey || (keyName ? facts.env[keyName] : undefined);
  if (keyName && key) {
    progress?.(`Checking the ${keyName}…`);
    const agentId = answers.retellAgent;
    const result = await checkKey(backend as 'openai', key, agentId ? { agentId } : {}, doFetch);
    if (result.ok === false) {
      throw new CliError('invalid_api_key', `${keyName} was rejected: ${result.reason}.`, {
        hint: 'Check the key and run again.',
      });
    }
    if (result.ok === 'unknown') warnings.push(`Could not verify ${keyName}: ${result.reason}`);
  }

  // The dashboard password: hashed here, stored as a hash, shown once if generated.
  let generatedPassword: string | undefined;
  const dashboard = answers.dashboard !== false && Boolean(answers.adminEmail);
  if (dashboard) {
    const password = answers.adminPassword || (generatedPassword = generatePassword());
    writeEnvVar(cwd, 'ADMIN_PASSWORD_HASH', hashPassword(password));
  }

  const generated = generateProject(answers, facts);
  const project = parseProject(generated.project);
  saveProject(cwd, generated.project);
  const files = [PROJECT_FILE];
  if (!existsSync(join(cwd, PROMPT_FILE)) || options.force) {
    writeFileSync(join(cwd, PROMPT_FILE), generated.prompt);
    files.push(PROMPT_FILE);
  }
  for (const [name, value] of Object.entries(generated.secrets)) writeEnvVar(cwd, name, value);
  ensureGitignore(cwd, ['.env', '.murmur/']);
  writeSchemaFile(cwd);
  if (options.agentFiles !== false) files.push(...writeAgentFiles(cwd));

  return {
    status: 'created',
    dir: cwd,
    project,
    files,
    secrets: Object.keys(generated.secrets),
    assumed: { ...generated.assumed, ...assumed },
    site: facts.site ? { name: facts.site.name, accent: facts.site.accent, reachable: facts.site.reachable } : null,
    ...(generatedPassword ? { adminPassword: generatedPassword } : {}),
    ...(background ? { background } : {}),
    warnings,
  };
}

function redactAnswers(answers: Answers): Answers {
  const out: Answers = { ...answers };
  for (const key of ['apiKey', 'cfToken', 'httpToken', 'adminPassword'] as const) if (out[key]) out[key] = '<provided>';
  return out;
}
