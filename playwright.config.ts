import { defineConfig, devices } from '@playwright/test';

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://webcove:webcove_dev_only@127.0.0.1:55432/webcove_e2e';
export const PLATFORM_URL = 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: 'tests',
  testMatch: ['e2e/**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: PLATFORM_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Run binaries directly (not via pnpm) so Playwright can stop them cleanly.
      command: './node_modules/.bin/tsx src/server.ts',
      cwd: 'apps/api',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        API_PORT: '3000',
        PLATFORM_ORIGIN: PLATFORM_URL,
        DATABASE_URL: E2E_DATABASE_URL,
        SESSION_SECRET: 'e2e-session-secret-that-is-long-enough-0123456789',
      },
    },
    {
      command: './node_modules/.bin/vite',
      cwd: 'apps/web',
      url: PLATFORM_URL,
      reuseExistingServer: false,
    },
  ],
});
