import { Hono } from 'hono';
import type { KvStore } from '@helppuff/connector-types';
import { LATEST_MIGRATION } from '../db/migrations.js';
import { dbFrom, ensureSchema } from '../db/d1.js';
import type { HonoEnv } from '../core/request.js';
import { currentAdmin } from './guard.js';

/**
 * What is running and whether there is newer: for the dashboard's update
 * notice (Settings → Updates). The Worker cannot update itself — a deploy
 * needs the owner's Cloudflare login, which it never holds — so the notice
 * says what to run: `npx @knowtific/helppuff@latest upgrade`.
 */

export const versionRoutes = new Hono<HonoEnv>();

const PACKAGE = '@knowtific/helppuff';
const LATEST_KEY = 'meta:latest-version';
const CHECK_EVERY_S = 12 * 3600;
const RELEASE_NOTES = 'https://github.com/knowtific/helppuff/blob/main/CHANGELOG.md';

export const deployedVersion = (env: Record<string, unknown>): string | null => (typeof env['HELPPUFF_VERSION'] === 'string' && env['HELPPUFF_VERSION'] ? env['HELPPUFF_VERSION'] : null);

/** `1.10.0` > `1.9.2`; a pre-release sorts before its release. */
export function newer(candidate: string, current: string): boolean {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/.exec(v);
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  const [pa, pb] = [a[4], b[4]];
  if (!pb) return false;
  return !pa || pa > pb;
}

/** The newest release on npm, asked at most twice a day per Worker (cached in KV). Null when npm cannot be reached. */
async function latestRelease(kv: KvStore | undefined): Promise<string | null> {
  const cached = await kv?.get(LATEST_KEY).catch(() => null);
  if (cached) return cached;
  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE}/latest`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const version = ((await response.json()) as { version?: unknown }).version;
    if (typeof version !== 'string') return null;
    await kv?.put(LATEST_KEY, version, { expirationTtl: CHECK_EVERY_S }).catch(() => {});
    return version;
  } catch {
    return null;
  }
}

versionRoutes.get('/version', async (c) => {
  await currentAdmin(c);
  const ctx = c.get('helppuff');
  const current = deployedVersion(ctx.env);
  const latest = await latestRelease(ctx.env['HELPPUFF_KV'] as KvStore | undefined);
  let schema: number | null = null;
  const db = dbFrom(ctx.env);
  if (db) {
    await ensureSchema(db).catch(() => {});
    schema = (await db.prepare('SELECT max(id) AS id FROM _migrations').first<{ id: number | null }>().catch(() => null))?.id ?? null;
  }
  return c.json({
    current,
    latest,
    upgradeAvailable: Boolean(current && latest && newer(latest, current)),
    schema: { applied: schema, expected: LATEST_MIGRATION },
    command: `npx ${PACKAGE}@latest upgrade`,
    releaseNotes: RELEASE_NOTES,
  });
});
