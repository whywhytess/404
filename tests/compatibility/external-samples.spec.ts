/**
 * SRD 3.10 "External samples": unmodified sites from openly licensed learning material
 * (MDN Learning Area, CC0-1.0, pinned commit) are uploaded as they are. For each, we record
 * whether it is accepted, which rules it breaks (validator warnings / errors), and what the
 * browser blocks when it runs. This is a MEASUREMENT of the policy's restriction cost; the
 * test fails only if a measurement could not be taken.
 * Run `pnpm fixtures:external` first (files are verified by SHA-256).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { StudentSession, watch, zipFolder } from './platform.js';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures');
const EVIDENCE = path.resolve(import.meta.dirname, '../../docs/evidence/compatibility');
const manifest = JSON.parse(readFileSync(path.join(FIXTURES, 'external-samples.json'), 'utf8')) as {
  samples: { id: string; title: string; sourcePath: string; sourceCommit: string }[];
};

/** The page that shows the finished example, when it is not index.html (the folder is still uploaded unchanged). */
const ENTRY: Record<string, string> = { X2: 'index-finished.html', X4: 'personal-greeting.html' };

/** Typical user action per sample, so that behaviour triggered by interaction is exercised. */
const ACTIONS: Record<string, (page: Page) => Promise<void>> = {
  X4: async (page) => {
    await page.locator('#entername').fill('Aina', { timeout: 5000 });
    await page.locator('#submitname').click({ timeout: 5000 });
  },
  X5: async (page) => {
    await page.locator('#generate-primes').click({ timeout: 5000 });
  },
  X6: async (page) => {
    await page.locator('button.play').click({ timeout: 5000 });
  },
};

test.describe.configure({ mode: 'serial' });
const results: unknown[] = [];

test.beforeAll(() => {
  for (const s of manifest.samples) {
    if (!existsSync(path.join(FIXTURES, 'external', s.id)))
      throw new Error('Run `pnpm fixtures:external` first');
  }
});

for (const s of manifest.samples) {
  test(
    `${s.id} ${s.title} — measured unmodified`,
    { tag: '@cross' },
    async ({ page, browserName }) => {
      test.setTimeout(90_000);
      const session = await StudentSession.create(`ext-${s.id}-${browserName}`);
      const out = await session.publish(s.id, zipFolder(path.join(FIXTURES, 'external', s.id)));
      const record: Record<string, unknown> = {
        id: s.id,
        title: s.title,
        source: `${s.sourcePath}@${s.sourceCommit.slice(0, 7)}`,
        browser: browserName,
        accepted: out.status === 201,
        uploadStatus: out.status,
        rejectionCodes: [...new Set(out.errors.map((e) => e.code))],
        rejections: out.errors.map((e) => `${e.code}${e.file ? ` ${e.file}` : ''}`),
        warningCodes: [...new Set(out.warnings.map((w) => w.code))],
        warnings: out.warnings.map((w) => `${w.code} ${w.file ?? ''}`.trim()),
      };
      if (out.link) {
        const w = await watch(page);
        const external: string[] = [];
        page.on('requestfailed', (r) =>
          external.push(`${r.url()} (${r.failure()?.errorText ?? 'failed'})`),
        );
        record.entry = ENTRY[s.id] ?? 'index.html';
        await page.goto(`${out.link}${ENTRY[s.id] ?? ''}`);
        await page.waitForLoadState('networkidle');
        if (ACTIONS[s.id]) {
          await ACTIONS[s.id]!(page).catch((e: Error) =>
            w.pageErrors.push(`action failed: ${e.message}`),
          );
          await page.waitForTimeout(1000);
        }
        const violations = await w.violations();
        record.blockedDirectives = [...new Set(violations.map((v) => v.directive))];
        record.violations = violations.map((v) => `${v.directive} ${v.blocked}`);
        record.pageErrors = w.pageErrors;
        record.runsUnchanged = violations.length === 0 && w.pageErrors.length === 0;
      } else {
        record.runsUnchanged = false;
      }
      results.push(record);
      test.info().annotations.push({ type: 'measurement', description: JSON.stringify(record) });
      expect(record).toHaveProperty('accepted');
    },
  );
}

test.afterAll(({ browserName }) => {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE, `external-samples-${browserName}.json`),
    JSON.stringify(
      { measuredAt: new Date().toISOString(), browser: browserName, results },
      null,
      2,
    ) + '\n',
  );
});
