import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES } from '@webcove/zip-validator/fixtures';
import { buildZip } from '@webcove/zip-validator/zip-writer';
import { versionPrefix } from '@webcove/storage';
import { DEFAULT_UPLOAD_LIMITS } from '@webcove/shared';
import {
  createCourseWithMembers,
  createUser,
  setupHarness,
  uploadZip,
  type Client,
  type Harness,
} from '../helpers/harness.js';

const KB = 1024;
const MB = 1024 * KB;
let h: Harness;
let admin: Client;
let ctx: Awaited<ReturnType<typeof createCourseWithMembers>>;

const defaults = {
  storageQuotaBytes: 200 * MB,
  uploadsPerHour: 10,
  contentRequestsPerSecond: 50,
  ...DEFAULT_UPLOAD_LIMITS,
};
const setSettings = (patch: Partial<typeof defaults>) =>
  admin.put('/api/admin/settings', { ...defaults, ...patch });

/** A rule-compliant site with one incompressible file of `bytes`. */
const siteOf = (bytes: number) =>
  buildZip([
    { name: 'index.html', data: '<!doctype html><h1>x</h1>' },
    { name: 'img/big.png', data: randomBytes(bytes), method: 0 },
  ]);

beforeAll(async () => {
  h = await setupHarness();
  admin = (await createUser(h, 'admin', 'Admin')).c;
  ctx = await createCourseWithMembers(h, admin);
});
afterAll(async () => h.close());

async function newAssignment() {
  const r = await ctx.instructor.c.post(`/api/courses/${ctx.course.id}/assignments`, {
    title: 'RC',
  });
  return r.body.assignment.id as string;
}

describe('FR-35 administrator settings', () => {
  it('shows the initial values of SRD Table 3.21', async () => {
    const res = await admin.get('/api/admin/settings');
    expect(res.body.settings).toEqual(defaults);
  });

  it('only administrators can view or change settings; values are validated and audited', async () => {
    expect((await ctx.instructor.c.get('/api/admin/settings')).status).toBe(403);
    expect((await ctx.student.c.get('/api/admin/usage')).status).toBe(403);
    expect((await setSettings({ uploadsPerHour: 0 })).status).toBe(400);
    const ok = await setSettings({ uploadsPerHour: 12 });
    expect(ok.body.settings.uploadsPerHour).toBe(12);
    const log = await admin.get('/api/admin/audit-log');
    expect(log.body.entries.some((e: { action: string }) => e.action === 'settings.update')).toBe(
      true,
    );
    await setSettings({});
  });
});

describe('ST-19 / FR-33 uploads per student per assignment per hour', () => {
  it('refuses the upload after the limit with 429 and Retry-After; other assignments are unaffected', async () => {
    await setSettings({ uploadsPerHour: 3 });
    try {
      const id = await newAssignment();
      // A rejected upload also counts as an attempt.
      expect((await uploadZip(ctx.student.c, id, FIXTURES['zipslip-parent']!())).status).toBe(422);
      expect((await uploadZip(ctx.student.c, id, FIXTURES['valid-site']!())).status).toBe(201);
      expect((await uploadZip(ctx.student.c, id, FIXTURES['valid-site']!())).status).toBe(201);
      const limited = await uploadZip(ctx.student.c, id, FIXTURES['valid-site']!());
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      const retry = Number(limited.headers['retry-after']);
      expect(retry).toBeGreaterThan(3000);
      expect(retry).toBeLessThanOrEqual(3600);

      const other = await newAssignment();
      expect((await uploadZip(ctx.student.c, other, FIXTURES['valid-site']!())).status).toBe(201);

      // Raising the limit takes effect on the next request.
      await setSettings({ uploadsPerHour: 5 });
      expect((await uploadZip(ctx.student.c, id, FIXTURES['valid-site']!())).status).toBe(201);
    } finally {
      await setSettings({});
    }
  });
});

describe('FR-32 storage quota', () => {
  it('counts files of current + previous versions only and refuses uploads beyond the quota', async () => {
    const student = await createUser(h, 'student');
    await student.c.post('/api/courses/join', { joinCode: ctx.course.joinCode });
    const id = await newAssignment();
    const set = await setSettings({ storageQuotaBytes: Math.round(1.3 * MB) });
    expect(set.status).toBe(200);
    try {
      const v1 = await uploadZip(student.c, id, siteOf(600 * KB));
      expect(v1.status).toBe(201);
      expect((await uploadZip(student.c, id, siteOf(600 * KB))).status).toBe(201); // 1.2 MB kept
      // v1 is retired by this upload, so it does not count: 0.6 (v2) + 0.6 (v3) ≤ 1.3 MB.
      expect((await uploadZip(student.c, id, siteOf(600 * KB))).status).toBe(201);

      const before = await student.c.get(`/api/assignments/${id}/submission`);
      const folders = new Set(await h.store.listFolders('versions/'));
      // 0.6 (v3, kept as previous) + 0.8 = 1.4 MB > 1.3 MB.
      const over = await uploadZip(student.c, id, siteOf(800 * KB));
      expect(over.status).toBe(413);
      expect(over.body.error.code).toBe('QUOTA_EXCEEDED');
      expect(over.body.error.message).toContain('1 MB');
      const after = await student.c.get(`/api/assignments/${id}/submission`);
      expect(after.body.submission.currentVersionId).toBe(before.body.submission.currentVersionId);
      const added = (await h.store.listFolders('versions/')).filter((f) => !folders.has(f));
      const stray = (await Promise.all(added.map((f) => h.store.list(versionPrefix(f))))).flat();
      expect(stray).toEqual([]);

      const usage = await admin.get('/api/admin/usage');
      const row = usage.body.users.find((u: { id: string }) => u.id === student.id);
      expect(row.usedBytes).toBeGreaterThan(1.1 * MB);
      expect(row.usedBytes).toBeLessThanOrEqual(1.3 * MB);
    } finally {
      await setSettings({});
    }
  });
});

describe('FR-11 / FR-35 adjustable upload limits', () => {
  it('a lower archive limit applies to the next upload', async () => {
    const id = await newAssignment();
    await setSettings({ maxArchiveBytes: 100 * KB });
    try {
      const res = await uploadZip(ctx.student.c, id, siteOf(300 * KB));
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('ARCHIVE_TOO_LARGE');
    } finally {
      await setSettings({});
    }
  });
});
