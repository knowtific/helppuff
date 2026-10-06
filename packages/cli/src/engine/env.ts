import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `.env` next to helppuff.json: where secrets live on this machine. Deploy
 * copies the ones the project references into Worker secrets; nothing else
 * reads it. It is added to .gitignore the first time it is written.
 *
 * Values in the real environment win over the file, so CI and agents can
 * pass a key without writing it anywhere.
 */

export const ENV_FILE = '.env';

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2] ?? '';
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2] ?? '';
    else value = value.replace(/\s+#.*$/, '');
    out[match[1]!] = value;
  }
  return out;
}

export function readEnvFile(dir: string): Record<string, string> {
  const file = join(dir, ENV_FILE);
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
}

/** The file, then the process environment on top. */
export function loadEnv(dir: string, processEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const merged = readEnvFile(dir);
  for (const [key, value] of Object.entries(processEnv)) {
    if (typeof value === 'string' && value) merged[key] = value;
  }
  return merged;
}

/** Set or replace one variable, keeping every other line as it was. */
export function writeEnvVar(dir: string, name: string, value: string): void {
  const file = join(dir, ENV_FILE);
  const line = `${name}=${/[\s#"']/.test(value) ? JSON.stringify(value) : value}`;
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, 'm');
  const next = pattern.test(existing)
    ? existing.replace(pattern, line)
    : `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${line}\n`;
  writeFileSync(file, next, { mode: 0o600 });
  ensureGitignore(dir, [ENV_FILE, '.helppuff/']);
}

export function ensureGitignore(dir: string, entries: string[]): void {
  const file = join(dir, '.gitignore');
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter((entry) => !lines.has(entry) && !lines.has(`/${entry}`));
  if (missing.length === 0) return;
  const block = `${existing && !existing.endsWith('\n') ? '\n' : ''}${existing ? '\n' : ''}# HelpPuff: secrets and generated deploy files\n${missing.join('\n')}\n`;
  appendFileSync(file, block);
}

/** Show that a secret is set without showing it. */
export function redact(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}
