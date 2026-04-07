ALTER TABLE "signal_sources" ADD COLUMN "telegram_session" text;--> statement-breakpoint
ALTER TABLE "signal_sources" ADD COLUMN "telegram_phone" text;--> statement-breakpoint
ALTER TABLE "signal_sources" ADD COLUMN "telegram_status" text DEFAULT 'disconnected' NOT NULL;