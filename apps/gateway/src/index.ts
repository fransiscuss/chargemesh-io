import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { schema } from '@chargemesh/db';
import { parseEnv } from './env.js';
import { DbConfigStore } from './config/store.js';
import { createGateway } from './server.js';

export { createGateway } from './server.js';
export { MemoryConfigStore, DbConfigStore } from './config/store.js';
export type { ConfigStore, ChargerConfig, PrimaryConfig } from './config/store.js';
export { Pipeline } from './pipeline/pipeline.js';

if (import.meta.main) {
  const env = parseEnv(process.env);
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const gateway = createGateway({
    store: new DbConfigStore(drizzle(pool, { schema }), env.CREDENTIALS_ENC_KEY),
    allowInsecureWs: env.ALLOW_INSECURE_WS,
    trustFlyProxy: env.FLY_APP_NAME !== undefined,
    logLevel: env.LOG_LEVEL,
  });
  try {
    await gateway.listen(env.PORT);
  } catch (error) {
    await pool.end();
    throw error;
  }
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await gateway.close();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  };
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
}
