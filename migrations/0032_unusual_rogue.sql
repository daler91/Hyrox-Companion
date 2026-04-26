ALTER TABLE "exercise_sets" ADD COLUMN "planned_reps" integer;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "planned_weight" real;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "planned_distance" real;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "planned_time" real;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "planned_weight_non_negative_check" CHECK (planned_weight IS NULL OR planned_weight >= 0);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "planned_distance_non_negative_check" CHECK (planned_distance IS NULL OR planned_distance >= 0);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "planned_time_non_negative_check" CHECK (planned_time IS NULL OR planned_time >= 0);--> statement-breakpoint

-- Backfill: for existing LOGGED rows (workout_log_id IS NOT NULL), copy the
-- current actual values into the planned columns. This means historical logs
-- will render as "no diff" (planned == actual) instead of "no plan recorded".
-- Prescribed rows (plan_day_id IS NOT NULL) intentionally stay NULL — the row
-- itself IS the prescription.
UPDATE "exercise_sets"
SET
  "planned_reps" = "reps",
  "planned_weight" = "weight",
  "planned_distance" = "distance",
  "planned_time" = "time"
WHERE "workout_log_id" IS NOT NULL
  AND "planned_reps" IS NULL
  AND "planned_weight" IS NULL
  AND "planned_distance" IS NULL
  AND "planned_time" IS NULL;