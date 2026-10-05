import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * The size budgets, asserted against the real production bundles. Run
 * `pnpm --filter @murmur/widget build` first; the suite skips if dist/ is
 * absent so a fresh clone does not fail on a missing artefact.
 */
const DIST = join(process.cwd(), 'packages/widget/dist');
// Tripwires for accidental bloat, not design constraints — see the note in
// packages/widget/scripts/build.mjs.
const BUDGETS = { loader: 8 * 1024, app: 35 * 1024 };

test.describe('bundle budgets', () => {
  test.skip(!existsSync(DIST), 'build the widget first');
  test.describe.configure({ mode: 'serial' });

  const gz = (name: string) => gzipSync(readFileSync(join(DIST, name)), { level: 9 }).length;

  test('the loader stays within its gzip budget', () => {
    expect(gz('loader.js')).toBeLessThanOrEqual(BUDGETS.loader);
  });

  test('the app stays under 35 kb gzipped', () => {
    const app = readdirSync(DIST).find((f) => /^app-.*\.js$/.test(f));
    expect(app, 'app chunk missing').toBeTruthy();
    expect(gz(app as string)).toBeLessThanOrEqual(BUDGETS.app);
  });

  test('build-time constants are inlined, leaving one global', () => {
    const app = readdirSync(DIST).find((f) => /^app-.*\.js$/.test(f)) as string;
    for (const file of ['loader.js', app]) {
      const source = readFileSync(join(DIST, file), 'utf8');
      expect(source, `${file} leaks a build constant`).not.toContain('__MURMUR_APP_FILE__');
      expect(source, `${file} leaks a build constant`).not.toContain('__MURMUR_VERSION__');
    }
  });

  test('the widget bundles no markdown, state or animation library', () => {
    const app = readdirSync(DIST).find((f) => /^app-.*\.js$/.test(f)) as string;
    const source = readFileSync(join(DIST, app), 'utf8');
    // Zod would cost a third of the budget — the widget validates by hand.
    expect(source).not.toContain('ZodError');
    expect(source).not.toContain('zod');
  });
});
