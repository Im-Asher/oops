ALTER TABLE "messages" ADD COLUMN "transcript" jsonb;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "summarized_up_to" uuid;