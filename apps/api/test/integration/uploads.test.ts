import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURES } from '@webcove/zip-validator/fixtures';
import { versionPrefix } from '@webcove/storage';
import {
  FaultyStore,
  createCourseWithMembers,
  createUser,
  setupHarness,
  testStore,
  uploadZip,
  type Client,
  type Harness,
} from '../helpers/harness.js';
import { sweepStorage } from '../../src/services/publish.js';
import { SUBDOMAIN_PATTERN } from '../../src/services/subdomain.js';

const faulty = new FaultyStore(testStore());
let failBeforeCommit = false;
let pauseBeforeCommit: Promise<void> | null = null;
let onReachedCommit: (() => void) | null = null;

let h: Harness;
let admin: Client;
let ctx: Awaited<ReturnType<typeof createCourseWithMembers>>;
let other: Awaited<ReturnType<typeof createCourseWithMembers>>;

beforeAll(async () => {
  h = await setupHarness({
    store: faulty,
    beforeCommit: async () => {
      onReachedCommit?.();
      if (pauseBeforeCommit) await pauseBeforeCommit;
      if (failBeforeCommit) throw new Error('injected database failure');
    },
  });
  admin = (await createUser(h, 'admin', 'Admin')).c;
  ctx = await createCourseWithMembers(h, admin);
  other = await createCourseWithMembers(h, admin);
});
afterAll(async () => h.close());
beforeEach(() => {
  faulty.reset();
  failBeforeCommit = false;
  pauseBeforeCommit = null;
  onReachedCommit = null;
});

async function newAssignment(title = 'A') {
  const res = await ctx.instructor.c.post(`/api/courses/${ctx.course.id}/assignments`, { title });
  return res.body.assignment.id as string;
}
const valid = () => FIXTURES['valid-site']!();

describe('FR-10 / FR-16 / FR-21 upload and publish', () => {
  it('publishes a valid ZIP as version 1 on a random subdomain, with files in storage', async () => {
    const id = await newAssignment();
    const res = await uploadZip(ctx.student.c, id, valid());
    expect(res.status).toBe(201);
    expect(res.body.version).toMatchObject({
      number: 1,
      fileCount: 4,
      warningCount: 0,
      filesAvailable: true,
    });
    expect(res.body.submission.subdomain).toMatch(SUBDOMAIN_PATTERN);
    const objects = await h.store.list(versionPrefix(res.body.version.id));
    expect(objects.map((o) => o.key.split('/').slice(2).join('/')).sort()).toEqual([
      'css/style.css',
      'img/logo.png',
      'index.html',
      'js/app.js',
    ]);

    const mine = await ctx.student.c.get(`/api/assignments/${id}/submission`);
    expect(mine.body.submission.currentVersionId).toBe(res.body.version.id);
    expect(mine.body.versions).toHaveLength(1);
  });

  it('rejects an unsafe ZIP with per-file reasons and creates nothing', async () => {
    const id = await newAssignment();
    const res = await uploadZip(ctx.student.c, id, FIXTURES['zipslip-parent']!());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UPLOAD_REJECTED');
    expect(res.body.error.details.errors[0]).toMatchObject({
      code: 'PARENT_PATH',
      file: '../evil.html',
    });
    const mine = await ctx.student.c.get(`/api/assignments/${id}/submission`);
    expect(mine.body.submission).toBeNull();
  });

  it('returns warnings with an accepted upload (FR-15)', async () => {
    const id = await newAssignment();
    const res = await uploadZip(ctx.student.c, id, FIXTURES['warnings-site']!());
    expect(res.status).toBe(201);
    expect(res.body.warnings.length).toBeGreaterThan(5);
    expect(res.body.version.warningCount).toBe(res.body.warnings.length);
  });

  it('only students of the course can upload, and only one ZIP', async () => {
    const id = await newAssignment();
    expect((await uploadZip(ctx.instructor.c, id, valid())).status).toBe(403);
    expect((await uploadZip(ctx.ta.c, id, valid())).status).toBe(403);
    expect((await uploadZip(other.student.c, id, valid())).status).toBe(404);
    const none = await ctx.student.c.agent
      .post(`/api/assignments/${id}/submission`)
      .set('Origin', 'http://platform.test');
    expect(none.status).toBe(400);
    const two = await ctx.student.c.agent
      .post(`/api/assignments/${id}/submission`)
      .set('Origin', 'http://platform.test')
      .attach('archive', valid(), 'a.zip')
      .attach('archive', valid(), 'b.zip');
    expect(two.status).toBe(400);
  });
});

describe('FR-17 – FR-19 versions and rollback', () => {
  it('numbers versions, keeps files of current + previous only, and rolls back (undoably)', async () => {
    const id = await newAssignment();
    const v1 = (await uploadZip(ctx.student.c, id, valid())).body.version;
    const v2 = (await uploadZip(ctx.student.c, id, FIXTURES['valid-wrapped']!())).body.version;
    const r3 = await uploadZip(ctx.student.c, id, valid());
    const v3 = r3.body.version;
    expect([v1.number, v2.number, v3.number]).toEqual([1, 2, 3]);
    expect(r3.body.submission).toMatchObject({ currentVersionId: v3.id, previousVersionId: v2.id });

    // v1's files are deleted; its record is kept.
    const history = await ctx.student.c.get(`/api/submissions/${r3.body.submission.id}/versions`);
    expect(
      history.body.versions.map((v: { number: number; filesAvailable: boolean }) => [
        v.number,
        v.filesAvailable,
      ]),
    ).toEqual([
      [3, true],
      [2, true],
      [1, false],
    ]);
    expect(await h.store.list(versionPrefix(v1.id))).toEqual([]);

    const subId = r3.body.submission.id;
    const back = await ctx.student.c.post(`/api/submissions/${subId}/rollback`);
    expect(back.status).toBe(200);
    expect(back.body.submission).toMatchObject({
      currentVersionId: v2.id,
      previousVersionId: v3.id,
    });
    const undo = await ctx.student.c.post(`/api/submissions/${subId}/rollback`);
    expect(undo.body.submission).toMatchObject({
      currentVersionId: v3.id,
      previousVersionId: v2.id,
    });
  });

  it('cannot roll back without a previous version', async () => {
    const id = await newAssignment();
    const r = await uploadZip(ctx.student.c, id, valid());
    const res = await ctx.student.c.post(`/api/submissions/${r.body.submission.id}/rollback`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_PREVIOUS_VERSION');
  });

  it('only the owner rolls back; staff can view history; classmates cannot see it', async () => {
    const id = await newAssignment();
    await uploadZip(ctx.student.c, id, valid());
    const r = await uploadZip(ctx.student.c, id, valid());
    const subId = r.body.submission.id;
    const classmate = await createUser(h, 'student');
    await classmate.c.post('/api/courses/join', { joinCode: ctx.course.joinCode });

    expect((await ctx.instructor.c.post(`/api/submissions/${subId}/rollback`)).status).toBe(403);
    expect((await classmate.c.post(`/api/submissions/${subId}/rollback`)).status).toBe(404);
    expect((await classmate.c.get(`/api/submissions/${subId}/versions`)).status).toBe(404);
    expect((await other.instructor.c.get(`/api/submissions/${subId}/versions`)).status).toBe(404);
    expect((await ctx.ta.c.get(`/api/submissions/${subId}/versions`)).status).toBe(200);
  });
});

describe('FR-09 / FR-36 closed assignments and ended courses', () => {
  it('a closed assignment accepts no uploads or rollbacks; reopening allows them again', async () => {
    const id = await newAssignment();
    await uploadZip(ctx.student.c, id, valid());
    const r = await uploadZip(ctx.student.c, id, valid());
    const before = r.body.submission.currentVersionId;
    await ctx.ta.c.post(`/api/assignments/${id}/close`);

    const up = await uploadZip(ctx.student.c, id, valid());
    expect(up.status).toBe(409);
    expect(up.body.error.code).toBe('ASSIGNMENT_CLOSED');
    const rb = await ctx.student.c.post(`/api/submissions/${r.body.submission.id}/rollback`);
    expect(rb.status).toBe(409);
    expect(rb.body.error.code).toBe('ASSIGNMENT_CLOSED');
    const mine = await ctx.student.c.get(`/api/assignments/${id}/submission`);
    expect(mine.body.submission.currentVersionId).toBe(before);

    await ctx.instructor.c.post(`/api/assignments/${id}/reopen`);
    expect((await uploadZip(ctx.student.c, id, valid())).status).toBe(201);
  });

  it('a course after its end date accepts no uploads', async () => {
    const c = await createCourseWithMembers(h, admin);
    const a = await c.instructor.c.post(`/api/courses/${c.course.id}/assignments`, { title: 'x' });
    await admin.patch(`/api/courses/${c.course.id}`, { endDate: '2020-01-01' });
    const res = await uploadZip(c.student.c, a.body.assignment.id, valid());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_ENDED');
  });

  it('a close that arrives during a publish waits for it; nothing changes after the close', async () => {
    const id = await newAssignment();
    let release!: () => void;
    pauseBeforeCommit = new Promise<void>((r) => (release = r));
    const reached = new Promise<void>((r) => (onReachedCommit = r));
    // supertest only sends the request when it is awaited or .then() is called.
    const uploading = uploadZip(ctx.student.c, id, valid()).then((r) => r);
    // Wait until the upload holds its lock inside the transaction, then request a close.
    await reached;
    let closeFinished = false;
    const closing = ctx.instructor.c.post(`/api/assignments/${id}/close`).then((r) => {
      closeFinished = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 200));
    const blocked = !closeFinished;
    release();
    // The close is blocked by the publish transaction's row lock.
    expect(blocked).toBe(true);
    const [up, close] = await Promise.all([uploading, closing]);
    expect(up.status).toBe(201);
    expect(close.status).toBe(200);
    expect(new Date(close.body.assignment.closedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(up.body.version.createdAt).getTime(),
    );
    expect((await uploadZip(ctx.student.c, id, valid())).status).toBe(409);
  });
});

/**
 * Objects in version folders that did not exist before. (SeaweedFS may keep an empty
 * folder name after its objects are deleted, so count objects rather than folders.)
 */
async function strayObjects(foldersBefore: Set<string>) {
  const added = (await h.store.listFolders('versions/')).filter((f) => !foldersBefore.has(f));
  const lists = await Promise.all(added.map((f) => h.store.list(versionPrefix(f))));
  return lists.reduce((n, l) => n + l.length, 0);
}

describe('NFR-R1 / FR-20 atomic publish under failure (fault injection)', () => {
  async function setup() {
    const id = await newAssignment();
    const first = await uploadZip(ctx.student.c, id, valid());
    return { id, first };
  }

  it('a storage failure halfway through leaves the published version unchanged and no stray files', async () => {
    const { id, first } = await setup();
    const foldersBefore = new Set(await h.store.listFolders('versions/'));
    faulty.failPutsAfter = 2;
    const res = await uploadZip(ctx.student.c, id, valid());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
    const mine = await ctx.student.c.get(`/api/assignments/${id}/submission`);
    expect(mine.body.submission.currentVersionId).toBe(first.body.version.id);
    expect(mine.body.versions).toHaveLength(1);
    expect(await strayObjects(foldersBefore)).toBe(0);
  });

  it('a database failure before commit leaves the published version unchanged and removes the new files', async () => {
    const { id, first } = await setup();
    const foldersBefore = new Set(await h.store.listFolders('versions/'));
    failBeforeCommit = true;
    const res = await uploadZip(ctx.student.c, id, valid());
    expect(res.status).toBe(500);
    failBeforeCommit = false;
    const mine = await ctx.student.c.get(`/api/assignments/${id}/submission`);
    expect(mine.body.submission.currentVersionId).toBe(first.body.version.id);
    expect(mine.body.versions).toHaveLength(1);
    expect(await strayObjects(foldersBefore)).toBe(0);
    // The published version's files are intact.
    expect(await h.store.list(versionPrefix(first.body.version.id))).toHaveLength(4);
  });

  it('concurrent uploads by one student get distinct numbers and the newest becomes current', async () => {
    const id = await newAssignment();
    const results = await Promise.all([1, 2, 3].map(() => uploadZip(ctx.student.c, id, valid())));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const numbers = results.map((r) => r.body.version.number).sort();
    expect(numbers).toEqual([1, 2, 3]);
    const mine = await ctx.student.c.get(`/api/assignments/${id}/submission`);
    const newest = results.find((r) => r.body.version.number === 3)!;
    expect(mine.body.submission.currentVersionId).toBe(newest.body.version.id);
  });
});

describe('storage sweep', () => {
  it('deletes orphaned and retired folders but never the current or previous version', async () => {
    const id = await newAssignment();
    await uploadZip(ctx.student.c, id, valid());
    const r = await uploadZip(ctx.student.c, id, valid());
    const orphan = '00000000-0000-4000-8000-000000000001';
    await h.store.put(`${versionPrefix(orphan)}index.html`, Buffer.from('x'), 1, 'text/html');

    await sweepStorage({ db: h.db.kysely, store: h.store }, 0);
    expect(await h.store.list(versionPrefix(orphan))).toEqual([]);
    expect(await h.store.list(versionPrefix(r.body.submission.currentVersionId))).toHaveLength(4);
    expect(await h.store.list(versionPrefix(r.body.submission.previousVersionId))).toHaveLength(4);
  });
});

describe('FR-27 review list with submissions', () => {
  it('shows current version, last upload time and warning count', async () => {
    const id = await newAssignment();
    await uploadZip(ctx.student.c, id, FIXTURES['warnings-site']!());
    const review = await ctx.instructor.c.get(`/api/assignments/${id}/review`);
    const row = review.body.submissions.find(
      (s: { student: { id: string } }) => s.student.id === ctx.student.id,
    );
    expect(row.submission).toMatchObject({ currentVersion: 1, takenDown: false });
    expect(row.submission.warningCount).toBeGreaterThan(5);
    expect(row.submission.lastUploadAt).toBeTruthy();
  });
});
