// `pnpm dev:live`: try live chat locally in one command.
//
// Starts the live-chat Worker (e2e/live: a local D1, the live hub, the widget,
// a visitor page at / and the dashboard at /admin/) on :8788, then makes two
// accounts and turns live chat on. One port, like a deployment. Everything is
// local and wiped at each start.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = `http://localhost:${process.env['HELPPUFF_LIVE_PORT'] ?? '8788'}`;
// The test-only key from e2e/live/wrangler.toml.
const KEY = 'e2e-only-admin-key-not-for-any-deployment-012345';
const OWNER = { email: 'owner@local.test', password: 'live-chat-owner', name: 'Olivia' };
const MEMBER = { email: 'member@local.test', password: 'live-chat-member', name: 'Mo', role: 'member' };

const children = [spawn('node', [join(repo, 'e2e/live/serve.mjs')], { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] })];
const stop = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code && stop());

async function waitFor(url) {
  for (let i = 0; i < 180; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not start`);
}

const admin = (method, path, body) =>
  fetch(`${WORKER}/admin/api${path}`, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

process.stdout.write('Building the widget and the dashboard, then starting the Worker…\n');
await waitFor(`${WORKER}/healthz`);
for (const person of [OWNER, MEMBER]) await admin('POST', '/admins', person);
await admin('PUT', '/settings', { settings: { live: { enabled: true, waitSeconds: 60 } } });

process.stdout.write(`
Live chat is running.

  Team (dashboard)   ${WORKER}/admin/
                     owner:  ${OWNER.email} / ${OWNER.password}
                     member: ${MEMBER.email} / ${MEMBER.password}
  Visitor (widget)   ${WORKER}/   (use a private window)

Start a chat, press the person icon at the top of the widget, and answer from
the dashboard (click the dashboard once so the browser allows sound).
Over VS Code port forwarding, forward 8788: any local port 8780-8799 works.
Ctrl+C stops it. Everything is wiped at the next start.
`);
