ALTER TABLE "plan_days" ADD COLUMN "expected_duration_min" integer;--> statement-breakpoint
ALTER TABLE "plan_days" ADD COLUMN "expected_rpe" integer;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_expected_duration_check" CHECK (expected_duration_min IS NULL OR (expected_duration_min BETWEEN 1 AND 600));--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_expected_rpe_check" CHECK (expected_rpe IS NULL OR (expected_rpe BETWEEN 1 AND 10));