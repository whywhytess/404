import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { ResourceSettings } from '@webcove/shared';
import type { Database } from '../db/schema.js';

/** Read the current resource settings (FR-35). Changes apply to the next request. */
export async function getSettings(db: Kysely<Database>): Promise<ResourceSettings> {
  const r = await db
    .selectFrom('platform_settings')
    .selectAll()
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();
  return {
    storageQuotaBytes: Number(r.storage_quota_bytes),
    uploadsPerHour: r.uploads_per_hour,
    contentRequestsPerSecond: r.content_requests_per_second,
    maxArchiveBytes: Number(r.max_archive_bytes),
    maxFileBytes: Number(r.max_file_bytes),
    maxFiles: r.max_files,
    maxTotalBytes: Number(r.max_total_bytes),
    maxCompressionRatio: r.max_compression_ratio,
    retentionDays: r.retention_days,
  };
}

export async function updateSettings(db: Kysely<Database>, s: ResourceSettings, userId: string) {
  await db
    .updateTable('platform_settings')
    .set({
      storage_quota_bytes: s.storageQuotaBytes,
      uploads_per_hour: s.uploadsPerHour,
      content_requests_per_second: s.contentRequestsPerSecond,
      max_archive_bytes: s.maxArchiveBytes,
      max_file_bytes: s.maxFileBytes,
      max_files: s.maxFiles,
      max_total_bytes: s.maxTotalBytes,
      max_compression_ratio: s.maxCompressionRatio,
      retention_days: s.retentionDays,
      updated_at: sql`now()`,
      updated_by: userId,
    })
    .where('id', '=', 1)
    .execute();
}

/**
 * FR-32: a student's storage use = files that are currently kept (current and previous
 * versions of all their submissions). Retired versions no longer count.
 */
export async function storageUsedBy(
  db: Kysely<Database> | Transaction<Database>,
  studentId: string,
  excludeVersionId?: string | null,
) {
  let q = db
    .selectFrom('versions')
    .innerJoin('submissions', 'submissions.id', 'versions.submission_id')
    .select((eb) =>
      eb.fn.coalesce(eb.fn.sum<string>('versions.total_bytes'), sql<string>`0`).as('used'),
    )
    .where('submissions.student_id', '=', studentId)
    .where('versions.files_deleted_at', 'is', null);
  if (excludeVersionId) q = q.where('versions.id', '!=', excludeVersionId);
  const { used } = await q.executeTakeFirstOrThrow();
  return Number(used);
}
