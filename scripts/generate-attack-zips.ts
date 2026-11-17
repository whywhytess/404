/**
 * Write the small archive fixtures to tests/fixtures/archives/ for manual demos
 * (e.g. uploading a Zip Slip archive in the UI). Large fixtures (> 1 MB) are generated
 * in memory by the tests instead of being committed.
 * Usage: pnpm fixtures:archives
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURES, NOT_A_ZIP } from '@webcove/zip-validator/fixtures';

const out = path.resolve(import.meta.dirname, '../tests/fixtures/archives');
mkdirSync(out, { recursive: true });
let count = 0;
for (const [name, build] of Object.entries(FIXTURES)) {
  const buf = build();
  if (buf.length > 1024 * 1024) continue;
  writeFileSync(path.join(out, `${name}.zip`), buf);
  count++;
}
writeFileSync(path.join(out, 'not-a-zip.zip'), NOT_A_ZIP);
console.log(`Wrote ${count + 1} fixtures to ${path.relative(process.cwd(), out)}`);
