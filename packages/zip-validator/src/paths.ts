/**
 * Entry-name checks done on the central directory, before anything is extracted (ADR-003).
 */
import path from 'node:path/posix';
import { CONTENT_TYPES } from '@webcove/shared';

export type PathIssueCode =
  'ABSOLUTE_PATH' | 'PARENT_PATH' | 'BACKSLASH_PATH' | 'INVALID_NAME' | 'FORBIDDEN_TYPE';

export const MAX_PATH_LENGTH = 255;
export const MAX_PATH_DEPTH = 20;

/** Names that are silently ignored (FR-13) — operating-system clutter, never site content. */
export function isIgnored(name: string): boolean {
  const segments = name.split('/');
  const base = segments[segments.length - 1] ?? '';
  return (
    segments[0] === '__MACOSX' ||
    base === '.DS_Store' ||
    base.startsWith('._') || // AppleDouble resource forks
    base === 'Thumbs.db' ||
    base === 'desktop.ini'
  );
}

/**
 * Validate and normalise one entry name. Returns the normalised relative path
 * (NFC, no "." segments, no trailing slash) or an issue code.
 */
export function checkEntryName(
  raw: string,
  isDirectory: boolean,
): { ok: true; path: string } | { ok: false; code: PathIssueCode; detail?: string } {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw))
    return { ok: false, code: 'INVALID_NAME', detail: 'control character' };
  if (raw.includes('\\')) return { ok: false, code: 'BACKSLASH_PATH' };
  if (raw.startsWith('/')) return { ok: false, code: 'ABSOLUTE_PATH' };
  if (/^[A-Za-z]:/.test(raw)) return { ok: false, code: 'ABSOLUTE_PATH' };

  const name = raw.normalize('NFC');
  const trimmed = isDirectory ? name.replace(/\/+$/, '') : name;
  const segments = trimmed.split('/').filter((s) => s !== '.');
  if (segments.some((s) => s === '..')) return { ok: false, code: 'PARENT_PATH' };
  if (segments.some((s) => s === ''))
    return { ok: false, code: 'INVALID_NAME', detail: 'empty path segment' };
  if (segments.length === 0) return { ok: false, code: 'INVALID_NAME', detail: 'empty name' };
  if (segments.length > MAX_PATH_DEPTH)
    return { ok: false, code: 'INVALID_NAME', detail: 'too deeply nested' };
  const normalised = segments.join('/');
  if (normalised.length > MAX_PATH_LENGTH)
    return { ok: false, code: 'INVALID_NAME', detail: 'path too long' };

  // Defence in depth: the normalised path must stay inside the site root.
  const resolved = path.normalize(normalised);
  if (resolved.startsWith('../') || resolved === '..' || path.isAbsolute(resolved)) {
    return { ok: false, code: 'PARENT_PATH' };
  }

  if (!isDirectory && !isAllowedType(normalised)) return { ok: false, code: 'FORBIDDEN_TYPE' };
  return { ok: true, path: normalised };
}

export function extensionOf(p: string): string {
  return path.extname(p).toLowerCase();
}

export function isAllowedType(p: string): boolean {
  return Object.hasOwn(CONTENT_TYPES, extensionOf(p));
}
