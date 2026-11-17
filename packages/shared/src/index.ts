/**
 * Contracts shared by the platform API, the content server and the web front end.
 */

/** Account type: who created the account and what it is for. */
export const ACCOUNT_TYPES = ['student', 'staff', 'admin'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Role a user holds inside one course (ENROLLMENT.role in the SRD ERD). */
export const COURSE_ROLES = ['student', 'ta', 'instructor'] as const;
export type CourseRole = (typeof COURSE_ROLES)[number];

export const ASSIGNMENT_STATUSES = ['open', 'closed'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** Stable machine-readable error codes. The UI switches on these, never on messages. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'CSRF_ORIGIN_MISMATCH',
  'INVALID_CREDENTIALS',
  'ACCOUNT_DISABLED',
  'PASSWORD_CHANGE_REQUIRED',
  'EMAIL_TAKEN',
  'INVALID_JOIN_CODE',
  'ALREADY_ENROLLED',
  'ASSIGNMENT_CLOSED',
  'COURSE_ENDED',
  'RATE_LIMITED',
  'UPLOAD_REJECTED',
  'ARCHIVE_TOO_LARGE',
  'NO_PREVIOUS_VERSION',
  'STORAGE_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  accountType: AccountType;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
}

/**
 * Allowed file extensions and the Content-Type the content server sends for each
 * (SRD Table 3.21, FR-12, FR-25). Anything else is rejected at upload.
 */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/** Initial upload limits (SRD Table 3.21); adjustable by administrators later (FR-35). */
export interface UploadLimits {
  maxArchiveBytes: number;
  maxFileBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  /** Reject if total uncompressed size / total compressed size exceeds this. */
  maxCompressionRatio: number;
}

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxArchiveBytes: 20 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxFiles: 500,
  maxTotalBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 100,
};
