CREATE TABLE "account_balance_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"balance" real NOT NULL,
	"equity" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_balance_snapshots_account_date_uniq" UNIQUE("account_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "tv_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"account_id" text NOT NULL,
	"activation_alert_id" text,
	"tv_symbol" text NOT NULL,
	"fusion_symbol" text NOT NULL,
	"direction" text NOT NULL,
	"entry_price" real NOT NULL,
	"original_stop_loss" real NOT NULL,
	"r_distance" real NOT NULL,
	"initial_take_profit" real NOT NULL,
	"initial_lot_size" real NOT NULL,
	"risk_amount" real NOT NULL,
	"risk_multiplier_applied" real DEFAULT 1 NOT NULL,
	"metaapi_position_ids" text NOT NULL,
	"current_stop_loss" real NOT NULL,
	"remaining_lots" real NOT NULL,
	"hit_1r" boolean DEFAULT false NOT NULL,
	"hit_2r" boolean DEFAULT false NOT NULL,
	"hit_5r" boolean DEFAULT false NOT NULL,
	"moved_to_breakeven" boolean DEFAULT false NOT NULL,
	"partial_closed_at" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"close_reason" text,
	"closed_at" timestamp,
	"r_gain_achieved" real,
	"pnl_amount" real,
	"pct_gain" real,
	"account_balance_at_open" real,
	"is_dry_run" boolean DEFAULT false NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ALTER COLUMN "risk_percent" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "tp_r_multiple" real DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "be_at_r_multiple" real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "partial_close_at_r_multiple" real DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "partial_close_percent" real DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "close_at_r_multiple" real DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "spillover_mode" text DEFAULT 'cap' NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "invalidation_close_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "watermark_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "watermark_drawdown_threshold" real DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "watermark_risk_reduction_percent" real DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "market_close_timezone" text DEFAULT 'America/Los_Angeles' NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "market_close_hour" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "market_close_minute" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alerts" ADD COLUMN "alert_type" text DEFAULT 'activation' NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alerts" ADD COLUMN "r_level" real;--> statement-breakpoint
ALTER TABLE "tv_alerts" ADD COLUMN "breaker_high" real;--> statement-breakpoint
ALTER TABLE "tv_alerts" ADD COLUMN "breaker_low" real;--> statement-breakpoint
ALTER TABLE "tv_alerts" ADD COLUMN "breaker_high_adjusted" real;--> statement-breakpoint
ALTER TABLE "tv_alerts" ADD COLUMN "breaker_low_adjusted" real;--> statement-breakpoint
ALTER TABLE "tv_alerts" ADD COLUMN "risk_multiplier_applied" real;--> statement-breakpoint
ALTER TABLE "tv_alerts" ADD COLUMN "linked_position_id" text;--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_positions" ADD CONSTRAINT "tv_positions_config_id_tv_alert_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."tv_alert_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_positions" ADD CONSTRAINT "tv_positions_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_positions" ADD CONSTRAINT "tv_positions_activation_alert_id_tv_alerts_id_fk" FOREIGN KEY ("activation_alert_id") REFERENCES "public"."tv_alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_balance_snapshots_account_id_idx" ON "account_balance_snapshots" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_balance_snapshots_snapshot_date_idx" ON "account_balance_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "tv_positions_config_id_idx" ON "tv_positions" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "tv_positions_account_id_idx" ON "tv_positions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "tv_positions_status_idx" ON "tv_positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tv_positions_tv_symbol_idx" ON "tv_positions" USING btree ("tv_symbol");--> statement-breakpoint
CREATE INDEX "tv_positions_opened_at_idx" ON "tv_positions" USING btree ("opened_at");