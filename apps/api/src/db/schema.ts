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

export interface Database {
  users: UsersTable;
  courses: CoursesTable;
  enrollments: EnrollmentsTable;
  assignments: AssignmentsTable;
  audit_log: AuditLogTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Course = Selectable<CoursesTable>;
export type Assignment = Selectable<AssignmentsTable>;
