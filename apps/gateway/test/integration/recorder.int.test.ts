import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { MockCsms, SimCharger, runScenario } from '@chargemesh/sim';
import { chargers, chargerUpstreams, connections, ocppMessages, upstreams } from '@chargemesh/db';
import { createTestDb } from '../../../../packages/db/test/createTestDb.js';
import { createGateway } from '../../src/server.js';
import { DbConfigStore } from '../../src/config/store.js';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { BatchWriter } from '../../src/recorder/batchWriter.js';
import { InProcessEventBus } from '../../src/recorder/eventBus.js';
import type { OcppEvent } from '../../src/recorder/eventBuilder.js';
import { createBusPublisher, createDbSink, createRecorder } from '../../src/recorder/recorder.js';
import type { PendingRow } from '../../src/recorder/recorder.js';
import { createValidatorInterceptor } from '../../src/recorder/validator.js';
import { ConnectionTracker } from '../../src/recorder/connections.js';

let mock: MockCsms;
let gateway: ReturnType<typeof createGateway>;
let writer: BatchWriter<PendingRow, string> | undefined;
let database: Awaited<ReturnType<typeof createTestDb>>;
let url: string;
const chargersConnected: SimCharger[] = [];
const busEvents: OcppEvent[] = [];

beforeEach(async () => {
  database = await createTestDb();
  mock = await MockCsms.start();
  const [charger] = await database.db
    .insert(chargers)
    .values({ identity: 'SIM001', ocppVersion: '1.6', authMode: 'passthrough' })
    .returning();
  const [upstream] = await database.db
    .insert(upstreams)
    .values({ name: 'Primary', url: mock.url, ocppVersion: '1.6' })
    .returning();
  await database.db
    .insert(chargerUpstreams)
    .values({ chargerId: charger!.id, upstreamId: upstream!.id, role: 'primary' });

  const bus = new InProcessEventBus();
  bus.subscribe({}, (event) => {
    busEvents.push(event);
  });
  // Cast through the concrete pending-row type after construction.
  const pending = new BatchWriter<PendingRow, string>(createDbSink(database.db), {
    flushIntervalMs: 60_000,
  });
  writer = pending;
  const recording = {
    writer: pending,
    bus,
  };
  const pipeline = new Pipeline(
    [],
    [
      createValidatorInterceptor(),
      createRecorder(recording.writer),
      createBusPublisher(recording.bus),
    ],
    { error: () => undefined },
  );
  gateway = createGateway({
    store: new DbConfigStore(database.db, 'test-key'),
    allowInsecureWs: true,
    logLevel: 'silent',
    upstreamTimeoutMs: 2000,
    pipeline,
    recorder: { flush: () => pending.flush() },
    connections: new ConnectionTracker(database.db),
  });
  url = await gateway.listen(0, '127.0.0.1');
});
afterEach(async () => {
  busEvents.splice(0);
  for (const charger of chargersConnected.splice(0)) await charger.close();
  await gateway.close();
  await writer?.close();
  writer = undefined;
  await mock.close();
  await database.close();
});

it('records every frame of a full session exactly once with actions and latency', async () => {
  const charger = await SimCharger.connect({ url, id: 'SIM001', version: '1.6' });
  chargersConnected.push(charger);
  await runScenario(charger, '1.6', 'full-session');

  // Mid-session presence: charger leg + upstream leg open, charger marked connected.
  await vi.waitFor(async () => {
    const rows = await database.db.select().from(connections);
    expect(rows).toHaveLength(2);
  });
  const live = await database.db.select().from(chargers);
  expect(live[0]?.connected).toBe(true);

  await charger.close();
  await gateway.close();

  const rows = await database.db.select().from(ocppMessages);
  // One row per frame received on either leg: every charger CALL plus every CSMS response.
  expect(rows).toHaveLength(mock.frames.length);
  expect(rows).toHaveLength(16);
  const recordedRaws = rows.map((row) => row.raw).sort();
  expect(recordedRaws).toEqual(mock.frames.map((frame) => frame.raw).sort());

  for (const row of rows) {
    expect(row.valid).toBe(true);
    if (row.msgType === 2) {
      expect(row.action).not.toBeNull();
      expect(row.latencyMs).toBeNull();
    } else {
      // Each response row carries its correlated action and round-trip latency.
      expect(row.msgType).toBe(3);
      expect(row.action).not.toBeNull();
      expect(row.latencyMs).not.toBeNull();
      expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    }
  }

  // The bus published every event after its DB id was assigned.
  expect(busEvents).toHaveLength(rows.length);
  expect(busEvents.map((event) => event.id).sort()).toEqual(
    rows.map((row) => row.id.toString()).sort(),
  );

  // Both legs closed and the charger marked disconnected.
  await vi.waitFor(async () => {
    const closed = await database.db.select().from(connections);
    expect(closed.every((row) => row.closedAt !== null)).toBe(true);
  });
  const stored = await database.db.select().from(chargers).where(eq(chargers.identity, 'SIM001'));
  expect(stored[0]?.connected).toBe(false);
  expect(stored[0]?.lastSeenAt).not.toBeNull();
});
