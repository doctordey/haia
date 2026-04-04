CREATE TABLE "account_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"balance" real DEFAULT 0 NOT NULL,
	"equity" real DEFAULT 0 NOT NULL,
	"total_pnl" real DEFAULT 0 NOT NULL,
	"realized_pnl" real DEFAULT 0 NOT NULL,
	"unrealized_pnl" real DEFAULT 0 NOT NULL,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"winning_trades" integer DEFAULT 0 NOT NULL,
	"losing_trades" integer DEFAULT 0 NOT NULL,
	"win_rate" real DEFAULT 0 NOT NULL,
	"profit_factor" real DEFAULT 0 NOT NULL,
	"expectancy" real DEFAULT 0 NOT NULL,
	"average_win" real DEFAULT 0 NOT NULL,
	"average_loss" real DEFAULT 0 NOT NULL,
	"risk_reward_ratio" real DEFAULT 0 NOT NULL,
	"max_drawdown_pct" real DEFAULT 0 NOT NULL,
	"max_drawdown_abs" real DEFAULT 0 NOT NULL,
	"sharpe_ratio" real DEFAULT 0 NOT NULL,
	"sortino_ratio" real DEFAULT 0 NOT NULL,
	"avg_trade_duration" integer DEFAULT 0 NOT NULL,
	"best_trade" real DEFAULT 0 NOT NULL,
	"worst_trade" real DEFAULT 0 NOT NULL,
	"longest_win_streak" integer DEFAULT 0 NOT NULL,
	"longest_loss_streak" integer DEFAULT 0 NOT NULL,
	"total_lots" real DEFAULT 0 NOT NULL,
	"total_pips" real DEFAULT 0 NOT NULL,
	"avg_pips_per_trade" real DEFAULT 0 NOT NULL,
	"best_trade_pips" real DEFAULT 0 NOT NULL,
	"worst_trade_pips" real DEFAULT 0 NOT NULL,
	"total_commission" real DEFAULT 0 NOT NULL,
	"total_swap" real DEFAULT 0 NOT NULL,
	"last_calculated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_stats_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "daily_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"date" date NOT NULL,
	"balance" real NOT NULL,
	"equity" real NOT NULL,
	"pnl" real NOT NULL,
	"trade_count" integer NOT NULL,
	"win_count" integer NOT NULL,
	"loss_count" integer NOT NULL,
	"volume" real NOT NULL,
	"pips" real DEFAULT 0 NOT NULL,
	"commission" real DEFAULT 0 NOT NULL,
	"swap" real DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_snapshots_account_date_uniq" UNIQUE("account_id","date")
);
--> statement-breakpoint
CREATE TABLE "flex_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text,
	"title" text,
	"period" text NOT NULL,
	"metric" text NOT NULL,
	"background_theme" text DEFAULT 'dark-geometric' NOT NULL,
	"custom_bg_url" text,
	"show_username" boolean DEFAULT true NOT NULL,
	"show_chart" boolean DEFAULT true NOT NULL,
	"show_win_loss" boolean DEFAULT true NOT NULL,
	"show_branding" boolean DEFAULT true NOT NULL,
	"image_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"ticket" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"lots" real NOT NULL,
	"entry_price" real NOT NULL,
	"close_price" real,
	"stop_loss" real,
	"take_profit" real,
	"open_time" timestamp NOT NULL,
	"close_time" timestamp,
	"profit" real NOT NULL,
	"pips" real,
	"commission" real DEFAULT 0 NOT NULL,
	"swap" real DEFAULT 0 NOT NULL,
	"is_open" boolean DEFAULT false NOT NULL,
	"magic_number" integer,
	"comment" text,
	CONSTRAINT "trades_account_ticket_uniq" UNIQUE("account_id","ticket")
);
--> statement-breakpoint
CREATE TABLE "trading_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"meta_api_id" text NOT NULL,
	"server" text NOT NULL,
	"login" text NOT NULL,
	"broker" text,
	"leverage" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trading_accounts_meta_api_id_unique" UNIQUE("meta_api_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text,
	"name" text,
	"username" text,
	"avatar_url" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"calendar_start" text DEFAULT 'monday' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "account_stats" ADD CONSTRAINT "account_stats_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_snapshots" ADD CONSTRAINT "daily_snapshots_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD CONSTRAINT "flex_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_snapshots_account_date_idx" ON "daily_snapshots" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "flex_cards_user_id_idx" ON "flex_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trades_account_close_time_idx" ON "trades" USING btree ("account_id","close_time");--> statement-breakpoint
CREATE INDEX "trades_account_symbol_idx" ON "trades" USING btree ("account_id","symbol");--> statement-breakpoint
CREATE INDEX "trades_account_is_open_idx" ON "trades" USING btree ("account_id","is_open");--> statement-breakpoint
CREATE INDEX "trading_accounts_user_id_idx" ON "trading_accounts" USING btree ("user_id");