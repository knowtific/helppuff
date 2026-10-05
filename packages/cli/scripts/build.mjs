/**
 * Builds the publishable CLI:
 *
 *   dist/cli.js              the CLI, one ESM file (wrangler stays a dependency)
 *   dist/runtime/server.js   the Murmur server, prebundled for Workers
 *   dist/runtime/widget/     the widget bundles, served as static assets
 *   dist/runtime/version.json
 *
 * Nothing in the workspace is needed at run time: `npx @knowtific/murmur` works
 * from the registry alone.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = join(root, '..', '..');
const dist = join(root, 'dist');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'runtime'), { recursive: true });

// 1. The widget, built fresh so the CLI never ships a stale one.
execFileSync(process.execPath, [join(repo, 'packages', 'widget', 'scripts', 'build.mjs')], { stdio: 'inherit' });
cpSync(join(repo, 'packages', 'widget', 'dist'), join(dist, 'runtime', 'widget'), { recursive: true });

// 1b. The dashboard (React), served by the Worker at /admin/.
execFileSync(process.execPath, [join(repo, 'packages', 'dashboard', 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  cwd: join(repo, 'packages', 'dashboard'),
  stdio: 'inherit',
});
cpSync(join(repo, 'packages', 'dashboard', 'dist'), join(dist, 'runtime', 'dashboard'), { recursive: true });

// 2. The server, for the Workers runtime.
await build({
  entryPoints: [join(repo, 'packages', 'server', 'src', 'runtime.ts')],
  outfile: join(dist, 'runtime', 'server.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  conditions: ['workerd', 'worker', 'browser', 'import'],
  mainFields: ['module', 'main'],
  // The Anthropic SDK imports Node built-ins; the Worker runs with
  // `nodejs_compat`, and wrangler supplies them when it bundles the entry.
  // `cloudflare:workers` (the Workflow base class) is provided by the runtime.
  external: ['node:*', 'cloudflare:*'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});
writeFileSync(join(dist, 'runtime', 'version.json'), `${JSON.stringify({ version, built: new Date().toISOString() })}\n`);

// 3. The CLI itself.
await build({
  entryPoints: [join(root, 'src', 'bin.ts')],
  outfile: join(dist, 'cli.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['wrangler'],
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __murmurCreateRequire } from 'node:module';",
      'const require = __murmurCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  legalComments: 'none',
  logLevel: 'warning',
});
chmodSync(join(dist, 'cli.js'), 0o755);

const size = (file) => `${(readFileSync(file).length / 1024).toFixed(0)} kB`;
console.log(`cli.js ${size(join(dist, 'cli.js'))} · runtime/server.js ${size(join(dist, 'runtime', 'server.js'))}`);
if (!existsSync(join(dist, 'runtime', 'widget', 'loader.js'))) throw new Error('widget build missing loader.js');
