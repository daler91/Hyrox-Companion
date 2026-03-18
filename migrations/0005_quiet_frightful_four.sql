ALTER TABLE "training_plans" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_coach_enabled" boolean DEFAULT true;