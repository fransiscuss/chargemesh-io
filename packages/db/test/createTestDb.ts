import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from '../src/schema.js';

/** Isolated in-memory PostgreSQL, using exactly the production migration files. */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    });
    return { db, client, close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}
