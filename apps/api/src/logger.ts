import { pino, type Logger } from 'pino';

/** Remove access tokens from any URL before it is logged (INV-11). */
export function redactUrl(url: string): string {
  return url.replace(/\/_t\/[^/?#]+/g, '/_t/[REDACTED]');
}

export function createLogger(env: string): Logger {
  return pino({
    level: env === 'test' ? 'silent' : env === 'production' ? 'info' : 'debug',
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
        '*.temporaryPassword',
      ],
      censor: '[REDACTED]',
    },
  });
}
