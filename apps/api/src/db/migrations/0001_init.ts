import { sql, type Kysely } from 'kysely';

/**
 * Initial schema: users, courses, enrollments (course-scoped roles), assignments,
 * audit log, and the session table used by connect-pg-simple.
 * Submissions and versions are added in a later migration (Phase 2).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('email', 'text', (c) => c.notNull())
    .addColumn('password_hash', 'text', (c) => c.notNull())
    .addColumn('account_type', 'text', (c) =>
      c.notNull().check(sql`account_type in ('student', 'staff', 'admin')`),
    )
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('active')
        .check(sql`status in ('active', 'disabled')`),
    )
    .addColumn('must_change_password', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('session_version', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  // E-mail addresses are unique case-insensitively.
  await sql`create unique index users_email_lower_idx on users (lower(email))`.execute(db);

  await db.schema
    .createTable('courses')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('code', 'text', (c) => c.notNull())
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('join_code', 'text', (c) => c.notNull().unique())
    .addColumn('end_date', 'date')
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('enrollments')
    .addColumn('course_id', 'uuid', (c) => c.notNull().references('courses.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('role', 'text', (c) =>
      c.notNull().check(sql`role in ('student', 'ta', 'instructor')`),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('enrollments_pk', ['course_id', 'user_id'])
    .execute();
  await db.schema.createIndex('enrollments_user_idx').on('enrollments').column('user_id').execute();

  await db.schema
    .createTable('assignments')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('course_id', 'uuid', (c) => c.notNull().references('courses.id').onDelete('cascade'))
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('open')
        .check(sql`status in ('open', 'closed')`),
    )
    .addColumn('closed_at', 'timestamptz')
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('assignments_course_idx')
    .on('assignments')
    .column('course_id')
    .execute();

  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('actor_id', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('target_type', 'text', (c) => c.notNull())
    .addColumn('target_id', 'text', (c) => c.notNull())
    .addColumn('reason', 'text')
    .addColumn('metadata', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('audit_log_target_idx')
    .on('audit_log')
    .columns(['target_type', 'target_id'])
    .execute();

  // Session table in the format expected by connect-pg-simple.
  await sql`
    create table "session" (
      "sid" varchar not null primary key,
      "sess" json not null,
      "expire" timestamp(6) not null
    )`.execute(db);
  await sql`create index "IDX_session_expire" on "session" ("expire")`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('session').ifExists().execute();
  await db.schema.dropTable('audit_log').ifExists().execute();
  await db.schema.dropTable('assignments').ifExists().execute();
  await db.schema.dropTable('enrollments').ifExists().execute();
  await db.schema.dropTable('courses').ifExists().execute();
  await db.schema.dropTable('users').ifExists().execute();
}
