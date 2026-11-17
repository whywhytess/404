import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateAndExtract, type ValidationResult } from '../src/index.js';
import { FIXTURES, NOT_A_ZIP } from '../src/fixtures.js';

let work: string;
beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'wc-validator-'));
});
afterAll(async () => rm(work, { recursive: true, force: true }));

let n = 0;
async function run(buf: Buffer): Promise<{ result: ValidationResult; dest: string }> {
  const id = ++n;
  const zipPath = path.join(work, `in-${id}.zip`);
  const dest = path.join(work, `out-${id}`);
  await writeFile(zipPath, buf);
  return { result: await validateAndExtract(zipPath, dest), dest };
}
const fixture = (name: string) => run(FIXTURES[name]!());

async function listTree(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
      .sort();
  } catch {
    return [];
  }
}

function expectRejected(result: ValidationResult, code: string, file?: string) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const match = result.errors.find((e) => e.code === code);
  expect(match, `expected ${code}, got ${JSON.stringify(result.errors)}`).toBeDefined();
  if (file) expect(match!.file).toBe(file);
  expect(match!.message.length).toBeGreaterThan(20);
}

describe('accepted archives (FR-10, FR-13)', () => {
  it('accepts a rule-compliant site and extracts every file with a hash', async () => {
    const { result, dest } = await fixture('valid-site');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.path).sort()).toEqual([
      'css/style.css',
      'img/logo.png',
      'index.html',
      'js/app.js',
    ]);
    expect(result.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(await listTree(dest)).toEqual([
      'css/style.css',
      'img/logo.png',
      'index.html',
      'js/app.js',
    ]);
  });

  it('strips a single enclosing folder and ignores __MACOSX and .DS_Store', async () => {
    const { result, dest } = await fixture('valid-wrapped');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strippedFolder).toBe('my-site');
    expect(await listTree(dest)).toEqual([
      'css/style.css',
      'img/logo.png',
      'index.html',
      'js/app.js',
    ]);
  });

  it('allows a file whose content does not match its extension (handled by nosniff, ST-13)', async () => {
    const { result } = await fixture('disguised-html');
    expect(result.ok).toBe(true);
  });
});

describe('ST-14 path traversal and links (FR-12)', () => {
  const cases: [string, string, string][] = [
    ['zipslip-parent', 'PARENT_PATH', '../evil.html'],
    ['zipslip-nested', 'PARENT_PATH', 'css/../../evil.js'],
    ['zipslip-absolute', 'ABSOLUTE_PATH', '/etc/evil.txt'],
    ['zipslip-drive', 'ABSOLUTE_PATH', 'C:/Windows/evil.txt'],
    ['zipslip-backslash', 'BACKSLASH_PATH', '..\\evil.html'],
    ['symlink', 'SYMLINK', 'secret.txt'],
  ];
  for (const [name, code, file] of cases) {
    it(`${name}: rejected with ${code} and nothing is written`, async () => {
      const { result, dest } = await fixture(name);
      expectRejected(result, code, file);
      expect(await listTree(dest)).toEqual([]);
      // Nothing escaped into the parent work directory either.
      expect((await readdir(work)).some((f) => f.startsWith('evil'))).toBe(false);
    });
  }
});

describe('ST-15 limits, types and malformed archives (FR-11, FR-12)', () => {
  it('rejects forbidden file types, naming the file', async () => {
    expectRejected((await fixture('forbidden-type')).result, 'FORBIDDEN_TYPE', 'shell.php');
    expectRejected((await fixture('hidden-file')).result, 'FORBIDDEN_TYPE', '.htaccess');
  });

  it('rejects a highly compressed archive (ZIP bomb ratio)', async () => {
    expectRejected((await fixture('bomb-ratio')).result, 'COMPRESSION_RATIO');
  });

  it('rejects an archive whose real sizes do not match its headers', async () => {
    const { result, dest } = await fixture('lying-size');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['SIZE_MISMATCH', 'FILE_TOO_LARGE']).toContain(result.errors[0]!.code);
    expect(await listTree(dest)).toEqual([]); // partial output is removed
  });

  it('rejects more than 500 files', async () => {
    expectRejected((await fixture('too-many-files')).result, 'TOO_MANY_FILES');
  });

  it('rejects a file larger than 5 MB', async () => {
    expectRejected((await fixture('oversize-file')).result, 'FILE_TOO_LARGE', 'video.mp4');
  });

  it('rejects duplicates, case conflicts, encrypted entries, bad names and legacy encodings', async () => {
    expectRejected((await fixture('duplicate')).result, 'DUPLICATE_PATH', 'index.html');
    expectRejected((await fixture('case-conflict')).result, 'CASE_CONFLICT', 'Index.html');
    expectRejected((await fixture('encrypted')).result, 'ENCRYPTED', 'secret.html');
    expectRejected((await fixture('nul-name')).result, 'INVALID_NAME');
    expectRejected((await fixture('legacy-encoding')).result, 'ENCODING');
  });

  it('rejects non-ZIP files and empty archives', async () => {
    expectRejected((await run(NOT_A_ZIP)).result, 'NOT_A_ZIP');
    expectRejected((await fixture('empty')).result, 'EMPTY_ARCHIVE');
  });

  it('rejects an archive over the size limit before opening it', async () => {
    const zipPath = path.join(work, 'huge.zip');
    await writeFile(zipPath, FIXTURES['valid-site']!());
    const result = await validateAndExtract(zipPath, path.join(work, 'huge-out'), {
      maxArchiveBytes: 10,
      maxFileBytes: 1e9,
      maxFiles: 1e6,
      maxTotalBytes: 1e9,
      maxCompressionRatio: 1e9,
    });
    expectRejected(result, 'ARCHIVE_TOO_LARGE');
  });

  it('enforces the total-size limit on actual bytes during extraction', async () => {
    const zipPath = path.join(work, 'total.zip');
    await writeFile(zipPath, FIXTURES['valid-site']!());
    const result = await validateAndExtract(zipPath, path.join(work, 'total-out'), {
      maxArchiveBytes: 1e9,
      maxFileBytes: 1e9,
      maxFiles: 1e6,
      maxTotalBytes: 150, // declared sizes pass the pre-check only if under this, so use a tiny value
      maxCompressionRatio: 1e9,
    });
    expectRejected(result, 'TOTAL_TOO_LARGE');
  });
});

describe('FR-13 index.html rules', () => {
  it('rejects an archive without index.html', async () => {
    expectRejected((await fixture('no-index')).result, 'NO_INDEX');
  });
  it('explains a wrongly-cased index file', async () => {
    const { result } = await fixture('index-wrong-case');
    expectRejected(result, 'NO_INDEX');
    if (!result.ok) expect(result.errors[0]!.message).toContain('Index.HTML');
  });
  it('explains an index.html nested too deep', async () => {
    const { result } = await fixture('index-too-deep');
    expectRejected(result, 'NO_INDEX');
    if (!result.ok) expect(result.errors[0]!.message).toContain('project/site/index.html');
  });
});

describe('FR-15 rule warnings', () => {
  it('warns about content the policy will block, without rejecting', async () => {
    const { result } = await fixture('warnings-site');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const got = result.warnings.map((w) => `${w.code}:${w.file}`);
    expect(got).toEqual(
      expect.arrayContaining([
        'EXTERNAL_STYLE:index.html',
        'ROOT_ABSOLUTE_PATH:index.html',
        'EXTERNAL_SCRIPT:index.html',
        'INLINE_SCRIPT:index.html',
        'EXTERNAL_RESOURCE:index.html',
        'INLINE_HANDLER:index.html',
        'JAVASCRIPT_URL:index.html',
        'CASE_MISMATCH:index.html',
        'MISSING_FILE:index.html',
        'EXTERNAL_FRAME:index.html',
        'EXTERNAL_FORM:index.html',
        'EXTERNAL_STYLE:css/style.css',
        'EXTERNAL_REQUEST:js/app.js',
        'EVAL:js/app.js',
        'WORKER:js/app.js',
        'BLOB_URL:js/app.js',
      ]),
    );
    // Exactly one inline-script warning: the JSON data block and the commented-out script are ignored.
    expect(result.warnings.filter((w) => w.code === 'INLINE_SCRIPT')).toHaveLength(1);
    // A normal link to another website is not a warning.
    expect(result.warnings.some((w) => w.message.includes('www.usm.my'))).toBe(false);
    // The relative CSS url(../img/logo.png) resolves correctly.
    expect(
      result.warnings.some((w) => w.file === 'css/style.css' && w.code === 'MISSING_FILE'),
    ).toBe(false);
    // Every message names the file.
    for (const w of result.warnings) expect(w.message).toContain(`"${w.file}"`);
  });
});
