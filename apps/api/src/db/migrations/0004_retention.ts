import { sql, type Kysely } from 'kysely';

/**
 * FR-37 / NFR-P1 retention (ADR-009): when a course is purged its database rows are removed
 * first and the storage folders to delete are queued in pending_deletions, so that a storage
 * failure is retried later instead of being lost.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('courses').addColumn('purged_at', 'timestamptz').execute();
  await db.schema
    .alterTable('platform_settings')
    .addColumn('retention_days', 'integer', (c) => c.notNull().defaultTo(183))
    .execute();
  await db.schema
    .createTable('pending_deletions')
    .addColumn('prefix', 'text', (c) => c.primaryKey())
    .addColumn('reason', 'text', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('pending_deletions').ifExists().execute();
  await db.schema.alterTable('platform_settings').dropColumn('retention_days').execute();
  await db.schema.alterTable('courses').dropColumn('purged_at').execute();
}
