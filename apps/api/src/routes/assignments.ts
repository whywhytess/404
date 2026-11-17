import { Router } from 'express';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/schema.js';
import { parse } from '../errors.js';
import { presentAssignment } from '../presenters.js';
import { MANAGERS, MEMBERS, STAFF, authoriseAssignment, authoriseCourse } from '../policy.js';
import { audit } from '../audit.js';

const Title = z.string().trim().min(1, 'Title is required').max(200);
const Description = z.string().max(5000);
const CreateBody = z.object({ title: Title, description: Description.default('') });
const UpdateBody = z.object({ title: Title.optional(), description: Description.optional() });

/** Routes nested under /api/courses/:courseId/assignments */
export function courseAssignmentRoutes(db: Kysely<Database>) {
  const r = Router({ mergeParams: true });

  r.get('/', async (req, res) => {
    const { courseId } = req.params as { courseId: string };
    await authoriseCourse(db, req.user!, courseId, MEMBERS);
    const rows = await db
      .selectFrom('assignments')
      .selectAll()
      .where('course_id', '=', courseId)
      .orderBy('created_at', 'desc')
      .execute();
    res.json({ assignments: rows.map(presentAssignment) });
  });

  // FR-08: instructors create assignments in their own course.
  r.post('/', async (req, res) => {
    const { courseId } = req.params as { courseId: string };
    await authoriseCourse(db, req.user!, courseId, MANAGERS);
    const body = parse(CreateBody, req.body);
    const a = await db
      .insertInto('assignments')
      .values({
        course_id: courseId,
        title: body.title,
        description: body.description,
        created_by: req.user!.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json({ assignment: presentAssignment(a) });
  });

  return r;
}

/** Routes under /api/assignments/:id */
export function assignmentRoutes(db: Kysely<Database>) {
  const r = Router();

  r.get('/:id', async (req, res) => {
    const { assignment, actor } = await authoriseAssignment(db, req.user!, req.params.id, MEMBERS);
    res.json({ assignment: presentAssignment(assignment), role: actor });
  });

  // FR-08: instructors edit the title and description later.
  r.patch('/:id', async (req, res) => {
    await authoriseAssignment(db, req.user!, req.params.id, MANAGERS);
    const body = parse(UpdateBody, req.body);
    const a = await db
      .updateTable('assignments')
      .set({
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        updated_at: sql`now()`,
      })
      .where('id', '=', req.params.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    res.json({ assignment: presentAssignment(a) });
  });

  /**
   * FR-09 (Must): instructors and TAs close and reopen an assignment.
   * A closed assignment accepts no uploads or rollbacks, so each submission's current
   * version stays fixed while it is marked. The upload and rollback paths re-check the
   * status inside their own database transaction (row lock), so a close cannot race
   * with a publish (see ADR-005).
   */
  for (const action of ['close', 'reopen'] as const) {
    r.post(`/:id/${action}`, async (req, res) => {
      await authoriseAssignment(db, req.user!, req.params.id, STAFF);
      const target = action === 'close' ? 'closed' : 'open';
      const result = await db.transaction().execute(async (trx) => {
        const current = await trx
          .selectFrom('assignments')
          .selectAll()
          .where('id', '=', req.params.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (current.status === target) return { assignment: current, changed: false };
        const updated = await trx
          .updateTable('assignments')
          .set({
            status: target,
            closed_at: target === 'closed' ? sql`now()` : null,
            updated_at: sql`now()`,
          })
          .where('id', '=', req.params.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, {
          actorId: req.user!.id,
          action: `assignment.${action}`,
          targetType: 'assignment',
          targetId: updated.id,
        });
        return { assignment: updated, changed: true };
      });
      res.json({ assignment: presentAssignment(result.assignment), changed: result.changed });
    });
  }

  // FR-27 (skeleton): list every student of the course; submissions are added in Phase 2.
  r.get('/:id/review', async (req, res) => {
    const { assignment } = await authoriseAssignment(db, req.user!, req.params.id, STAFF);
    const students = await db
      .selectFrom('enrollments')
      .innerJoin('users', 'users.id', 'enrollments.user_id')
      .select(['users.id', 'users.name', 'users.email'])
      .where('enrollments.course_id', '=', assignment.course_id)
      .where('enrollments.role', '=', 'student')
      .orderBy('users.name')
      .execute();
    res.json({
      assignment: presentAssignment(assignment),
      submissions: students.map((s) => ({ student: s, submission: null })),
    });
  });

  return r;
}
