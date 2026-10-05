import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint is aimed at the rules the build plan actually makes commitments
 * about — no stray `console`, no floating promises, no `any` in the protocol
 * or connector interfaces — rather than at style, which the codebase keeps
 * consistent by hand.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-demo/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      'test-results/**',
      'playwright-report/**',
      'private/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // No console.log in shipped bundles; the server uses injected `log`.
      'no-console': 'error',
      // A dropped promise is how a fail-safe path silently stops working.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // No `any` in the protocol or connector interfaces.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // An empty catch is deliberate throughout the fail-safe layer.
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
    },
  },

  {
    // The one place a console call is intended, behind a debug flag.
    files: ['packages/widget/src/lib/env.ts', 'packages/server/src/core/request.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    // Build scripts and the demo run in Node or a plain page, not in a bundle.
    files: ['**/scripts/**', '**/demo/**', '*.config.*', 'e2e/**'],
    rules: { 'no-console': 'off' },
  },

  {
    // Config files and plain-JS build scripts sit outside every tsconfig, so
    // there is no type information to lint them with.
    files: [
      '**/*.config.{js,ts,mjs}',
      '**/scripts/**/*.mjs',
      '**/demo/fixtures/*.js',
      'eslint.config.js',
    ],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    files: ['**/test/**', 'e2e/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
