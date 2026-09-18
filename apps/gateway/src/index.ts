import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { schema } from '@chargemesh/db';
import { parseEnv } from './env.js';
import { DbConfigStore } from './config/store.js';
import { Pipeline } from './pipeline/pipeline.js';
import { createRecording } from './recorder/recorder.js';
import { ConnectionTracker } from './recorder/connections.js';
import { createGateway } from './server.js';

export { createGateway } from './server.js';
export { MemoryConfigStore, DbConfigStore } from './config/store.js';
export type { ConfigStore, ChargerConfig, PrimaryConfig } from './config/store.js';
export { Pipeline } from './pipeline/pipeline.js';
export type { FrameContext, SyncInterceptor, AsyncInterceptor } from './pipeline/pipeline.js';
export { buildEvent } from './recorder/eventBuilder.js';
export type { OcppEvent, NewOcppEvent } from './recorder/eventBuilder.js';
export { createValidatorInterceptor } from './recorder/validator.js';
export { BatchWriter, createDropCounter } from './recorder/batchWriter.js';
export type { BatchWriterOptions, BatchWriterSink } from './recorder/batchWriter.js';
export { InProcessEventBus } from './recorder/eventBus.js';
export type { EventBus, EventFilter, EventHandler } from './recorder/eventBus.js';
export {
  createDbSink,
  createRecorder,
  createBusPublisher,
  createRecording,
} from './recorder/recorder.js';
export { ConnectionTracker } from './recorder/connections.js';
export type { ConnectionOpen, ConnectionClose } from './recorder/connections.js';

if (import.meta.main) {
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
}
