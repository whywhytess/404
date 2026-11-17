/**
 * Synthetic demo data for local development and demos (Phase 0).
 * Refuses to run in production. All people and e-mail addresses are fictitious.
 */
import { createDb } from '../src/db/index.js';
import { migrateToLatest } from '../src/db/migrate.js';
import { hashPassword } from '../src/auth/password.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const DEMO_PASSWORD = 'demo-password-123';
const db = createDb(url);
const k = db.kysely;

try {
  await migrateToLatest(k);
  const existing = await k
    .selectFrom('users')
    .select('id')
    .where('email', '=', 'admin@demo.webcove.test')
    .executeTakeFirst();
  if (existing) {
    console.log('Demo data already present; nothing to do.');
  } else {
    const hash = await hashPassword(DEMO_PASSWORD);
    const mk = (name: string, email: string, account_type: 'student' | 'staff' | 'admin') =>
      k
        .insertInto('users')
        .values({ name, email, password_hash: hash, account_type })
        .returning('id')
        .executeTakeFirstOrThrow();

    const admin = await mk('Demo Admin', 'admin@demo.webcove.test', 'admin');
    const instructor = await mk('Dr Demo Instructor', 'instructor@demo.webcove.test', 'staff');
    const ta = await mk('Demo TA', 'ta@demo.webcove.test', 'staff');
    const s1 = await mk('Student One', 'student1@demo.webcove.test', 'student');
    const s2 = await mk('Student Two', 'student2@demo.webcove.test', 'student');

    const course = await k
      .insertInto('courses')
      .values({
        code: 'DEMO101',
        title: 'Demo Web Development',
        join_code: 'DEMOWEB7',
        created_by: admin.id,
      })
      .returning(['id', 'join_code'])
      .executeTakeFirstOrThrow();
    await k
      .insertInto('enrollments')
      .values([
        { course_id: course.id, user_id: instructor.id, role: 'instructor' },
        { course_id: course.id, user_id: ta.id, role: 'ta' },
        { course_id: course.id, user_id: s1.id, role: 'student' },
        { course_id: course.id, user_id: s2.id, role: 'student' },
      ])
      .execute();
    await k
      .insertInto('assignments')
      .values({
        course_id: course.id,
        title: 'Assignment 1: Personal Portfolio',
        description: 'Build a multi-page static portfolio site. Follow the submission rules.',
        created_by: instructor.id,
      })
      .execute();

    console.log('Demo data created (synthetic accounts, local use only):');
    console.log('  admin@demo.webcove.test, instructor@demo.webcove.test, ta@demo.webcove.test,');
    console.log('  student1@demo.webcove.test, student2@demo.webcove.test');
    console.log(`  password for all demo accounts: ${DEMO_PASSWORD}`);
    console.log(`  course DEMO101 join code: ${course.join_code}`);
  }
} finally {
  await db.close();
}
