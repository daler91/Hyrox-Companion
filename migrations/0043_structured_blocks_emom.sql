ALTER TABLE workout_structure_blocks
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS round_count integer,
  ADD COLUMN IF NOT EXISTS time_cap_minutes integer,
  ADD COLUMN IF NOT EXISTS work_interval_sec integer,
  ADD COLUMN IF NOT EXISTS rest_interval_sec integer,
  ADD COLUMN IF NOT EXISTS sequence_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS instructions text;

ALTER TABLE workout_structure_steps
  ADD COLUMN IF NOT EXISTS minute_index integer,
  ADD COLUMN IF NOT EXISTS step_type varchar(50) NOT NULL DEFAULT 'work',
  ALTER COLUMN exercise_name DROP NOT NULL,
  ALTER COLUMN category DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS target_reps integer,
  ADD COLUMN IF NOT EXISTS target_time real,
  ADD COLUMN IF NOT EXISTS target_distance real,
  ADD COLUMN IF NOT EXISTS target_weight real,
  ADD COLUMN IF NOT EXISTS intensity jsonb,
  ADD COLUMN IF NOT EXISTS load_mode varchar(50),
  ADD COLUMN IF NOT EXISTS unilateral_mode varchar(50),
  ADD COLUMN IF NOT EXISTS tempo jsonb,
  ADD COLUMN IF NOT EXISTS constraint_tags jsonb;

ALTER TABLE workout_structure_blocks
  ADD CONSTRAINT workout_structure_block_duration_minutes_positive_check CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  ADD CONSTRAINT workout_structure_block_round_count_positive_check CHECK (round_count IS NULL OR round_count > 0),
  ADD CONSTRAINT workout_structure_block_time_cap_positive_check CHECK (time_cap_minutes IS NULL OR time_cap_minutes > 0);

ALTER TABLE workout_structure_steps
  ADD CONSTRAINT workout_structure_step_minute_index_positive_check CHECK (minute_index IS NULL OR minute_index > 0),
  ADD CONSTRAINT workout_structure_step_type_check CHECK (step_type IN ('work', 'rest', 'transition'));
