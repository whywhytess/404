/**
 * FR-37 / NFR-P1 retention deletion, with a simulated clock (no waiting for a semester).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Kysely } from 'kysely';
import { pino } from 'pino';
import { FIXTURES } from '@webcove/zip-validator/fixtures';
import { versionPrefix } from '@webcove/storage';
import { signToken } from '@webcove/security';
import {
  FaultyStore,
  ORIGIN,
  TEST_CONTENT_DOMAIN,
  TEST_TOKEN_KEY,
  createCourseWithMembers,
  createUser,
  setupHarness,
  testStore,
  uploadZip,
  type Client,
  type Harness,
} from '../../../api/test/helpers/harness.js';
import { retentionCutoff, runRetention } from '../../../api/src/services/retention.js';
import { createContentHandler, type ContentDatabase } from '../../src/app.js';

const DAY = 86_400_000;
const faulty = new FaultyStore(testStore());
let h: Harness;
let admin: Client;

interface Published {
  courseId: string;
  subdomain: string;
  versionIds: string[];
  studentId: string;
}

beforeAll(async () => {
  h = await setupHarness({ store: faulty });
  admin = (await createUser(h, 'admin', 'Admin')).c;
});
afterAll(async () => h.close());

/** A course with one submission of two versions, then the course is given `endDate`. */
async function publishedCourse(endDate: string | null): Promise<Published> {
  const c = await createCourseWithMembers(h, admin);
  const a = await c.instructor.c.post(`/api/courses/${c.course.id}/assignments`, { title: 'A' });
  const v1 = await uploadZip(c.student.c, a.body.assignment.id, FIXTURES['valid-site']!());
  const v2 = await uploadZip(c.student.c, a.body.assignment.id, FIXTURES['valid-site']!());
  await admin.patch(`/api/courses/${c.course.id}`, { endDate });
  return {
    courseId: c.course.id,
    subdomain: v2.body.submission.subdomain,
    versionIds: [v1.body.version.id, v2.body.version.id],
    studentId: c.student.id,
  };
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

describe('retention cutoff', () => {
  it('purges only after end date + retention days', () => {
    const now = new Date('2027-12-01T08:00:00Z');
    expect(retentionCutoff(now, 183)).toBe('2027-06-01');
  });
});

describe('FR-37 automatic deletion after the retention period', () => {
  it('deletes submissions, versions and files; retires subdomains (410); audits once; is idempotent', async () => {
    const now = Date.now();
    const old = await publishedCourse(iso(now - 200 * DAY)); // past 183 days
    const recent = await publishedCourse(iso(now - 100 * DAY)); // still within retention
    const open = await publishedCourse(null); // no end date

    const r = await runRetention({ db: h.db.kysely, store: h.store }, new Date(now));
    expect(r.coursesPurged.map((c) => c.courseId)).toEqual([old.courseId]);
    expect(r.coursesPurged[0]).toMatchObject({ submissions: 1, versions: 2 });
    expect(r.foldersFailed).toBe(0);

    // Database rows gone; course shell kept and marked purged.
    const k = h.db.kysely;
    expect(
      await k
        .selectFrom('submissions')
        .select('id')
        .where('subdomain', '=', old.subdomain)
        .execute(),
    ).toEqual([]);
    expect(
      await k.selectFrom('versions').select('id').where('id', 'in', old.versionIds).execute(),
    ).toEqual([]);
    const course = await k
      .selectFrom('courses')
      .select('purged_at')
      .where('id', '=', old.courseId)
      .executeTakeFirstOrThrow();
    expect(course.purged_at).not.toBeNull();
    const enrolled = await k
      .selectFrom('enrollments')
      .select('role')
      .where('course_id', '=', old.courseId)
      .execute();
    expect(enrolled.map((e) => e.role).sort()).toEqual(['instructor', 'ta']); // student membership removed

    // Files deleted from storage.
    for (const v of old.versionIds) expect(await h.store.list(versionPrefix(v))).toEqual([]);

    // Content server: 410 Gone even with a still-valid token.
    const content = createContentHandler({
      db: k as unknown as Kysely<ContentDatabase>,
      store: h.store,
      logger: pino({ level: 'silent' }),
      tokenKey: TEST_TOKEN_KEY,
      platformOrigin: ORIGIN,
      contentDomain: TEST_CONTENT_DOMAIN,
    });
    const token = signToken(TEST_TOKEN_KEY, {
      subdomain: old.subdomain,
      userId: old.studentId,
      role: 'student',
    }).token;
    const gone = await request(content)
      .get(`/_t/${token}/`)
      .set('Host', `${old.subdomain}.${TEST_CONTENT_DOMAIN}`);
    expect(gone.status).toBe(410);

    // Other courses untouched.
    for (const c of [recent, open]) {
      expect(
        await k
          .selectFrom('submissions')
          .select('id')
          .where('subdomain', '=', c.subdomain)
          .execute(),
      ).toHaveLength(1);
      expect(await h.store.list(versionPrefix(c.versionIds[1]!))).toHaveLength(4);
    }

    // Audited once, with counts; a second run does nothing.
    const again = await runRetention({ db: k, store: h.store }, new Date(now));
    expect(again.coursesPurged).toEqual([]);
    const log = await admin.get('/api/admin/audit-log?limit=500');
    const entries = log.body.entries.filter(
      (e: { action: string; targetId: string }) =>
        e.action === 'course.retention_delete' && e.targetId === old.courseId,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toMatchObject({
      submissions: 1,
      versions: 2,
      studentEnrolments: 1,
    });
  });

  it('the retired subdomain is never handed out again', async () => {
    const retired = await h.db.kysely
      .selectFrom('retired_subdomains')
      .select('subdomain')
      .execute();
    const live = await h.db.kysely.selectFrom('submissions').select('subdomain').execute();
    const liveSet = new Set(live.map((s) => s.subdomain));
    expect(retired.length).toBeGreaterThan(0);
    expect(retired.some((r) => liveSet.has(r.subdomain))).toBe(false);
  });

  it('a storage failure is queued and retried on the next run', async () => {
    const now = Date.now();
    const course = await publishedCourse(iso(now - 300 * DAY));
    const realDelete = faulty.deletePrefix.bind(faulty);
    faulty.deletePrefix = async () => {
      throw new Error('injected storage outage');
    };
    try {
      const first = await runRetention({ db: h.db.kysely, store: faulty }, new Date(now));
      expect(first.coursesPurged.map((c) => c.courseId)).toEqual([course.courseId]);
      expect(first.foldersFailed).toBe(2);
      const pending = await h.db.kysely.selectFrom('pending_deletions').selectAll().execute();
      expect(pending.map((p) => p.prefix).sort()).toEqual(
        course.versionIds.map(versionPrefix).sort(),
      );
      expect(
        pending.every((p) => p.attempts === 1 && p.last_error === 'injected storage outage'),
      ).toBe(true);
      // The database side is already done: nothing can be served.
      expect(
        await h.db.kysely
          .selectFrom('submissions')
          .select('id')
          .where('subdomain', '=', course.subdomain)
          .execute(),
      ).toEqual([]);
    } finally {
      faulty.deletePrefix = realDelete;
    }
    const second = await runRetention({ db: h.db.kysely, store: faulty }, new Date(now));
    expect(second.foldersDeleted).toBe(2);
    expect(await h.db.kysely.selectFrom('pending_deletions').selectAll().execute()).toEqual([]);
    for (const v of course.versionIds) expect(await h.store.list(versionPrefix(v))).toEqual([]);
  });

  it('administrators can run it on demand and see what is due; others cannot', async () => {
    const student = await createUser(h, 'student');
    expect((await student.c.post('/api/admin/retention/run')).status).toBe(403);
    const status = await admin.get('/api/admin/retention');
    expect(status.body.retentionDays).toBe(183);
    expect(status.body.courses.length).toBeGreaterThan(0);
    const run = await admin.post('/api/admin/retention/run');
    expect(run.status).toBe(200);
    expect(run.body.result).toHaveProperty('coursesPurged');
  });
});
