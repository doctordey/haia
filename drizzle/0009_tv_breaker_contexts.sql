CREATE TABLE "tv_breaker_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"tv_symbol" text NOT NULL,
	"breaker_high" real NOT NULL,
	"breaker_low" real NOT NULL,
	"breaker_direction" text,
	"source" text DEFAULT 'publisher' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tv_breaker_contexts_account_symbol_uniq" UNIQUE("account_id","tv_symbol")
);
--> statement-breakpoint
ALTER TABLE "tv_breaker_contexts" ADD CONSTRAINT "tv_breaker_contexts_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tv_breaker_contexts_tv_symbol_idx" ON "tv_breaker_contexts" USING btree ("tv_symbol");--> statement-breakpoint
CREATE INDEX "tv_breaker_contexts_received_at_idx" ON "tv_breaker_contexts" USING btree ("received_at");