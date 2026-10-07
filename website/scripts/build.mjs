import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The whole published site: the playground (built by `pnpm build:playground`)
 * copied to `/playground/`, then VitePress around it. Run from the repo root
 * as `pnpm build:website`, which builds the playground first.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const playground = join(root, '../packages/widget/dist-playground');
const target = join(root, 'public/playground');

if (!existsSync(join(playground, 'index.html'))) {
  console.error('Build the playground first: pnpm build:playground (or pnpm build:website from the repo root).');
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(playground, target, { recursive: true });

execFileSync('pnpm', ['exec', 'vitepress', 'build'], { cwd: root, stdio: 'inherit' });
