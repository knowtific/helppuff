import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { OWNER_HEADER, ownerToken } from '@helppuff/server';
import { CliError } from '../errors.js';
import type { CloudflareSession } from './credentials.js';
import { writeEnvVar } from './env.js';
import { dashboardEnabled, workerNameFor, type LoadedProject } from './project.js';

/**
 * Dashboard accounts. The owner lives in Worker config (ADMIN_EMAIL var,
 * ADMIN_PASSWORD_HASH secret, the hash kept in .env); everyone else lives in
 * the D1 `admins` table. Hashes use exactly the format the Worker verifies:
 * `pbkdf2$<iterations>$<salt>$<hash>`, base64url, SHA-256.
 */

export const ITERATIONS = 100_000;

const b64url = (buffer: Buffer) => buffer.toString('base64url');

export function hashPassword(password: string, iterations = ITERATIONS): string {
  const salt = randomBytes(16);
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(pbkdf2Sync(password, salt, iterations, 32, 'sha256'))}`;
}

/** Readable, 20 characters of entropy-dense text: `kite-7fq2-mars-9xpd`. */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

export function validatePassword(password: string): void {
  if (password.length < 10) {
    throw new CliError('weak_password', 'Use a password of at least 10 characters.', { exitCode: 2 });
  }
}

/** The git user's email — the most likely owner — or null. */
export function gitEmail(cwd: string): string | null {
  try {
    const email = execFileSync('git', ['config', 'user.email'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Set the owner's password: a new hash in .env, and on the Worker if deployed. */
export async function setOwnerPassword(loaded: LoadedProject, password: string, cf?: CloudflareSession | null): Promise<boolean> {
  validatePassword(password);
  const hash = hashPassword(password);
  writeEnvVar(loaded.dir, 'ADMIN_PASSWORD_HASH', hash);
  const worker = workerNameFor(loaded.project);
  if (cf && loaded.project.cloudflare.url && (await cf.api.workerExists(cf.accountId, worker))) {
    await cf.api.putSecret(cf.accountId, worker, 'ADMIN_PASSWORD_HASH', hash);
    return true;
  }
  return false;
}

/**
 * A new Worker secret takes a few seconds to reach every location. Wait
 * until the dashboard accepts the new password, so "changed" means usable.
 */
export async function waitForSignIn(
  url: string,
  email: string,
  password: string,
  secret: string | undefined,
  doFetch: typeof fetch = fetch,
  limitMs = 60_000,
): Promise<boolean> {
  const origin = new URL(url).origin;
  const owner: Record<string, string> = secret && secret.length >= 32 ? { [OWNER_HEADER]: await ownerToken(secret) } : {};
  const start = Date.now();
  while (Date.now() - start < limitMs) {
    const response = await doFetch(`${origin}/admin/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...owner },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    if (response?.ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  return false;
}

export function requireDashboardDb(loaded: LoadedProject): string {
  if (!dashboardEnabled(loaded.project)) {
    throw new CliError('dashboard_disabled', 'The dashboard is not enabled for this project.', {
      hint: 'Set dashboard.adminEmail in helppuff.json (helppuff config set dashboard.adminEmail you@example.com), then helppuff deploy.',
    });
  }
  const id = loaded.project.cloudflare.d1DatabaseId;
  if (!id) throw new CliError('not_deployed', 'The dashboard database does not exist yet.', { hint: 'helppuff deploy' });
  return id;
}
