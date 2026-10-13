import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { CliError } from '../errors.js';

/**
 * Wrangler, run from this package's own dependency — never whatever happens
 * to be on PATH — with credentials passed through the environment so it
 * never opens a browser or prompts.
 */

function wranglerBin(): string {
  try {
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
  } catch {
    throw new CliError('wrangler_missing', 'Wrangler is not installed alongside helppuff.', {
      hint: 'Reinstall: npm i -D @knowtific/helppuff (wrangler is a dependency of it).',
    });
  }
}

/** No token means wrangler uses its own `wrangler login` session. */
export type WranglerEnv = { token?: string | undefined; accountId: string };

export async function runWrangler(
  args: string[],
  options: { cwd: string; auth?: WranglerEnv; inherit?: boolean; onLine?: (line: string) => void },
): Promise<{ code: number; output: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WRANGLER_SEND_METRICS: 'false',
    // Non-interactive: fail with a message rather than wait on a prompt.
    CI: process.env['CI'] ?? '1',
    ...(options.auth ? { CLOUDFLARE_ACCOUNT_ID: options.auth.accountId } : {}),
    ...(options.auth?.token ? { CLOUDFLARE_API_TOKEN: options.auth.token } : {}),
  };
  if (options.inherit) delete env['CI'];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerBin(), ...args], {
      cwd: options.cwd,
      env,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (options.onLine) for (const line of text.split(/\r?\n/)) if (line.trim()) options.onLine(line);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

/** A bounded, machine-readable tail. Accepts compact or multiline Wrangler JSON events. */
export async function collectWranglerTail(
  args: string[],
  options: { cwd: string; auth: WranglerEnv; durationMs: number; maxEvents?: number },
): Promise<{ code: number; events: unknown[]; diagnostics: string; truncated: boolean }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WRANGLER_SEND_METRICS: 'false',
    CI: '1',
    NO_COLOR: '1',
    CLOUDFLARE_ACCOUNT_ID: options.auth.accountId,
    ...(options.auth.token ? { CLOUDFLARE_API_TOKEN: options.auth.token } : {}),
  };
  const maxEvents = options.maxEvents ?? 500;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerBin(), ...args, '--format', 'json'], {
      cwd: options.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const events: unknown[] = [];
    let pending = '';
    let pendingEvent = '';
    let diagnostics = '';
    let stopped = false;
    let truncated = false;
    let forceStop: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      child.kill('SIGINT');
      forceStop = setTimeout(() => child.kill('SIGKILL'), 3000);
      forceStop.unref();
    };
    const timer = setTimeout(stop, options.durationMs);
    const readLine = (line: string) => {
      if (!line.trim() || truncated) return;
      if (!pendingEvent && !/^[{[]/.test(line.trimStart())) {
        diagnostics = `${diagnostics}${line}\n`.slice(-16_000);
        return;
      }
      const first = !pendingEvent;
      pendingEvent += `${line}\n`;
      // Parse once an event can be complete: a compact one-line event, or the
      // closing brace of a pretty-printed one (at the start of its line).
      const closes = /^[}\]]\s*$/.test(line) || (first && /[}\]]\s*$/.test(line));
      if (!closes) {
        if (pendingEvent.length > 1_000_000) {
          diagnostics = `${diagnostics}Cloudflare returned an oversized log event.\n`.slice(-16_000);
          pendingEvent = '';
          truncated = true;
          stop();
        }
        return;
      }
      try {
        const event = JSON.parse(pendingEvent) as unknown;
        pendingEvent = '';
        events.push(event);
        if (events.length >= maxEvents) {
          truncated = true;
          stop();
        }
      } catch {
        if (pendingEvent.length > 1_000_000) {
          diagnostics = `${diagnostics}Cloudflare returned an oversized log event.\n`.slice(-16_000);
          pendingEvent = '';
          truncated = true;
          stop();
        }
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      pending += chunk.toString();
      if (pending.length > 1_000_000 && !pending.includes('\n')) {
        diagnostics = `${diagnostics}Cloudflare returned an oversized log event.\n`.slice(-16_000);
        pending = '';
        truncated = true;
        stop();
        return;
      }
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) readLine(line);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      diagnostics = `${diagnostics}${chunk.toString()}`.slice(-16_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (forceStop) clearTimeout(forceStop);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (forceStop) clearTimeout(forceStop);
      if (pending) readLine(pending);
      // Stopping it ourselves is success, unless Wrangler had already failed (auth, unknown Worker).
      const failed = /\[ERROR\]/.test(diagnostics);
      resolve({ code: stopped ? (failed ? 1 : 0) : (code ?? 1), events, diagnostics, truncated });
    });
  });
}

/** Deploy `.helppuff/deploy`, returning the URL wrangler reports. */
export async function wranglerDeploy(dir: string, auth: WranglerEnv, onLine?: (line: string) => void): Promise<string | null> {
  const { code, output } = await runWrangler(['deploy', '--config', 'wrangler.json'], { cwd: dir, auth, ...(onLine ? { onLine } : {}) });
  if (code !== 0) {
    const tail = output.split(/\r?\n/).filter(Boolean).slice(-15).join('\n');
    throw new CliError('wrangler_failed', `wrangler deploy failed:\n${tail}`, { hint: explainWranglerFailure(output) });
  }
  return /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(output)?.[0] ?? null;
}

function explainWranglerFailure(output: string): string {
  if (/ai_search|AI Search/i.test(output) && /not found|does not exist/i.test(output)) {
    return 'The AI Search instance does not exist yet. Run `helppuff knowledge sync`, or check `backend.instance` in helppuff.json.';
  }
  if (/Authentication error|10000|not authorized/i.test(output)) {
    return 'The Cloudflare token lacks a permission. Run `helppuff doctor` to see which.';
  }
  if (/workers\.dev subdomain/i.test(output)) {
    return 'Your account has no workers.dev subdomain. Open Workers & Pages in the Cloudflare dashboard once to create it, then retry.';
  }
  return 'Run `helppuff doctor` for a full check.';
}
