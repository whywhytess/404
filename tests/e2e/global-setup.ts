import { execFileSync } from 'node:child_process';
import { E2E_DATABASE_URL } from '../../playwright.config.js';

export const E2E_ADMIN = { email: 'admin@e2e.webcove.test', password: 'e2e-admin-password' };

/** Fresh e2e database with one administrator. Synthetic data only. */
export default function globalSetup() {
  execFileSync(
    'pnpm',
    [
      '--filter',
      '@webcove/api',
      'exec',
      'tsx',
      'scripts/reset-e2e-db.ts',
      E2E_DATABASE_URL,
      E2E_ADMIN.email,
      E2E_ADMIN.password,
    ],
    { stdio: 'inherit' },
  );
}
