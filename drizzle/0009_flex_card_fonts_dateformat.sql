ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "hero_font_family" text;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "value_font_family" text;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "date_format" text DEFAULT 'short' NOT NULL;
