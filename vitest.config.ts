import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['apps/*/test/unit/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['apps/*/test/integration/**/*.test.ts'],
          environment: 'node',
          // Integration tests share one test database, so run files one at a time.
          fileParallelism: false,
          testTimeout: 20000,
          hookTimeout: 30000,
          env: { NODE_ENV: 'test' },
        },
      },
    ],
    coverage: { provider: 'v8', reporter: ['text', 'html', 'json-summary'] },
  },
});
