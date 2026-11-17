import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { createApp } from './app.js';
import { DEFAULT_RATE_LIMITS } from './middleware/rate-limit.js';
import { createLogger } from './logger.js';
import { S3ObjectStore } from '@webcove/storage';
import { parseTokenKey } from '@webcove/security';
import { sweepStorage } from './services/publish.js';
import { runRetention } from './services/retention.js';

const config = loadConfig();
const logger = createLogger(config.NODE_ENV);
const db = createDb(config.DATABASE_URL);
const store = new S3ObjectStore({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  bucket: config.S3_BUCKET,
  accessKeyId: config.S3_ACCESS_KEY,
  secretAccessKey: config.S3_SECRET_KEY,
});
await store.ensureBucket();

const app = createApp({
  db,
  logger,
  platformOrigin: config.PLATFORM_ORIGIN,
  sessionSecret: config.SESSION_SECRET,
  secureCookie: config.NODE_ENV === 'production',
  trustProxy: config.TRUST_PROXY,
  rateLimits: { ...DEFAULT_RATE_LIMITS, loginMax: config.LOGIN_RATE_LIMIT },
  store,
  tokenKey: parseTokenKey(config.TOKEN_SECRET),
  contentUrlPattern: config.CONTENT_URL_PATTERN,
});

const server = app.listen(config.API_PORT, () => {
  logger.info(`Web Cove API listening on port ${config.API_PORT}`);
});

// Periodic storage clean-up (ADR-004, FR-19): orphaned and retired version folders.
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const sweepTimer = setInterval(() => {
  sweepStorage({ db: db.kysely, store })
    .then((r) => logger.info(r, 'Storage sweep finished'))
    .catch((err) => logger.error({ err }, 'Storage sweep failed'));
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();

// FR-37: retention deletion, checked every 6 hours and once shortly after start-up.
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const retention = () =>
  runRetention({ db: db.kysely, store, logger })
    .then((r) => {
      if (r.coursesPurged.length || r.foldersDeleted || r.foldersFailed)
        logger.info(r, 'Retention run finished');
    })
    .catch((err) => logger.error({ err }, 'Retention run failed'));
setTimeout(retention, 60_000).unref();
setInterval(retention, RETENTION_INTERVAL_MS).unref();

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
