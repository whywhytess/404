import { createServer } from 'node:http';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { pino } from 'pino';
import { z } from 'zod';
import { parseTokenKey } from '@webcove/security';
import { S3ObjectStore } from '@webcove/storage';
import { createContentHandler, redactUrl, type ContentDatabase } from './app.js';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    CONTENT_PORT: z.coerce.number().int().positive().default(4000),
    CONTENT_DOMAIN: z.string().min(1),
    PLATFORM_ORIGIN: z.url(),
    TOKEN_SECRET: z.string().min(32),
    /** Ideally a read-only database role (ADR-010). */
    CONTENT_DATABASE_URL: z.string().optional(),
    DATABASE_URL: z.string().min(1),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
  })
  .parse(process.env);

const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: { paths: ['req.headers.cookie'], censor: '[REDACTED]' },
  hooks: {
    // Belt and braces: strip tokens from any string field that looks like a URL.
    logMethod(args, method) {
      method.apply(
        this,
        args.map((a) => (typeof a === 'string' ? redactUrl(a) : a)) as Parameters<typeof method>,
      );
    },
  },
});
const pool = new pg.Pool({
  connectionString: env.CONTENT_DATABASE_URL ?? env.DATABASE_URL,
  max: 10,
});
const db = new Kysely<ContentDatabase>({ dialect: new PostgresDialect({ pool }) });
const store = new S3ObjectStore({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY,
  secretAccessKey: env.S3_SECRET_KEY,
});

const handler = createContentHandler({
  db,
  store,
  logger,
  tokenKey: parseTokenKey(env.TOKEN_SECRET),
  platformOrigin: env.PLATFORM_ORIGIN,
  contentDomain: env.CONTENT_DOMAIN,
});
const server = createServer((req, res) => void handler(req, res));
server.listen(env.CONTENT_PORT, () =>
  logger.info(`Web Cove content server on port ${env.CONTENT_PORT} for *.${env.CONTENT_DOMAIN}`),
);

const shutdown = async () => {
  server.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
