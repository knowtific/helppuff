import { build } from 'vite';
import { cpSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The hosted playground: the static site GitHub Pages publishes
 * (`.github/workflows/playground.yml`), at `dist-playground/`.
 *
 * 1. The widget's production build (`build.mjs`, size budgets and all), so the
 *    preview runs exactly the `loader.js` and app chunk a real site gets.
 * 2. The demo pages, built with Vite.
 * 3. Assembled: the options playground becomes `index.html`, the widget goes
 *    in `widget/`, and the pages that need the local Worker are left out.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'dist-playground');
const demo = join(root, 'dist-demo');

await import('./build.mjs');
await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });

rmSync(out, { recursive: true, force: true });
cpSync(join(demo, 'demo'), out, { recursive: true });
cpSync(join(demo, 'assets'), join(out, 'assets'), { recursive: true });
// `index.html` is the local playground, which talks to `pnpm dev`'s Worker.
rmSync(join(out, 'index.html'), { force: true });
renameSync(join(out, 'playground.html'), join(out, 'index.html'));
// Vite wrote the pages one level down (`demo/`); they now sit beside `assets/`.
for (const page of readdirSync(out).filter((name) => name.endsWith('.html'))) {
  const file = join(out, page);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('"../assets/', '"./assets/'));
}
cpSync(join(root, 'dist'), join(out, 'widget'), {
  recursive: true,
  filter: (src) => !/(_headers|manifest\.json)$/.test(src),
});
// Serve underscore-prefixed files as they are.
writeFileSync(join(out, '.nojekyll'), '');

console.log(`  playground: ${readdirSync(out).join(', ')}`);
