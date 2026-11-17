import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createUser, setupHarness, type Client, type Harness } from '../helpers/harness.js';

let h: Harness;
let admin: Client;
beforeAll(async () => {
  h = await setupHarness();
  admin = (await createUser(h, 'admin', 'Admin')).c;
});
afterAll(async () => h.close());

describe('FR-03 staff accounts', () => {
  it('only administrators can manage staff', async () => {
    const student = await createUser(h, 'student');
    const staff = await createUser(h, 'staff');
    expect((await client(h.app).get('/api/admin/staff')).status).toBe(401);
    expect((await student.c.get('/api/admin/staff')).status).toBe(403);
    expect((await staff.c.get('/api/admin/staff')).status).toBe(403);
    expect(
      (await staff.c.post('/api/admin/staff', { name: 'X', email: 'x@example.test' })).status,
    ).toBe(403);
  });

  it('creates a staff account with a one-time temporary password that must be changed', async () => {
    const res = await admin.post('/api/admin/staff', { name: 'Dr Lim', email: 'lim@example.test' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ accountType: 'staff', mustChangePassword: true });
    const temp: string = res.body.temporaryPassword;
    expect(temp).toHaveLength(16);

    const lim = client(h.app);
    expect(
      (await lim.post('/api/auth/login', { email: 'lim@example.test', password: temp })).status,
    ).toBe(200);
    // Until the password is changed, nothing else works.
    const blocked = await lim.get('/api/courses');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await lim.post('/api/auth/change-password', {
      currentPassword: temp,
      newPassword: 'my-own-password',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect((await lim.get('/api/courses')).status).toBe(200);

    // The temporary password is never written to the audit log.
    const log = await admin.get('/api/admin/audit-log');
    expect(JSON.stringify(log.body)).not.toContain(temp);
    expect(log.body.entries.map((e: { action: string }) => e.action)).toContain('staff.create');
  });

  it('disabling a staff account ends existing sessions immediately and blocks sign-in', async () => {
    const created = await admin.post('/api/admin/staff', {
      name: 'TA Tan',
      email: 'tan@example.test',
    });
    const id = created.body.user.id;
    const tan = client(h.app);
    await tan.post('/api/auth/login', {
      email: 'tan@example.test',
      password: created.body.temporaryPassword,
    });
    await tan.post('/api/auth/change-password', {
      currentPassword: created.body.temporaryPassword,
      newPassword: 'tan-password-1',
    });
    expect((await tan.get('/api/courses')).status).toBe(200);

    expect((await admin.patch(`/api/admin/staff/${id}`, { status: 'disabled' })).status).toBe(200);
    expect((await tan.get('/api/courses')).status).toBe(401);
    const login = await client(h.app).post('/api/auth/login', {
      email: 'tan@example.test',
      password: 'tan-password-1',
    });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_DISABLED');

    await admin.patch(`/api/admin/staff/${id}`, { status: 'active' });
    expect(
      (
        await client(h.app).post('/api/auth/login', {
          email: 'tan@example.test',
          password: 'tan-password-1',
        })
      ).status,
    ).toBe(200);
  });

  it('resetting a password ends old sessions and issues a new temporary password', async () => {
    const created = await admin.post('/api/admin/staff', {
      name: 'Dr Wong',
      email: 'wong@example.test',
    });
    const wong = client(h.app);
    await wong.post('/api/auth/login', {
      email: 'wong@example.test',
      password: created.body.temporaryPassword,
    });
    await wong.post('/api/auth/change-password', {
      currentPassword: created.body.temporaryPassword,
      newPassword: 'wong-password-1',
    });

    const reset = await admin.post(`/api/admin/staff/${created.body.user.id}/reset-password`);
    expect(reset.status).toBe(200);
    expect((await wong.get('/api/courses')).status).toBe(401);
    const relogin = client(h.app);
    expect(
      (
        await relogin.post('/api/auth/login', {
          email: 'wong@example.test',
          password: 'wong-password-1',
        })
      ).status,
    ).toBe(401);
    const ok = await relogin.post('/api/auth/login', {
      email: 'wong@example.test',
      password: reset.body.temporaryPassword,
    });
    expect(ok.body.user.mustChangePassword).toBe(true);
  });

  it('cannot disable or reset a non-staff account through the staff endpoints', async () => {
    const student = await createUser(h, 'student');
    expect(
      (await admin.patch(`/api/admin/staff/${student.id}`, { status: 'disabled' })).status,
    ).toBe(404);
    expect((await admin.post(`/api/admin/staff/not-a-uuid/reset-password`)).status).toBe(404);
  });
});
