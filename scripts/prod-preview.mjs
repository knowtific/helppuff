/**
 * Serve only `demo/prod.html`, on the dev server's own port.
 *
 * The point is to remove all doubt about what is being exercised. The page
 * loads the deployed Worker — its bundles, its connector, its lead sink — but
 * if the dev server were also running you could not tell from the outside
 * whether a request went to the edge or to localhost:8787.
 *
 * So this binds 5173 deliberately:
 *
 * - If the dev server is up, the bind fails and you are told, rather than
 *   quietly serving a second thing alongside it.
 * - The page's origin stays `http://localhost:5173`, which is what the
 *   development sites' `origins` allow. On any other port the Worker would
 *   refuse every call, and that 403 would look like a bug rather than a
 *   misconfigured preview.
 *
 * Nothing else is served. A request for anything but the page is a 404, which
 * makes an accidental import from the dev server impossible to miss.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGE = resolve(root, 'packages/widget/demo/prod.html');
const URL_FILE = resolve(root, 'packages/server/.wrangler/worker-url');
const PORT = 5173;
const HOST = '127.0.0.1';

const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const YELLOW = '\u001b[33m';
const GREEN = '\u001b[32m';
const RESET = '\u001b[0m';

const page = await readFile(PAGE, 'utf8').catch(() => null);
if (page === null) {
  console.error(`Could not read ${PAGE}`);
  process.exit(1);
}

const workerUrl = await readFile(URL_FILE, 'utf8').then((s) => s.trim()).catch(() => '');

/*
 * Checked before the browser is pointed at it, so an unreachable or
 * never-deployed Worker reads as one line here instead of an empty page.
 */
if (workerUrl) {
  const ok = await fetch(`${workerUrl}/healthz`, { signal: AbortSignal.timeout(8000) })
    .then((r) => r.ok)
    .catch(() => false);
  console.log(
    ok
      ? `${GREEN}✓${RESET} ${workerUrl} is up`
      : `${YELLOW}!${RESET} ${workerUrl} did not answer /healthz — the page will show the failure`,
  );
} else {
  console.log(`${YELLOW}!${RESET} No deployed Worker URL cached. Deploy once, or pass ?worker=… on the page.`);
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/' || path === '/prod.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      // Always the current file, so an edit is one reload away.
      'Cache-Control': 'no-store',
    });
    res.end(page);
    return;
  }
  // Deliberately bare: nothing here should be loading anything else.
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Not served. This preview serves only prod.html — ${path} would have come from the dev server.\n`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n${YELLOW}Port ${PORT} is already in use — the dev server is running.${RESET}`);
    console.error(`${DIM}That is exactly what this script refuses to work around: with both up you`);
    console.error(`cannot tell whether a request went to the edge or to localhost.${RESET}\n`);
    console.error(`  Stop it first:  pkill -f vite\n`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log(`\n${BOLD}Production preview${RESET}`);
  console.log(`  ${DIM}serving only demo/prod.html — nothing else${RESET}`);
  console.log(`\n  http://localhost:${PORT}/\n`);
  console.log(`  ${DIM}Ctrl-C to stop.${RESET}\n`);
});
