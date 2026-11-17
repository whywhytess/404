import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import type pg from 'pg';

export const SESSION_COOKIE = 'wc.sid';
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

/**
 * Platform session cookie (NFR-S4): HttpOnly, Secure outside local development,
 * SameSite=Lax and no Domain attribute, so it is never sent to the content domain.
 */
export function createSessionMiddleware(opts: {
  pool: pg.Pool;
  secret: string;
  secureCookie: boolean;
}) {
  const PgStore = connectPgSimple(session);
  return session({
    name: SESSION_COOKIE,
    secret: opts.secret,
    store: new PgStore({ pool: opts.pool, tableName: 'session', pruneSessionInterval: 15 * 60 }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: opts.secureCookie,
      sameSite: 'lax',
      maxAge: EIGHT_HOURS,
      path: '/',
    },
  });
}
