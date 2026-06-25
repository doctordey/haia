CREATE TABLE "hitl_symbol_maps" (
	"id" text PRIMARY KEY NOT NULL,
	"tv_symbol" text NOT NULL,
	"broker_symbol" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hitl_symbol_maps_tv_symbol_unique" UNIQUE("tv_symbol")
);
