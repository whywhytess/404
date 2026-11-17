import { Router, type Request, type RequestHandler } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database, User } from '../db/schema.js';
import { AppError, parse } from '../errors.js';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password.js';
import { presentUser } from '../presenters.js';
import { Email, Name, Password } from '../validation.js';
import { SESSION_COOKIE } from '../middleware/session.js';

const RegisterBody = z.object({ name: Name, email: Email, password: Password });
const LoginBody = z.object({ email: Email, password: z.string().min(1).max(128) });
const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: Password,
});

/** Regenerate the session ID on sign-in to prevent session fixation. */
function signIn(req: Request, user: User): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.sessionVersion = user.session_version;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

export function authRoutes(db: Kysely<Database>, loginLimiter: RequestHandler) {
  const r = Router();

  // FR-01: students register themselves.
  r.post('/register', loginLimiter, async (req, res) => {
    const body = parse(RegisterBody, req.body);
    const existing = await db
      .selectFrom('users')
      .select('id')
      .where((eb) => eb(eb.fn('lower', ['email']), '=', body.email))
      .executeTakeFirst();
    if (existing) throw new AppError('EMAIL_TAKEN', 'An account with this e-mail already exists');
    const user = await db
      .insertInto('users')
      .values({
        name: body.name,
        email: body.email,
        password_hash: await hashPassword(body.password),
        account_type: 'student',
      })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((err) => {
        // Race between the check above and the insert.
        if (err?.code === '23505')
          throw new AppError('EMAIL_TAKEN', 'An account with this e-mail already exists');
        throw err;
      });
    await signIn(req, user);
    res.status(201).json({ user: presentUser(user) });
  });

  // FR-02: sign in.
  r.post('/login', loginLimiter, async (req, res) => {
    const body = parse(LoginBody, req.body);
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where((eb) => eb(eb.fn('lower', ['email']), '=', body.email))
      .executeTakeFirst();
    const ok = await verifyPassword(user?.password_hash ?? (await getDummyHash()), body.password);
    if (!user || !ok) throw new AppError('INVALID_CREDENTIALS', 'E-mail or password is incorrect');
    // Only reveal "disabled" to someone who knows the password.
    if (user.status !== 'active')
      throw new AppError('ACCOUNT_DISABLED', 'This account has been disabled');
    await signIn(req, user);
    res.json({ user: presentUser(user) });
  });

  r.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.status(204).end();
    });
  });

  r.get('/me', (req, res) => {
    if (!req.user) throw new AppError('UNAUTHENTICATED', 'Please sign in');
    res.json({ user: presentUser(req.user) });
  });

  // Required after an administrator creates or resets a staff account.
  r.post('/change-password', async (req, res) => {
    if (!req.user) throw new AppError('UNAUTHENTICATED', 'Please sign in');
    const body = parse(ChangePasswordBody, req.body);
    if (!(await verifyPassword(req.user.password_hash, body.currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    if (body.currentPassword === body.newPassword) {
      throw new AppError(
        'VALIDATION_FAILED',
        'New password must be different from the current one',
      );
    }
    const newHash = await hashPassword(body.newPassword);
    const updated = await db
      .updateTable('users')
      .set((eb) => ({
        password_hash: newHash,
        must_change_password: false,
        session_version: eb('session_version', '+', 1),
      }))
      .where('id', '=', req.user.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    // Other sessions of this user are invalidated by the session_version bump; keep this one.
    await signIn(req, updated);
    res.json({ user: presentUser(updated) });
  });

  return r;
}
