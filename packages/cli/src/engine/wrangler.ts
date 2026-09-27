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
    throw new CliError('wrangler_missing', 'Wrangler is not installed alongside murmur.', {
      hint: 'Reinstall: npm i -D @knowtific/murmur (wrangler is a dependency of it).',
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

/** Deploy `.murmur/deploy`, returning the URL wrangler reports. */
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
    return 'The AI Search instance does not exist yet. Run `murmur knowledge sync`, or check `backend.instance` in murmur.json.';
  }
  if (/Authentication error|10000|not authorized/i.test(output)) {
    return 'The Cloudflare token lacks a permission. Run `murmur doctor` to see which.';
  }
  if (/workers\.dev subdomain/i.test(output)) {
    return 'Your account has no workers.dev subdomain. Open Workers & Pages in the Cloudflare dashboard once to create it, then retry.';
  }
  return 'Run `murmur doctor` for a full check.';
}
