ALTER TABLE exercise_sets
  ADD COLUMN planned_reps integer,
  ADD COLUMN planned_weight real,
  ADD COLUMN planned_distance real,
  ADD COLUMN planned_time real;

UPDATE exercise_sets
SET
  planned_reps = reps,
  planned_weight = weight,
  planned_distance = distance,
  planned_time = time
WHERE workout_log_id IS NOT NULL;
