import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const queryClient = postgres(databaseUrl);
  return drizzle(queryClient, { schema });
}

export type Db = ReturnType<typeof createDb>;

// The handle a db.transaction callback is given. Both the database work and
// the queue insert take one of these, so they commit together.
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
