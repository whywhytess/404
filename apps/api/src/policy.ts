import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { CourseRole } from '@webcove/shared';
import type { Database, User } from './db/schema.js';
import { forbidden, notFound } from './errors.js';

/** Who may act, in terms of the permission matrix (SRD Table 3.12). */
export type Actor = CourseRole | 'admin';

const uuid = z.uuid();
/** Malformed IDs are reported as "not found" rather than as a server error. */
export function assertUuid(id: string, what: string): string {
  if (!uuid.safeParse(id).success) throw notFound(what);
  return id;
}

export async function getCourseRole(
  db: Kysely<Database>,
  courseId: string,
  userId: string,
): Promise<CourseRole | null> {
  const row = await db
    .selectFrom('enrollments')
    .select('role')
    .where('course_id', '=', courseId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.role ?? null;
}

/**
 * Server-side course-scoped authorisation (FR-04, INV-06).
 * - A user with no relationship to the course gets 404, so course IDs cannot be probed.
 * - A member whose role is not allowed gets 403.
 * Returns the actor role that was matched.
 */
export async function authoriseCourse(
  db: Kysely<Database>,
  user: User,
  courseId: string,
  allowed: readonly Actor[],
): Promise<Actor> {
  assertUuid(courseId, 'Course');
  const course = await db
    .selectFrom('courses')
    .select('id')
    .where('id', '=', courseId)
    .executeTakeFirst();
  if (!course) throw notFound('Course');
  if (user.account_type === 'admin') {
    if (allowed.includes('admin')) return 'admin';
    throw forbidden();
  }
  const role = await getCourseRole(db, courseId, user.id);
  if (!role) throw notFound('Course');
  if (!allowed.includes(role)) throw forbidden();
  return role;
}

/** Same as authoriseCourse, starting from an assignment ID. */
export async function authoriseAssignment(
  db: Kysely<Database>,
  user: User,
  assignmentId: string,
  allowed: readonly Actor[],
) {
  assertUuid(assignmentId, 'Assignment');
  const assignment = await db
    .selectFrom('assignments')
    .selectAll()
    .where('id', '=', assignmentId)
    .executeTakeFirst();
  if (!assignment) throw notFound('Assignment');
  try {
    const actor = await authoriseCourse(db, user, assignment.course_id, allowed);
    return { assignment, actor };
  } catch (err) {
    // Do not reveal that the assignment exists in a course the user cannot see.
    if (err instanceof Error && 'code' in err && err.code === 'NOT_FOUND')
      throw notFound('Assignment');
    throw err;
  }
}

export const STAFF: readonly Actor[] = ['instructor', 'ta', 'admin'];
export const MANAGERS: readonly Actor[] = ['instructor', 'admin'];
export const MEMBERS: readonly Actor[] = ['student', 'ta', 'instructor', 'admin'];
