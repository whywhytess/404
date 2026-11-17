/**
 * Version Management + atomic publish (FR-16, FR-18 – FR-20, NFR-R1; ADR-004, ADR-005).
 *
 * Order: validate → write every file under versions/{id}/ → verify the listing →
 * ONE database transaction that re-checks the assignment is open, inserts the version
 * and switches current/previous. Object storage and PostgreSQL do not share a
 * transaction: if anything fails before the commit the database is unchanged and the
 * uploaded folder is deleted now or by the periodic sweep.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import { CONTENT_TYPES, DEFAULT_UPLOAD_LIMITS, type UploadLimits } from '@webcove/shared';
import { versionKey, versionPrefix, type ObjectStore } from '@webcove/storage';
import {
  extensionOf,
  validateAndExtract,
  type ExtractedFile,
  type Warning,
} from '@webcove/zip-validator';
import type { Database, Submission, Version } from '../db/schema.js';
import { AppError } from '../errors.js';
import { courseHasEnded } from '../routes/courses.js';
import { generateSubdomain } from './subdomain.js';

export interface PublishContext {
  db: Kysely<Database>;
  store: ObjectStore;
  logger: Logger;
  limits?: UploadLimits;
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';

/** Upload files with limited parallelism. */
async function uploadAll(store: ObjectStore, versionId: string, files: ExtractedFile[]) {
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const type = CONTENT_TYPES[extensionOf(f.path)] ?? 'application/octet-stream';
      await store.put(versionKey(versionId, f.path), createReadStream(f.diskPath), f.size, type);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
}

/** Confirm that storage holds exactly the expected files with the expected sizes. */
async function verifyUploaded(store: ObjectStore, versionId: string, files: ExtractedFile[]) {
  const listed = await store.list(versionPrefix(versionId));
  const sizes = new Map(listed.map((o) => [o.key, o.size]));
  if (listed.length !== files.length) return false;
  return files.every((f) => sizes.get(versionKey(versionId, f.path)) === f.size);
}

/**
 * Lock the assignment (and its course) for the duration of the transaction and check that
 * uploads/rollbacks are allowed. Close/reopen takes FOR UPDATE on the same row, so it waits
 * for an in-flight publish and vice versa (ADR-005).
 */
export async function assertOpenForChanges(trx: Transaction<Database>, assignmentId: string) {
  const row = await trx
    .selectFrom('assignments')
    .innerJoin('courses', 'courses.id', 'assignments.course_id')
    .select(['assignments.status', 'courses.end_date'])
    .where('assignments.id', '=', assignmentId)
    .forShare()
    .executeTakeFirstOrThrow();
  if (row.status !== 'open') {
    throw new AppError(
      'ASSIGNMENT_CLOSED',
      'This assignment is closed. Uploads and rollbacks are not accepted.',
    );
  }
  if (courseHasEnded(row.end_date)) {
    throw new AppError(
      'COURSE_ENDED',
      'This course has ended. Uploads and rollbacks are not accepted.',
    );
  }
}

async function getOrCreateSubmission(
  trx: Transaction<Database>,
  assignmentId: string,
  studentId: string,
) {
  const existing = await trx
    .selectFrom('submissions')
    .selectAll()
    .where('assignment_id', '=', assignmentId)
    .where('student_id', '=', studentId)
    .forUpdate()
    .executeTakeFirst();
  if (existing) return existing;
  let subdomain = generateSubdomain();
  // Never reuse a subdomain that belonged to deleted data (FR-37).
  while (
    await trx
      .selectFrom('retired_subdomains')
      .select('subdomain')
      .where('subdomain', '=', subdomain)
      .executeTakeFirst()
  ) {
    subdomain = generateSubdomain();
  }
  return trx
    .insertInto('submissions')
    .values({ assignment_id: assignmentId, student_id: studentId, subdomain })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface PublishResult {
  submission: Submission;
  version: Version;
  warnings: Warning[];
}

export async function publishUpload(
  ctx: PublishContext,
  input: { assignmentId: string; studentId: string; zipPath: string; workDir: string },
  hooks: { beforeCommit?: () => Promise<void> } = {},
): Promise<PublishResult> {
  const limits = ctx.limits ?? DEFAULT_UPLOAD_LIMITS;
  const result = await validateAndExtract(input.zipPath, input.workDir, limits);
  if (!result.ok) {
    throw new AppError(
      'UPLOAD_REJECTED',
      'The ZIP was rejected. Fix the problems listed and upload again.',
      {
        errors: result.errors,
      },
    );
  }

  const versionId = randomUUID();
  let committed = false;
  try {
    try {
      await uploadAll(ctx.store, versionId, result.files);
      if (!(await verifyUploaded(ctx.store, versionId, result.files)))
        throw new Error('storage verification failed');
    } catch (err) {
      ctx.logger.error({ err, versionId }, 'Writing version files failed');
      throw new AppError(
        'STORAGE_UNAVAILABLE',
        'The files could not be stored. Your published version is unchanged; please try again.',
      );
    }

    const manifest = result.files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 }));
    let outcome: { submission: Submission; version: Version; retired: string | null } | undefined;
    for (let attempt = 0; attempt < 3 && !outcome; attempt++) {
      try {
        outcome = await ctx.db.transaction().execute(async (trx) => {
          await assertOpenForChanges(trx, input.assignmentId);
          const sub = await getOrCreateSubmission(trx, input.assignmentId, input.studentId);
          const { max } = await trx
            .selectFrom('versions')
            .select((eb) => eb.fn.max('number').as('max'))
            .where('submission_id', '=', sub.id)
            .executeTakeFirstOrThrow();
          const version = await trx
            .insertInto('versions')
            .values({
              id: versionId,
              submission_id: sub.id,
              number: (max ?? 0) + 1,
              file_count: result.files.length,
              total_bytes: result.totalBytes,
              warnings: JSON.stringify(result.warnings),
              manifest: JSON.stringify(manifest),
              uploaded_by: input.studentId,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          // FR-19: keep files of the current and previous versions only.
          const retired = sub.previous_version_id;
          if (retired) {
            await trx
              .updateTable('versions')
              .set({ files_deleted_at: new Date() })
              .where('id', '=', retired)
              .execute();
          }
          const submission = await trx
            .updateTable('submissions')
            .set({
              previous_version_id: sub.current_version_id,
              current_version_id: versionId,
              updated_at: sql`now()`,
            })
            .where('id', '=', sub.id)
            .returningAll()
            .executeTakeFirstOrThrow();
          await hooks.beforeCommit?.();
          return { submission, version, retired };
        });
      } catch (err) {
        // Concurrent first uploads or a subdomain collision: retry the transaction.
        if (isUniqueViolation(err) && attempt < 2) continue;
        throw err;
      }
    }
    if (!outcome) throw new Error('publish transaction did not complete');
    committed = true;

    if (outcome.retired) {
      await ctx.store.deletePrefix(versionPrefix(outcome.retired)).catch((err) => {
        ctx.logger.warn(
          { err, versionId: outcome.retired },
          'Deleting retired version files failed; sweep will retry',
        );
      });
    }
    return { submission: outcome.submission, version: outcome.version, warnings: result.warnings };
  } finally {
    if (!committed) {
      await ctx.store.deletePrefix(versionPrefix(versionId)).catch((err) => {
        ctx.logger.warn(
          { err, versionId },
          'Removing uncommitted version files failed; sweep will retry',
        );
      });
    }
  }
}

/**
 * FR-18: roll back to the previous version while the assignment is open. The replaced
 * version becomes the previous one, so the rollback can be undone.
 */
export async function rollbackSubmission(db: Kysely<Database>, submissionId: string) {
  return db.transaction().execute(async (trx) => {
    const sub = await trx
      .selectFrom('submissions')
      .selectAll()
      .where('id', '=', submissionId)
      .executeTakeFirstOrThrow();
    await assertOpenForChanges(trx, sub.assignment_id);
    const locked = await trx
      .selectFrom('submissions')
      .selectAll()
      .where('id', '=', submissionId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (!locked.previous_version_id) {
      throw new AppError('NO_PREVIOUS_VERSION', 'There is no previous version to go back to.');
    }
    return trx
      .updateTable('submissions')
      .set({
        current_version_id: locked.previous_version_id,
        previous_version_id: locked.current_version_id,
        updated_at: sql`now()`,
      })
      .where('id', '=', submissionId)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

/**
 * Periodic clean-up (ADR-004, FR-19): delete version folders that no committed version
 * references (older than `orphanAgeMs`, so in-flight uploads are not touched) and folders
 * of versions whose files were retired.
 */
export async function sweepStorage(
  ctx: { db: Kysely<Database>; store: ObjectStore },
  orphanAgeMs = 60 * 60 * 1000,
) {
  const folders = await ctx.store.listFolders('versions/');
  let orphans = 0;
  let retired = 0;
  for (const id of folders) {
    const row = /^[0-9a-f-]{36}$/.test(id)
      ? await ctx.db
          .selectFrom('versions')
          .select(['id', 'files_deleted_at'])
          .where('id', '=', id)
          .executeTakeFirst()
      : undefined;
    if (row && row.files_deleted_at === null) continue;
    if (!row) {
      const objects = await ctx.store.list(versionPrefix(id));
      const newest = Math.max(0, ...objects.map((o) => o.lastModified?.getTime() ?? 0));
      if (Date.now() - newest < orphanAgeMs) continue;
      orphans++;
    } else {
      retired++;
    }
    await ctx.store.deletePrefix(versionPrefix(id));
  }
  return { orphans, retired };
}
