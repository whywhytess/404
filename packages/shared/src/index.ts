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
