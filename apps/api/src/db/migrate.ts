import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import * as m0001 from './migrations/0001_init.js';
import * as m0002 from './migrations/0002_submissions.js';
import * as m0003 from './migrations/0003_resource_control.js';

/** Migrations are registered statically so that they work identically under tsx, tests and builds. */
const migrations: Record<string, Migration> = {
  '0001_init': m0001,
  '0002_submissions': m0002,
  '0003_resource_control': m0003,
};

const provider: MigrationProvider = { getMigrations: async () => migrations };

// Migrations operate on an untyped schema; any Kysely instance is accepted.
export async function migrateToLatest<T>(db: Kysely<T>): Promise<string[]> {
  const migrator = new Migrator({ db: db as Kysely<unknown>, provider });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
