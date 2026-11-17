import { sql, type Kysely } from 'kysely';

/**
 * Resource control (FR-32 – FR-35): one row of administrator-adjustable settings with the
 * initial values of SRD Table 3.21, and a log of upload attempts for the hourly limit.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('platform_settings')
    .addColumn('id', 'integer', (c) =>
      c
        .primaryKey()
        .defaultTo(1)
        .check(sql`id = 1`),
    )
    .addColumn('storage_quota_bytes', 'bigint', (c) => c.notNull().defaultTo(200 * 1024 * 1024))
    .addColumn('uploads_per_hour', 'integer', (c) => c.notNull().defaultTo(10))
    .addColumn('content_requests_per_second', 'integer', (c) => c.notNull().defaultTo(50))
    .addColumn('max_archive_bytes', 'bigint', (c) => c.notNull().defaultTo(20 * 1024 * 1024))
    .addColumn('max_file_bytes', 'bigint', (c) => c.notNull().defaultTo(5 * 1024 * 1024))
    .addColumn('max_files', 'integer', (c) => c.notNull().defaultTo(500))
    .addColumn('max_total_bytes', 'bigint', (c) => c.notNull().defaultTo(100 * 1024 * 1024))
    .addColumn('max_compression_ratio', 'integer', (c) => c.notNull().defaultTo(100))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .execute();
  await sql`insert into platform_settings (id) values (1)`.execute(db);

  await db.schema
    .createTable('upload_attempts')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('assignment_id', 'uuid', (c) =>
      c.notNull().references('assignments.id').onDelete('cascade'),
    )
    .addColumn('student_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('upload_attempts_lookup_idx')
    .on('upload_attempts')
    .columns(['student_id', 'assignment_id', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('upload_attempts').ifExists().execute();
  await db.schema.dropTable('platform_settings').ifExists().execute();
}
