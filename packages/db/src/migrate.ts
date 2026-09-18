import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export function parseMigrationEnv(env: NodeJS.ProcessEnv) {
  const result = z
    .object({
      DATABASE_URL: z
        .url()
        .refine(
          (value) => /^postgres(?:ql)?:\/\//.test(value),
          'Must be a PostgreSQL connection URL',
        ),
    })
    .safeParse(env);
  if (!result.success) throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  return result.data;
}

export async function runMigrations(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { DATABASE_URL } = parseMigrationEnv(env);
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  runMigrations()
    .then(() => {
      console.info('Database migrations applied');
    })
    .catch(() => {
      // Database errors can include connection details: keep credentials out of logs.
      console.error(
        'Database migration failed. Check DATABASE_URL, connectivity, and migration files.',
      );
      process.exitCode = 1;
    });
}
