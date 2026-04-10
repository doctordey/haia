ALTER TABLE "signal_configs" ADD COLUMN IF NOT EXISTS "nq_base_risk_percent" real;--> statement-breakpoint
ALTER TABLE "signal_configs" ADD COLUMN IF NOT EXISTS "nq_max_risk_percent" real;--> statement-breakpoint
ALTER TABLE "signal_configs" ADD COLUMN IF NOT EXISTS "es_base_risk_percent" real;--> statement-breakpoint
ALTER TABLE "signal_configs" ADD COLUMN IF NOT EXISTS "es_max_risk_percent" real;
