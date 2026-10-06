import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runWrangler } from './wrangler.js';

/**
 * Reuse `wrangler login`.
 *
 * Its OAuth token already carries every scope helppuff needs (workers,
 * workers_kv, ai-search write+run, d1), so someone who has logged in once —
 * or who runs `npx wrangler login` now — never has to create an API token.
 * The token lives in wrangler's own config file; when it is about to
 * expire, `wrangler whoami` refreshes it in place.
 */

function configPaths(): string[] {
  const home = homedir();
  const paths = [
    join(process.env['XDG_CONFIG_HOME'] ?? join(home, '.config'), '.wrangler', 'config', 'default.toml'),
    join(home, '.wrangler', 'config', 'default.toml'),
  ];
  if (process.platform === 'darwin') paths.unshift(join(home, 'Library', 'Preferences', '.wrangler', 'config', 'default.toml'));
  if (process.platform === 'win32' && process.env['APPDATA']) paths.unshift(join(process.env['APPDATA'], '.wrangler', 'config', 'default.toml'));
  return paths;
}

type Stored = { token: string; expires: number | null };

function readStored(): Stored | null {
  for (const path of configPaths()) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const token = /^\s*oauth_token\s*=\s*"([^"]+)"/m.exec(text)?.[1];
    if (!token) continue;
    const expiry = /^\s*expiration_time\s*=\s*"([^"]+)"/m.exec(text)?.[1];
    return { token, expires: expiry ? Date.parse(expiry) : null };
  }
  return null;
}

/** The current wrangler OAuth token, refreshed if needed; null when not logged in. */
export async function wranglerOAuthToken(cwd = process.cwd()): Promise<string | null> {
  const stored = readStored();
  if (!stored) return null;
  if (stored.expires === null || stored.expires - Date.now() > 120_000) return stored.token;
  // Expired or about to: whoami refreshes it with the stored refresh token.
  await runWrangler(['whoami'], { cwd }).catch(() => null);
  const refreshed = readStored();
  return refreshed && (refreshed.expires === null || refreshed.expires > Date.now()) ? refreshed.token : null;
}

/** Open the browser login. Only for a person at a terminal. */
export async function wranglerLogin(cwd = process.cwd()): Promise<boolean> {
  const { code } = await runWrangler(['login'], { cwd, inherit: true });
  return code === 0 && readStored() !== null;
}
