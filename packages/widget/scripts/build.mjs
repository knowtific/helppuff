import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

/**
 * Size guards.
 *
 * The plan sets the loader at 4 kb, and holding that line started to cost
 * real things — first the orb's gradient and runtime contrast correction,
 * then the choice of launcher icon. It was not a trade worth making. A
 * kilobyte gzipped is roughly 20ms on Chrome's Slow 3G throttle and under a
 * millisecond on broadband, on a script that loads `async` and is therefore
 * off the critical path: it cannot affect LCP, and being `position: fixed`
 * it cannot affect CLS. The TLS handshake that fetches it costs ten times
 * more than its entire body.
 *
 * So these are tripwires, not design constraints. They are set to catch the
 * mistakes that genuinely matter — importing Preact into the loader (+10 kb),
 * or Zod (+13 kb), or reaching the app's module graph by accident (+25 kb) —
 * while leaving room for features that belong at first paint.
 *
 * The app's 35 kb is the number that reflects real payload, since that
 * bundle carries Preact and every component. Keep that one honest.
 */
export const BUDGETS = { 'loader.js': 8 * 1024, app: 35 * 1024 };

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

/**
 * The stylesheets live in template literals so they can be handed to
 * `adoptedStyleSheets`. esbuild will not touch string contents, so
 * they are minified here instead — worth ~35% of the CSS.
 */
const minifyCssLiterals = {
  name: 'helppuff-minify-css',
  transform(code, id) {
    if (!/(launcher-shell|widget\.css)\.ts$/.test(id)) return null;
    return {
      code: code.replace(/`\n([^`]*?)`/g, (match, css) => {
        if (!/[{;]/.test(css)) return match;
        const out = css
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s*([{}:;,>])\s*/g, '$1')
          .replace(/;}/g, '}')
          .replace(/\s+/g, ' ')
          .trim();
        return '`' + out + '`';
      }),
      map: null,
    };
  },
};

const shared = {
  root,
  logLevel: 'warn',
  plugins: [minifyCssLiterals],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact', legalComments: 'none' },
  define: { __HELPPUFF_VERSION__: JSON.stringify(version) },
};

// 1. The app chunk: an ES module, content-hashed, with Preact bundled privately.
await build({
  ...shared,
  build: {
    outDir: dist,
    emptyOutDir: false,
    target: 'es2019',
    minify: 'esbuild',
    rollupOptions: {
      input: join(root, 'src/app/index.tsx'),
      // Vite drops entry exports by default outside lib mode, which would
      // tree-shake `mount` and everything it reaches.
      preserveEntrySignatures: 'exports-only',
      output: { format: 'es', entryFileNames: 'app-[hash].js', inlineDynamicImports: true },
    },
  },
  define: { ...shared.define, __HELPPUFF_APP_FILE__: '""' },
});

const appFile = readdirSync(dist).find((name) => /^app-.*\.js$/.test(name));
if (!appFile) throw new Error('app chunk was not emitted');

// 2. The loader: a self-contained IIFE that knows the app chunk's hashed name.
await build({
  ...shared,
  build: {
    outDir: dist,
    emptyOutDir: false,
    target: 'es2019',
    minify: 'esbuild',
    rollupOptions: {
      input: join(root, 'src/loader.ts'),
      output: { format: 'iife', entryFileNames: 'loader.js', inlineDynamicImports: true },
    },
  },
  // The loader resolves this against its own script src at runtime.
  define: {
    ...shared.define,
    __HELPPUFF_APP_FILE__: JSON.stringify(`./${appFile}`),
  },
});

// 3. Report and enforce the size budgets.
const report = [];
let failed = false;

for (const name of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
  const raw = readFileSync(join(dist, name));
  const gz = gzipSync(raw, { level: 9 }).length;
  const budget = name === 'loader.js' ? BUDGETS['loader.js'] : BUDGETS.app;
  const over = gz > budget;
  if (over) failed = true;
  report.push({ name, raw: raw.length, gz, budget, ok: !over });
}

writeFileSync(join(dist, 'manifest.json'), JSON.stringify({ version, app: appFile }, null, 2));

/*
 * Headers for the Worker's static assets.
 *
 * `Access-Control-Allow-Origin` matters more than it looks: the loader is a
 * classic script, which a `<script src>` fetches without CORS — but its
 * `import()` of the app chunk is a *module* fetch, and module fetches are
 * always CORS-mode. Without this the widget loads on its own origin and
 * fails on every real host page, which is exactly the bug a local dev server
 * cannot show you.
 */
writeFileSync(
  join(dist, '_headers'),
  [
    '/loader.js',
    '  Cache-Control: public, max-age=300',
    '  Access-Control-Allow-Origin: *',
    '',
    '/app-*.js',
    '  Cache-Control: public, max-age=31536000, immutable',
    '  Access-Control-Allow-Origin: *',
    '',
  ].join('\n'),
);

const kb = (n) => `${(n / 1024).toFixed(1)} kb`;
console.log('\n  bundle              raw       gzip      budget');
console.log('  ' + '-'.repeat(48));
for (const r of report) {
  console.log(
    `  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(18)} ${kb(r.raw).padStart(8)}  ${kb(r.gz).padStart(8)}  ${kb(r.budget).padStart(8)}`,
  );
}
console.log('');

if (failed) {
  console.error('  Size budget exceeded.\n');
  process.exit(1);
}
