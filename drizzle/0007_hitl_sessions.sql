CREATE TABLE "hitl_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"account_id" text,
	"symbol" text NOT NULL,
	"action" text,
	"state" text DEFAULT 'RECEIVED' NOT NULL,
	"entry_ref" real,
	"range_high" real,
	"range_low" real,
	"raw_alert" jsonb,
	"direction" text,
	"sl" real,
	"r" real,
	"tp1" real,
	"tp2" real,
	"tp3" real,
	"lots" real,
	"legs" jsonb,
	"sl_from" text,
	"position_model" text,
	"entry_mode" text,
	"risk_pct" real,
	"operator_chat_id" text,
	"prompt_message_id" text,
	"confirm_message_id" text,
	"be_applied" boolean DEFAULT false NOT NULL,
	"be_applied_at" timestamp,
	"dispatched_at" timestamp,
	"realized_pnl" real,
	"failure_reason" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"range_received_at" timestamp,
	"approved_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hitl_sessions_signal_id_unique" UNIQUE("signal_id")
);
--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "hitl_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hitl_sessions" ADD CONSTRAINT "hitl_sessions_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hitl_sessions_state_idx" ON "hitl_sessions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "hitl_sessions_symbol_idx" ON "hitl_sessions" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "hitl_sessions_account_id_idx" ON "hitl_sessions" USING btree ("account_id");