/**
 * Download the external samples listed in tests/fixtures/external-samples.json from the
 * pinned commit and verify every file's SHA-256. Output: tests/fixtures/external/<id>/
 * (git-ignored: third-party assets are not redistributed in this repository).
 * Usage: pnpm fixtures:external
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface Manifest {
  samples: {
    id: string;
    sourceRepository: string;
    sourcePath: string;
    sourceCommit: string;
    files: { path: string; size: number; sha256: string }[];
  }[];
}

const root = path.resolve(import.meta.dirname, '../tests/fixtures');
const manifest = JSON.parse(
  readFileSync(path.join(root, 'external-samples.json'), 'utf8'),
) as Manifest;
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

for (const s of manifest.samples) {
  const dir = path.join(root, 'external', s.id);
  const repo = new URL(s.sourceRepository).pathname.replace(/^\//, '');
  let fetched = 0;
  for (const f of s.files) {
    const target = path.join(dir, f.path);
    if (existsSync(target) && sha256(readFileSync(target)) === f.sha256) continue;
    const url = `https://raw.githubusercontent.com/${repo}/${s.sourceCommit}/${s.sourcePath}/${f.path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== f.sha256) throw new Error(`Checksum mismatch for ${s.id}/${f.path}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, buf);
    fetched++;
  }
  console.log(`${s.id}: ${s.files.length} files verified (${fetched} downloaded)`);
}
