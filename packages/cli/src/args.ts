import { CliError } from './errors.js';

export type Flags = Record<string, string | boolean | string[]>;
export type Parsed = { command: string | null; positionals: string[]; flags: Flags };

/** Flags that never take a value. */
const BOOLEAN = new Set([
  'json',
  'help',
  'h',
  'version',
  'yes',
  'y',
  'force',
  'deploy',
  'dry-run',
  'knowledge',
  'skip-knowledge',
  'local',
  'agent-files',
  'defaults',
  'wait',
  'browser',
  'all',
  'live',
  'non-interactive',
  'verbose',
  'keep-data',
  'overwrite-settings',
  'apply',
  'timing',
  'check',
  'allow-downgrade',
]);
/** Flags that may repeat, collected into a list. */
const LIST = new Set(['docs']);

/**
 * Small and strict: `--flag value`, `--flag=value`, `--no-flag`, `-y`.
 * An unknown flag is not an error here — each command checks its own — but
 * a value-taking flag with no value is.
 */
export function parseArgs(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags: Flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const [rawName, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      if (rawName.startsWith('no-') && inline === undefined) {
        flags[rawName.slice(3)] = false;
        continue;
      }
      const name = rawName;
      let value: string | boolean;
      if (inline !== undefined) value = inline;
      else if (BOOLEAN.has(name)) value = true;
      else {
        const next = argv[i + 1];
        if (next === undefined || (next.startsWith('--') && next.length > 2)) {
          throw new CliError('usage', `--${name} needs a value.`, { exitCode: 2, hint: `murmur --help` });
        }
        value = next;
        i++;
      }
      if (LIST.has(name) && typeof value === 'string') {
        const list = Array.isArray(flags[name]) ? (flags[name] as string[]) : [];
        flags[name] = [...list, ...value.split(',').map((v) => v.trim()).filter(Boolean)];
      } else {
        flags[name] = value;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      for (const letter of arg.slice(1)) flags[letter] = true;
      continue;
    }
    positionals.push(arg);
  }

  const command = positionals.shift() ?? null;
  return { command, positionals, flags };
}

export function str(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function bool(flags: Flags, name: string): boolean | undefined {
  const value = flags[name];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function assertKnown(flags: Flags, allowed: string[], command: string): void {
  // Global flags: accepted by every command.
  const known = new Set([...allowed, 'json', 'help', 'h', 'cwd', 'version', 'non-interactive', 'verbose', 'config']);
  const unknown = Object.keys(flags).filter((name) => !known.has(name));
  if (unknown.length) {
    throw new CliError('usage', `Unknown option(s) for \`murmur ${command}\`: ${unknown.map((u) => `--${u}`).join(', ')}`, {
      exitCode: 2,
      hint: `murmur ${command} --help`,
    });
  }
}
