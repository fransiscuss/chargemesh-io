CREATE TYPE "public"."alert_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."auth_mode" AS ENUM('passthrough', 'gateway');--> statement-breakpoint
CREATE TYPE "public"."auth_type" AS ENUM('none', 'basic');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('slack', 'webhook', 'email');--> statement-breakpoint
CREATE TYPE "public"."connection_kind" AS ENUM('charger', 'upstream');--> statement-breakpoint
CREATE TYPE "public"."message_source" AS ENUM('charger', 'upstream');--> statement-breakpoint
CREATE TYPE "public"."ocpp_version" AS ENUM('1.6', '2.0.1');--> statement-breakpoint
CREATE TYPE "public"."rule_type" AS ENUM('charger_offline', 'upstream_down', 'connector_faulted', 'boot_rejected', 'call_error', 'response_timeout', 'schema_invalid', 'unknown_charger', 'auth_rotation_seen', 'custom_match');--> statement-breakpoint
CREATE TYPE "public"."sink_type" AS ENUM('snowflake', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."upstream_role" AS ENUM('primary', 'mirror');--> statement-breakpoint
CREATE TABLE "alert_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "channel_type" NOT NULL,
	"enc_config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"charger_id" uuid,
	"upstream_id" uuid,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	"summary" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "rule_type" NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope" jsonb DEFAULT '"all"'::jsonb NOT NULL,
	"channel_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"cooldown_s" integer DEFAULT 300 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "alert_rules_cooldown_check" CHECK ("alert_rules"."cooldown_s" >= 0)
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"sha256_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_sha256_hash_unique" UNIQUE("sha256_hash")
);
--> statement-breakpoint
CREATE TABLE "charger_upstreams" (
	"charger_id" uuid NOT NULL,
	"upstream_id" uuid NOT NULL,
	"role" "upstream_role" NOT NULL,
	"identity_override" text,
	"enc_password" text,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "charger_upstreams_charger_id_upstream_id_pk" PRIMARY KEY("charger_id","upstream_id")
);
--> statement-breakpoint
CREATE TABLE "chargers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity" text NOT NULL,
	"ocpp_version" "ocpp_version" NOT NULL,
	"auth_mode" "auth_mode" DEFAULT 'passthrough' NOT NULL,
	"password_hash" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"connected" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chargers_identity_unique" UNIQUE("identity")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"charger_id" uuid NOT NULL,
	"kind" "connection_kind" NOT NULL,
	"upstream_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"close_code" integer,
	"close_reason" text,
	"remote_ip" text,
	"subprotocol" text
);
--> statement-breakpoint
CREATE TABLE "ocpp_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"charger_id" uuid NOT NULL,
	"connection_id" varchar(26) NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "message_source" NOT NULL,
	"upstream_id" uuid,
	"upstream_role" "upstream_role",
	"msg_type" integer,
	"unique_id" text,
	"action" text,
	"payload" jsonb,
	"raw" text NOT NULL,
	"delivery" jsonb NOT NULL,
	"valid" boolean NOT NULL,
	"errors" jsonb,
	"latency_ms" integer,
	CONSTRAINT "ocpp_messages_msg_type_check" CHECK ("ocpp_messages"."msg_type" in (2, 3, 4))
);
--> statement-breakpoint
CREATE TABLE "sink_cursors" (
	"sink_id" uuid PRIMARY KEY NOT NULL,
	"last_message_id" bigint DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_rows" integer,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "sinks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "sink_type" NOT NULL,
	"enc_config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tx_id_map" (
	"charger_id" uuid NOT NULL,
	"upstream_id" uuid NOT NULL,
	"primary_tx_id" integer NOT NULL,
	"mirror_tx_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tx_id_map_charger_id_upstream_id_primary_tx_id_pk" PRIMARY KEY("charger_id","upstream_id","primary_tx_id")
);
--> statement-breakpoint
CREATE TABLE "upstreams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"ocpp_version" "ocpp_version" NOT NULL,
	"auth_type" "auth_type" DEFAULT 'none' NOT NULL,
	"enc_secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_upstream_id_upstreams_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."upstreams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charger_upstreams" ADD CONSTRAINT "charger_upstreams_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charger_upstreams" ADD CONSTRAINT "charger_upstreams_upstream_id_upstreams_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."upstreams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_upstream_id_upstreams_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."upstreams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocpp_messages" ADD CONSTRAINT "ocpp_messages_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocpp_messages" ADD CONSTRAINT "ocpp_messages_upstream_id_upstreams_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."upstreams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sink_cursors" ADD CONSTRAINT "sink_cursors_sink_id_sinks_id_fk" FOREIGN KEY ("sink_id") REFERENCES "public"."sinks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_id_map" ADD CONSTRAINT "tx_id_map_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_id_map" ADD CONSTRAINT "tx_id_map_upstream_id_upstreams_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."upstreams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "charger_upstreams_one_primary" ON "charger_upstreams" USING btree ("charger_id") WHERE "charger_upstreams"."role" = 'primary';--> statement-breakpoint
CREATE INDEX "ocpp_messages_charger_ts_idx" ON "ocpp_messages" USING btree ("charger_id","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ocpp_messages_ts_idx" ON "ocpp_messages" USING btree ("ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ocpp_messages_action_ts_idx" ON "ocpp_messages" USING btree ("action","ts" DESC NULLS LAST);