import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, str } from './args.js';
import { CliError, EXIT } from './errors.js';
import { COMMAND_HELP, MAIN_HELP, VERSION, cliReferencePage, commandHelp } from './help.js';
import { configReferencePage } from './engine/reference.js';
import { apiReferencePages } from '@helppuff/server';
import { Output } from './output.js';
import { deployCommand, devCommand, initCommand } from './commands/setup.js';
import { askCommand, crawlCommand, discoverCommand, knowledgeCommand } from './commands/knowledge.js';
import { destroyCommand } from './commands/destroy.js';
import { evalCommand } from './commands/eval.js';
import {
  chatCommand,
  configCommand,
  doctorCommand,
  embedCommand,
  schemaCommand,
  secretCommand,
  statusCommand,
  validateCommand,
} from './commands/manage.js';
import type { Ctx } from './commands/context.js';
import { dashboardCommand, usersCommand } from './commands/users.js';
import { webhooksCommand } from './commands/webhooks.js';
import { apiCommand, keysCommand } from './commands/keys.js';
import { callbacksCommand } from './commands/callbacks.js';
import { upgradeCommand } from './commands/upgrade.js';
import { promptCommand } from './commands/prompt.js';

const COMMANDS: Record<string, (ctx: Ctx) => Promise<number>> = {
  init: initCommand,
  setup: initCommand,
  deploy: deployCommand,
  dev: devCommand,
  chat: chatCommand,
  status: statusCommand,
  doctor: doctorCommand,
  knowledge: knowledgeCommand,
  discover: discoverCommand,
  crawl: crawlCommand,
  ask: askCommand,
  destroy: destroyCommand,
  eval: evalCommand,
  secret: secretCommand,
  secrets: secretCommand,
  config: configCommand,
  validate: validateCommand,
  schema: schemaCommand,
  embed: embedCommand,
  users: usersCommand,
  webhooks: webhooksCommand,
  keys: keysCommand,
  api: apiCommand,
  callbacks: callbacksCommand,
  upgrade: upgradeCommand,
  dashboard: dashboardCommand,
  prompt: promptCommand,
};

export async function main(argv: string[]): Promise<number> {
  let json = argv.includes('--json');
  try {
    const parsed = parseArgs(argv);
    json = Boolean(parsed.flags['json']);
    const { command, positionals, flags } = parsed;

    if (flags['version']) {
      process.stdout.write(json ? `${JSON.stringify({ ok: true, version: VERSION })}\n` : `${VERSION}\n`);
      return EXIT.ok;
    }
    // `npx @knowtific/helppuff` in a terminal: set up here, or redeploy what is here.
    if (!command && Object.keys(flags).length === 0 && !json && process.stdin.isTTY && process.stdout.isTTY && !process.env['CI']) {
      const here = resolve(process.cwd());
      const ctx: Ctx = { cwd: here, positionals: [], flags: {}, out: new Output(false), interactive: true };
      return await (existsSync(join(here, 'helppuff.json')) ? COMMANDS['deploy']! : COMMANDS['init']!)(ctx);
    }
    if (!command || command === 'help') {
      const topic = positionals[0];
      // The wiki's generated pages (`pnpm sync:docs` writes them).
      if (topic === 'wiki-cli') {
        process.stdout.write(cliReferencePage());
        return EXIT.ok;
      }
      if (topic === 'wiki-config') {
        process.stdout.write(configReferencePage());
        return EXIT.ok;
      }
      if (topic === 'wiki-api') {
        // Several pages: written into the wiki folder given, replacing the old ones.
        const dir = resolve(positionals[1] ?? 'wiki');
        for (const file of readdirSync(dir)) if (/^API-Reference(-.+)?\.md$/.test(file)) rmSync(join(dir, file));
        for (const [page, content] of Object.entries(apiReferencePages())) writeFileSync(join(dir, `${page}.md`), content);
        return EXIT.ok;
      }
      const help = topic ? commandHelp(topic) : null;
      process.stdout.write(`${help ?? MAIN_HELP}\n`);
      return EXIT.ok;
    }
    if (flags['help'] || flags['h']) {
      process.stdout.write(`${commandHelp(command) ?? MAIN_HELP}\n`);
      return EXIT.ok;
    }
    const run = COMMANDS[command];
    if (!run) {
      const close = Object.keys(COMMAND_HELP).find((name) => name.startsWith(command.slice(0, 3)));
      throw new CliError('usage', `Unknown command "${command}".`, {
        exitCode: EXIT.usage,
        hint: close ? `Did you mean \`helppuff ${close}\`? See \`helppuff --help\`.` : 'See `helppuff --help`.',
      });
    }

    const interactive =
      !json && !flags['non-interactive'] && Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env['CI'];
    // `--config path/to/helppuff.json` names the project by its file; the folder is what matters.
    const config = str(flags, 'config');
    if (config && typeof flags['config'] === 'string') delete flags['config'];
    const cwd = resolve(config ? dirname(resolve(config)) : (str(flags, 'cwd') ?? process.cwd()));
    const ctx: Ctx = { cwd, positionals, flags, out: new Output(json), interactive };
    return await run(ctx);
  } catch (thrown) {
    return new Output(json).failure(thrown);
  }
}
