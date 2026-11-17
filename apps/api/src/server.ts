import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { createApp } from './app.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.NODE_ENV);
const db = createDb(config.DATABASE_URL);

const app = createApp({
  db,
  logger,
  platformOrigin: config.PLATFORM_ORIGIN,
  sessionSecret: config.SESSION_SECRET,
  secureCookie: config.NODE_ENV === 'production',
  trustProxy: config.TRUST_PROXY,
});

const server = app.listen(config.API_PORT, () => {
  logger.info(`Web Cove API listening on port ${config.API_PORT}`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
