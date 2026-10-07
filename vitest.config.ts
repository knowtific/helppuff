import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  resolve: {
    alias: { 'react/jsx-runtime': 'preact/jsx-runtime', react: 'preact/compat' },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    projects: [
      {
        // Pure logic: reducers, validators, tokens, the server.
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/**/test/**/*.test.ts', 'website/test/**/*.test.ts'],
        },
      },
      {
        // Functional tests: real components in a real DOM.
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['packages/**/test/**/*.test.tsx'],
          setupFiles: [resolve(__dirname, 'packages/widget/test/setup.ts')],
        },
      },
    ],
  },
});
