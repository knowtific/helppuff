import { defineConfig, devices } from '@playwright/test';

/**
 * UI tests run against the real Worker and the real widget bundle — the same
 * two processes `pnpm dev` starts.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Chromium-based so the suite runs without a WebKit download; real
    // Safari and Android passes are part of M5's device testing.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: [
    {
      command: 'pnpm --filter @helppuff/server exec wrangler dev --port 8787 --local',
      url: 'http://localhost:8787/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
    },
    {
      // Live chat's Worker: a local D1, the live hub and the dashboard (e2e/live).
      command: 'node e2e/live/serve.mjs',
      url: 'http://localhost:8788/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'ignore',
    },
    {
      command: 'pnpm --filter @helppuff/widget exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
    },
  ],
});
