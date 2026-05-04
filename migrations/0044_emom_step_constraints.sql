CREATE UNIQUE INDEX "idx_workout_structure_steps_block_minute_unique"
  ON "workout_structure_steps" ("block_id", "minute_index");--> statement-breakpoint
ALTER TABLE "workout_structure_steps"
  ADD CONSTRAINT "workout_structure_rest_step_target_restrictions_check"
  CHECK (
    step_type <> 'rest' OR (
      exercise_name IS NULL
      AND custom_label IS NULL
      AND target_reps IS NULL
      AND target_time IS NULL
      AND target_distance IS NULL
      AND target_weight IS NULL
    )
  );
