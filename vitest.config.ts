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
          exclude: ['**/node_modules/**', 'packages/dashboard/**'],
          setupFiles: [resolve(__dirname, 'packages/widget/test/setup.ts')],
        },
      },
      {
        // The dashboard is React, not Preact: its own project, without the alias.
        esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
        test: {
          name: 'dashboard',
          environment: 'happy-dom',
          environmentOptions: { happyDOM: { url: 'http://dashboard.test/admin/' } },
          include: ['packages/dashboard/test/**/*.test.tsx'],
          setupFiles: [resolve(__dirname, 'packages/dashboard/test/setup.ts')],
        },
      },
    ],
  },
});
