ALTER TABLE "chat_messages" ADD COLUMN "kind" varchar(20) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "proposal_id" varchar(255);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "safety_notice" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "rag_info" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "focus_plan_day_id" varchar(255);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "focus_workout_log_id" varchar(255);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_proposal_id_plan_adjustment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."plan_adjustment_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_kind_check" CHECK (kind IN ('text', 'proposal', 'summary'));