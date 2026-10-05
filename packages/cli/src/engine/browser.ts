import { spawn } from 'node:child_process';

/**
 * Open a URL in the person's browser, best effort. Never for agents or CI:
 * callers check `ctx.interactive` and `--no-browser` first. A failure is
 * silent — the URL is always printed too.
 */
export function openBrowser(url: string): void {
  if (!/^https?:\/\//.test(url)) return;
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(command, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser here; the printed link is enough.
  }
}
