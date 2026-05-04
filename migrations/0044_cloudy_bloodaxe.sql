CREATE UNIQUE INDEX "idx_workout_structure_steps_block_minute_unique" ON "workout_structure_steps" USING btree ("block_id","minute_index");--> statement-breakpoint
UPDATE "workout_structure_steps"
SET
  "exercise_name" = NULL,
  "custom_label" = NULL,
  "target_reps" = NULL,
  "target_time" = NULL,
  "target_distance" = NULL,
  "target_weight" = NULL
WHERE "step_type" = 'rest'
  AND (
    "exercise_name" IS NOT NULL
    OR "custom_label" IS NOT NULL
    OR "target_reps" IS NOT NULL
    OR "target_time" IS NOT NULL
    OR "target_distance" IS NOT NULL
    OR "target_weight" IS NOT NULL
  );--> statement-breakpoint
ALTER TABLE "workout_structure_steps" ADD CONSTRAINT "workout_structure_rest_step_target_restrictions_check" CHECK (step_type <> 'rest' OR (
      exercise_name IS NULL
      AND custom_label IS NULL
      AND target_reps IS NULL
      AND target_time IS NULL
      AND target_distance IS NULL
      AND target_weight IS NULL
    ));
