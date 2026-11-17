import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { sql } from 'kysely';
import type { Db } from './db/index.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { createSessionMiddleware } from './middleware/session.js';
import { requireSameOrigin } from './middleware/csrf.js';
import { loadUser, requireAdmin, requireAuth } from './middleware/auth.js';
import {
  DEFAULT_RATE_LIMITS,
  createJoinLimiter,
  createLoginLimiter,
  type RateLimitSettings,
} from './middleware/rate-limit.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { courseRoutes } from './routes/courses.js';
import { assignmentRoutes, courseAssignmentRoutes } from './routes/assignments.js';
import { redactUrl } from './logger.js';
import { ownSubmissionRoutes, submissionRoutes } from './routes/submissions.js';
import type { ObjectStore } from '@webcove/storage';
import type { UploadLimits } from '@webcove/shared';

export interface AppDeps {
  db: Db;
  logger: Logger;
  platformOrigin: string;
  sessionSecret: string;
  secureCookie: boolean;
  trustProxy?: number;
  rateLimits?: RateLimitSettings;
  store: ObjectStore;
  tokenKey: Buffer;
  contentUrlPattern: string;
  uploadLimits?: UploadLimits;
  /** Test hook for fault injection inside the publish transaction. */
  beforeCommit?: () => Promise<void>;
}

export function createApp(deps: AppDeps) {
  const { db } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxy ?? 0);

  app.use(
    pinoHttp({
      logger: deps.logger,
      serializers: {
        req: (req) => ({ method: req.method, url: redactUrl(req.url) }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  // Platform API responses: strict defaults. The front end's own CSP is set by the web server.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Liveness: the process is up. Readiness: dependencies are reachable.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/ready', async (_req, res) => {
    try {
      await sql`select 1`.execute(db.kysely);
      res.json({ status: 'ready', database: 'ok' });
    } catch {
      res.status(503).json({ status: 'not_ready', database: 'unreachable' });
    }
  });

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use(requireSameOrigin(deps.platformOrigin));
  api.use(
    createSessionMiddleware({
      pool: db.pool,
      secret: deps.sessionSecret,
      secureCookie: deps.secureCookie,
    }),
  );
  api.use(loadUser(db.kysely));

  const limits = deps.rateLimits ?? DEFAULT_RATE_LIMITS;
  api.use('/auth', authRoutes(db.kysely, createLoginLimiter(limits)));
  api.use('/admin', requireAdmin, adminRoutes(db.kysely));
  api.use('/courses', requireAuth, courseRoutes(db.kysely, createJoinLimiter(limits)));
  api.use('/courses/:courseId/assignments', requireAuth, courseAssignmentRoutes(db.kysely));
  api.use('/assignments', requireAuth, assignmentRoutes(db.kysely));

  const subDeps = {
    db: db.kysely,
    store: deps.store,
    logger: deps.logger,
    limits: deps.uploadLimits,
    beforeCommit: deps.beforeCommit,
    tokenKey: deps.tokenKey,
    contentUrlPattern: deps.contentUrlPattern,
  };
  api.use('/assignments/:id/submission', requireAuth, ownSubmissionRoutes(subDeps));
  api.use('/submissions', requireAuth, submissionRoutes(subDeps));

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
