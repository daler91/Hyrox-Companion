ALTER TABLE workout_logs
  ADD COLUMN prescribed_main_workout text,
  ADD COLUMN prescribed_accessory text,
  ADD COLUMN prescribed_notes text;

-- Backfill from existing mutable workout text so historical logs have
-- a stable reference snapshot immediately after deploy.
UPDATE workout_logs
SET
  prescribed_main_workout = main_workout,
  prescribed_accessory = accessory,
  prescribed_notes = notes
WHERE prescribed_main_workout IS NULL;
