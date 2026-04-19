ALTER TABLE "plan_days" ADD COLUMN "ai_rationale" text;--> statement-breakpoint
ALTER TABLE "plan_days" ADD COLUMN "ai_note_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_days" ADD COLUMN "ai_inputs_used" jsonb;