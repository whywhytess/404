import type { RequestHandler } from 'express';
import { AppError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated, state-changing requests (see ADR-011).
 * Browsers always send `Origin` on cross-origin and same-origin POST/PUT/PATCH/DELETE,
 * so a request whose Origin is missing or differs from the platform origin is refused.
 * This complements SameSite=Lax on the session cookie.
 */
export function requireSameOrigin(platformOrigin: string): RequestHandler {
  const expected = new URL(platformOrigin).origin;
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin !== expected) {
      return next(new AppError('CSRF_ORIGIN_MISMATCH', 'Request origin is not allowed'));
    }
    next();
  };
}
