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
let ctx: Awaited<ReturnType<typeof createCourseWithMembers>>;
let other: Awaited<ReturnType<typeof createCourseWithMembers>>;
beforeAll(async () => {
  h = await setupHarness();
  admin = (await createUser(h, 'admin', 'Admin')).c;
  ctx = await createCourseWithMembers(h, admin);
  other = await createCourseWithMembers(h, admin);
});
afterAll(async () => h.close());

describe('FR-08 create and edit assignments', () => {
  it('the instructor creates and edits an assignment; TAs and students cannot', async () => {
    const base = `/api/courses/${ctx.course.id}/assignments`;
    expect((await ctx.ta.c.post(base, { title: 'A1' })).status).toBe(403);
    expect((await ctx.student.c.post(base, { title: 'A1' })).status).toBe(403);

    const created = await ctx.instructor.c.post(base, {
      title: 'Assignment 1',
      description: 'Portfolio <b>site</b>',
    });
    expect(created.status).toBe(201);
    expect(created.body.assignment).toMatchObject({ title: 'Assignment 1', status: 'open' });
    // Stored as text; rendering is escaped by the front end.
    expect(created.body.assignment.description).toBe('Portfolio <b>site</b>');

    const id = created.body.assignment.id;
    expect((await ctx.ta.c.patch(`/api/assignments/${id}`, { title: 'x' })).status).toBe(403);
    const edited = await ctx.instructor.c.patch(`/api/assignments/${id}`, {
      title: 'Assignment 1 (Portfolio)',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.assignment.title).toBe('Assignment 1 (Portfolio)');

    const list = await ctx.student.c.get(base);
    expect(list.status).toBe(200);
    expect(list.body.assignments).toHaveLength(1);
  });

  it('rejects an empty title', async () => {
    const res = await ctx.instructor.c.post(`/api/courses/${ctx.course.id}/assignments`, {
      title: '   ',
    });
    expect(res.status).toBe(400);
  });

  it('users outside the course cannot read or edit the assignment', async () => {
    const created = await ctx.instructor.c.post(`/api/courses/${ctx.course.id}/assignments`, {
      title: 'Private',
    });
    const id = created.body.assignment.id;
    expect((await other.student.c.get(`/api/assignments/${id}`)).status).toBe(404);
    expect(
      (await other.instructor.c.patch(`/api/assignments/${id}`, { title: 'hacked' })).status,
    ).toBe(404);
    expect((await other.ta.c.post(`/api/assignments/${id}/close`)).status).toBe(404);
  });
});

describe('FR-09 close and reopen', () => {
  it('instructors and TAs close and reopen; students cannot; each change is audited once', async () => {
    const created = await ctx.instructor.c.post(`/api/courses/${ctx.course.id}/assignments`, {
      title: 'Close me',
    });
    const id = created.body.assignment.id;

    expect((await ctx.student.c.post(`/api/assignments/${id}/close`)).status).toBe(403);

    const closed = await ctx.ta.c.post(`/api/assignments/${id}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body.assignment.status).toBe('closed');
    expect(closed.body.assignment.closedAt).toBeTruthy();

    // Closing again is a no-op.
    const again = await ctx.instructor.c.post(`/api/assignments/${id}/close`);
    expect(again.body.changed).toBe(false);

    const reopened = await ctx.instructor.c.post(`/api/assignments/${id}/reopen`);
    expect(reopened.body.assignment).toMatchObject({ status: 'open', closedAt: null });

    const log = await admin.get('/api/admin/audit-log?limit=500');
    const forThis = log.body.entries
      .filter((e: { targetId: string }) => e.targetId === id)
      .map((e: { action: string }) => e.action);
    expect(forThis.sort()).toEqual(['assignment.close', 'assignment.reopen']);
  });
});

describe('FR-27 review list (skeleton)', () => {
  it('instructors and TAs of the course see every student; others cannot', async () => {
    const created = await ctx.instructor.c.post(`/api/courses/${ctx.course.id}/assignments`, {
      title: 'Review me',
    });
    const id = created.body.assignment.id;
    const review = await ctx.ta.c.get(`/api/assignments/${id}/review`);
    expect(review.status).toBe(200);
    expect(review.body.submissions).toEqual([
      { student: expect.objectContaining({ id: ctx.student.id }), submission: null },
    ]);

    expect((await ctx.student.c.get(`/api/assignments/${id}/review`)).status).toBe(403);
    expect((await other.instructor.c.get(`/api/assignments/${id}/review`)).status).toBe(404);
    expect((await other.ta.c.get(`/api/assignments/${id}/review`)).status).toBe(404);
  });
});
