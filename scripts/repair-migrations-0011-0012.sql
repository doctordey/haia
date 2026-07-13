-- ─────────────────────────────────────────────────────────────────────────────
-- Manual repair: apply migrations 0011 + 0012 to a database that is stuck at
-- 0010 (symptom: "Failed to create key" because the api_keys table is missing).
--
-- Safe to paste into the Railway Postgres "Query" console. Fully idempotent —
-- every object is guarded, so re-running it (or running it when some objects
-- already exist) does nothing harmful. It also records both migrations in
-- Drizzle's journal so the next deploy's auto-migrate skips them cleanly.
--
-- Assumes the base migrations (0000–0010) are already applied — i.e. the app's
-- users/trades/trading_accounts tables and drizzle.__drizzle_migrations exist.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- ── 0011: api_keys + manual-trade / label-override columns ──
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id"          text PRIMARY KEY NOT NULL,
	"user_id"     text NOT NULL,
	"name"        text NOT NULL,
	"prefix"      text NOT NULL,
	"key_hash"    text NOT NULL,
	"scopes"      text DEFAULT 'read' NOT NULL,
	"account_ids" jsonb,
	"last_used_at" timestamp,
	"expires_at"  timestamp,
	"revoked_at"  timestamp,
	"created_at"  timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE ("key_hash")
);

ALTER TABLE "trades"           ADD COLUMN IF NOT EXISTS "source"             text    DEFAULT 'live'  NOT NULL;
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "account_type"       text;
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "label_name"         text;
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "label_login"        text;
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "label_type"         text;
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "distinguish_manual" boolean DEFAULT true   NOT NULL;

-- ── 0012: account scoping, exclusions, balance_ops ──
ALTER TABLE "api_keys"         ADD COLUMN IF NOT EXISTS "account_ids"     jsonb;
ALTER TABLE "trades"           ADD COLUMN IF NOT EXISTS "is_excluded"     boolean DEFAULT false NOT NULL;
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "opening_balance" real    DEFAULT 0     NOT NULL;

CREATE TABLE IF NOT EXISTS "balance_ops" (
	"id"          text PRIMARY KEY NOT NULL,
	"account_id"  text NOT NULL,
	"deal_id"     text NOT NULL,
	"kind"        text NOT NULL,
	"amount"      real NOT NULL,
	"time"        timestamp NOT NULL,
	"comment"     text,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"created_at"  timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "balance_ops_account_deal_uniq" UNIQUE ("account_id","deal_id")
);

-- Foreign keys (ADD CONSTRAINT has no IF NOT EXISTS — guard against re-run).
DO $$ BEGIN
	ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "balance_ops" ADD CONSTRAINT "balance_ops_account_id_trading_accounts_id_fk"
		FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx"        ON "api_keys"    USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "api_keys_key_hash_idx"       ON "api_keys"    USING btree ("key_hash");
CREATE INDEX IF NOT EXISTS "trades_account_source_idx"   ON "trades"      USING btree ("account_id","source");
CREATE INDEX IF NOT EXISTS "balance_ops_account_time_idx" ON "balance_ops" USING btree ("account_id","time");

-- ── Record both migrations in Drizzle's journal (skip on next auto-migrate) ──
INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at")
SELECT '9b055b482d0aaf928b1f21a563d74a13137f890d05c5b2b66fb27c6314d6a695', 1782854806535
WHERE NOT EXISTS (SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1782854806535);

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at")
SELECT '3e415fa5e3a17ed1b1d69efe6f05122b920c8e541bc89561034a4de555839cbb', 1783907737398
WHERE NOT EXISTS (SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1783907737398);

COMMIT;
