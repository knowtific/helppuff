// Starts the live-chat e2e Worker (see wrangler.toml): a fresh database, the
// dashboard built under /admin/, then `wrangler dev` on :8788.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
rmSync(join(here, '.state'), { recursive: true, force: true });
rmSync(join(here, '.assets'), { recursive: true, force: true });
mkdirSync(join(here, '.assets'), { recursive: true });

const built = spawnSync('pnpm', ['--filter', '@helppuff/dashboard', 'exec', 'vite', 'build', '--outDir', join(here, '.assets', 'admin'), '--emptyOutDir'], { cwd: repo, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const worker = spawn('pnpm', ['--filter', '@helppuff/server', 'exec', 'wrangler', 'dev', '--config', join(here, 'wrangler.toml'), '--port', '8788', '--local', '--persist-to', join(here, '.state')], {
  cwd: repo,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => worker.kill(signal));
worker.on('exit', (code) => process.exit(code ?? 0));
