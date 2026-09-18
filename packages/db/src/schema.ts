import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  integer,
  bigint,
  bigserial,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';

export const ocppVersion = pgEnum('ocpp_version', ['1.6', '2.0.1']);
export const authType = pgEnum('auth_type', ['none', 'basic']);
export const authMode = pgEnum('auth_mode', ['passthrough', 'gateway']);
export const upstreamRole = pgEnum('upstream_role', ['primary', 'mirror']);
export const connectionKind = pgEnum('connection_kind', ['charger', 'upstream']);
export const messageSource = pgEnum('message_source', ['charger', 'upstream']);
export const sinkType = pgEnum('sink_type', ['snowflake', 'webhook']);
export const channelType = pgEnum('channel_type', ['slack', 'webhook', 'email']);
export const alertStatus = pgEnum('alert_status', ['open', 'resolved']);
export const ruleType = pgEnum('rule_type', [
  'charger_offline',
  'upstream_down',
  'connector_faulted',
  'boot_rejected',
  'call_error',
  'response_timeout',
  'schema_invalid',
  'unknown_charger',
  'auth_rotation_seen',
  'custom_match',
]);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const id = () => uuid('id').defaultRandom().primaryKey();

export const upstreams = pgTable('upstreams', {
  id: id(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  ocppVersion: ocppVersion('ocpp_version').notNull(),
  authType: authType('auth_type').notNull().default('none'),
  encSecret: text('enc_secret'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
});

export const chargers = pgTable('chargers', {
  id: id(),
  identity: text('identity').notNull().unique(),
  ocppVersion: ocppVersion('ocpp_version').notNull(),
  authMode: authMode('auth_mode').notNull().default('passthrough'),
  passwordHash: text('password_hash'),
  enabled: boolean('enabled').notNull().default(true),
  notes: text('notes'),
  connected: boolean('connected').notNull().default(false),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const chargerUpstreams = pgTable(
  'charger_upstreams',
  {
    chargerId: uuid('charger_id')
      .notNull()
      .references(() => chargers.id),
    upstreamId: uuid('upstream_id')
      .notNull()
      .references(() => upstreams.id),
    role: upstreamRole('role').notNull(),
    identityOverride: text('identity_override'),
    encPassword: text('enc_password'),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.chargerId, table.upstreamId] }),
    uniqueIndex('charger_upstreams_one_primary')
      .on(table.chargerId)
      .where(sql`${table.role} = 'primary'`),
  ],
);

export const connections = pgTable('connections', {
  id: varchar('id', { length: 26 }).primaryKey(),
  chargerId: uuid('charger_id')
    .notNull()
    .references(() => chargers.id),
  kind: connectionKind('kind').notNull(),
  upstreamId: uuid('upstream_id').references(() => upstreams.id),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closeCode: integer('close_code'),
  closeReason: text('close_reason'),
  remoteIp: text('remote_ip'),
  subprotocol: text('subprotocol'),
});

export type Delivery = {
  forwardedTo: string[];
  dropped?: string;
  rejected?: string;
  rewritten?: boolean;
  unmappedTx?: boolean;
};

export const ocppMessages = pgTable(
  'ocpp_messages',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    chargerId: uuid('charger_id')
      .notNull()
      .references(() => chargers.id),
    // Keep the identifier after connection retention removes the connection row.
    connectionId: varchar('connection_id', { length: 26 }).notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    source: messageSource('source').notNull(),
    upstreamId: uuid('upstream_id').references(() => upstreams.id),
    upstreamRole: upstreamRole('upstream_role'),
    // Nullable so malformed traffic can also be recorded (F3/F4).
    msgType: integer('msg_type'),
    uniqueId: text('unique_id'),
    action: text('action'),
    payload: jsonb('payload').$type<unknown>(),
    raw: text('raw').notNull(),
    delivery: jsonb('delivery').$type<Delivery>().notNull(),
    valid: boolean('valid').notNull(),
    errors: jsonb('errors').$type<unknown[]>(),
    latencyMs: integer('latency_ms'),
  },
  (table) => [
    index('ocpp_messages_charger_ts_idx').on(table.chargerId, table.ts.desc()),
    index('ocpp_messages_ts_idx').on(table.ts.desc()),
    index('ocpp_messages_action_ts_idx').on(table.action, table.ts.desc()),
    check('ocpp_messages_msg_type_check', sql`${table.msgType} in (2, 3, 4)`),
  ],
);

export const txIdMap = pgTable(
  'tx_id_map',
  {
    chargerId: uuid('charger_id')
      .notNull()
      .references(() => chargers.id),
    upstreamId: uuid('upstream_id')
      .notNull()
      .references(() => upstreams.id),
    primaryTxId: integer('primary_tx_id').notNull(),
    mirrorTxId: integer('mirror_tx_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.chargerId, table.upstreamId, table.primaryTxId] })],
);

/** Store the versioned ciphertext as a JSON string, never plaintext configuration. */
export const alertChannels = pgTable('alert_channels', {
  id: id(),
  type: channelType('type').notNull(),
  encConfig: jsonb('enc_config').$type<string>().notNull(),
});

export const alertRules = pgTable(
  'alert_rules',
  {
    id: id(),
    name: text('name').notNull(),
    type: ruleType('type').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    scope: jsonb('scope')
      .$type<'all' | string[]>()
      .notNull()
      .default(sql`'"all"'::jsonb`),
    channelIds: uuid('channel_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    cooldownS: integer('cooldown_s').notNull().default(300),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [check('alert_rules_cooldown_check', sql`${table.cooldownS} >= 0`)],
);

export const alertEvents = pgTable('alert_events', {
  id: id(),
  ruleId: uuid('rule_id')
    .notNull()
    .references(() => alertRules.id),
  // unknown_charger alerts have no registered charger row.
  chargerId: uuid('charger_id').references(() => chargers.id),
  upstreamId: uuid('upstream_id').references(() => upstreams.id),
  status: alertStatus('status').notNull().default('open'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
  summary: text('summary').notNull(),
  context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
});

export const sinks = pgTable('sinks', {
  id: id(),
  type: sinkType('type').notNull(),
  encConfig: jsonb('enc_config').$type<string>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
});

export const sinkCursors = pgTable('sink_cursors', {
  sinkId: uuid('sink_id')
    .primaryKey()
    .references(() => sinks.id),
  lastMessageId: bigint('last_message_id', { mode: 'bigint' })
    .notNull()
    .default(sql`0`),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRows: integer('last_rows'),
  lastError: text('last_error'),
});

export const apiKeys = pgTable('api_keys', {
  id: id(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  sha256Hash: text('sha256_hash').notNull().unique(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
