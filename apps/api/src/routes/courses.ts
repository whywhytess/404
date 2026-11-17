import { Router, type RequestHandler } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/schema.js';
import { AppError, forbidden, notFound, parse } from '../errors.js';
import { generateJoinCode, normaliseJoinCode } from '../auth/join-code.js';
import { presentCourse, presentUser } from '../presenters.js';
import { MANAGERS, MEMBERS, STAFF, assertUuid, authoriseCourse } from '../policy.js';
import { audit } from '../audit.js';
import { requireAdmin } from '../middleware/auth.js';

const IsoDate = z.iso.date({ message: 'Use the format YYYY-MM-DD' });
const CreateCourseBody = z.object({
  code: z.string().trim().min(1).max(20),
  title: z.string().trim().min(1).max(200),
  endDate: IsoDate.nullable().optional(),
});
const UpdateCourseBody = CreateCourseBody.partial();
const AssignStaffBody = z.object({ userId: z.uuid(), role: z.enum(['instructor', 'ta']) });
const JoinBody = z.object({ joinCode: z.string().trim().min(1).max(32) });

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';

/** True when the course has an end date that is already in the past (FR-36). */
export function courseHasEnded(endDate: string | null, now = new Date()): boolean {
  if (!endDate) return false;
  return now.toISOString().slice(0, 10) > endDate;
}

export function courseRoutes(db: Kysely<Database>, joinLimiter: RequestHandler) {
  const r = Router();

  // Courses the user can see: all for administrators, otherwise those they are enrolled in.
  r.get('/', async (req, res) => {
    const user = req.user!;
    if (user.account_type === 'admin') {
      const courses = await db
        .selectFrom('courses')
        .selectAll()
        .orderBy('created_at', 'desc')
        .execute();
      res.json({
        courses: courses.map((c) => ({
          ...presentCourse(c, { includeJoinCode: true }),
          role: 'admin',
        })),
      });
      return;
    }
    const rows = await db
      .selectFrom('courses')
      .innerJoin('enrollments', 'enrollments.course_id', 'courses.id')
      .selectAll('courses')
      .select('enrollments.role')
      .where('enrollments.user_id', '=', user.id)
      .orderBy('courses.created_at', 'desc')
      .execute();
    res.json({
      courses: rows.map((c) => ({
        ...presentCourse(c, { includeJoinCode: c.role === 'instructor' }),
        role: c.role,
      })),
    });
  });

  // FR-05: administrators create courses. FR-06: a join code is generated automatically.
  r.post('/', requireAdmin, async (req, res) => {
    const body = parse(CreateCourseBody, req.body);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const course = await db
          .insertInto('courses')
          .values({
            code: body.code,
            title: body.title,
            end_date: body.endDate ?? null,
            join_code: generateJoinCode(),
            created_by: req.user!.id,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(db, {
          actorId: req.user!.id,
          action: 'course.create',
          targetType: 'course',
          targetId: course.id,
        });
        res.status(201).json({ course: presentCourse(course, { includeJoinCode: true }) });
        return;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err; // join-code collision: retry
      }
    }
    throw new AppError('INTERNAL', 'Could not generate a unique join code');
  });

  // FR-07: a student joins a course with its join code.
  r.post('/join', joinLimiter, async (req, res) => {
    const user = req.user!;
    if (user.account_type === 'admin') throw forbidden('Administrators do not join courses');
    const { joinCode } = parse(JoinBody, req.body);
    const course = await db
      .selectFrom('courses')
      .selectAll()
      .where('join_code', '=', normaliseJoinCode(joinCode))
      .executeTakeFirst();
    if (!course) throw new AppError('INVALID_JOIN_CODE', 'This join code is not valid');
    if (courseHasEnded(course.end_date))
      throw new AppError('COURSE_ENDED', 'This course has ended');
    const inserted = await db
      .insertInto('enrollments')
      .values({ course_id: course.id, user_id: user.id, role: 'student' })
      .onConflict((oc) => oc.columns(['course_id', 'user_id']).doNothing())
      .returning('role')
      .executeTakeFirst();
    if (!inserted)
      throw new AppError('ALREADY_ENROLLED', 'You are already a member of this course');
    res
      .status(201)
      .json({ course: { ...presentCourse(course, { includeJoinCode: false }), role: 'student' } });
  });

  r.get('/:id', async (req, res) => {
    const role = await authoriseCourse(db, req.user!, req.params.id, MEMBERS);
    const course = await db
      .selectFrom('courses')
      .selectAll()
      .where('id', '=', req.params.id)
      .executeTakeFirstOrThrow();
    res.json({
      course: {
        ...presentCourse(course, { includeJoinCode: role === 'admin' || role === 'instructor' }),
        role,
      },
    });
  });

  r.patch('/:id', requireAdmin, async (req, res) => {
    const courseId = String(req.params.id);
    assertUuid(courseId, 'Course');
    const body = parse(UpdateCourseBody, req.body);
    const course = await db
      .updateTable('courses')
      .set({
        ...(body.code !== undefined && { code: body.code }),
        ...(body.title !== undefined && { title: body.title }),
        ...(body.endDate !== undefined && { end_date: body.endDate }),
      })
      .where('id', '=', courseId)
      .returningAll()
      .executeTakeFirst();
    if (!course) throw notFound('Course');
    await audit(db, {
      actorId: req.user!.id,
      action: 'course.update',
      targetType: 'course',
      targetId: course.id,
      metadata: { fields: Object.keys(body) },
    });
    res.json({ course: presentCourse(course, { includeJoinCode: true }) });
  });

  // FR-06: the instructor regenerates the join code; the old code stops working immediately.
  r.post('/:id/join-code/rotate', async (req, res) => {
    await authoriseCourse(db, req.user!, req.params.id, MANAGERS);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const course = await db
          .updateTable('courses')
          .set({ join_code: generateJoinCode() })
          .where('id', '=', req.params.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(db, {
          actorId: req.user!.id,
          action: 'course.rotate_join_code',
          targetType: 'course',
          targetId: course.id,
        });
        res.json({ course: presentCourse(course, { includeJoinCode: true }) });
        return;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new AppError('INTERNAL', 'Could not generate a unique join code');
  });

  r.get('/:id/staff', async (req, res) => {
    await authoriseCourse(db, req.user!, req.params.id, STAFF);
    const rows = await db
      .selectFrom('enrollments')
      .innerJoin('users', 'users.id', 'enrollments.user_id')
      .selectAll('users')
      .select('enrollments.role')
      .where('enrollments.course_id', '=', req.params.id)
      .where('enrollments.role', 'in', ['instructor', 'ta'])
      .orderBy('users.name')
      .execute();
    res.json({ staff: rows.map((u) => ({ ...presentUser(u), role: u.role })) });
  });

  // FR-05: administrators assign (or change) a course's instructor and TAs.
  r.post('/:id/staff', requireAdmin, async (req, res) => {
    const courseId = String(req.params.id);
    await authoriseCourse(db, req.user!, courseId, ['admin']);
    const body = parse(AssignStaffBody, req.body);
    const staff = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', body.userId)
      .where('account_type', '=', 'staff')
      .executeTakeFirst();
    if (!staff) throw notFound('Staff account');
    if (staff.status !== 'active') throw new AppError('CONFLICT', 'This staff account is disabled');
    const existing = await db
      .selectFrom('enrollments')
      .select('role')
      .where('course_id', '=', courseId)
      .where('user_id', '=', staff.id)
      .executeTakeFirst();
    if (existing?.role === 'student') {
      throw new AppError('CONFLICT', 'This person is enrolled as a student in this course');
    }
    await db
      .insertInto('enrollments')
      .values({ course_id: courseId, user_id: staff.id, role: body.role })
      .onConflict((oc) => oc.columns(['course_id', 'user_id']).doUpdateSet({ role: body.role }))
      .execute();
    await audit(db, {
      actorId: req.user!.id,
      action: 'course.assign_staff',
      targetType: 'course',
      targetId: courseId,
      metadata: { userId: staff.id, role: body.role, previousRole: existing?.role ?? null },
    });
    res.status(existing ? 200 : 201).json({ staff: { ...presentUser(staff), role: body.role } });
  });

  r.delete('/:id/staff/:userId', requireAdmin, async (req, res) => {
    const courseId = String(req.params.id);
    const userId = String(req.params.userId);
    await authoriseCourse(db, req.user!, courseId, ['admin']);
    assertUuid(userId, 'Staff member');
    const removed = await db
      .deleteFrom('enrollments')
      .where('course_id', '=', courseId)
      .where('user_id', '=', userId)
      .where('role', 'in', ['instructor', 'ta'])
      .returning('role')
      .executeTakeFirst();
    if (!removed) throw notFound('Staff member');
    await audit(db, {
      actorId: req.user!.id,
      action: 'course.remove_staff',
      targetType: 'course',
      targetId: courseId,
      metadata: { userId: userId, role: removed.role },
    });
    res.status(204).end();
  });

  return r;
}
