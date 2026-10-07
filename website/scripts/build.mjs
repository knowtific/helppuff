import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The whole published site: the widget playground (`pnpm build:playground`)
 * copied to `/playground/`, the dashboard demo (`pnpm --filter
 * @helppuff/dashboard build:demo`) to `/dashboard-demo/`, then VitePress around
 * them. Run from the repo root as `pnpm build:website`, which builds both first.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const playground = join(root, '../packages/widget/dist-playground');
const dashboard = join(root, '../packages/dashboard/dist-demo');

for (const [built, what] of [
  [join(playground, 'index.html'), 'pnpm build:playground'],
  [join(dashboard, 'demo.html'), 'pnpm --filter @helppuff/dashboard build:demo'],
]) {
  if (!existsSync(built)) {
    console.error(`Build it first: ${what} (or pnpm build:website from the repo root).`);
    process.exit(1);
  }
}

const copy = (from, to) => {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
};
copy(playground, join(root, 'public/playground'));
copy(dashboard, join(root, 'public/dashboard-demo'));
renameSync(join(root, 'public/dashboard-demo/demo.html'), join(root, 'public/dashboard-demo/index.html'));

execFileSync('pnpm', ['exec', 'vitepress', 'build'], { cwd: root, stdio: 'inherit' });
