import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../src/db/client.js';

// Runs once, before any spec file starts. On a brand new test database every
// spec file would otherwise try to run the migrations at the same moment and
// trip over each other.
export default async function migrateTestDatabase(): Promise<void> {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgres://holocron:holocron@localhost:5432/holocron_test',
  );
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  } finally {
    await db.$client.end();
  }
}
