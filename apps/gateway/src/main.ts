import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { schema } from '@chargemesh/db';
import { parseEnv } from './env.js';
import { DbConfigStore } from './config/store.js';
import { Pipeline } from './pipeline/pipeline.js';
import { createRecording } from './recorder/recorder.js';
import { ConnectionTracker } from './recorder/connections.js';
import { createGateway } from './server.js';

const env = parseEnv(process.env);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool, { schema });
const recording = createRecording(db);
const gateway = createGateway({
  store: new DbConfigStore(db, env.CREDENTIALS_ENC_KEY),
  allowInsecureWs: env.ALLOW_INSECURE_WS,
  trustFlyProxy: env.FLY_APP_NAME !== undefined,
  logLevel: env.LOG_LEVEL,
  pipeline: new Pipeline([], [recording.validator, recording.recorder, recording.busPublisher]),
  recorder: { flush: () => recording.flush() },
  connections: new ConnectionTracker(db),
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
    await recording.close();
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
