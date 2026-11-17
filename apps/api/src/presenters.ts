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
