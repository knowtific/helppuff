import { createInterface } from 'node:readline/promises';
import * as p from '@clack/prompts';
import { assertKnown, str } from '../args.js';
import { CliError } from '../errors.js';
import { c } from '../output.js';
import { chat, type ChatTurn } from '../engine/chat.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, DEV_PORT, devOrigin, embedSnippet } from '../engine/compile.js';
import { cloudflareSession } from '../engine/credentials.js';
import { doctor } from '../engine/doctor.js';
import { loadEnv, redact, writeEnvVar } from '../engine/env.js';
import { GENERATED_DIR, loadProject, updateProject, workerNameFor, type LoadedProject } from '../engine/project.js';
import { projectJsonSchema, writeSchemaFile } from '../engine/schema.js';
import type { Ctx } from './context.js';

function target(ctx: Ctx, loaded: LoadedProject): { url: string; origin: string } {
  if (ctx.flags['local']) {
    const file = join(loaded.dir, GENERATED_DIR, 'dev', 'port');
    const port = Number(str(ctx.flags, 'port') ?? (existsSync(file) ? readFileSync(file, 'utf8').trim() : DEV_PORT));
    return { url: `http://localhost:${port}`, origin: devOrigin(port) };
  }
  const url = str(ctx.flags, 'url') ?? loaded.project.cloudflare.url;
  if (!url) {
    throw new CliError('not_deployed', 'This assistant has not been deployed yet.', {
      hint: 'murmur deploy   (or `murmur dev` and then `murmur chat --local`)',
    });
  }
  // The Worker's own origin is always allowed: it is where the preview page lives.
  return { url, origin: new URL(url).origin };
}

export async function chatCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['session', 'local', 'url', 'port'], 'chat');
  const loaded = loadProject(ctx.cwd);
  const { url, origin } = target(ctx, loaded);
  const message = ctx.positionals.join(' ').trim();

  if (message) {
    const secret = loadEnv(loaded.dir)['MURMUR_SECRET'];
    const turn = await chat({ url, site: loaded.project.site, origin, message, session: str(ctx.flags, 'session'), secret });
    ctx.out.result(
      { reply: turn.reply, messages: turn.messages, session: turn.session, next: ['Continue with: murmur chat "<message>" --session <session> --json'] },
      () => process.stdout.write(`${turn.reply || c.dim('(no reply)')}\n`),
    );
    return 0;
  }

  if (!ctx.interactive) {
    throw new CliError('usage', 'Give the message to send: murmur chat "your question"', { exitCode: 2 });
  }
  process.stdout.write(c.dim(`Chatting with ${url} as a visitor. Empty line or Ctrl-C to quit.\n\n`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let session: string | undefined;
  try {
    for (;;) {
      const line = (await rl.question(c.cyan('you › '))).trim();
      if (!line) break;
      const turn: ChatTurn = await chat({ url, site: loaded.project.site, origin, message: line, session, secret: loadEnv(loaded.dir)['MURMUR_SECRET'] });
      session = turn.session;
      process.stdout.write(`${c.bold('bot › ')}${turn.reply.replace(/\n/g, '\n      ')}\n\n`);
    }
  } finally {
    rl.close();
  }
  return 0;
}

export async function statusCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, [], 'status');
  const loaded = loadProject(ctx.cwd);
  const { project } = loaded;
  const url = project.cloudflare.url;
  const status = {
    site: project.site,
    name: project.name,
    backend: project.backend,
    website: project.website ?? null,
    origins: project.origins,
    deployed: Boolean(url),
    url: url ?? null,
    preview: url ? `${url}/` : null,
    embed: url ? embedSnippet(url, project.site) : null,
    worker: workerNameFor(project),
    next: url ? ['murmur chat "<question>" --json', 'murmur doctor --json'] : ['murmur deploy --json'],
  };
  ctx.out.result(status, () => {
    const backend = project.backend as Record<string, unknown>;
    const lines = [
      `${c.bold(project.name)} ${c.dim(`(${project.site})`)}`,
      `  backend   ${backend['type']}${backend['model'] ? ` · ${String(backend['model'])}` : ''}`,
      `  website   ${project.website ?? c.dim('none')}`,
      url ? `  preview   ${c.cyan(`${url}/`)}` : `  deployed  ${c.yellow('not yet')} — run ${c.cyan('murmur deploy')}`,
      ...(url ? [`  embed     ${embedSnippet(url, project.site)}`] : []),
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  });
  return 0;
}

export async function doctorCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, [], 'doctor');
  const report = await doctor(ctx.cwd);
  ctx.out.result(report, () => {
    const icon = { pass: c.green('✔'), fail: c.red('✖'), warn: c.yellow('!'), skip: c.dim('–') };
    for (const check of report.checks) {
      process.stdout.write(`${icon[check.status]} ${c.bold(check.name.padEnd(14))} ${check.detail}\n`);
      if (check.fix && check.status !== 'pass') process.stdout.write(c.dim(`${check.fix.split('\n').map((l) => `                 → ${l}`).join('\n')}\n`));
    }
  });
  return report.ok ? 0 : 1;
}

export async function embedCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, [], 'embed');
  const loaded = loadProject(ctx.cwd);
  const url = loaded.project.cloudflare.url;
  if (!url) throw new CliError('not_deployed', 'Not deployed yet, so there is no snippet.', { hint: 'murmur deploy' });
  const embed = embedSnippet(url, loaded.project.site);
  ctx.out.result({ embed, url }, () => process.stdout.write(`${embed}\n`));
  return 0;
}

async function readSecretValue(ctx: Ctx, name: string): Promise<string> {
  const flag = str(ctx.flags, 'value');
  if (flag !== undefined) return flag;
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const piped = Buffer.concat(chunks).toString('utf8').trim();
    if (piped) return piped;
  }
  if (ctx.interactive || process.stdin.isTTY) {
    const value = await p.password({ message: `Value for ${name}`, mask: '•' });
    if (p.isCancel(value)) process.exit(130);
    return String(value).trim();
  }
  throw new CliError('usage', `No value for ${name}. Pass --value, pipe it in, or run in a terminal.`, { exitCode: 2 });
}

export async function secretCommand(ctx: Ctx): Promise<number> {
  const [sub, name] = ctx.positionals;
  assertKnown(ctx.flags, ['value'], 'secret');
  const loaded = loadProject(ctx.cwd);

  if (sub === 'list') {
    const env = loadEnv(loaded.dir);
    let required: string[] = [];
    try {
      required = compile(loaded).secrets;
    } catch {
      // An invalid config still lists what is set.
    }
    let onWorker: string[] | null = null;
    if (loaded.project.cloudflare.url && env['CLOUDFLARE_API_TOKEN']) {
      const cf = await cloudflareSession(env).catch(() => null);
      onWorker = cf ? await cf.api.secretNames(cf.accountId, workerNameFor(loaded.project)).catch(() => null) : null;
    }
    const names = [...new Set([...required, 'CLOUDFLARE_API_TOKEN'])];
    const rows = names.map((n) => ({
      name: n,
      required: required.includes(n) || n === 'CLOUDFLARE_API_TOKEN',
      local: Boolean(env[n]),
      ...(env[n] ? { preview: redact(env[n]!) } : {}),
      ...(onWorker ? { onWorker: onWorker.includes(n) || n === 'CLOUDFLARE_API_TOKEN' ? onWorker.includes(n) : false } : {}),
    }));
    ctx.out.result({ secrets: rows }, () => {
      for (const row of rows) {
        const where = [row.local ? c.green('local') : c.red('missing locally'), row.onWorker === undefined || row.name === 'CLOUDFLARE_API_TOKEN' ? '' : row.onWorker ? c.green('worker') : c.yellow('not on worker')]
          .filter(Boolean)
          .join(' · ');
        process.stdout.write(`${row.name.padEnd(24)} ${where}${row.preview ? c.dim(`  ${row.preview}`) : ''}\n`);
      }
    });
    return 0;
  }

  if (sub !== 'set' || !name) {
    throw new CliError('usage', 'Usage: murmur secret set <NAME> [--value <v>]  |  murmur secret list', { exitCode: 2 });
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    throw new CliError('usage', `Secret names are UPPER_SNAKE_CASE; got "${name}".`, { exitCode: 2 });
  }
  const value = await readSecretValue(ctx, name);
  if (!value) throw new CliError('usage', 'Empty value; nothing was stored.', { exitCode: 2 });
  writeEnvVar(loaded.dir, name, value);

  let uploaded = false;
  const env = loadEnv(loaded.dir);
  const isWorkerSecret = !name.startsWith('CLOUDFLARE_');
  if (isWorkerSecret && loaded.project.cloudflare.url && env['CLOUDFLARE_API_TOKEN']) {
    const cf = await cloudflareSession(env);
    const worker = workerNameFor(loaded.project);
    if (await cf.api.workerExists(cf.accountId, worker)) {
      await cf.api.putSecret(cf.accountId, worker, name, value);
      uploaded = true;
    }
  }
  ctx.out.result({ name, stored: '.env', uploadedToWorker: uploaded }, () =>
    ctx.out.success(`${name} saved to .env${uploaded ? ' and set on the Worker' : ''}.`),
  );
  return 0;
}

function getPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), value);
}

function parseValue(text: string): unknown {
  if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(text) || /^[[{"]/.test(text.trim())) {
    try {
      return JSON.parse(text);
    } catch {
      // Falls through to a plain string.
    }
  }
  return text;
}

export async function configCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, [], 'config');
  const [sub, path, ...rest] = ctx.positionals;
  const loaded = loadProject(ctx.cwd);
  const keys = path ? path.split('.').filter(Boolean) : [];

  if (sub === 'get') {
    const value = keys.length ? getPath(loaded.project, keys) : loaded.project;
    ctx.out.result({ path: path ?? '', value }, () => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`));
    return 0;
  }
  if (sub === 'set' && keys.length && rest.length) {
    const value = parseValue(rest.join(' '));
    const updated = updateProject(loaded, (raw) => {
      let node = raw as Record<string, unknown>;
      for (const key of keys.slice(0, -1)) {
        if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
        node = node[key] as Record<string, unknown>;
      }
      node[keys.at(-1)!] = value;
    });
    compile(updated);
    ctx.out.result({ path, value, next: ['murmur deploy --json'] }, () =>
      ctx.out.success(`${path} = ${JSON.stringify(value)}. Run ${c.cyan('murmur deploy')} to publish.`),
    );
    return 0;
  }
  throw new CliError('usage', 'Usage: murmur config get [path]  |  murmur config set <path> <value>', { exitCode: 2 });
}

export async function validateCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, [], 'validate');
  const loaded = loadProject(ctx.cwd);
  const compiled = compile(loaded);
  writeSchemaFile(loaded.dir);
  const env = loadEnv(loaded.dir);
  const missing = compiled.secrets.filter((n) => n !== 'MURMUR_SECRET' && !env[n]);
  ctx.out.result({ valid: true, site: compiled.site, secrets: compiled.secrets, missingSecrets: missing }, () => {
    ctx.out.success(`murmur.json and ${loaded.project.prompt} are valid.`);
    if (missing.length) ctx.out.warn(`Set before deploying: ${missing.map((m) => `murmur secret set ${m}`).join(', ')}`);
  });
  return 0;
}

export async function schemaCommand(ctx: Ctx): Promise<number> {
  const schema = projectJsonSchema();
  process.stdout.write(`${JSON.stringify(ctx.out.json ? { ok: true, schema } : schema, null, 2)}\n`);
  return 0;
}
