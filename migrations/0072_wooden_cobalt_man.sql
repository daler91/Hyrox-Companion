ALTER TABLE "plan_days" ADD COLUMN "planned_time_of_day_min" integer;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "time_of_day_min" integer;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_time_of_day_check" CHECK (planned_time_of_day_min IS NULL OR (planned_time_of_day_min BETWEEN 0 AND 1439));--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_time_of_day_check" CHECK ("workout_logs"."time_of_day_min" IS NULL OR ("workout_logs"."time_of_day_min" >= 0 AND "workout_logs"."time_of_day_min" <= 1439));