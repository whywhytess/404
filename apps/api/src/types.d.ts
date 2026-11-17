import type { User } from './db/schema.js';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    sessionVersion: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** Set by loadUser() when the session belongs to an active account. */
      user?: User;
    }
  }
}

export {};
