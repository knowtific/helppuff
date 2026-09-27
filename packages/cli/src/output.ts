import { CliError, EXIT } from './errors.js';

/**
 * Two audiences, one code path.
 *
 * With `--json` (or when stdout is not a terminal and `--json` was asked
 * for), stdout carries exactly one JSON document per command — nothing else —
 * so an agent can parse it. Progress still goes to stderr, where a person
 * watching can see it and a parser will not trip on it.
 *
 * Without `--json`, output is for a person: short lines, a little colour,
 * and a next step at the end.
 */

const useColor = !process.env['NO_COLOR'] && process.stderr.isTTY;
const paint = (code: number) => (text: string) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
export const c = {
  bold: paint(1),
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  cyan: paint(36),
};

export class Output {
  constructor(readonly json: boolean) {}

  /** Progress: stderr in JSON mode, stdout otherwise. */
  progress = (message: string): void => {
    const line = `${c.dim('│')} ${message}\n`;
    if (this.json) process.stderr.write(this.json && !process.stderr.isTTY ? `${message}\n` : line);
    else process.stdout.write(line);
  };

  info(message: string): void {
    if (!this.json) process.stdout.write(`${message}\n`);
  }

  success(message: string): void {
    if (!this.json) process.stdout.write(`${c.green('✔')} ${message}\n`);
  }

  warn(message: string): void {
    if (this.json) process.stderr.write(`warning: ${message}\n`);
    else process.stdout.write(`${c.yellow('!')} ${message}\n`);
  }

  /** The command's result. In JSON mode this is the whole of stdout. */
  result(data: Record<string, unknown>, human?: () => void): void {
    if (this.json) process.stdout.write(`${JSON.stringify({ ok: true, ...data }, null, 2)}\n`);
    else human?.();
  }

  failure(error: unknown): number {
    const cliError =
      error instanceof CliError
        ? error
        : new CliError('unexpected', error instanceof Error ? error.message : String(error), {
            hint: 'This looks like a bug in murmur. Run with DEBUG=murmur for the stack trace.',
          });
    if (process.env['DEBUG']?.includes('murmur') && error instanceof Error) process.stderr.write(`${error.stack}\n`);

    if (this.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: cliError.toJSON() }, null, 2)}\n`);
    } else {
      process.stderr.write(`${c.red('✖')} ${cliError.message}\n`);
      if (cliError.hint) process.stderr.write(`${c.dim(cliError.hint.split('\n').map((l) => `  ${l}`).join('\n'))}\n`);
    }
    return cliError.exitCode;
  }

  needsInput(payload: Record<string, unknown>): number {
    if (this.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, status: 'needs_input', ...payload }, null, 2)}\n`);
    } else {
      const questions = (payload['questions'] as { ask: string; flag: string; options?: { value: string }[] }[]) ?? [];
      process.stderr.write(`${c.yellow('?')} Setup needs a few answers. Re-run with:\n`);
      for (const q of questions) {
        const choices = q.options ? ` (${q.options.map((o) => o.value).join(' | ')})` : '';
        process.stderr.write(`  ${c.cyan(q.flag)} <value>  ${q.ask}${choices}\n`);
      }
    }
    return EXIT.needsInput;
  }
}
