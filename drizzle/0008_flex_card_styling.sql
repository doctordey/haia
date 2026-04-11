ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "font_family" text DEFAULT 'inter' NOT NULL;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "hero_color" text;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "label_color" text DEFAULT '#8B8D98' NOT NULL;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "value_color" text DEFAULT '#E8E9ED' NOT NULL;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "username_color" text DEFAULT '#E8E9ED' NOT NULL;--> statement-breakpoint
ALTER TABLE "flex_cards" ADD COLUMN IF NOT EXISTS "branding_color" text DEFAULT '#5A5C66' NOT NULL;
