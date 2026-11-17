/**
 * FR-37 / NFR-P1: automatic deletion of a course's submissions after the retention period
 * that follows its end date (SRD Table 3.21: one semester; ADR-009).
 *
 * Per course, ONE database transaction:
 *   - retires every subdomain (never reassigned; the content server answers 410 Gone),
 *   - queues each version folder in pending_deletions,
 *   - deletes submissions (and, by cascade, versions), upload attempts and student enrolments,
 *   - marks the course purged and writes an audit entry.
 * Storage folders are deleted afterwards; a failure leaves the row in pending_deletions with
 * the error and is retried on the next run. The run is idempotent.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import { versionPrefix, type ObjectStore } from '@webcove/storage';
import type { Database } from '../db/schema.js';
import { audit } from '../audit.js';
import { getSettings } from './settings.js';

export interface RetentionResult {
  coursesPurged: { courseId: string; code: string; submissions: number; versions: number }[];
  foldersDeleted: number;
  foldersFailed: number;
}

/** Courses whose end date is more than `retentionDays` before `now` (dates compared in UTC). */
export function retentionCutoff(now: Date, retentionDays: number): string {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function runRetention(
  ctx: { db: Kysely<Database>; store: ObjectStore; logger?: Logger },
  now = new Date(),
): Promise<RetentionResult> {
  const { retentionDays } = await getSettings(ctx.db);
  const cutoff = retentionCutoff(now, retentionDays);
  const due = await ctx.db
    .selectFrom('courses')
    .select(['id', 'code', 'end_date'])
    .where('end_date', 'is not', null)
    .where('end_date', '<', cutoff)
    .where('purged_at', 'is', null)
    .execute();

  const result: RetentionResult = { coursesPurged: [], foldersDeleted: 0, foldersFailed: 0 };
  for (const course of due) {
    const summary = await ctx.db.transaction().execute(async (trx) => {
      // Lock the course row so two runs cannot purge it at the same time.
      const locked = await trx
        .selectFrom('courses')
        .select('purged_at')
        .where('id', '=', course.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (locked.purged_at) return null;

      const subs = await trx
        .selectFrom('submissions')
        .innerJoin('assignments', 'assignments.id', 'submissions.assignment_id')
        .select(['submissions.id', 'submissions.subdomain'])
        .where('assignments.course_id', '=', course.id)
        .execute();
      const subIds = subs.map((s) => s.id);
      const versions = subIds.length
        ? await trx
            .selectFrom('versions')
            .select('id')
            .where('submission_id', 'in', subIds)
            .execute()
        : [];

      if (subs.length) {
        await trx
          .insertInto('retired_subdomains')
          .values(subs.map((s) => ({ subdomain: s.subdomain })))
          .onConflict((oc) => oc.column('subdomain').doNothing())
          .execute();
      }
      if (versions.length) {
        await trx
          .insertInto('pending_deletions')
          .values(
            versions.map((v) => ({
              prefix: versionPrefix(v.id),
              reason: `course ${course.id} retention`,
            })),
          )
          .onConflict((oc) => oc.column('prefix').doNothing())
          .execute();
      }
      if (subIds.length) {
        // Break the version pointers first, then delete (versions cascade from submissions).
        await trx
          .updateTable('submissions')
          .set({ current_version_id: null, previous_version_id: null })
          .where('id', 'in', subIds)
          .execute();
        await trx.deleteFrom('submissions').where('id', 'in', subIds).execute();
      }
      await trx
        .deleteFrom('upload_attempts')
        .where(
          'assignment_id',
          'in',
          trx.selectFrom('assignments').select('id').where('course_id', '=', course.id),
        )
        .execute();
      // Course membership of students is personal data (NFR-P1); staff assignments are kept.
      const removedStudents = await trx
        .deleteFrom('enrollments')
        .where('course_id', '=', course.id)
        .where('role', '=', 'student')
        .executeTakeFirst();
      await trx
        .updateTable('courses')
        .set({ purged_at: sql`now()` })
        .where('id', '=', course.id)
        .execute();
      await audit(trx, {
        actorId: null,
        action: 'course.retention_delete',
        targetType: 'course',
        targetId: course.id,
        reason: `End date ${course.end_date} + ${retentionDays} days retention`,
        metadata: {
          submissions: subs.length,
          versions: versions.length,
          studentEnrolments: Number(removedStudents.numDeletedRows),
        },
      });
      return {
        courseId: course.id,
        code: course.code,
        submissions: subs.length,
        versions: versions.length,
      };
    });
    if (summary) result.coursesPurged.push(summary);
  }

  const drained = await drainPendingDeletions(ctx);
  result.foldersDeleted = drained.deleted;
  result.foldersFailed = drained.failed;
  return result;
}

/** Delete queued storage folders; failures stay queued with their error for the next run. */
export async function drainPendingDeletions(ctx: {
  db: Kysely<Database>;
  store: ObjectStore;
  logger?: Logger;
}) {
  const rows = await ctx.db
    .selectFrom('pending_deletions')
    .selectAll()
    .orderBy('created_at')
    .limit(1000)
    .execute();
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await ctx.store.deletePrefix(row.prefix);
      await ctx.db.deleteFrom('pending_deletions').where('prefix', '=', row.prefix).execute();
      deleted++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await ctx.db
        .updateTable('pending_deletions')
        .set((eb) => ({ attempts: eb('attempts', '+', 1), last_error: message.slice(0, 500) }))
        .where('prefix', '=', row.prefix)
        .execute();
      ctx.logger?.warn(
        { prefix: row.prefix, err },
        'Deleting a retained folder failed; will retry',
      );
    }
  }
  return { deleted, failed };
}
