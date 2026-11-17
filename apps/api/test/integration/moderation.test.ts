import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES } from '@webcove/zip-validator/fixtures';
import {
  createCourseWithMembers,
  createUser,
  setupHarness,
  uploadZip,
  type Client,
  type Harness,
} from '../helpers/harness.js';

let h: Harness;
let admin: Client;
let ctx: Awaited<ReturnType<typeof createCourseWithMembers>>;
let subId: string;

beforeAll(async () => {
  h = await setupHarness();
  admin = (await createUser(h, 'admin', 'Admin')).c;
  ctx = await createCourseWithMembers(h, admin);
  const a = await ctx.instructor.c.post(`/api/courses/${ctx.course.id}/assignments`, {
    title: 'Site',
  });
  const up = await uploadZip(ctx.student.c, a.body.assignment.id, FIXTURES['valid-site']!());
  subId = up.body.submission.id;
});
afterAll(async () => h.close());

describe('FR-29 / FR-30 take-down and restore', () => {
  it('a TA takes a submission down with a reason; it is audited; the owner sees it', async () => {
    const res = await ctx.ta.c.post(`/api/submissions/${subId}/takedown`, {
      reason: 'Phishing form on the home page',
    });
    expect(res.status).toBe(200);
    expect(res.body.submission).toMatchObject({
      takenDown: true,
      takenDownReason: 'Phishing form on the home page',
    });

    const own = await ctx.student.c.get(`/api/submissions/${subId}/versions`);
    expect(own.body.submission.takenDown).toBe(true);

    const log = await admin.get('/api/admin/audit-log');
    const entry = log.body.entries.find(
      (e: { action: string }) => e.action === 'submission.takedown',
    );
    expect(entry).toMatchObject({
      targetId: subId,
      reason: 'Phishing form on the home page',
      actorName: 'TA',
    });
  });

  it('the instructor restores it with a reason', async () => {
    const res = await ctx.instructor.c.post(`/api/submissions/${subId}/restore`, {
      reason: 'Student removed the form',
    });
    expect(res.body.submission.takenDown).toBe(false);
    const log = await admin.get('/api/admin/audit-log');
    expect(
      log.body.entries.some((e: { action: string }) => e.action === 'submission.restore'),
    ).toBe(true);
  });

  it('requires a reason', async () => {
    expect((await ctx.ta.c.post(`/api/submissions/${subId}/takedown`, { reason: '' })).status).toBe(
      400,
    );
  });

  it('students and staff of other courses cannot moderate', async () => {
    expect(
      (await ctx.student.c.post(`/api/submissions/${subId}/takedown`, { reason: 'my own' })).status,
    ).toBe(403);
    const other = await createCourseWithMembers(h, admin);
    expect(
      (await other.instructor.c.post(`/api/submissions/${subId}/takedown`, { reason: 'not mine' }))
        .status,
    ).toBe(404);
  });
});
