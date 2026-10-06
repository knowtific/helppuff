import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The dashboard is served by the Worker as static assets under /admin/, and
 * talks to /admin/api on the same origin. In development, point the proxy
 * at a running `helppuff dev` (HELPPUFF_DEV_URL, default localhost:8787).
 */
export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5174,
    proxy: { '/admin/api': process.env.HELPPUFF_DEV_URL ?? 'http://localhost:8787' },
  },
});
