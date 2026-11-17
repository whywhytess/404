import { defineConfig, devices } from '@playwright/test';

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://webcove:webcove_dev_only@127.0.0.1:55432/webcove_e2e';
export const PLATFORM_URL = 'http://127.0.0.1:5173';
export const CONTENT_PORT = 4100;
const E2E_TOKEN_SECRET = 'e2e-token-secret-that-is-long-enough-0123456789';
const S3_ENV = {
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:59000',
  S3_BUCKET: 'webcove-e2e',
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? 'webcove',
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? 'webcove_dev_only',
};

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
        TOKEN_SECRET: E2E_TOKEN_SECRET,
        CONTENT_URL_PATTERN: `http://{sub}.localhost:${CONTENT_PORT}`,
        ...S3_ENV,
      },
    },
    {
      // Untrusted content origin: *.localhost is a different site from 127.0.0.1 (ADR-001).
      command: './node_modules/.bin/tsx src/server.ts',
      cwd: 'apps/content',
      // Readiness by port: the content server answers 404 to hosts that are not submissions.
      port: CONTENT_PORT,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        CONTENT_PORT: String(CONTENT_PORT),
        CONTENT_DOMAIN: 'localhost',
        PLATFORM_ORIGIN: PLATFORM_URL,
        TOKEN_SECRET: E2E_TOKEN_SECRET,
        DATABASE_URL: E2E_DATABASE_URL,
        ...S3_ENV,
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
