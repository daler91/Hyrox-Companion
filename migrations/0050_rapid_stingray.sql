ALTER TABLE "training_plans" ADD COLUMN "generation_status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "generation_error" text;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_generation_status_check" CHECK (generation_status IN ('pending', 'generating', 'ready', 'failed'));