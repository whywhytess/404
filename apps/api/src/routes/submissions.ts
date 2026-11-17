import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { DEFAULT_UPLOAD_LIMITS, type UploadLimits } from '@webcove/shared';
import type { ObjectStore } from '@webcove/storage';
import type { Database, Submission } from '../db/schema.js';
import { AppError, forbidden, notFound, parse } from '../errors.js';
import { audit } from '../audit.js';
import { z } from 'zod';
import { sql } from 'kysely';
import { assertUuid, authoriseAssignment, getCourseRole } from '../policy.js';
import { presentSubmission, presentVersion } from '../presenters.js';
import { courseHasEnded } from './courses.js';
import { publishUpload, rollbackSubmission } from '../services/publish.js';
import { signToken, type ViewerRole } from '@webcove/security';

export interface SubmissionDeps {
  db: Kysely<Database>;
  store: ObjectStore;
  logger: Logger;
  limits?: UploadLimits;
  /** Test hook: runs inside the publish transaction just before commit. */
  beforeCommit?: () => Promise<void>;
  tokenKey: Buffer;
  contentUrlPattern: string;
}

/** :id from the parent router (mergeParams). */
const paramId = (req: { params: unknown }) => String((req.params as { id?: string }).id);

async function loadVersions(db: Kysely<Database>, submissionId: string) {
  const rows = await db
    .selectFrom('versions')
    .selectAll()
    .where('submission_id', '=', submissionId)
    .orderBy('number', 'desc')
    .execute();
  return rows.map(presentVersion);
}

/** Routes under /api/assignments/:id/submission (the signed-in student's own submission). */
export function ownSubmissionRoutes(deps: SubmissionDeps) {
  const { db } = deps;
  const limits = deps.limits ?? DEFAULT_UPLOAD_LIMITS;
  const r = Router({ mergeParams: true });

  // FR-17: the student's own submission and version history.
  r.get('/', async (req, res) => {
    const id = paramId(req);
    const { assignment } = await authoriseAssignment(db, req.user!, id, ['student']);
    const sub = await db
      .selectFrom('submissions')
      .selectAll()
      .where('assignment_id', '=', assignment.id)
      .where('student_id', '=', req.user!.id)
      .executeTakeFirst();
    res.json({
      submission: sub ? presentSubmission(sub) : null,
      versions: sub ? await loadVersions(db, sub.id) : [],
    });
  });

  // Authorise and check the assignment BEFORE accepting any request body.
  const preCheck: RequestHandler = async (req, _res, next) => {
    const id = paramId(req);
    const { assignment } = await authoriseAssignment(db, req.user!, id, ['student']);
    if (assignment.status !== 'open')
      throw new AppError(
        'ASSIGNMENT_CLOSED',
        'This assignment is closed. Uploads are not accepted.',
      );
    const course = await db
      .selectFrom('courses')
      .select('end_date')
      .where('id', '=', assignment.course_id)
      .executeTakeFirstOrThrow();
    if (courseHasEnded(course.end_date))
      throw new AppError('COURSE_ENDED', 'This course has ended. Uploads are not accepted.');
    res_locals(req).workDir = await mkdtemp(path.join(os.tmpdir(), 'webcove-upload-'));
    next();
  };

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => cb(null, res_locals(req).workDir!),
      filename: (_req, _file, cb) => cb(null, 'archive.zip'),
    }),
    // FR-10: exactly one file; FR-11: archive size limit enforced while receiving.
    limits: { fileSize: limits.maxArchiveBytes, files: 1, fields: 5, parts: 6 },
  }).single('archive');

  const receive: RequestHandler = (req, res, next) => {
    upload(req, res, async (err: unknown) => {
      if (!err) return next();
      await rm(res_locals(req).workDir!, { recursive: true, force: true });
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError(
              'ARCHIVE_TOO_LARGE',
              `The ZIP file is larger than ${Math.round(limits.maxArchiveBytes / 1024 / 1024)} MB. Remove large or unused files and try again.`,
            ),
          );
        }
        return next(
          new AppError('VALIDATION_FAILED', 'Upload exactly one ZIP file in the "archive" field.'),
        );
      }
      next(err);
    });
  };

  // FR-10, FR-16, FR-20: upload a ZIP and publish it as a new version.
  r.post('/', preCheck, receive, async (req, res) => {
    const workDir = res_locals(req).workDir!;
    try {
      if (!req.file) throw new AppError('VALIDATION_FAILED', 'Choose a ZIP file to upload.');
      const result = await publishUpload(
        deps,
        {
          assignmentId: paramId(req),
          studentId: req.user!.id,
          zipPath: req.file.path,
          workDir: path.join(workDir, 'site'),
        },
        { beforeCommit: deps.beforeCommit },
      );
      res.status(201).json({
        submission: presentSubmission(result.submission),
        version: presentVersion(result.version),
        warnings: result.warnings,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  return r;
}

const locals = new WeakMap<object, { workDir?: string }>();
function res_locals(req: object) {
  let l = locals.get(req);
  if (!l) locals.set(req, (l = {}));
  return l;
}

/** Routes under /api/submissions/:id */
export function submissionRoutes(deps: SubmissionDeps) {
  const { db } = deps;
  const r = Router();

  async function loadForUser(
    id: string,
    userId: string,
    accountType: string,
  ): Promise<{ sub: Submission; isOwner: boolean; viewerRole: ViewerRole }> {
    assertUuid(id, 'Submission');
    const sub = await db
      .selectFrom('submissions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!sub) throw notFound('Submission');
    if (sub.student_id === userId) return { sub, isOwner: true, viewerRole: 'student' };
    if (accountType === 'admin') return { sub, isOwner: false, viewerRole: 'admin' };
    const assignment = await db
      .selectFrom('assignments')
      .select('course_id')
      .where('id', '=', sub.assignment_id)
      .executeTakeFirstOrThrow();
    const role = await getCourseRole(db, assignment.course_id, userId);
    if (role === 'instructor' || role === 'ta') return { sub, isOwner: false, viewerRole: role };
    // Classmates and outsiders cannot tell whether the submission exists.
    throw notFound('Submission');
  }

  r.get('/:id/versions', async (req, res) => {
    const { sub } = await loadForUser(String(req.params.id), req.user!.id, req.user!.account_type);
    res.json({ submission: presentSubmission(sub), versions: await loadVersions(db, sub.id) });
  });

  /**
   * FR-23: issue a short-lived signed access link. Only the owner and the course's
   * instructors/TAs (or an administrator) can obtain one; a classmate cannot (ST-16).
   */
  r.post('/:id/view-token', async (req, res) => {
    const { sub, viewerRole } = await loadForUser(
      String(req.params.id),
      req.user!.id,
      req.user!.account_type,
    );
    if (!sub.current_version_id) throw notFound('Published version');
    const { token, expiresAt } = signToken(deps.tokenKey, {
      subdomain: sub.subdomain,
      userId: req.user!.id,
      role: viewerRole,
    });
    const origin = deps.contentUrlPattern.replace('{sub}', sub.subdomain).replace(/\/+$/, '');
    // The token is a bearer credential: it is returned to this user only and never logged.
    res.json({
      url: `${origin}/_t/${token}/`,
      origin,
      expiresAt,
      subdomain: sub.subdomain,
      versionId: sub.current_version_id,
    });
  });

  /**
   * FR-29 / FR-30: instructors, TAs and administrators take a submission down or restore it,
   * with a recorded reason. Take-down overrides every valid token on the content server.
   */
  const ModerationBody = z.object({
    reason: z.string().trim().min(3, 'Give a short reason').max(500),
  });
  for (const action of ['takedown', 'restore'] as const) {
    r.post(`/:id/${action}`, async (req, res) => {
      const { sub, viewerRole } = await loadForUser(
        String(req.params.id),
        req.user!.id,
        req.user!.account_type,
      );
      if (viewerRole === 'student')
        throw forbidden('Only course staff can take submissions down or restore them');
      const { reason } = parse(ModerationBody, req.body);
      const updated = await db.transaction().execute(async (trx) => {
        const row = await trx
          .updateTable('submissions')
          .set(
            action === 'takedown'
              ? { taken_down_at: sql`now()`, taken_down_reason: reason, updated_at: sql`now()` }
              : { taken_down_at: null, taken_down_reason: null, updated_at: sql`now()` },
          )
          .where('id', '=', sub.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await audit(trx, {
          actorId: req.user!.id,
          action: `submission.${action}`,
          targetType: 'submission',
          targetId: sub.id,
          reason,
        });
        return row;
      });
      res.json({ submission: presentSubmission(updated) });
    });
  }

  // FR-18: only the owner rolls back, and only while the assignment is open.
  r.post('/:id/rollback', async (req, res) => {
    const { sub, isOwner } = await loadForUser(
      String(req.params.id),
      req.user!.id,
      req.user!.account_type,
    );
    if (!isOwner) throw forbidden('Only the student who owns the submission can roll it back');
    const updated = await rollbackSubmission(db, sub.id);
    res.json({ submission: presentSubmission(updated), versions: await loadVersions(db, sub.id) });
  });

  return r;
}
