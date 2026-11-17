import { rateLimit, type Options } from 'express-rate-limit';
import type { RequestHandler } from 'express';

export interface RateLimitSettings {
  /** Sign-in attempts per IP + e-mail per window. */
  loginMax: number;
  /** Join-code attempts per user per window. */
  joinMax: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  loginMax: 10,
  joinMax: 20,
  windowMs: 15 * 60 * 1000,
};

function limiter(max: number, windowMs: number, key: Options['keyGenerator']): RequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: key,
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({
        error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      });
    },
  });
}

export function createLoginLimiter(s: RateLimitSettings) {
  return limiter(s.loginMax, s.windowMs, (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${req.ip}|${email}`;
  });
}

export function createJoinLimiter(s: RateLimitSettings) {
  return limiter(s.joinMax, s.windowMs, (req) => `join|${req.user?.id ?? req.ip}`);
}
