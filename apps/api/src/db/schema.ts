import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { AccountType, AssignmentStatus, CourseRole } from '@webcove/shared';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  name: string;
  email: string;
  password_hash: string;
  account_type: AccountType;
  status: ColumnType<'active' | 'disabled', 'active' | 'disabled' | undefined>;
  must_change_password: ColumnType<boolean, boolean | undefined>;
  /** Incremented on password reset, password change or disable; invalidates old sessions. */
  session_version: ColumnType<number, number | undefined>;
  created_at: Timestamp;
}

export interface CoursesTable {
  id: Generated<string>;
  code: string;
  title: string;
  join_code: string;
  end_date: ColumnType<string | null, string | null | undefined>;
  created_by: string | null;
  created_at: Timestamp;
}

export interface EnrollmentsTable {
  course_id: string;
  user_id: string;
  role: CourseRole;
  created_at: Timestamp;
}

export interface AssignmentsTable {
  id: Generated<string>;
  course_id: string;
  title: string;
  description: ColumnType<string, string | undefined>;
  status: ColumnType<AssignmentStatus, AssignmentStatus | undefined>;
  closed_at: ColumnType<Date | null, Date | null | undefined>;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AuditLogTable {
  id: Generated<string>;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  metadata: ColumnType<Record<string, unknown>, string | undefined, string>;
  created_at: Timestamp;
}

export interface SubmissionsTable {
  id: Generated<string>;
  assignment_id: string;
  student_id: string;
  subdomain: string;
  current_version_id: string | null;
  previous_version_id: string | null;
  taken_down_at: Date | null;
  taken_down_reason: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface StoredWarning {
  code: string;
  file?: string;
  message: string;
}

export interface VersionsTable {
  id: string;
  submission_id: string;
  number: number;
  file_count: number;
  /** bigint is returned as a string by node-postgres. */
  total_bytes: ColumnType<string, number, number>;
  warnings: ColumnType<StoredWarning[], string, string>;
  manifest: ColumnType<ManifestEntry[], string, string>;
  uploaded_by: string | null;
  files_deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Timestamp;
}

export interface RetiredSubdomainsTable {
  subdomain: string;
  retired_at: Timestamp;
}

type BigInt = ColumnType<string, number | undefined, number>;

export interface PlatformSettingsTable {
  id: ColumnType<number, number | undefined, never>;
  storage_quota_bytes: BigInt;
  uploads_per_hour: ColumnType<number, number | undefined, number>;
  content_requests_per_second: ColumnType<number, number | undefined, number>;
  max_archive_bytes: BigInt;
  max_file_bytes: BigInt;
  max_files: ColumnType<number, number | undefined, number>;
  max_total_bytes: BigInt;
  max_compression_ratio: ColumnType<number, number | undefined, number>;
  updated_at: Timestamp;
  updated_by: string | null;
}

export interface UploadAttemptsTable {
  id: Generated<string>;
  assignment_id: string;
  student_id: string;
  created_at: Timestamp;
}

export interface Database {
  users: UsersTable;
  courses: CoursesTable;
  enrollments: EnrollmentsTable;
  assignments: AssignmentsTable;
  audit_log: AuditLogTable;
  submissions: SubmissionsTable;
  versions: VersionsTable;
  retired_subdomains: RetiredSubdomainsTable;
  platform_settings: PlatformSettingsTable;
  upload_attempts: UploadAttemptsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Course = Selectable<CoursesTable>;
export type Assignment = Selectable<AssignmentsTable>;
export type Submission = Selectable<SubmissionsTable>;
export type Version = Selectable<VersionsTable>;
