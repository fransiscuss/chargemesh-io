import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '../test/createTestDb.js';
import {
  chargers,
  upstreams,
  chargerUpstreams,
  ocppMessages,
  connections,
  alertRules,
  alertEvents,
  sinks,
  sinkCursors,
} from './schema.js';

describe('production migrations in PGlite', () => {
  let database: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    database = await createTestDb();
    await database.db.insert(chargers).values({ identity: 'SIM001', ocppVersion: '1.6' });
  });
  afterAll(async () => {
    await database?.close();
  });

  it('creates all 12 tables and can be applied a second time', async () => {
    const result = await database.client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    expect(result.rows.map((row) => row.tablename).sort()).toEqual(
      [
        'upstreams',
        'chargers',
        'charger_upstreams',
        'connections',
        'ocpp_messages',
        'tx_id_map',
        'alert_rules',
        'alert_channels',
        'alert_events',
        'sinks',
        'sink_cursors',
        'api_keys',
      ].sort(),
    );
    await expect(
      migrate(database.db, {
        migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
      }),
    ).resolves.toBeUndefined();
  });

  it('allows two mirrors but rejects a second primary even if disabled', async () => {
    const [charger] = await database.db
      .insert(chargers)
      .values({ identity: 'PRIMARY-TEST', ocppVersion: '1.6' })
      .returning();
    const endpoints = await database.db
      .insert(upstreams)
      .values(
        ['primary', 'mirror-a', 'mirror-b', 'other-primary'].map((name) => ({
          name,
          url: 'ws://localhost:9000',
          ocppVersion: '1.6' as const,
        })),
      )
      .returning();
    await database.db.insert(chargerUpstreams).values(
      endpoints.slice(0, 3).map((endpoint, i) => ({
        chargerId: charger!.id,
        upstreamId: endpoint.id,
        role: i === 0 ? ('primary' as const) : ('mirror' as const),
      })),
    );
    await expect(
      database.db.insert(chargerUpstreams).values({
        chargerId: charger!.id,
        upstreamId: endpoints[3]!.id,
        role: 'primary',
        enabled: false,
      }),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'charger_upstreams_one_primary' },
    });
    expect(await database.db.select().from(chargerUpstreams)).toHaveLength(3);
  });

  it('enforces unique charger identities and foreign keys', async () => {
    await expect(
      database.db.insert(chargers).values({ identity: 'SIM001', ocppVersion: '2.0.1' }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(
      database.db.insert(chargerUpstreams).values({
        chargerId: '00000000-0000-0000-0000-000000000000',
        upstreamId: '00000000-0000-0000-0000-000000000000',
        role: 'mirror',
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('preserves large message IDs, malformed frames, and connection identifiers after retention', async () => {
    const [charger] = await database.db.select().from(chargers);
    const connectionId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    await database.db
      .insert(connections)
      .values({ id: connectionId, chargerId: charger!.id, kind: 'charger' });
    const [message] = await database.db
      .insert(ocppMessages)
      .values({
        id: 9007199254740993n,
        chargerId: charger!.id,
        connectionId,
        source: 'charger',
        raw: 'not-json',
        valid: false,
        errors: [{ code: 'invalid_json' }],
        delivery: { forwardedTo: ['primary'] },
      })
      .returning();
    expect(message!.id.toString()).toBe('9007199254740993');
    expect(message!.msgType).toBeNull();
    await database.db.delete(connections);
    expect((await database.db.select().from(ocppMessages))[0]!.connectionId).toBe(connectionId);
  });

  it('supports unknown charger alerts and bigint sink cursors', async () => {
    const [rule] = await database.db
      .insert(alertRules)
      .values({ name: 'Unknown charger', type: 'unknown_charger' })
      .returning();
    expect(rule!.scope).toBe('all');
    const [event] = await database.db
      .insert(alertEvents)
      .values({ ruleId: rule!.id, summary: 'Unknown identity' })
      .returning();
    expect(event!.chargerId).toBeNull();
    const [sink] = await database.db
      .insert(sinks)
      .values({ type: 'webhook', encConfig: 'v1:encrypted' })
      .returning();
    const [cursor] = await database.db
      .insert(sinkCursors)
      .values({ sinkId: sink!.id, lastMessageId: 9007199254740993n })
      .returning();
    expect(cursor!.lastMessageId).toBe(9007199254740993n);
  });

  it('creates the three descending traffic indexes', async () => {
    const result = await database.db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = 'ocpp_messages' and indexname <> 'ocpp_messages_pkey'`,
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((row) => row.indexdef.includes('ts DESC'))).toBe(true);
  });
});
