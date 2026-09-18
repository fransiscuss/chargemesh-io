import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ end: vi.fn(), migrate: vi.fn(), pool: vi.fn() }));
vi.mock('pg', () => ({
  default: {
    Pool: class {
      constructor(options: unknown) {
        mocks.pool(options);
      }
      end = mocks.end;
    },
  },
}));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: (pool: unknown) => pool }));
vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: mocks.migrate }));

import { parseMigrationEnv, runMigrations } from './migrate.js';

describe('migration entry point', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it.each([{}, { DATABASE_URL: '' }, { DATABASE_URL: 'https://example.com' }])(
    'rejects missing or invalid DATABASE_URL',
    (env) => {
      expect(() => parseMigrationEnv(env)).toThrow('DATABASE_URL');
      expect(mocks.pool).not.toHaveBeenCalled();
    },
  );
  it('accepts a PostgreSQL URL', () => {
    expect(
      parseMigrationEnv({ DATABASE_URL: 'postgresql://localhost/chargemesh' }).DATABASE_URL,
    ).toBe('postgresql://localhost/chargemesh');
  });
  it('applies migration files and closes the connection pool', async () => {
    await runMigrations({ DATABASE_URL: 'postgres://localhost/chargemesh' });
    expect(mocks.pool).toHaveBeenCalledWith({
      connectionString: 'postgres://localhost/chargemesh',
      max: 1,
    });
    expect(mocks.migrate).toHaveBeenCalledWith(expect.anything(), {
      migrationsFolder: expect.stringMatching(/packages\/db\/migrations$/),
    });
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it('closes the pool even when migration fails', async () => {
    mocks.migrate.mockRejectedValueOnce(new Error('migration failed'));
    await expect(
      runMigrations({ DATABASE_URL: 'postgres://localhost/chargemesh' }),
    ).rejects.toThrow('migration failed');
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
