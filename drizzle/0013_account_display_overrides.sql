ALTER TABLE "trading_accounts" ADD COLUMN "label_server" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "label_broker" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "label_leverage" integer;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "beginning_date" date;