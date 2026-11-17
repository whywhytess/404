import type { PublicUser } from '@webcove/shared';
import type { Assignment, Course, User } from './db/schema.js';

/** Only these fields ever leave the server; password_hash and session_version never do. */
export const presentUser = (u: User): PublicUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  accountType: u.account_type,
  status: u.status,
  mustChangePassword: u.must_change_password,
});

export const presentCourse = (c: Course, opts: { includeJoinCode: boolean }) => ({
  id: c.id,
  code: c.code,
  title: c.title,
  endDate: c.end_date,
  purgedAt: c.purged_at,
  ...(opts.includeJoinCode ? { joinCode: c.join_code } : {}),
});

export const presentAssignment = (a: Assignment) => ({
  id: a.id,
  courseId: a.course_id,
  title: a.title,
  description: a.description,
  status: a.status,
  closedAt: a.closed_at,
  createdAt: a.created_at,
  updatedAt: a.updated_at,
});

export const presentVersion = (v: import('./db/schema.js').Version) => ({
  id: v.id,
  number: v.number,
  fileCount: v.file_count,
  totalBytes: Number(v.total_bytes),
  warningCount: v.warnings.length,
  warnings: v.warnings,
  filesAvailable: v.files_deleted_at === null,
  createdAt: v.created_at,
});

export const presentSubmission = (s: import('./db/schema.js').Submission) => ({
  id: s.id,
  assignmentId: s.assignment_id,
  studentId: s.student_id,
  subdomain: s.subdomain,
  currentVersionId: s.current_version_id,
  previousVersionId: s.previous_version_id,
  takenDown: s.taken_down_at !== null,
  takenDownReason: s.taken_down_reason,
  updatedAt: s.updated_at,
});
