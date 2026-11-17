import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/schema.js';
import { AppError, notFound, parse } from '../errors.js';
import { generateTemporaryPassword, hashPassword } from '../auth/password.js';
import { presentUser } from '../presenters.js';
import { assertUuid } from '../policy.js';
import { audit } from '../audit.js';
import { Email, Name } from '../validation.js';

const CreateStaffBody = z.object({ name: Name, email: Email });
const UpdateStaffBody = z.object({ status: z.enum(['active', 'disabled']) });

/** FR-03: administrators create, disable and reset instructor and TA accounts. All routes are admin-only. */
export function adminRoutes(db: Kysely<Database>) {
  const r = Router();

  r.get('/staff', async (_req, res) => {
    const staff = await db
      .selectFrom('users')
      .selectAll()
      .where('account_type', '=', 'staff')
      .orderBy('name')
      .execute();
    res.json({ staff: staff.map(presentUser) });
  });

  r.post('/staff', async (req, res) => {
    const body = parse(CreateStaffBody, req.body);
    const temporaryPassword = generateTemporaryPassword();
    const user = await db
      .insertInto('users')
      .values({
        name: body.name,
        email: body.email,
        password_hash: await hashPassword(temporaryPassword),
        account_type: 'staff',
        must_change_password: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((err) => {
        if (err?.code === '23505')
          throw new AppError('EMAIL_TAKEN', 'An account with this e-mail already exists');
        throw err;
      });
    await audit(db, {
      actorId: req.user!.id,
      action: 'staff.create',
      targetType: 'user',
      targetId: user.id,
    });
    // The temporary password is returned once, to the administrator only, and never logged or stored in plain text.
    res.status(201).json({ user: presentUser(user), temporaryPassword });
  });

  async function loadStaff(id: string) {
    assertUuid(id, 'Staff account');
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .where('account_type', '=', 'staff')
      .executeTakeFirst();
    if (!user) throw notFound('Staff account');
    return user;
  }

  r.patch('/staff/:id', async (req, res) => {
    const body = parse(UpdateStaffBody, req.body);
    const staff = await loadStaff(req.params.id);
    const updated = await db
      .updateTable('users')
      .set((eb) => ({ status: body.status, session_version: eb('session_version', '+', 1) }))
      .where('id', '=', staff.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(db, {
      actorId: req.user!.id,
      action: body.status === 'disabled' ? 'staff.disable' : 'staff.enable',
      targetType: 'user',
      targetId: staff.id,
    });
    res.json({ user: presentUser(updated) });
  });

  r.post('/staff/:id/reset-password', async (req, res) => {
    const staff = await loadStaff(req.params.id);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const updated = await db
      .updateTable('users')
      .set((eb) => ({
        password_hash: passwordHash,
        must_change_password: true,
        session_version: eb('session_version', '+', 1),
      }))
      .where('id', '=', staff.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(db, {
      actorId: req.user!.id,
      action: 'staff.reset_password',
      targetType: 'user',
      targetId: staff.id,
    });
    res.json({ user: presentUser(updated), temporaryPassword });
  });

  r.get('/audit-log', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const entries = await db
      .selectFrom('audit_log')
      .leftJoin('users', 'users.id', 'audit_log.actor_id')
      .select([
        'audit_log.id',
        'audit_log.action',
        'audit_log.target_type as targetType',
        'audit_log.target_id as targetId',
        'audit_log.reason',
        'audit_log.metadata',
        'audit_log.created_at as createdAt',
        'users.name as actorName',
      ])
      .orderBy('audit_log.id', 'desc')
      .limit(limit)
      .execute();
    res.json({ entries });
  });

  return r;
}
