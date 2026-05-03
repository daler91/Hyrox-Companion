CREATE TABLE IF NOT EXISTS "structured_exercise_health_counters" (
  "day" date NOT NULL,
  "owner_type" text NOT NULL,
  "source" text NOT NULL,
  "counter_name" text NOT NULL,
  "value" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp DEFAULT now(),
  PRIMARY KEY ("day", "owner_type", "source", "counter_name"),
  CONSTRAINT "structured_exercise_health_owner_type_check" CHECK (owner_type IN ('workout_log', 'plan_day')),
  CONSTRAINT "structured_exercise_health_source_check" CHECK (source IN ('manual', 'voice', 'photo', 'import')),
  CONSTRAINT "structured_exercise_health_counter_name_check" CHECK (counter_name IN ('text_only_rows_detected', 'auto_hydration_attempted', 'auto_hydration_succeeded', 'auto_hydration_failed', 'manual_fix_completed'))
);

CREATE TABLE IF NOT EXISTS "structured_exercise_health_daily_rollups" (
  "day" date PRIMARY KEY,
  "total_rows" integer NOT NULL DEFAULT 0,
  "structured_rows" integer NOT NULL DEFAULT 0,
  "legacy_only_rows" integer NOT NULL DEFAULT 0,
  "failed_hydration_backlog" integer NOT NULL DEFAULT 0,
  "legacy_only_pct" real NOT NULL DEFAULT 0,
  "updated_at" timestamp DEFAULT now()
);
