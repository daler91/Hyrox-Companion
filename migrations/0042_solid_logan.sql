CREATE TABLE IF NOT EXISTS "workout_structure_blocks" (
  "id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workout_log_id" varchar(255),
  "plan_day_id" varchar(255),
  "section_type" varchar(50) NOT NULL,
  "format_type" varchar(50) NOT NULL,
  "duration_seconds" integer,
  "rounds" integer,
  "work_seconds" integer,
  "rest_seconds" integer,
  "sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workout_structure_steps" (
  "id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "block_id" varchar(255) NOT NULL,
  "step_number" integer NOT NULL,
  "exercise_name" varchar(255) NOT NULL,
  "category" varchar(255) NOT NULL,
  "custom_label" text,
  "targets" jsonb,
  "step_role" varchar(50),
  "group_id" varchar(255),
  "group_meta" jsonb
);
--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "block_id" varchar(255);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "step_number" integer;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "interval_minute" integer;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "cycle_number" integer;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "step_role" varchar(50);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "group_id" varchar(255);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "intensity" jsonb;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "load" jsonb;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "rep_mode" varchar(50);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "tempo" jsonb;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN IF NOT EXISTS "standards" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workout_structure_blocks_workout_log_id" ON "workout_structure_blocks" USING btree ("workout_log_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workout_structure_blocks_plan_day_id" ON "workout_structure_blocks" USING btree ("plan_day_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workout_structure_blocks_workout_sort" ON "workout_structure_blocks" USING btree ("workout_log_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workout_structure_blocks_plan_day_sort" ON "workout_structure_blocks" USING btree ("plan_day_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workout_structure_steps_block_id" ON "workout_structure_steps" USING btree ("block_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workout_structure_steps_block_step_unique" ON "workout_structure_steps" USING btree ("block_id","step_number");--> statement-breakpoint
