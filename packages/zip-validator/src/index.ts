/**
 * Upload Validator (SRD module 3, FR-10 – FR-15, ST-14, ST-15).
 *
 * Phase A reads only the central directory and rejects the archive before anything is
 * written if any entry has an unsafe or disallowed name, type, size or attribute.
 * Phase B extracts entries into a fresh destination directory with running byte counters
 * that enforce the limits on the *actual* bytes, whatever the archive declares (ADR-003).
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import nodePath from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { DEFAULT_UPLOAD_LIMITS, type UploadLimits } from '@webcove/shared';
import { checkEntryName, extensionOf, isIgnored } from './paths.js';
import { errorMessage, type ErrorCode, type Issue } from './messages.js';
import {
  MAX_SCANNED_BYTES,
  buildIndex,
  newCollector,
  scanCss,
  scanHtml,
  scanJs,
  type Warning,
} from './warnings.js';

export type { ErrorCode, WarningCode, Issue } from './messages.js';
export type { Warning } from './warnings.js';
export { isAllowedType, extensionOf } from './paths.js';

export type ValidationError = Issue<ErrorCode>;

export interface ExtractedFile {
  /** Path relative to the site root, e.g. "css/style.css". */
  path: string;
  size: number;
  sha256: string;
  /** Absolute path of the extracted copy inside the destination directory. */
  diskPath: string;
}

export type ValidationResult =
  | {
      ok: true;
      files: ExtractedFile[];
      warnings: Warning[];
      totalBytes: number;
      strippedFolder: string | null;
    }
  | { ok: false; errors: ValidationError[] };

const MAX_REPORTED_ERRORS = 50;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

interface Candidate {
  entry: Entry;
  path: string;
}

class Errors {
  readonly list: ValidationError[] = [];
  constructor(private limits: UploadLimits) {}
  add(code: ErrorCode, file?: string, detail?: string) {
    if (this.list.length >= MAX_REPORTED_ERRORS) return;
    this.list.push({
      code,
      ...(file !== undefined && { file }),
      message: errorMessage(code, file, this.limits, detail),
    });
  }
  get any() {
    return this.list.length > 0;
  }
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: false,
        validateEntrySizes: true,
        strictFileNames: false,
      },
      (err, zip) => (err || !zip ? reject(err ?? new Error('open failed')) : resolve(zip)),
    );
  });
}

function readAllEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    zip.on('entry', (e: Entry) => {
      entries.push(e);
      zip.readEntry();
    });
    zip.once('end', () => resolve(entries));
    zip.once('error', reject);
    zip.readEntry();
  });
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Decode an entry name: UTF-8 when flagged or when the bytes are valid UTF-8; otherwise unsupported. */
function decodeName(entry: Entry): string | null {
  const raw = entry.fileName as unknown as Buffer;
  try {
    return utf8.decode(raw);
  } catch {
    // Pure ASCII is valid UTF-8, so this is a legacy (e.g. CP437) name with non-ASCII bytes.
    return null;
  }
}

function unixMode(entry: Entry): number | null {
  const madeBy = entry.versionMadeBy >> 8;
  // 3 = Unix, 19 = macOS; other systems do not store Unix modes in the high bits.
  if (madeBy !== 3 && madeBy !== 19) return null;
  return (entry.externalFileAttributes >>> 16) & 0xffff;
}

/** Phase A: inspect the central directory only. */
function inspect(entries: Entry[], limits: UploadLimits, errors: Errors) {
  const files: Candidate[] = [];
  const seen = new Map<string, string>();
  const seenLower = new Map<string, string>();
  let declaredTotal = 0;
  let compressedTotal = 0;

  for (const entry of entries) {
    const name = decodeName(entry);
    if (name === null) {
      errors.add('ENCODING');
      continue;
    }
    if (isIgnored(name)) continue;

    const mode = unixMode(entry);
    const type = mode === null ? null : mode & S_IFMT;
    const looksLikeDir = name.endsWith('/');
    if (type === S_IFLNK) {
      errors.add('SYMLINK', name);
      continue;
    }
    if (type !== null && type !== 0 && type !== S_IFREG && type !== S_IFDIR) {
      errors.add('SPECIAL_FILE', name);
      continue;
    }
    const isDir = looksLikeDir || type === S_IFDIR;

    const checked = checkEntryName(name, isDir);
    if (!checked.ok) {
      errors.add(checked.code, name, checked.detail);
      continue;
    }
    if (isDir) continue;

    if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
      errors.add('ENCRYPTED', checked.path);
      continue;
    }
    if (entry.uncompressedSize > limits.maxFileBytes) {
      errors.add('FILE_TOO_LARGE', checked.path);
      continue;
    }
    const prev = seen.get(checked.path);
    if (prev !== undefined) {
      errors.add('DUPLICATE_PATH', checked.path);
      continue;
    }
    const lower = checked.path.toLowerCase();
    const clash = seenLower.get(lower);
    if (clash !== undefined) {
      errors.add('CASE_CONFLICT', checked.path, `"${clash}"`);
      continue;
    }
    seen.set(checked.path, name);
    seenLower.set(lower, checked.path);
    declaredTotal += entry.uncompressedSize;
    compressedTotal += entry.compressedSize;
    files.push({ entry, path: checked.path });
  }

  if (files.length > limits.maxFiles) errors.add('TOO_MANY_FILES');
  if (declaredTotal > limits.maxTotalBytes) errors.add('TOTAL_TOO_LARGE');
  const denominator = Math.max(compressedTotal, 1);
  if (declaredTotal > 1024 * 1024 && declaredTotal / denominator > limits.maxCompressionRatio) {
    errors.add('COMPRESSION_RATIO');
  }
  if (!errors.any && files.length === 0) errors.add('EMPTY_ARCHIVE');
  return files;
}

/** FR-13: index.html at the root, or inside one enclosing folder that is stripped. */
function resolveRoot(files: Candidate[], errors: Errors): string | null {
  const paths = files.map((f) => f.path);
  if (paths.includes('index.html')) return '';
  const tops = new Set(paths.map((p) => (p.includes('/') ? p.split('/')[0]! : '')));
  if (tops.size === 1 && !tops.has('')) {
    const [top] = [...tops];
    if (paths.includes(`${top}/index.html`)) return `${top}/`;
  }
  // Helpful hints for the common mistakes.
  const caseMatch = paths.find((p) => /^(?:[^/]+\/)?index\.html?$/i.test(p));
  const nested = paths
    .filter((p) => p.endsWith('/index.html'))
    .sort((a, b) => a.length - b.length)[0];
  let hint: string | undefined;
  if (caseMatch) {
    hint = `Found "${caseMatch}". Rename it to exactly "index.html" (lower case, .html).`;
  } else if (nested) {
    hint = `Found "${nested}". Compress the folder that directly contains index.html, not a folder above it.`;
  }
  errors.add('NO_INDEX', undefined, hint);
  return null;
}

class LimitExceeded extends Error {
  constructor(readonly code: 'FILE_TOO_LARGE' | 'TOTAL_TOO_LARGE') {
    super(code);
  }
}

function openStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) =>
      err || !stream ? reject(err ?? new Error('stream')) : resolve(stream),
    );
  });
}

/**
 * Validate a ZIP on disk and, if it is acceptable, extract it into `destDir`
 * (which must be a fresh, empty directory owned by this upload).
 */
export async function validateAndExtract(
  zipPath: string,
  destDir: string,
  limits: UploadLimits = DEFAULT_UPLOAD_LIMITS,
): Promise<ValidationResult> {
  try {
    const result = await validateInner(zipPath, destDir, limits);
    // Never leave partially extracted files behind after a rejection.
    if (!result.ok) await rm(destDir, { recursive: true, force: true });
    return result;
  } catch (err) {
    await rm(destDir, { recursive: true, force: true });
    throw err;
  }
}

async function validateInner(
  zipPath: string,
  destDir: string,
  limits: UploadLimits,
): Promise<ValidationResult> {
  const errors = new Errors(limits);
  const archiveBytes = (await stat(zipPath)).size;
  if (archiveBytes > limits.maxArchiveBytes) {
    errors.add('ARCHIVE_TOO_LARGE');
    return { ok: false, errors: errors.list };
  }

  let zip: ZipFile;
  let entries: Entry[];
  try {
    zip = await openZip(zipPath);
    entries = await readAllEntries(zip);
  } catch {
    errors.add('NOT_A_ZIP');
    return { ok: false, errors: errors.list };
  }

  try {
    if (entries.length > limits.maxFiles * 2 + 100) {
      // Do not even iterate absurd entry counts.
      errors.add('TOO_MANY_FILES');
      return { ok: false, errors: errors.list };
    }
    const candidates = inspect(entries, limits, errors);
    if (errors.any) return { ok: false, errors: errors.list };
    const root = resolveRoot(candidates, errors);
    if (root === null) return { ok: false, errors: errors.list };

    // Phase B: bounded extraction.
    const root_ = nodePath.resolve(destDir);
    await mkdir(root_, { recursive: true });
    const extracted: ExtractedFile[] = [];
    let total = 0;
    for (const c of candidates) {
      const rel = c.path.slice(root.length);
      const diskPath = nodePath.resolve(root_, rel);
      // Defence in depth against path traversal (names were already validated).
      if (!diskPath.startsWith(root_ + nodePath.sep)) {
        errors.add('PARENT_PATH', c.path);
        return { ok: false, errors: errors.list };
      }
      await mkdir(nodePath.dirname(diskPath), { recursive: true });
      const hash = createHash('sha256');
      let size = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length;
          total += chunk.length;
          if (size > limits.maxFileBytes) return cb(new LimitExceeded('FILE_TOO_LARGE'));
          if (total > limits.maxTotalBytes) return cb(new LimitExceeded('TOTAL_TOO_LARGE'));
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      try {
        const stream = await openStream(zip, c.entry);
        await pipeline(stream, counter, createWriteStream(diskPath, { flags: 'wx' }));
      } catch (err) {
        if (err instanceof LimitExceeded) {
          errors.add(err.code, err.code === 'FILE_TOO_LARGE' ? c.path : undefined);
        } else {
          errors.add('SIZE_MISMATCH', c.path);
        }
        return { ok: false, errors: errors.list };
      }
      extracted.push({ path: rel, size, sha256: hash.digest('hex'), diskPath });
    }

    const warnings = await collectWarnings(extracted);
    return {
      ok: true,
      files: extracted,
      warnings,
      totalBytes: total,
      strippedFolder: root ? root.slice(0, -1) : null,
    };
  } finally {
    zip.close();
  }
}

async function collectWarnings(files: ExtractedFile[]): Promise<Warning[]> {
  const idx = buildIndex(files.map((f) => f.path));
  const c = newCollector();
  for (const f of files) {
    const ext = extensionOf(f.path);
    if (!['.html', '.htm', '.css', '.js'].includes(ext) || f.size > MAX_SCANNED_BYTES) continue;
    const text = await readFile(f.diskPath, 'utf8');
    if (ext === '.css') scanCss(c, idx, f.path, text);
    else if (ext === '.js') scanJs(c, f.path, text);
    else scanHtml(c, idx, f.path, text);
  }
  return c.items;
}
