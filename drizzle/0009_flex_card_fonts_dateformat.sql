ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "hero_font_family" text;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "value_font_family" text;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "date_format" text DEFAULT 'short' NOT NULL;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "hero_box_color" text;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "hero_box_text_color" text DEFAULT '#0B0C10' NOT NULL;
