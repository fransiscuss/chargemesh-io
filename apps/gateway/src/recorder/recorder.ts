import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { chargers, ocppMessages } from '@chargemesh/db';
import type { schema } from '@chargemesh/db';
import type { AsyncInterceptor } from '../pipeline/pipeline.js';
import { buildEvent } from './eventBuilder.js';
import type { NewOcppEvent } from './eventBuilder.js';
import { createValidatorInterceptor } from './validator.js';
import { BatchWriter } from './batchWriter.js';
import type { BatchWriterOptions, BatchWriterSink } from './batchWriter.js';
import type { EventBus } from './eventBus.js';
import { InProcessEventBus } from './eventBus.js';

export type RecorderDb = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

export type PendingRow = {
  row: typeof ocppMessages.$inferInsert;
  event: NewOcppEvent;
};

function toRow(
  ctx: Parameters<AsyncInterceptor>[0],
  event: NewOcppEvent,
): typeof ocppMessages.$inferInsert {
  return {
    chargerId: ctx.chargerId,
    connectionId: ctx.connectionId,
    ts: new Date(ctx.ts),
    source: ctx.source,
    upstreamId: ctx.upstreamId,
    upstreamRole: ctx.upstreamRole,
    msgType: event.msgType,
    uniqueId: event.uniqueId,
    action: event.action,
    payload: event.payload,
    raw: ctx.raw,
    delivery: event.delivery,
    valid: event.valid,
    errors: event.errors,
    latencyMs: event.latencyMs,
  };
}

/** Multi-row insert sink; also advances `chargers.last_seen_at` per charger. */
export function createDbSink(db: RecorderDb): BatchWriterSink<PendingRow, string> {
  // The pg and PGlite drizzle surfaces share the same insert/update call shapes
  // at runtime; only their deep result types differ, so normalize to one.
  const typed = db as PgliteDatabase<typeof schema>;
  return async (entries) => {
    const inserted = await typed
      .insert(ocppMessages)
      .values(entries.map((entry) => entry.row))
      .returning({ id: ocppMessages.id });
    const latest = new Map<string, Date>();
    for (const entry of entries) {
      const ts = entry.row.ts instanceof Date ? entry.row.ts : new Date();
      const current = latest.get(entry.row.chargerId);
      if (!current || ts > current) latest.set(entry.row.chargerId, ts);
    }
    for (const [chargerId, lastSeenAt] of latest) {
      await typed.update(chargers).set({ lastSeenAt }).where(eq(chargers.id, chargerId));
    }
    return inserted.map((row) => row.id.toString());
  };
}

/**
 * Async recorder interceptor. Persists the event through the BatchWriter and
 * resolves `ctx.recorded` with the DB-assigned id for the busPublisher.
 */
export function createRecorder(writer: BatchWriter<PendingRow, string>): AsyncInterceptor {
  return async (ctx, parsed) => {
    const event = buildEvent(ctx, parsed);
    const id = await writer.write({ row: toRow(ctx, event), event });
    ctx.recorded = Promise.resolve({ ...event, id });
  };
}

/** Publishes the recorded event (with DB id) on the EventBus. */
export function createBusPublisher(bus: EventBus): AsyncInterceptor {
  return async (ctx) => {
    const event = await ctx.recorded;
    if (event) bus.publish(event);
  };
}

export type RecordingOptions = {
  bus?: EventBus;
  writer?: BatchWriter<PendingRow, string>;
  writerOptions?: BatchWriterOptions;
};

export type Recording = {
  validator: AsyncInterceptor;
  recorder: AsyncInterceptor;
  busPublisher: AsyncInterceptor;
  writer: BatchWriter<PendingRow, string>;
  bus: EventBus;
  flush: () => Promise<void>;
  close: () => Promise<void>;
};

/** Validator → recorder → busPublisher chain plus its writer and bus. */
export function createRecording(db: RecorderDb, options: RecordingOptions = {}): Recording {
  const bus = options.bus ?? new InProcessEventBus();
  const writer = options.writer ?? new BatchWriter(createDbSink(db), options.writerOptions);
  return {
    validator: createValidatorInterceptor(),
    recorder: createRecorder(writer),
    busPublisher: createBusPublisher(bus),
    writer,
    bus,
    flush: () => writer.flush(),
    close: () => writer.close(),
  };
}
