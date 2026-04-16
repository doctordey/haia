-- Trading accounts: make metaApiId nullable, add Tradovate columns
ALTER TABLE "trading_accounts" ALTER COLUMN "meta_api_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_accounts" ALTER COLUMN "server" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_accounts" ALTER COLUMN "login" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "tradovate_account_id" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "tradovate_username" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "tradovate_password" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "tradovate_api_key" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "tradovate_api_secret" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "tradovate_environment" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "tradovate_cid" integer;--> statement-breakpoint

-- Copy Groups
CREATE TABLE IF NOT EXISTS "copy_groups" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "master_account_id" text NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
  "is_enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_groups_user_id_idx" ON "copy_groups" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_groups_master_account_id_idx" ON "copy_groups" ("master_account_id");--> statement-breakpoint

-- Copy Slaves
CREATE TABLE IF NOT EXISTS "copy_slaves" (
  "id" text PRIMARY KEY NOT NULL,
  "group_id" text NOT NULL REFERENCES "copy_groups"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
  "is_enabled" boolean NOT NULL DEFAULT false,
  "dry_run" boolean NOT NULL DEFAULT true,
  "sizing_mode" text NOT NULL DEFAULT 'fixed_multiplier',
  "multiplier" real NOT NULL DEFAULT 1.0,
  "risk_percent" real NOT NULL DEFAULT 1.0,
  "risk_base" text NOT NULL DEFAULT 'balance',
  "max_risk_percent" real NOT NULL DEFAULT 5.0,
  "fixed_lots" real NOT NULL DEFAULT 0.01,
  "max_lot_size" real NOT NULL DEFAULT 10.0,
  "max_lots_per_order" real NOT NULL DEFAULT 50,
  "max_slippage" real NOT NULL DEFAULT 5.0,
  "margin_warning_pct" real NOT NULL DEFAULT 80,
  "margin_reject_pct" real NOT NULL DEFAULT 95,
  "direction_filter" text,
  "max_open_positions" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "copy_slaves_group_account_uniq" ON "copy_slaves" ("group_id", "account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_slaves_group_id_idx" ON "copy_slaves" ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_slaves_account_id_idx" ON "copy_slaves" ("account_id");--> statement-breakpoint

-- Copy Symbol Maps
CREATE TABLE IF NOT EXISTS "copy_symbol_maps" (
  "id" text PRIMARY KEY NOT NULL,
  "slave_id" text NOT NULL REFERENCES "copy_slaves"("id") ON DELETE CASCADE,
  "master_symbol" text NOT NULL,
  "slave_symbol" text NOT NULL,
  "sizing_mode" text,
  "multiplier" real,
  "risk_percent" real,
  "fixed_lots" real,
  "pip_value_per_lot" real NOT NULL DEFAULT 1.0,
  "min_lot_size" real NOT NULL DEFAULT 0.01,
  "lot_step" real NOT NULL DEFAULT 0.01,
  "copy_sl" boolean NOT NULL DEFAULT true,
  "copy_tp" boolean NOT NULL DEFAULT true,
  "apply_offset" boolean NOT NULL DEFAULT false,
  "offset_instrument" text,
  "is_enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "copy_symbol_maps_slave_master_uniq" ON "copy_symbol_maps" ("slave_id", "master_symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_symbol_maps_slave_id_idx" ON "copy_symbol_maps" ("slave_id");--> statement-breakpoint

-- Copy Positions
CREATE TABLE IF NOT EXISTS "copy_positions" (
  "id" text PRIMARY KEY NOT NULL,
  "group_id" text NOT NULL REFERENCES "copy_groups"("id") ON DELETE CASCADE,
  "slave_id" text NOT NULL REFERENCES "copy_slaves"("id") ON DELETE CASCADE,
  "symbol_map_id" text REFERENCES "copy_symbol_maps"("id") ON DELETE SET NULL,
  "master_account_id" text NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
  "master_position_id" text NOT NULL,
  "master_symbol" text NOT NULL,
  "master_direction" text NOT NULL,
  "master_lots" real NOT NULL,
  "master_entry_price" real NOT NULL,
  "master_sl" real,
  "master_tp" real,
  "slave_account_id" text NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
  "slave_position_id" text,
  "slave_symbol" text NOT NULL,
  "slave_direction" text NOT NULL,
  "slave_lots" real NOT NULL,
  "slave_entry_price" real,
  "slave_sl" real,
  "slave_tp" real,
  "sizing_mode" text NOT NULL,
  "sizing_detail" text,
  "status" text NOT NULL DEFAULT 'pending',
  "error_message" text,
  "master_close_price" real,
  "slave_close_price" real,
  "slave_profit" real,
  "master_opened_at" timestamp NOT NULL,
  "slave_opened_at" timestamp,
  "master_closed_at" timestamp,
  "slave_closed_at" timestamp,
  "open_latency_ms" integer,
  "close_latency_ms" integer,
  "is_dry_run" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_positions_group_id_idx" ON "copy_positions" ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_positions_slave_id_idx" ON "copy_positions" ("slave_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_positions_master_pos_idx" ON "copy_positions" ("master_account_id", "master_position_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_positions_slave_pos_idx" ON "copy_positions" ("slave_account_id", "slave_position_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_positions_status_idx" ON "copy_positions" ("status");--> statement-breakpoint

-- Copy Events
CREATE TABLE IF NOT EXISTS "copy_events" (
  "id" text PRIMARY KEY NOT NULL,
  "group_id" text NOT NULL REFERENCES "copy_groups"("id") ON DELETE CASCADE,
  "copy_position_id" text REFERENCES "copy_positions"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "master_account_id" text REFERENCES "trading_accounts"("id"),
  "slave_account_id" text REFERENCES "trading_accounts"("id"),
  "payload" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_events_group_id_idx" ON "copy_events" ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_events_copy_position_id_idx" ON "copy_events" ("copy_position_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_events_event_type_idx" ON "copy_events" ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_events_created_at_idx" ON "copy_events" ("created_at");
