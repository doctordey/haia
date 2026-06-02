ALTER TABLE "tv_alert_configs" ADD COLUMN "sl_anchor_mode" text DEFAULT 'swing' NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "swing_timeframe" text DEFAULT '5m' NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "swing_strength" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "swing_lookback" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_alert_configs" ADD COLUMN "fixed_sl_pips" real DEFAULT 20 NOT NULL;