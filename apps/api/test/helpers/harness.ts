import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import request from 'supertest';
import type { Express } from 'express';
import { createDb, type Db } from '../../src/db/index.js';
import { migrateToLatest } from '../../src/db/migrate.js';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/logger.js';
import { hashPassword } from '../../src/auth/password.js';
import type { RateLimitSettings } from '../../src/middleware/rate-limit.js';
import type { AccountType, UploadLimits } from '@webcove/shared';
import { S3ObjectStore, type ObjectStore } from '@webcove/storage';

export const ORIGIN = 'http://platform.test';

/** Read TEST_DATABASE_URL from the environment or the repository's .env file. */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  try {
    const envFile = readFileSync(
      fileURLToPath(new URL('../../../../.env', import.meta.url)),
      'utf8',
    );
    const line = envFile.split('\n').find((l) => l.startsWith('TEST_DATABASE_URL='));
    if (line) return line.slice('TEST_DATABASE_URL='.length).trim();
  } catch {
    /* fall through */
  }
  throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
}

export interface Harness {
  db: Db;
  app: Express;
  store: ObjectStore;
  close(): Promise<void>;
}

/** Fresh schema + app for one test file. Never point TEST_DATABASE_URL at a real database. */
export function testStore(): S3ObjectStore {
  return new S3ObjectStore({
    endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:59000',
    region: 'us-east-1',
    bucket: 'webcove-test',
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'webcove',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'webcove_dev_only',
  });
}

export async function setupHarness(
  opts: {
    rateLimits?: Partial<RateLimitSettings>;
    store?: ObjectStore;
    beforeCommit?: () => Promise<void>;
    uploadLimits?: UploadLimits;
  } = {},
): Promise<Harness> {
  const url = testDatabaseUrl();
  if (!/test/.test(new URL(url).pathname))
    throw new Error('Refusing to reset a database whose name does not contain "test"');
  const db = createDb(url);
  await sql`drop schema if exists public cascade`.execute(db.kysely);
  await sql`create schema public`.execute(db.kysely);
  await migrateToLatest(db.kysely);
  const real = testStore();
  await real.ensureBucket();
  const store = opts.store ?? real;
  const app = createApp({
    store,
    beforeCommit: opts.beforeCommit,
    uploadLimits: opts.uploadLimits,
    db,
    logger: createLogger('test'),
    platformOrigin: ORIGIN,
    sessionSecret: 'test-session-secret-that-is-long-enough-0123456789',
    secureCookie: false,
    rateLimits: { loginMax: 1000, joinMax: 1000, windowMs: 60_000, ...opts.rateLimits },
  });
  return { db, app, store, close: () => db.close() };
}

/** A cookie-keeping client that sends the platform Origin on every request (as a browser would). */
export function client(app: Express) {
  const agent = request.agent(app);
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) =>
      agent
        .post(url)
        .set('Origin', ORIGIN)
        .send(body ?? {}),
    patch: (url: string, body?: object) =>
      agent
        .patch(url)
        .set('Origin', ORIGIN)
        .send(body ?? {}),
    delete: (url: string) => agent.delete(url).set('Origin', ORIGIN),
  };
}
export type Client = ReturnType<typeof client>;

let counter = 0;
const PASSWORD = 'correct-horse-battery';

/** Insert a user directly and return a signed-in client. */
export async function createUser(
  h: Harness,
  accountType: AccountType,
  name = `${accountType}`,
): Promise<{ id: string; email: string; password: string; c: Client }> {
  const n = ++counter;
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}-${n}@example.test`;
  const user = await h.db.kysely
    .insertInto('users')
    .values({ name, email, password_hash: await hashPassword(PASSWORD), account_type: accountType })
    .returning('id')
    .executeTakeFirstOrThrow();
  const c = client(h.app);
  const res = await c.post('/api/auth/login', { email, password: PASSWORD });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: user.id, email, password: PASSWORD, c };
}

/** Admin creates a course and assigns an instructor and a TA; a student joins with the code. */
export async function createCourseWithMembers(h: Harness, admin: Client) {
  const instructor = await createUser(h, 'staff', 'Instructor');
  const ta = await createUser(h, 'staff', 'TA');
  const student = await createUser(h, 'student', 'Student');
  const courseRes = await admin.post('/api/courses', { code: 'CAT201', title: 'Web Development' });
  const course = courseRes.body.course;
  await admin.post(`/api/courses/${course.id}/staff`, {
    userId: instructor.id,
    role: 'instructor',
  });
  await admin.post(`/api/courses/${course.id}/staff`, { userId: ta.id, role: 'ta' });
  await student.c.post('/api/courses/join', { joinCode: course.joinCode });
  return { course, instructor, ta, student };
}

/** Upload a ZIP buffer as the signed-in student. */
export function uploadZip(c: Client, assignmentId: string, zip: Buffer, filename = 'site.zip') {
  return c.agent
    .post(`/api/assignments/${assignmentId}/submission`)
    .set('Origin', ORIGIN)
    .attach('archive', zip, filename);
}

/** ObjectStore wrapper that fails on demand (fault injection, NFR-R1). */
export class FaultyStore implements ObjectStore {
  failPutsAfter = Infinity;
  private puts = 0;
  constructor(private inner: ObjectStore) {}
  reset() {
    this.puts = 0;
    this.failPutsAfter = Infinity;
  }
  async put(...args: Parameters<ObjectStore['put']>) {
    if (++this.puts > this.failPutsAfter) throw new Error('injected storage failure');
    return this.inner.put(...args);
  }
  get(key: string) {
    return this.inner.get(key);
  }
  list(prefix: string) {
    return this.inner.list(prefix);
  }
  listFolders(prefix: string) {
    return this.inner.listFolders(prefix);
  }
  deletePrefix(prefix: string) {
    return this.inner.deletePrefix(prefix);
  }
}
