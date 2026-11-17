import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCourseWithMembers,
  createUser,
  setupHarness,
  type Client,
  type Harness,
} from '../helpers/harness.js';

let h: Harness;
let admin: Client;
beforeAll(async () => {
  h = await setupHarness();
  admin = (await createUser(h, 'admin', 'Admin')).c;
});
afterAll(async () => h.close());

describe('FR-05 courses and staff assignment', () => {
  it('only administrators create courses', async () => {
    const staff = await createUser(h, 'staff');
    const student = await createUser(h, 'student');
    expect((await staff.c.post('/api/courses', { code: 'X1', title: 'X' })).status).toBe(403);
    expect((await student.c.post('/api/courses', { code: 'X1', title: 'X' })).status).toBe(403);
    const res = await admin.post('/api/courses', {
      code: 'CAT201',
      title: 'Web Development',
      endDate: '2027-05-30',
    });
    expect(res.status).toBe(201);
    expect(res.body.course.joinCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(res.body.course.endDate).toBe('2027-05-30');
  });

  it('assigns an instructor and TAs, and can change or remove them later', async () => {
    const { course, instructor, ta } = await createCourseWithMembers(h, admin);
    const list = await instructor.c.get(`/api/courses/${course.id}/staff`);
    expect(list.status).toBe(200);
    expect(list.body.staff.map((s: { id: string; role: string }) => [s.id, s.role])).toEqual(
      expect.arrayContaining([
        [instructor.id, 'instructor'],
        [ta.id, 'ta'],
      ]),
    );
    // Promote the TA to instructor, then remove them.
    const changed = await admin.post(`/api/courses/${course.id}/staff`, {
      userId: ta.id,
      role: 'instructor',
    });
    expect(changed.status).toBe(200);
    expect((await admin.delete(`/api/courses/${course.id}/staff/${ta.id}`)).status).toBe(204);
    expect((await ta.c.get(`/api/courses/${course.id}`)).status).toBe(404);
  });

  it('only staff accounts can be assigned as instructor or TA', async () => {
    const { course, student } = await createCourseWithMembers(h, admin);
    const res = await admin.post(`/api/courses/${course.id}/staff`, {
      userId: student.id,
      role: 'ta',
    });
    expect(res.status).toBe(404);
  });

  it('instructors and TAs cannot assign staff', async () => {
    const { course, instructor, ta } = await createCourseWithMembers(h, admin);
    const other = await createUser(h, 'staff');
    expect(
      (await instructor.c.post(`/api/courses/${course.id}/staff`, { userId: other.id, role: 'ta' }))
        .status,
    ).toBe(403);
    expect(
      (await ta.c.post(`/api/courses/${course.id}/staff`, { userId: other.id, role: 'ta' })).status,
    ).toBe(403);
  });
});

describe('FR-06 / FR-07 join codes', () => {
  it('a student joins with the code, normalising case, spaces and dashes', async () => {
    const res = await admin.post('/api/courses', { code: 'CAT202', title: 'Join test' });
    const code: string = res.body.course.joinCode;
    const student = await createUser(h, 'student');
    const messy = `${code.slice(0, 4).toLowerCase()}- ${code.slice(4)}`;
    const join = await student.c.post('/api/courses/join', { joinCode: messy });
    expect(join.status).toBe(201);
    expect(join.body.course).toMatchObject({ id: res.body.course.id, role: 'student' });
    expect(join.body.course.joinCode).toBeUndefined();

    const again = await student.c.post('/api/courses/join', { joinCode: code });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_ENROLLED');
  });

  it('rejects an invalid code', async () => {
    const student = await createUser(h, 'student');
    const res = await student.c.post('/api/courses/join', { joinCode: 'ZZZZZZZZ' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVALID_JOIN_CODE');
  });

  it('rejects joining a course whose end date has passed', async () => {
    const res = await admin.post('/api/courses', {
      code: 'OLD1',
      title: 'Ended',
      endDate: '2020-01-01',
    });
    const student = await createUser(h, 'student');
    const join = await student.c.post('/api/courses/join', { joinCode: res.body.course.joinCode });
    expect(join.status).toBe(409);
    expect(join.body.error.code).toBe('COURSE_ENDED');
  });

  it('the instructor regenerates the code; the old code stops working', async () => {
    const { course, instructor, ta, student } = await createCourseWithMembers(h, admin);
    expect((await student.c.post(`/api/courses/${course.id}/join-code/rotate`)).status).toBe(403);
    expect((await ta.c.post(`/api/courses/${course.id}/join-code/rotate`)).status).toBe(403);
    const rotated = await instructor.c.post(`/api/courses/${course.id}/join-code/rotate`);
    expect(rotated.status).toBe(200);
    expect(rotated.body.course.joinCode).not.toBe(course.joinCode);

    const late = await createUser(h, 'student');
    expect((await late.c.post('/api/courses/join', { joinCode: course.joinCode })).status).toBe(
      404,
    );
    expect(
      (await late.c.post('/api/courses/join', { joinCode: rotated.body.course.joinCode })).status,
    ).toBe(201);
  });

  it('only the instructor and administrators see the join code', async () => {
    const { course, instructor, ta, student } = await createCourseWithMembers(h, admin);
    expect(
      (await instructor.c.get(`/api/courses/${course.id}`)).body.course.joinCode,
    ).toBeDefined();
    expect((await ta.c.get(`/api/courses/${course.id}`)).body.course.joinCode).toBeUndefined();
    expect((await student.c.get(`/api/courses/${course.id}`)).body.course.joinCode).toBeUndefined();
  });

  it('administrators cannot join courses as students', async () => {
    const res = await admin.post('/api/courses', { code: 'ADM', title: 'x' });
    expect(
      (await admin.post('/api/courses/join', { joinCode: res.body.course.joinCode })).status,
    ).toBe(403);
  });
});

describe('FR-04 course-scoped access (cross-course tampering)', () => {
  it('users cannot see or act on courses they do not belong to', async () => {
    const a = await createCourseWithMembers(h, admin);
    const b = await createCourseWithMembers(h, admin);
    // Instructor A changes the course ID in the URL to course B.
    expect((await a.instructor.c.get(`/api/courses/${b.course.id}`)).status).toBe(404);
    expect(
      (await a.instructor.c.post(`/api/courses/${b.course.id}/assignments`, { title: 'x' })).status,
    ).toBe(404);
    expect((await a.instructor.c.post(`/api/courses/${b.course.id}/join-code/rotate`)).status).toBe(
      404,
    );
    expect((await a.ta.c.get(`/api/courses/${b.course.id}/staff`)).status).toBe(404);
    expect((await a.student.c.get(`/api/courses/${b.course.id}/assignments`)).status).toBe(404);

    // Course lists only contain the user's own courses.
    const list = await a.instructor.c.get('/api/courses');
    expect(list.body.courses.map((c: { id: string }) => c.id)).toEqual([a.course.id]);
  });

  it('malformed IDs return 404, not a server error', async () => {
    const { student } = await createCourseWithMembers(h, admin);
    expect((await student.c.get('/api/courses/not-a-uuid')).status).toBe(404);
    expect((await student.c.get("/api/courses/1' OR '1'='1")).status).toBe(404);
  });

  it('records course administration in the audit log', async () => {
    const log = await admin.get('/api/admin/audit-log?limit=500');
    const actions = new Set(log.body.entries.map((e: { action: string }) => e.action));
    for (const a of [
      'course.create',
      'course.assign_staff',
      'course.remove_staff',
      'course.rotate_join_code',
    ]) {
      expect(actions).toContain(a);
    }
  });
});
