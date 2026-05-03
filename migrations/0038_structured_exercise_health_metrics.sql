CREATE TABLE "structured_exercise_health_counters" (
	"day" date NOT NULL,
	"owner_type" text NOT NULL,
	"source" text NOT NULL,
	"counter_name" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "structured_exercise_health_counters_day_owner_type_source_counter_name_pk" PRIMARY KEY("day","owner_type","source","counter_name"),
	CONSTRAINT "structured_exercise_health_owner_type_check" CHECK ("structured_exercise_health_counters"."owner_type" IN ('workout_log', 'plan_day')),
	CONSTRAINT "structured_exercise_health_source_check" CHECK ("structured_exercise_health_counters"."source" IN ('manual', 'voice', 'photo', 'import')),
	CONSTRAINT "structured_exercise_health_counter_name_check" CHECK ("structured_exercise_health_counters"."counter_name" IN ('text_only_rows_detected', 'auto_hydration_attempted', 'auto_hydration_succeeded', 'auto_hydration_failed', 'manual_fix_completed'))
);
--> statement-breakpoint
CREATE TABLE "structured_exercise_health_daily_rollups" (
	"day" date PRIMARY KEY NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"structured_rows" integer DEFAULT 0 NOT NULL,
	"legacy_only_rows" integer DEFAULT 0 NOT NULL,
	"failed_hydration_backlog" integer DEFAULT 0 NOT NULL,
	"legacy_only_pct" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
