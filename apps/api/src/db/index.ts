import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates (avoids timezone shifts).
pg.types.setTypeParser(1082, (v) => v);

export interface Db {
  kysely: Kysely<Database>;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const kysely = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return {
    kysely,
    pool,
    // Kysely.destroy() also ends the pool.
    close: () => kysely.destroy(),
  };
}
