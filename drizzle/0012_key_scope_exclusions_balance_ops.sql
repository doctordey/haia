CREATE TABLE "balance_ops" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" real NOT NULL,
	"time" timestamp NOT NULL,
	"comment" text,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "balance_ops_account_deal_uniq" UNIQUE("account_id","deal_id")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "account_ids" jsonb;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "is_excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "opening_balance" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "balance_ops" ADD CONSTRAINT "balance_ops_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_ops_account_time_idx" ON "balance_ops" USING btree ("account_id","time");