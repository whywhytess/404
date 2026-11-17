import { sql, type Kysely } from 'kysely';

/**
 * Submissions (one per student × assignment, owning one random subdomain) and their
 * immutable versions (FR-16 – FR-21). Retired subdomains are kept forever so they are
 * never reassigned (FR-37).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('submissions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('assignment_id', 'uuid', (c) =>
      c.notNull().references('assignments.id').onDelete('cascade'),
    )
    .addColumn('student_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('subdomain', 'text', (c) => c.notNull().unique())
    .addColumn('current_version_id', 'uuid')
    .addColumn('previous_version_id', 'uuid')
    .addColumn('taken_down_at', 'timestamptz')
    .addColumn('taken_down_reason', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('submissions_assignment_student_uq', ['assignment_id', 'student_id'])
    .execute();

  await db.schema
    .createTable('versions')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('submission_id', 'uuid', (c) =>
      c.notNull().references('submissions.id').onDelete('cascade'),
    )
    .addColumn('number', 'integer', (c) => c.notNull())
    .addColumn('file_count', 'integer', (c) => c.notNull())
    .addColumn('total_bytes', 'bigint', (c) => c.notNull())
    .addColumn('warnings', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('manifest', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('uploaded_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('files_deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('versions_submission_number_uq', ['submission_id', 'number'])
    .execute();

  await db.schema
    .alterTable('submissions')
    .addForeignKeyConstraint('submissions_current_fk', ['current_version_id'], 'versions', ['id'])
    .execute();
  await db.schema
    .alterTable('submissions')
    .addForeignKeyConstraint('submissions_previous_fk', ['previous_version_id'], 'versions', ['id'])
    .execute();

  await db.schema
    .createTable('retired_subdomains')
    .addColumn('subdomain', 'text', (c) => c.primaryKey())
    .addColumn('retired_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('retired_subdomains').ifExists().execute();
  await db.schema.alterTable('submissions').dropConstraint('submissions_current_fk').execute();
  await db.schema.alterTable('submissions').dropConstraint('submissions_previous_fk').execute();
  await db.schema.dropTable('versions').ifExists().execute();
  await db.schema.dropTable('submissions').ifExists().execute();
}
