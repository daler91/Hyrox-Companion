ALTER TABLE "chat_messages" ADD COLUMN "feedback" varchar(10);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "feedback_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_feedback_check" CHECK (feedback IS NULL OR feedback IN ('up', 'down'));