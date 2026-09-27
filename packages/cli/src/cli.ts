import { resolve } from 'node:path';
import { parseArgs, str } from './args.js';
import { CliError, EXIT } from './errors.js';
import { COMMAND_HELP, MAIN_HELP, VERSION, commandHelp } from './help.js';
import { Output } from './output.js';
import { deployCommand, devCommand, initCommand, knowledgeCommand } from './commands/setup.js';
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
import { serveMcp } from './mcp.js';
import { dashboardCommand, usersCommand } from './commands/users.js';
import { skillCommand } from './commands/skill.js';
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
  secret: secretCommand,
  secrets: secretCommand,
  config: configCommand,
  validate: validateCommand,
  schema: schemaCommand,
  embed: embedCommand,
  users: usersCommand,
  dashboard: dashboardCommand,
  skill: skillCommand,
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
    if (!command || command === 'help') {
      const topic = positionals[0];
      const help = topic ? commandHelp(topic) : null;
      process.stdout.write(`${help ?? MAIN_HELP}\n`);
      return EXIT.ok;
    }
    if (flags['help'] || flags['h']) {
      process.stdout.write(`${commandHelp(command) ?? MAIN_HELP}\n`);
      return EXIT.ok;
    }
    if (command === 'mcp') return await serveMcp(resolve(str(flags, 'cwd') ?? process.cwd()));

    const run = COMMANDS[command];
    if (!run) {
      const close = Object.keys(COMMAND_HELP).find((name) => name.startsWith(command.slice(0, 3)));
      throw new CliError('usage', `Unknown command "${command}".`, {
        exitCode: EXIT.usage,
        hint: close ? `Did you mean \`murmur ${close}\`? See \`murmur --help\`.` : 'See `murmur --help`.',
      });
    }

    const interactive = !json && Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env['CI'];
    const ctx: Ctx = { cwd: resolve(str(flags, 'cwd') ?? process.cwd()), positionals, flags, out: new Output(json), interactive };
    return await run(ctx);
  } catch (thrown) {
    return new Output(json).failure(thrown);
  }
}
