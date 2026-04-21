ALTER TABLE "signal_configs" ADD COLUMN IF NOT EXISTS "nq_market_order_threshold" real;--> statement-breakpoint
ALTER TABLE "signal_configs" ADD COLUMN IF NOT EXISTS "es_market_order_threshold" real;
