import type { RequestHandler } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { AppError } from '../errors.js';

/**
 * Load the signed-in user on every request from the database (not from the session),
 * so that disabling an account or resetting a password takes effect immediately.
 */
export function loadUser(db: Kysely<Database>): RequestHandler {
  return async (req, _res, next) => {
    const userId = req.session?.userId;
    if (!userId) return next();
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || user.status !== 'active' || user.session_version !== req.session.sessionVersion) {
      await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
      return next();
    }
    req.user = user;
    next();
  };
}

/** Require a signed-in user. Users with a temporary password may only change it. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new AppError('UNAUTHENTICATED', 'Please sign in'));
  if (req.user.must_change_password) {
    return next(
      new AppError('PASSWORD_CHANGE_REQUIRED', 'Please change your temporary password first'),
    );
  }
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new AppError('UNAUTHENTICATED', 'Please sign in'));
  if (req.user.account_type !== 'admin')
    return next(new AppError('FORBIDDEN', 'Administrators only'));
  if (req.user.must_change_password) {
    return next(
      new AppError('PASSWORD_CHANGE_REQUIRED', 'Please change your temporary password first'),
    );
  }
  next();
};
