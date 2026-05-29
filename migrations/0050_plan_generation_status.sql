ALTER TABLE "training_plans"
  ADD COLUMN "generation_status" text NOT NULL DEFAULT 'ready';
ALTER TABLE "training_plans"
  ADD CONSTRAINT "training_plans_generation_status_check"
  CHECK ("generation_status" IN ('pending', 'generating', 'ready', 'failed'));
ALTER TABLE "training_plans"
  ADD COLUMN "generation_error" text;
