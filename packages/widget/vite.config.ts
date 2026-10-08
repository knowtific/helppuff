import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

/**
 * Dev server for the demo, the options playground, the gallery and the
 * hostile-page fixtures.
 *
 * The root is the package itself so that `/src/loader.ts` resolves — the
 * demo embeds the widget exactly as a host page does, by script src. These
 * rewrites keep the URLs clean (`/`, `/gallery.html`, `/fixtures/…`) so the
 * Playwright specs read the way a real site's would.
 */
function demoRoutes(): Plugin {
  const map: Record<string, string> = {
    '/': '/demo/index.html',
    '/index.html': '/demo/index.html',
    '/gallery.html': '/demo/gallery.html',
    '/playground.html': '/demo/playground.html',
    '/preview.html': '/demo/preview.html',
  };
  return {
    name: 'helppuff-demo-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path = '/', query] = (req.url ?? '/').split('?');
        const target = map[path] ?? (path.startsWith('/fixtures/') ? `/demo${path}` : null);
        if (target) req.url = query ? `${target}?${query}` : target;
        next();
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  root: __dirname,
  // Relative, so the built pages work from any path: the website serves them under /helppuff/playground/.
  base: command === 'build' ? './' : '/',
  plugins: [demoRoutes()],
  server: { port: 5173, strictPort: true },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  define: {
    __HELPPUFF_VERSION__: JSON.stringify('0.1.0-dev'),
    __HELPPUFF_APP_FILE__: JSON.stringify('/src/app/index.tsx'),
    __HELPPUFF_LIVE_FILE__: JSON.stringify('/src/live/index.ts'),
    // The playground's preview embeds the source in dev and the built bundle
    // (copied next to it by `scripts/build-playground.mjs`) when published.
    __HELPPUFF_PLAYGROUND_LOADER__: JSON.stringify(command === 'build' ? 'widget/loader.js' : '/src/loader.ts'),
  },
  build: {
    outDir: resolve(__dirname, 'dist-demo'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'demo/index.html'),
        gallery: resolve(__dirname, 'demo/gallery.html'),
        playground: resolve(__dirname, 'demo/playground.html'),
        preview: resolve(__dirname, 'demo/preview.html'),
      },
    },
  },
}));
