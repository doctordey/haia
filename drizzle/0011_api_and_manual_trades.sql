CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text DEFAULT 'read' NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "source" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "account_type" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "label_name" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "label_login" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "label_type" text;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "distinguish_manual" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "trades_account_source_idx" ON "trades" USING btree ("account_id","source");