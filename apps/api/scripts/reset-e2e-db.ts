/**
 * Reset the end-to-end test database and create one administrator (synthetic).
 * Usage: tsx scripts/reset-e2e-db.ts <database-url> <admin-email> <admin-password>
 */
import { sql } from 'kysely';
import { createDb } from '../src/db/index.js';
import { migrateToLatest } from '../src/db/migrate.js';
import { hashPassword } from '../src/auth/password.js';

const [url, email, password] = process.argv.slice(2);
if (!url || !email || !password) throw new Error('usage: reset-e2e-db <url> <email> <password>');
if (!/e2e/.test(new URL(url).pathname))
  throw new Error('Refusing to reset a database whose name does not contain "e2e"');

const db = createDb(url);
try {
  await sql`drop schema if exists public cascade`.execute(db.kysely);
  await sql`create schema public`.execute(db.kysely);
  await migrateToLatest(db.kysely);
  await db.kysely
    .insertInto('users')
    .values({
      name: 'E2E Admin',
      email,
      password_hash: await hashPassword(password),
      account_type: 'admin',
    })
    .execute();
} finally {
  await db.close();
}
