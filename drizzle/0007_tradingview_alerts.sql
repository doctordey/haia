CREATE TABLE "tv_alert_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"tv_symbol" text NOT NULL,
	"fusion_symbol" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"risk_percent" real DEFAULT 5 NOT NULL,
	"reward_risk_ratio" real DEFAULT 2 NOT NULL,
	"sl_pip_offset" real DEFAULT 2 NOT NULL,
	"pip_size" real DEFAULT 0.01 NOT NULL,
	"pip_value_per_lot" real DEFAULT 0.1 NOT NULL,
	"sizing_mode" text DEFAULT 'percent_equity' NOT NULL,
	"strict_lots" real DEFAULT 0.01 NOT NULL,
	"min_lot_size" real DEFAULT 0.01 NOT NULL,
	"lot_step" real DEFAULT 0.01 NOT NULL,
	"max_lot_size" real DEFAULT 100 NOT NULL,
	"max_lots_per_order" real DEFAULT 50 NOT NULL,
	"min_stop_distance_pips" real DEFAULT 5 NOT NULL,
	"max_risk_percent" real DEFAULT 10 NOT NULL,
	"max_slippage" real DEFAULT 5 NOT NULL,
	"margin_warning_threshold" real DEFAULT 80 NOT NULL,
	"margin_reject_threshold" real DEFAULT 95 NOT NULL,
	"max_offset_abs" real DEFAULT 10 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tv_alert_configs_user_account_symbol_uniq" UNIQUE("user_id","account_id","tv_symbol")
);
--> statement-breakpoint
CREATE TABLE "tv_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text,
	"account_id" text,
	"raw_payload" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"tv_symbol" text NOT NULL,
	"fusion_symbol" text,
	"direction" text NOT NULL,
	"tv_price" real,
	"fusion_price" real,
	"offset_applied" real,
	"prev_candle_high" real,
	"prev_candle_low" real,
	"prev_candle_high_adjusted" real,
	"prev_candle_low_adjusted" real,
	"entry_price" real,
	"stop_loss" real,
	"take_profit" real,
	"lot_size" real,
	"risk_amount" real,
	"reward_risk_ratio" real,
	"compute_reason" text,
	"status" text NOT NULL,
	"metaapi_order_id" text,
	"error_message" text,
	"order_sent_at" timestamp,
	"total_latency_ms" integer,
	"is_dry_run" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD CONSTRAINT "tv_alert_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD CONSTRAINT "tv_alert_configs_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_alerts" ADD CONSTRAINT "tv_alerts_config_id_tv_alert_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."tv_alert_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_alerts" ADD CONSTRAINT "tv_alerts_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tv_alert_configs_user_id_idx" ON "tv_alert_configs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tv_alert_configs_account_id_idx" ON "tv_alert_configs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "tv_alert_configs_tv_symbol_idx" ON "tv_alert_configs" USING btree ("tv_symbol");--> statement-breakpoint
CREATE INDEX "tv_alerts_config_id_idx" ON "tv_alerts" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "tv_alerts_received_at_idx" ON "tv_alerts" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "tv_alerts_status_idx" ON "tv_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tv_alerts_tv_symbol_idx" ON "tv_alerts" USING btree ("tv_symbol");