ALTER TABLE "workout_structure_steps" ALTER COLUMN "exercise_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD COLUMN "round_count" integer;--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD COLUMN "time_cap_minutes" integer;--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD COLUMN "work_interval_sec" integer;--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD COLUMN "rest_interval_sec" integer;--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD COLUMN "sequence_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "minute_index" integer;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "step_type" varchar(50) DEFAULT 'work' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "target_reps" integer;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "target_time" real;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "target_distance" real;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "target_weight" real;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "intensity" jsonb;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "load_mode" varchar(50);--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "unilateral_mode" varchar(50);--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "tempo" jsonb;--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD COLUMN "constraint_tags" jsonb;--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD CONSTRAINT "workout_structure_block_duration_minutes_positive_check" CHECK (duration_minutes IS NULL OR duration_minutes > 0);--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD CONSTRAINT "workout_structure_block_round_count_positive_check" CHECK (round_count IS NULL OR round_count > 0);--> statement-breakpoint
ALTER TABLE "workout_structure_blocks" ADD CONSTRAINT "workout_structure_block_time_cap_positive_check" CHECK (time_cap_minutes IS NULL OR time_cap_minutes > 0);--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD CONSTRAINT "workout_structure_step_minute_index_positive_check" CHECK (minute_index IS NULL OR minute_index > 0);--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD CONSTRAINT "workout_structure_step_type_check" CHECK (step_type IN ('work', 'rest', 'transition'));