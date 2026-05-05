ALTER TABLE "structured_exercise_health_counters"
DROP CONSTRAINT IF EXISTS "structured_exercise_health_counter_name_check";

ALTER TABLE "structured_exercise_health_counters"
ADD CONSTRAINT "structured_exercise_health_counter_name_check"
CHECK (
  "structured_exercise_health_counters"."counter_name" IN (
    'text_only_rows_detected',
    'auto_hydration_attempted',
    'auto_hydration_succeeded',
    'auto_hydration_failed',
    'manual_fix_completed',
    'rejected_text_only_write',
    'parse_text_attempted',
    'parse_text_succeeded',
    'parse_text_failed',
    'parse_photo_attempted',
    'parse_photo_succeeded',
    'parse_photo_failed',
    'structured_blocks_fallback',
    'structured_blocks_accepted'
  )
);
