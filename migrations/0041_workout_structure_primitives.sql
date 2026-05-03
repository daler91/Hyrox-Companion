CREATE TABLE "workout_structure_blocks" (
  "id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workout_log_id" varchar(255),
  "plan_day_id" varchar(255),
  "section_type" varchar(50) NOT NULL,
  "format_type" varchar(50) NOT NULL,
  "duration_seconds" integer,
  "rounds" integer,
  "work_seconds" integer,
  "rest_seconds" integer,
  "sort_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "workout_structure_block_single_owner_check" CHECK ((workout_log_id IS NULL) <> (plan_day_id IS NULL)),
  CONSTRAINT "workout_structure_block_duration_non_negative_check" CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  CONSTRAINT "workout_structure_block_rounds_positive_check" CHECK (rounds IS NULL OR rounds > 0),
  CONSTRAINT "workout_structure_block_work_non_negative_check" CHECK (work_seconds IS NULL OR work_seconds >= 0),
  CONSTRAINT "workout_structure_block_rest_non_negative_check" CHECK (rest_seconds IS NULL OR rest_seconds >= 0)
);
--> statement-breakpoint
CREATE TABLE "workout_structure_steps" (
  "id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "block_id" varchar(255) NOT NULL,
  "step_number" integer NOT NULL,
  "exercise_name" varchar(255) NOT NULL,
  "category" varchar(255) NOT NULL,
  "custom_label" text,
  "targets" jsonb,
  "step_role" varchar(50),
  "group_id" varchar(255),
  "group_meta" jsonb,
  CONSTRAINT "workout_structure_step_number_positive_check" CHECK (step_number > 0)
);
--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD CONSTRAINT "workout_structure_blocks_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD CONSTRAINT "workout_structure_blocks_plan_day_id_plan_days_id_fk" FOREIGN KEY ("plan_day_id") REFERENCES "public"."plan_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD CONSTRAINT "workout_structure_steps_block_id_workout_structure_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."workout_structure_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workout_structure_blocks_workout_log_id" ON "workout_structure_blocks" USING btree ("workout_log_id");--> statement-breakpoint
CREATE INDEX "idx_workout_structure_blocks_plan_day_id" ON "workout_structure_blocks" USING btree ("plan_day_id");--> statement-breakpoint
CREATE INDEX "idx_workout_structure_blocks_workout_sort" ON "workout_structure_blocks" USING btree ("workout_log_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_workout_structure_blocks_plan_day_sort" ON "workout_structure_blocks" USING btree ("plan_day_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_workout_structure_steps_block_id" ON "workout_structure_steps" USING btree ("block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workout_structure_steps_block_step_unique" ON "workout_structure_steps" USING btree ("block_id","step_number");--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "block_id" varchar(255);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "step_number" integer;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "interval_minute" integer;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "cycle_number" integer;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "step_role" varchar(50);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "group_id" varchar(255);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "intensity" jsonb;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "load" jsonb;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "rep_mode" varchar(50);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "tempo" jsonb;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "standards" jsonb;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_block_id_workout_structure_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."workout_structure_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_block_step_fk" FOREIGN KEY ("block_id","step_number") REFERENCES "public"."workout_structure_steps"("block_id","step_number") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "step_number_positive_check" CHECK (step_number IS NULL OR step_number > 0);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "interval_minute_non_negative_check" CHECK (interval_minute IS NULL OR interval_minute >= 0);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "cycle_number_positive_check" CHECK (cycle_number IS NULL OR cycle_number > 0);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "rep_mode_check" CHECK (rep_mode IS NULL OR rep_mode IN ('total', 'per_side'));--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_set_block_step_pair_check" CHECK ((block_id IS NULL) = (step_number IS NULL));
