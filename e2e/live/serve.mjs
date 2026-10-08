// Starts the live-chat Worker (see wrangler.toml): a fresh database; the
// widget, a preview page and the dashboard as its assets, as a deployment
// has them; then `wrangler dev` on :8788.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const port = process.env['HELPPUFF_LIVE_PORT'] ?? '8788';
// One set per port, so a second instance never wipes the first one's.
const assets = join(here, '.assets', port);
const state = join(here, '.state', port);
rmSync(state, { recursive: true, force: true });
rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

const run = (args) => {
  const done = spawnSync('pnpm', args, { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] });
  if (done.status !== 0) process.exit(done.status ?? 1);
};
run(['--filter', '@helppuff/widget', 'build']);
cpSync(join(repo, 'packages', 'widget', 'dist'), assets, { recursive: true });
run(['--filter', '@helppuff/dashboard', 'exec', 'vite', 'build', '--outDir', join(assets, 'admin'), '--emptyOutDir']);

const page = (title, body) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>:root { color-scheme: light dark; } body { margin: 0; min-height: 100vh; background: Canvas; color: CanvasText; font: 16px/1.5 system-ui, sans-serif; }</style>
</head>
<body>
${body}
</body>
</html>
`;
// What a visitor sees: a page with the widget (the API is this same origin).
writeFileSync(
  join(assets, 'index.html'),
  page(
    'Live chat · visitor',
    `<main style="padding: 12vh 2rem; max-width: 34rem"><h1>A site with live chat</h1><p>Start a chat, then press the person icon at the top of the widget to talk to the team.</p></main>
<script src="/loader.js" data-site="demo" data-open async></script>`,
  ),
);
// The `models` site: another model and the site's own knowledge base (config.ts).
writeFileSync(join(assets, 'models.html'), page('Models', '<main style="padding: 12vh 2rem"><h1>Acme Plumbing</h1></main><script src="/loader.js" data-site="models" data-open async></script>'));
// The `tools` site: the same model, with the owner's tools (tools.spec.ts).
writeFileSync(join(assets, 'tools.html'), page('Tools', '<main style="padding: 12vh 2rem"><h1>Acme Plumbing</h1></main><script src="/loader.js" data-site="tools" data-open async></script>'));
// The dashboard's Home: just the widget, open.
writeFileSync(join(assets, 'chat.html'), page('Chat', '<script src="/loader.js" data-site="demo" data-open data-fill async></script>'));

const worker = spawn('pnpm', ['--filter', '@helppuff/server', 'exec', 'wrangler', 'dev', '--config', join(here, 'wrangler.toml'), '--port', port, '--local', '--persist-to', state, '--assets', assets, '--var', `FAKE_LLM_URL:http://localhost:${port}/fake-llm/v1`, '--var', 'FAKE_LLM_KEY:e2e-fake-llm-key'], {
  cwd: repo,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => worker.kill(signal));
worker.on('exit', (code) => process.exit(code ?? 0));
