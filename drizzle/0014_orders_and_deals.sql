CREATE TABLE "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"order_ticket" text,
	"time" timestamp NOT NULL,
	"symbol" text,
	"type" text NOT NULL,
	"direction" text,
	"lots" real,
	"price" real,
	"commission" real,
	"fee" real,
	"swap" real,
	"profit" real,
	"balance" real,
	"comment" text,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deals_account_deal_uniq" UNIQUE("account_id","deal_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"ticket" text NOT NULL,
	"symbol" text NOT NULL,
	"type" text NOT NULL,
	"lots_requested" real,
	"lots_filled" real,
	"price" real,
	"stop_loss" real,
	"take_profit" real,
	"setup_time" timestamp NOT NULL,
	"done_time" timestamp,
	"state" text NOT NULL,
	"comment" text,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_account_ticket_uniq" UNIQUE("account_id","ticket")
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deals_account_time_idx" ON "deals" USING btree ("account_id","time");--> statement-breakpoint
CREATE INDEX "orders_account_setup_time_idx" ON "orders" USING btree ("account_id","setup_time");