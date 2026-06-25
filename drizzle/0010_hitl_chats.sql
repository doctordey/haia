CREATE TABLE "hitl_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hitl_chats_chat_id_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
ALTER TABLE "hitl_sessions" ADD COLUMN "prompt_message_ids" jsonb;