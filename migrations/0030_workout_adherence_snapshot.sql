ALTER TABLE workout_logs
  ADD COLUMN planned_set_count integer,
  ADD COLUMN actual_set_count integer,
  ADD COLUMN matched_set_count integer,
  ADD COLUMN added_set_count integer,
  ADD COLUMN removed_set_count integer,
  ADD COLUMN compliance_pct integer;
