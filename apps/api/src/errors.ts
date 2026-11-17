import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import type { ApiErrorBody, ErrorCode } from '@webcove/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  CSRF_ORIGIN_MISMATCH: 403,
  ACCOUNT_DISABLED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EMAIL_TAKEN: 409,
  ALREADY_ENROLLED: 409,
  ASSIGNMENT_CLOSED: 409,
  COURSE_ENDED: 409,
  INVALID_JOIN_CODE: 404,
  RATE_LIMITED: 429,
  UPLOAD_REJECTED: 422,
  ARCHIVE_TOO_LARGE: 413,
  NO_PREVIOUS_VERSION: 409,
  STORAGE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS_BY_CODE[code];
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError('FORBIDDEN', message);

/** Parse a request part with a zod schema, raising a 400 with field details on failure. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'Some fields are invalid', {
      fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('Endpoint'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    res.status(err.status).json(body);
    return;
  }
  // Malformed JSON from express.json()
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Malformed JSON body' } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res
      .status(413)
      .json({ error: { code: 'VALIDATION_FAILED', message: 'Request body too large' } });
    return;
  }
  req.log?.error({ err }, 'Unhandled error');
  const body: ApiErrorBody = { error: { code: 'INTERNAL', message: 'Something went wrong' } };
  res.status(500).json(body);
};
