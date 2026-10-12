import { isSecretHeader, type ToolHeader } from '@helppuff/protocol/tools';
import { CliError, EXIT } from '../errors.js';

/**
 * `--header 'Name: value'` and `${NAME}`, shared by the commands that save a
 * request HelpPuff sends (tools, custom webhooks, the email service).
 */

/** `${NAME}` in a header value, from .env or the environment; a missing one is a question for the user. */
export function expand(value: string, env: Record<string, string>, missing: Set<string>): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_all, name: string) => {
    const found = env[name];
    if (found === undefined) missing.add(name);
    return found ?? '';
  });
}

/** Repeated `--header 'Name: value'`, credential headers marked secret (stored encrypted). Values not expanded yet. */
export function headerFlags(value: unknown): ToolHeader[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return list.map((raw) => {
    const at = String(raw).indexOf(':');
    if (at < 1) throw new CliError('usage', '--header takes "Name: value".', { exitCode: EXIT.usage });
    const name = String(raw).slice(0, at).trim();
    return { name, value: String(raw).slice(at + 1).trim(), secret: isSecretHeader(name) };
  });
}

/** New headers replace stored ones of the same name; the rest stay (secret ones keep their value: sent empty). */
export function mergeHeaders(current: ToolHeader[], given: ToolHeader[], env: Record<string, string>, missing: Set<string>): ToolHeader[] {
  const kept = current.filter((h) => !given.some((n) => n.name.toLowerCase() === h.name.toLowerCase())).map(({ name, value, secret }) => ({ name, value: secret ? '' : value, secret }));
  return [...kept, ...given.map((h) => ({ ...h, value: expand(h.value, env, missing) }))];
}
