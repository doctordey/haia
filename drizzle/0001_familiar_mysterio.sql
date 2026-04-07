CREATE TABLE "offset_history" (
	"id" text PRIMARY KEY NOT NULL,
	"nq_offset" real NOT NULL,
	"es_offset" real NOT NULL,
	"nq_futures_price" real NOT NULL,
	"es_futures_price" real NOT NULL,
	"nas100_price" real NOT NULL,
	"us500_price" real NOT NULL,
	"nq_offset_sma" real,
	"es_offset_sma" real,
	"tradingview_timestamp" text,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_id" text NOT NULL,
	"account_id" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"nq_symbol" text DEFAULT 'NAS100' NOT NULL,
	"es_symbol" text DEFAULT 'US500' NOT NULL,
	"nq_small_lots" real DEFAULT 0.01 NOT NULL,
	"nq_medium_lots" real DEFAULT 0.05 NOT NULL,
	"nq_large_lots" real DEFAULT 0.1 NOT NULL,
	"es_small_lots" real DEFAULT 0.01 NOT NULL,
	"es_medium_lots" real DEFAULT 0.05 NOT NULL,
	"es_large_lots" real DEFAULT 0.1 NOT NULL,
	"offset_mode" text DEFAULT 'webhook' NOT NULL,
	"nq_fixed_offset" real DEFAULT 198 NOT NULL,
	"es_fixed_offset" real DEFAULT 40 NOT NULL,
	"nq_max_offset" real DEFAULT 400 NOT NULL,
	"nq_min_offset" real DEFAULT 50 NOT NULL,
	"es_max_offset" real DEFAULT 150 NOT NULL,
	"es_min_offset" real DEFAULT 10 NOT NULL,
	"sizing_mode" text DEFAULT 'strict' NOT NULL,
	"execution_mode" text DEFAULT 'single' NOT NULL,
	"base_risk_percent" real DEFAULT 1 NOT NULL,
	"max_risk_percent" real DEFAULT 5 NOT NULL,
	"min_stop_distance" real DEFAULT 10 NOT NULL,
	"max_lot_size" real DEFAULT 0.1 NOT NULL,
	"small_multiplier" real DEFAULT 0.5 NOT NULL,
	"medium_multiplier" real DEFAULT 1 NOT NULL,
	"large_multiplier" real DEFAULT 1.5 NOT NULL,
	"max_lots_per_order" real DEFAULT 50 NOT NULL,
	"market_order_threshold" real DEFAULT 5 NOT NULL,
	"max_slippage" real DEFAULT 5 NOT NULL,
	"margin_warning_threshold" real DEFAULT 80 NOT NULL,
	"margin_reject_threshold" real DEFAULT 95 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"config_id" text NOT NULL,
	"account_id" text NOT NULL,
	"trade_number" integer,
	"split_index" integer,
	"linked_execution_id" text,
	"chunk_index" integer,
	"total_chunks" integer,
	"instrument" text NOT NULL,
	"fusion_symbol" text NOT NULL,
	"direction" text NOT NULL,
	"signal_entry" real NOT NULL,
	"signal_sl" real NOT NULL,
	"signal_tp1" real NOT NULL,
	"signal_tp2" real NOT NULL,
	"signal_size" text NOT NULL,
	"lot_size" real NOT NULL,
	"futures_price_at_exec" real,
	"fusion_price_at_exec" real,
	"offset_applied" real,
	"offset_is_stale" boolean DEFAULT false NOT NULL,
	"adjusted_entry" real,
	"adjusted_sl" real,
	"adjusted_tp1" real,
	"adjusted_tp2" real,
	"order_type" text,
	"order_reason" text,
	"status" text NOT NULL,
	"metaapi_order_id" text,
	"fill_price" real,
	"slippage" real,
	"error_message" text,
	"signal_received_at" timestamp,
	"order_sent_at" timestamp,
	"order_filled_at" timestamp,
	"total_latency_ms" integer,
	"breakeven_moved_at" timestamp,
	"is_dry_run" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"telegram_channel_id" text,
	"telegram_channel_name" text,
	"price_feed" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"telegram_message_id" integer,
	"raw_message" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"message_type" text NOT NULL,
	"parsed" boolean DEFAULT false NOT NULL,
	"signal_count" integer DEFAULT 0 NOT NULL,
	"warning" text,
	"parse_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_journal" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trade_id" text,
	"signal_execution_id" text,
	"setup_type" text,
	"reasoning" text,
	"review" text,
	"emotional_state" text,
	"rating" integer,
	"tags" text,
	"screenshot_urls" text,
	"symbol" text,
	"direction" text,
	"pnl" real,
	"pnl_pips" real,
	"entry_time" timestamp,
	"exit_time" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_by" text,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_role_uniq" UNIQUE("user_id","role")
);
--> statement-breakpoint
ALTER TABLE "signal_configs" ADD CONSTRAINT "signal_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_configs" ADD CONSTRAINT "signal_configs_source_id_signal_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."signal_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_configs" ADD CONSTRAINT "signal_configs_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_executions" ADD CONSTRAINT "signal_executions_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_executions" ADD CONSTRAINT "signal_executions_config_id_signal_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."signal_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_executions" ADD CONSTRAINT "signal_executions_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_sources" ADD CONSTRAINT "signal_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_source_id_signal_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."signal_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_journal" ADD CONSTRAINT "trade_journal_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_journal" ADD CONSTRAINT "trade_journal_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_journal" ADD CONSTRAINT "trade_journal_signal_execution_id_signal_executions_id_fk" FOREIGN KEY ("signal_execution_id") REFERENCES "public"."signal_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offset_history_received_at_idx" ON "offset_history" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "signal_executions_signal_id_idx" ON "signal_executions" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "signal_executions_account_id_idx" ON "signal_executions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "signal_executions_status_idx" ON "signal_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "signal_executions_instrument_idx" ON "signal_executions" USING btree ("instrument");--> statement-breakpoint
CREATE INDEX "signals_source_id_idx" ON "signals" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "signals_received_at_idx" ON "signals" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "trade_journal_user_id_idx" ON "trade_journal" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trade_journal_setup_type_idx" ON "trade_journal" USING btree ("setup_type");