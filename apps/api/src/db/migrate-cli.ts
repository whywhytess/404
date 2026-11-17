import { createDb } from './index.js';
import { migrateToLatest } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url);
try {
  const applied = await migrateToLatest(db.kysely);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database already up to date');
} finally {
  await db.close();
}
