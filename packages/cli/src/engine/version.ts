import { readFileSync } from 'node:fs';

export const PACKAGE_NAME = '@knowtific/murmur';

/**
 * This CLI's version, from its package.json: next to `dist/` once published
 * (dist/cli.js → ../package.json), two levels up from this file in the
 * source. It is stamped into every Worker it deploys (`MURMUR_VERSION`),
 * which is how `murmur upgrade` and the dashboard know what is running.
 */
export const VERSION: string = (() => {
  for (const path of ['../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { name?: string; version?: string };
      if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version;
    } catch {
      // Not here; try the next.
    }
  }
  return '0.0.0';
})();

/** The newest published version, or null when npm cannot be reached (offline, say). */
export async function latestVersion(doFetch: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await doFetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}
