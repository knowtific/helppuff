import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * The dashboard demo (`demo.html`, `demo/`): the real dashboard with its API
 * answered in the page, as a static site the website serves at
 * `/dashboard-demo/`. Relative paths, so it works under any base.
 */
const version = (JSON.parse(readFileSync(resolve(__dirname, '../cli/package.json'), 'utf8')) as { version: string }).version;

export default mergeConfig(base, defineConfig({
  base: './',
  define: {
    __HELPPUFF_VERSION__: JSON.stringify(version),
    'import.meta.env.VITE_HELPPUFF_DEMO_URL': JSON.stringify('https://knowtific.github.io/helppuff/#demo'),
    // Home's live test chat: the website's widget preview, filling the frame, with scripted answers.
    'import.meta.env.VITE_HELPPUFF_CHAT_URL': JSON.stringify('../playground/preview.html?demo=showcase&open=1&fill=1&setup=' + Buffer.from(JSON.stringify({ widget: { brand: { name: 'Harbour Plumbing', agentName: 'Sam', accent: '#5B5BF7', theme: 'auto' }, leadForm: { enabled: false }, chat: { initialMessages: ['Hi, I’m Sam from Harbour Plumbing. How can I help today?'] } } })).toString('base64url')),
  },
  build: { outDir: 'dist-demo', emptyOutDir: true, rollupOptions: { input: resolve(__dirname, 'demo.html') } },
}));
