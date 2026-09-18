import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseFrame } from '@chargemesh/ocpp';
import { chargers, connections, ocppMessages, upstreams, chargerUpstreams } from '@chargemesh/db';
import { createTestDb } from '../../../../packages/db/test/createTestDb.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { frameContext } from '../../test/helpers.js';
import type { OcppEvent } from './eventBuilder.js';
import { BatchWriter } from './batchWriter.js';
import { InProcessEventBus } from './eventBus.js';
import { createBusPublisher, createDbSink, createRecorder, createRecording } from './recorder.js';
import { createValidatorInterceptor } from './validator.js';
import { ConnectionTracker } from './connections.js';

let database: Awaited<ReturnType<typeof createTestDb>>;
let chargerId = '';
let upstreamId = '';

beforeAll(async () => {
  database = await createTestDb();
  const [charger] = await database.db
    .insert(chargers)
    .values({ identity: 'SIM001', ocppVersion: '1.6', authMode: 'passthrough' })
    .returning();
  const [upstream] = await database.db
    .insert(upstreams)
    .values({ name: 'Primary', url: 'ws://localhost:9000', ocppVersion: '1.6' })
    .returning();
  chargerId = charger!.id;
  upstreamId = upstream!.id;
  await database.db.insert(chargerUpstreams).values({ chargerId, upstreamId, role: 'primary' });
});
afterAll(async () => {
  await database.close();
});

function toOcppEvent(row: typeof ocppMessages.$inferSelect): OcppEvent {
  return {
    id: row.id.toString(),
    chargerIdentity: 'SIM001',
    connectionId: row.connectionId,
    ts: row.ts.toISOString(),
    source: row.source,
    upstreamId: row.upstreamId,
    upstreamRole: row.upstreamRole,
    msgType: row.msgType as 2 | 3 | 4 | null,
    uniqueId: row.uniqueId,
    action: row.action,
    payload: row.payload,
    valid: row.valid,
    errors: row.errors,
    delivery: row.delivery,
    latencyMs: row.latencyMs,
  };
}

it('writes rows that round-trip into the OcppEvent shape', async () => {
  const bus = new InProcessEventBus();
  const seen: OcppEvent[] = [];
  bus.subscribe({}, (event) => {
    seen.push(event);
  });
  const writer = new BatchWriter(createDbSink(database.db), { flushIntervalMs: 60_000 });
  const pipeline = new Pipeline(
    [],
    [createValidatorInterceptor(), createRecorder(writer), createBusPublisher(bus)],
  );
  try {
    const call = frameContext();
    call.chargerId = chargerId;
    call.raw = '[2, "call-1", "Heartbeat", {}]';
    pipeline.run(call, parseFrame(call.raw));

    const result = frameContext();
    result.chargerId = chargerId;
    result.source = 'upstream';
    result.upstreamId = upstreamId;
    result.upstreamRole = 'primary';
    result.action = 'Heartbeat';
    result.latencyMs = 12;
    result.raw = '[3, "call-1", {"currentTime":"2026-01-01T00:00:00Z"}]';
    pipeline.run(result, parseFrame(result.raw));

    const malformed = frameContext();
    malformed.chargerId = chargerId;
    malformed.raw = 'not ocpp';
    malformed.action = null;
    pipeline.run(malformed, parseFrame(malformed.raw));

    await writer.flush();
    await pipeline.flush();

    const rows = await database.db.select().from(ocppMessages);
    expect(rows).toHaveLength(3);
    const events = rows.map(toOcppEvent);
    // Every row maps back into the canonical envelope, including the DB id.
    for (const event of events) {
      expect(typeof event.id).toBe('string');
      expect(event.chargerIdentity).toBe('SIM001');
    }
    const callRows = events
      .filter((event) => event.uniqueId === 'call-1')
      .sort((a, b) => (a.msgType ?? 0) - (b.msgType ?? 0));
    const [callEvent, resultEvent] = callRows;
    const malformedEvent = events.find((event) => event.uniqueId === null);
    expect(callEvent).toMatchObject({
      msgType: 2,
      uniqueId: 'call-1',
      action: 'Heartbeat',
      valid: true,
    });
    expect(resultEvent).toMatchObject({
      msgType: 3,
      uniqueId: 'call-1',
      action: 'Heartbeat',
      latencyMs: 12,
      valid: true,
    });
    expect(malformedEvent).toMatchObject({
      msgType: null,
      uniqueId: null,
      action: null,
      valid: false,
    });
    const malformedRow = rows.find((row) => row.msgType === null);
    expect(malformedRow?.raw).toBe('not ocpp');

    // The bus published each event only after its DB id was assigned.
    expect(seen).toHaveLength(3);
    expect(new Set(seen.map((event) => event.id)).size).toBe(3);
    expect(seen.map((event) => event.id).sort()).toEqual(events.map((event) => event.id).sort());

    const charger = await database.db.select().from(chargers).where(eq(chargers.id, chargerId));
    expect(charger[0]?.lastSeenAt).not.toBeNull();
  } finally {
    await writer.close();
  }
});

it('createRecording wires validator, recorder and busPublisher end to end', async () => {
  const recording = createRecording(database.db, { writerOptions: { flushIntervalMs: 60_000 } });
  const seen: OcppEvent[] = [];
  recording.bus.subscribe({ action: 'Heartbeat' }, (event) => {
    seen.push(event);
  });
  const pipeline = new Pipeline(
    [],
    [recording.validator, recording.recorder, recording.busPublisher],
  );
  try {
    const ctx = frameContext();
    ctx.chargerId = chargerId;
    ctx.raw = '[2, "wired-1", "Heartbeat", {}]';
    pipeline.run(ctx, parseFrame(ctx.raw));
    await recording.flush();
    await pipeline.flush();
    const rows = await database.db.select().from(ocppMessages);
    expect(rows.some((row) => row.uniqueId === 'wired-1' && row.valid)).toBe(true);
    expect(seen.map((event) => event.uniqueId)).toContain('wired-1');
    expect(seen[0]?.id).toMatch(/^\d+$/);
  } finally {
    await recording.close();
  }
});

it('writes connection open/close rows for both legs and tracks charger presence', async () => {
  const tracker = new ConnectionTracker(database.db);
  await tracker.opened({
    id: '01J0000000000000000000001',
    chargerId,
    kind: 'charger',
    subprotocol: 'ocpp1.6',
  });
  await tracker.opened({
    id: '01J0000000000000000000002',
    chargerId,
    kind: 'upstream',
    upstreamId,
    subprotocol: 'ocpp1.6',
  });
  let charger = (await database.db.select().from(chargers).where(eq(chargers.id, chargerId)))[0];
  expect(charger?.connected).toBe(true);
  expect(charger?.lastSeenAt).not.toBeNull();

  await tracker.closed('01J0000000000000000000002', chargerId, 'upstream', {
    closeCode: 1000,
    closeReason: 'done',
  });
  await tracker.closed('01J0000000000000000000001', chargerId, 'charger', {
    closeCode: 1000,
    closeReason: 'done',
  });
  const rows = await database.db.select().from(connections);
  expect(rows.filter((row) => row.chargerId === chargerId)).toHaveLength(2);
  for (const row of rows) expect(row.closedAt).not.toBeNull();
  charger = (await database.db.select().from(chargers).where(eq(chargers.id, chargerId)))[0];
  expect(charger?.connected).toBe(false);
});
