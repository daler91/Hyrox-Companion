# Database Layer

## Overview

The fitai.coach app uses **PostgreSQL** as its primary datastore, accessed through the **Drizzle ORM** for type-safe query building. A separate (optional) **pgvector**-enabled database handles vector embeddings for the RAG-based AI coaching pipeline. The schema is defined in TypeScript using Drizzle's `pgTable` builder, and migrations are managed by Drizzle Kit.

Key technology choices:

- **Drizzle ORM** (`drizzle-orm/node-postgres`) -- type-safe schema, query builder, and migration tooling
- **node-postgres (`pg`)** -- connection pooling for both the main database and the vector database
- **pgvector** -- PostgreSQL extension for storing and querying high-dimensional embedding vectors
- **drizzle-zod** -- automatic Zod validation schema generation from Drizzle table definitions
- **drizzle-kit** -- CLI for generating and running SQL migrations

---

## Schema Tables

All table definitions live in `shared/schema/tables.ts` (~755 lines, 26 tables plus their Drizzle relations). It is one file in the modular `shared/schema/` directory, which also contains `enums.ts`, `exercises.ts` (the 200+ `EXERCISE_DEFINITIONS`), `structureLint.ts`, `zod.ts` (a patched `zod` instance plus the `drizzle-zod` schema factory), `index.ts` (barrel re-export), and `types.ts`. `types.ts` was split into a `types/` subdirectory of nine modules — `ai.ts`, `analytics.ts`, `annotations.ts`, `coaching.ts`, `connections.ts`, `plans.ts`, `requests.ts`, `users.ts`, `workouts.ts` — and `types.ts` is now just a barrel that re-exports them.

Most tables use `varchar(255)` primary keys with `gen_random_uuid()` defaults; a few (`rate_limit_buckets`, `server_runtime_cache`) use a `text` key, and `idempotency_keys` / `structured_exercise_health_counters` use composite primary keys.

### users

User accounts and preferences.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `email` | `varchar(255)` | UNIQUE, nullable |
| `first_name` | `varchar(255)` | nullable |
| `last_name` | `varchar(255)` | nullable |
| `profile_image_url` | `varchar(255)` | nullable |
| `weight_unit` | `varchar(255)` | default `'kg'` |
| `distance_unit` | `varchar(255)` | default `'km'` |
| `weekly_goal` | `integer` | default `5` |
| `email_notifications` | `boolean` | default `false` — **master** email toggle (GDPR opt-in) |
| `email_weekly_summary` | `boolean` | default `false` — per-type toggle for the weekly training summary |
| `email_missed_reminder` | `boolean` | default `false` — per-type toggle for the missed-workout reminder |
| `show_adherence_insights` | `boolean` | default `true` — UI toggle for displaying plan-adherence insights |
| `ai_coach_enabled` | `boolean` | default `false` — **AI consent gate**; no workout data is sent to Gemini while this is `false` |
| `training_style_id` | `text` | default `'balanced_default'` |
| `training_style_previous_id` | `text` | nullable |
| `training_style_changed_at` | `timestamp with time zone` | nullable |
| `training_style_recompute_now` | `boolean` | default `false` |
| `onboarding_completed` | `boolean` | NOT NULL, default `false` |
| `maf_age` | `integer` | nullable |
| `maf_injury_illness_medication` | `boolean` | nullable |
| `maf_consistency` | `text` | nullable |
| `maf_trend` | `text` | nullable |
| `maf_hr_data_available` | `boolean` | nullable |
| `maf_hr` | `integer` | nullable |
| `maf_baseline_test_scheduled_at` | `timestamp with time zone` | nullable |
| `is_auto_coaching` | `boolean` | default `false` |
| `last_weekly_summary_at` | `timestamp` | nullable |
| `last_missed_reminder_at` | `timestamp` | nullable |
| `created_at` | `timestamp` | default `now()` |
| `updated_at` | `timestamp` | default `now()` |

No additional indexes (queries are by PK).

**Consent columns.** The four boolean columns above default to `false` at the DB layer so new accounts are opted-out of every third-party data flow by default. The application reads them as follows:

- No email is ever sent unless `email_notifications = true` **and** the per-type toggle for the category is `true`. The scheduler in `server/emailScheduler.ts` enforces both checks.
- No Gemini call is issued unless `ai_coach_enabled = true`. The auto-coach service short-circuits (`server/services/coachService.ts`) and the chat / parsing routes check the flag before composing a prompt.

---


### user_training_style

Historical training-style selections per user.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `style` | `text` | NOT NULL |
| `effective_date` | `date` | NOT NULL |
| `source` | `text` | NOT NULL, CHECK in (`onboarding`, `settings`, `migration_default`) |
| `created_at` | `timestamp` | default `now()` |

**Indexes:**
- `idx_user_training_style_user_effective` on (`user_id`, `effective_date`)

**Migration default behavior:** existing users without an explicit style history receive one backfilled row with:
- `style = COALESCE(users.training_style_id, 'balanced_default')`
- `effective_date = CURRENT_DATE` (migration run date)
- `source = 'migration_default'`

### maf_profile

Versioned MAF heart-rate profile snapshots for reproducible calculations.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `base_hr` | `integer` | NOT NULL |
| `adjustment` | `integer` | NOT NULL, default `0` |
| `final_hr` | `integer` | NOT NULL |
| `reason` | `text` | nullable |
| `phase` | `text` | nullable |
| `strict_mode` | `boolean` | NOT NULL, default `false` |
| `version` | `integer` | NOT NULL, default `1` |
| `calculated_at` | `timestamp with time zone` | NOT NULL, default `now()` |

### maf_test_results

Versioned MAF test executions and output metrics.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `protocol_type` | `text` | NOT NULL |
| `conditions` | `jsonb` | nullable |
| `metrics` | `jsonb` | nullable |
| `notes` | `text` | nullable |
| `version` | `integer` | NOT NULL, default `1` |

### maf_workout_analysis

Versioned workout-level MAF compliance and action recommendations.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `workout_log_id` | `varchar(255)` | nullable, FK -> `workout_logs.id` ON DELETE SET NULL |
| `compliance_pct` | `integer` | nullable |
| `classification` | `text` | nullable |
| `next_action` | `text` | nullable |
| `analysis_details` | `jsonb` | nullable |
| `version` | `integer` | NOT NULL, default `1` |


### training_plans

Multi-week training plans, either imported from CSV or generated by AI.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `name` | `text` | NOT NULL |
| `source_file_name` | `text` | nullable |
| `total_weeks` | `integer` | NOT NULL |
| `goal` | `text` | nullable |
| `start_date` | `date` | nullable |
| `end_date` | `date` | nullable |

**Indexes:**
- `idx_training_plans_user_id` on (`user_id`)

---

### plan_days

Individual workout days within a training plan.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `plan_id` | `varchar(255)` | NOT NULL, FK -> `training_plans.id` ON DELETE CASCADE |
| `week_number` | `integer` | NOT NULL |
| `day_name` | `text` | NOT NULL |
| `focus` | `text` | NOT NULL |
| `main_workout` | `text` | NOT NULL |
| `accessory` | `text` | nullable |
| `notes` | `text` | nullable |
| `scheduled_date` | `date` | nullable |
| `status` | `text` | default `'planned'` |
| `ai_source` | `text` | nullable |
| `ai_rationale` | `text` | nullable — auto-coach prescriptive rationale for the day |
| `ai_note_updated_at` | `timestamp with time zone` | nullable |
| `ai_inputs_used` | `jsonb` | nullable — typed `CoachNoteInputs`, the inputs that produced the rationale |

**Check constraints:**
- `status_check`: `status IN ('planned', 'completed', 'missed', 'skipped')`

**Indexes:**
- `idx_plan_days_plan_id` on (`plan_id`)
- `idx_plan_days_scheduled_date` on (`scheduled_date`)
- `idx_plan_days_status` on (`status`)
- `idx_plan_days_plan_week` on (`plan_id`, `week_number`) -- composite
- `idx_plan_days_plan_status` on (`plan_id`, `status`) -- composite

---

### workout_logs

Logged workouts, either entered manually or synced from Strava.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `date` | `date` | NOT NULL |
| `focus` | `text` | NOT NULL |
| `main_workout` | `text` | NOT NULL |
| `accessory` | `text` | nullable |
| `notes` | `text` | nullable |
| `prescribed_main_workout` | `text` | nullable — free-text prescription snapshot copied at log create |
| `prescribed_accessory` | `text` | nullable |
| `prescribed_notes` | `text` | nullable |
| `planned_set_count` | `integer` | nullable — adherence snapshot |
| `actual_set_count` | `integer` | nullable |
| `matched_set_count` | `integer` | nullable |
| `added_set_count` | `integer` | nullable |
| `removed_set_count` | `integer` | nullable |
| `compliance_pct` | `integer` | nullable |
| `duration` | `integer` | nullable (minutes) |
| `rpe` | `integer` | nullable |
| `plan_day_id` | `varchar(255)` | FK -> `plan_days.id` ON DELETE SET NULL |
| `plan_id` | `varchar(255)` | FK -> `training_plans.id` ON DELETE SET NULL |
| `source` | `varchar(255)` | default `'manual'` |
| `strava_activity_id` | `varchar(255)` | nullable |
| `garmin_activity_id` | `varchar(255)` | nullable |
| `calories` | `integer` | nullable |
| `distance_meters` | `real` | nullable |
| `elevation_gain` | `real` | nullable |
| `avg_heartrate` | `integer` | nullable |
| `max_heartrate` | `integer` | nullable |
| `avg_speed` | `real` | nullable |
| `max_speed` | `real` | nullable |
| `avg_cadence` | `real` | nullable |
| `avg_watts` | `integer` | nullable |
| `suffer_score` | `integer` | nullable |

**Indexes:**
- `idx_workout_logs_user_id` on (`user_id`)
- `idx_workout_logs_date` on (`date`)
- `idx_workout_logs_user_date` on (`user_id`, `date`) -- composite
- `idx_workout_logs_plan_day_id` on (`plan_day_id`)
- `idx_workout_logs_plan_id` on (`plan_id`)
- `idx_workout_logs_strava_activity_id` on (`strava_activity_id`)
- `idx_workout_logs_garmin_activity_id` on (`garmin_activity_id`)
- `idx_workout_logs_source` on (`source`)
- `idx_workout_logs_user_strava_unique` on (`user_id`, `strava_activity_id`) -- partial unique where `strava_activity_id IS NOT NULL`, guarantees per-user dedupe of Strava imports
- `idx_workout_logs_user_garmin_unique` on (`user_id`, `garmin_activity_id`) -- partial unique where `garmin_activity_id IS NOT NULL`, same guarantee for Garmin imports

**Check constraints:**
- `rpe_range_check`: `rpe IS NULL OR (rpe >= 1 AND rpe <= 10)`

---

### exercise_sets

Individual exercise sets. Each row is either **prescribed** (owned by a `plan_day` — the AI-generated rows shown in the workout detail modal) or **logged** (owned by a `workout_log` — what the user actually did). Exactly one owner column is set per row, enforced by the `exercise_set_single_owner_check`. On logged rows `reps`/`weight`/`distance`/`time` are the actual performed values, while the `planned_*` columns snapshot the prescription at log-create time.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `workout_log_id` | `varchar(255)` | nullable, FK -> `workout_logs.id` ON DELETE CASCADE |
| `plan_day_id` | `varchar(255)` | nullable, FK -> `plan_days.id` ON DELETE CASCADE |
| `exercise_name` | `varchar(255)` | NOT NULL |
| `custom_label` | `text` | nullable |
| `category` | `varchar(255)` | NOT NULL |
| `set_number` | `integer` | NOT NULL, default `1` |
| `reps` | `integer` | nullable (actual) |
| `weight` | `real` | nullable (actual) |
| `distance` | `real` | nullable (actual) |
| `time` | `real` | nullable (actual) |
| `planned_reps` | `integer` | nullable (prescription snapshot) |
| `planned_weight` | `real` | nullable (prescription snapshot) |
| `planned_distance` | `real` | nullable (prescription snapshot) |
| `planned_time` | `real` | nullable (prescription snapshot) |
| `block_id` | `varchar(255)` | nullable — structured-block grouping |
| `step_number` | `integer` | nullable |
| `interval_minute` | `integer` | nullable |
| `cycle_number` | `integer` | nullable |
| `step_role` | `varchar(50)` | nullable |
| `group_id` | `varchar(255)` | nullable |
| `intensity` | `jsonb` | nullable |
| `load` | `jsonb` | nullable |
| `rep_mode` | `varchar(50)` | nullable |
| `tempo` | `jsonb` | nullable |
| `standards` | `jsonb` | nullable |
| `notes` | `text` | nullable |
| `confidence` | `integer` | nullable |
| `sort_order` | `integer` | default `0` |

**Check constraints:**
- `set_number_check`: `set_number > 0`
- `exercise_set_single_owner_check`: `(workout_log_id IS NULL) <> (plan_day_id IS NULL)` — exactly one owner
- Non-negative guards on `weight`/`distance`/`time` and their `planned_*` counterparts
- `step_number_positive_check`, `cycle_number_positive_check`, `interval_minute_non_negative_check`
- `rep_mode_check`: `rep_mode IN ('total', 'per_side')`
- `exercise_set_block_step_pair_check`: `(block_id IS NULL) = (step_number IS NULL)`

**Indexes:**
- `idx_exercise_sets_workout_log_id` on (`workout_log_id`)
- `idx_exercise_sets_plan_day_id` on (`plan_day_id`)
- `idx_exercise_sets_plan_day_sort` on (`plan_day_id`, `sort_order`) -- composite
- `idx_exercise_sets_exercise_name` on (`exercise_name`)
- `idx_exercise_sets_workout_sort` on (`workout_log_id`, `sort_order`) -- composite
- `idx_exercise_sets_workout_exercise` on (`workout_log_id`, `exercise_name`) -- composite

---

### workout_structure_blocks

Structured-format primitives (EMOM, AMRAP, intervals, etc.) attached to a workout or plan day. Like `exercise_sets`, each block is owned by exactly one of `workout_log_id` / `plan_day_id`. Added in migration `0041`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `workout_log_id` | `varchar(255)` | nullable, FK -> `workout_logs.id` ON DELETE CASCADE |
| `plan_day_id` | `varchar(255)` | nullable, FK -> `plan_days.id` ON DELETE CASCADE |
| `section_type` | `varchar(50)` | NOT NULL |
| `format_type` | `varchar(50)` | NOT NULL |
| `duration_seconds` | `integer` | nullable |
| `rounds` | `integer` | nullable |
| `work_seconds` | `integer` | nullable |
| `rest_seconds` | `integer` | nullable |
| `duration_minutes` | `integer` | nullable |
| `round_count` | `integer` | nullable |
| `time_cap_minutes` | `integer` | nullable |
| `work_interval_sec` | `integer` | nullable |
| `rest_interval_sec` | `integer` | nullable |
| `score` | `jsonb` | nullable — block scoring, added in migration `0046` |
| `sequence_order` | `integer` | NOT NULL, default `0` |
| `instructions` | `text` | nullable |
| `sort_order` | `integer` | NOT NULL, default `0` |

**Check constraints:**
- `workout_structure_block_single_owner_check`: `(workout_log_id IS NULL) <> (plan_day_id IS NULL)`
- Non-negative / positive guards on the duration, rounds, and interval columns

**Indexes:**
- `idx_workout_structure_blocks_workout_log_id` on (`workout_log_id`)
- `idx_workout_structure_blocks_plan_day_id` on (`plan_day_id`)
- `idx_workout_structure_blocks_workout_sort` on (`workout_log_id`, `sort_order`) -- composite
- `idx_workout_structure_blocks_plan_day_sort` on (`plan_day_id`, `sort_order`) -- composite

---

### workout_structure_steps

Individual steps inside a `workout_structure_block` (e.g. each minute of an EMOM). Added in migration `0041`, with EMOM minute support in `0043`/`0044`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `block_id` | `varchar(255)` | NOT NULL, FK -> `workout_structure_blocks.id` ON DELETE CASCADE |
| `step_number` | `integer` | NOT NULL |
| `minute_index` | `integer` | nullable |
| `step_type` | `varchar(50)` | NOT NULL, default `'work'` |
| `exercise_name` | `varchar(255)` | nullable |
| `category` | `varchar(255)` | nullable |
| `custom_label` | `text` | nullable |
| `target_reps` | `integer` | nullable |
| `target_time` | `real` | nullable |
| `target_distance` | `real` | nullable |
| `target_weight` | `real` | nullable |
| `targets` | `jsonb` | nullable |
| `step_role` | `varchar(50)` | nullable |
| `intensity` | `jsonb` | nullable |
| `load_mode` | `varchar(50)` | nullable |
| `unilateral_mode` | `varchar(50)` | nullable |
| `tempo` | `jsonb` | nullable |
| `constraint_tags` | `jsonb` | nullable |
| `group_id` | `varchar(255)` | nullable |
| `group_meta` | `jsonb` | nullable |

**Check constraints:**
- `workout_structure_step_number_positive_check`: `step_number > 0`
- `workout_structure_step_type_check`: `step_type IN ('work', 'rest', 'transition')`
- `workout_structure_rest_step_target_restrictions_check`: rest steps may not carry exercise/target fields

**Indexes:**
- `idx_workout_structure_steps_block_id` on (`block_id`)
- `idx_workout_structure_steps_block_step_unique` -- UNIQUE on (`block_id`, `step_number`)
- `idx_workout_structure_steps_block_minute_unique` -- UNIQUE on (`block_id`, `minute_index`), added in migration `0044`

---

### structured_exercise_backfill_reviews

Tracks owners (plan days / workout logs) whose structured exercise data needs manual review during the legacy-to-structured backfill.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `owner_type` | `text` | NOT NULL, CHECK in (`planDay`, `workoutLog`) |
| `owner_id` | `varchar(255)` | NOT NULL |
| `user_id` | `varchar(255)` | nullable, FK -> `users.id` ON DELETE SET NULL |
| `status` | `text` | NOT NULL, CHECK in (`needs_manual_review`, `resolved`) |
| `reason` | `text` | nullable |
| `first_seen_at` | `timestamp` | default `now()` |
| `last_seen_at` | `timestamp` | default `now()` |
| `updated_at` | `timestamp` | default `now()` |

**Indexes:**
- `idx_structured_exercise_backfill_owner_unique` -- UNIQUE on (`owner_type`, `owner_id`)
- `idx_structured_exercise_backfill_status` on (`status`)
- `idx_structured_exercise_backfill_user_id` on (`user_id`)

---

### structured_exercise_health_counters

Daily counters tracking the health of structured-exercise parsing/hydration. Composite primary key on `(day, owner_type, source, counter_name)`.

| Column | Type | Constraints |
|---|---|---|
| `day` | `date` | NOT NULL, composite PK |
| `owner_type` | `text` | NOT NULL, composite PK, CHECK in (`workout_log`, `plan_day`) |
| `source` | `text` | NOT NULL, composite PK, CHECK in (`manual`, `voice`, `photo`, `import`) |
| `counter_name` | `text` | NOT NULL, composite PK, CHECK against a fixed counter-name list |
| `value` | `integer` | NOT NULL, default `0` |
| `updated_at` | `timestamp` | default `now()` |

---

### structured_exercise_health_daily_rollups

Per-day rollup of structured-exercise coverage, keyed by `day`.

| Column | Type | Constraints |
|---|---|---|
| `day` | `date` | PK |
| `total_rows` | `integer` | NOT NULL, default `0` |
| `structured_rows` | `integer` | NOT NULL, default `0` |
| `legacy_only_rows` | `integer` | NOT NULL, default `0` |
| `failed_hydration_backlog` | `integer` | NOT NULL, default `0` |
| `legacy_only_pct` | `real` | NOT NULL, default `0` |
| `updated_at` | `timestamp` | default `now()` |

---

### ai_usage_logs

Per-call Gemini token-consumption records, used to cap daily AI spend and flag anomalies.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `model` | `varchar(100)` | NOT NULL |
| `feature` | `varchar(50)` | NOT NULL |
| `input_tokens` | `integer` | NOT NULL, default `0` |
| `output_tokens` | `integer` | NOT NULL, default `0` |
| `estimated_cost_cents` | `real` | NOT NULL, default `0` |
| `created_at` | `timestamp` | NOT NULL, default `now()` |

**Indexes:**
- `idx_ai_usage_logs_user_created` on (`user_id`, `created_at`) -- composite

---

### push_subscriptions

Web Push API subscription objects so the server can deliver push notifications to opted-in devices.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `endpoint` | `text` | NOT NULL |
| `p256dh` | `text` | NOT NULL |
| `auth` | `text` | NOT NULL |
| `created_at` | `timestamp` | default `now()` |

**Indexes:**
- `idx_push_subscriptions_user_id` on (`user_id`)
- `idx_push_subscriptions_user_endpoint` -- UNIQUE on (`user_id`, `endpoint`)

---

### custom_exercises

User-defined exercises for AI recognition beyond the built-in list.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `name` | `text` | NOT NULL |
| `category` | `varchar(255)` | NOT NULL, default `'conditioning'` |
| `created_at` | `timestamp` | default `now()` |

**Indexes:**
- `idx_custom_exercises_user_id` on (`user_id`)
- `idx_custom_exercises_user_name` on (`user_id`, `name`) -- UNIQUE composite index

---

### chat_messages

Persisted AI coach conversation history.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `role` | `varchar(20)` | NOT NULL |
| `content` | `text` | NOT NULL |
| `timestamp` | `timestamp` | default `now()` |

**Indexes:**
- `idx_chat_messages_user_id` on (`user_id`)
- `idx_chat_messages_user_time` on (`user_id`, `timestamp`) -- composite

---

### coaching_materials

Reference documents uploaded by users that feed the RAG pipeline.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `title` | `text` | NOT NULL |
| `content` | `text` | NOT NULL |
| `type` | `varchar(50)` | NOT NULL, default `'principles'` |
| `created_at` | `timestamp` | default `now()` |
| `updated_at` | `timestamp` | default `now()` |

**Indexes:**
- `idx_coaching_materials_user_id` on (`user_id`)

---

### document_chunks

Chunked and embedded fragments of coaching materials for vector similarity search. This table lives on the **vector database** (configured via `VECTOR_DATABASE_URL`), not the main database.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `material_id` | `varchar(255)` | NOT NULL, FK -> `coaching_materials.id` ON DELETE CASCADE |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `content` | `text` | NOT NULL |
| `chunk_index` | `integer` | NOT NULL |
| `embedding` | `vector(3072)` | nullable |
| `created_at` | `timestamp` | default `now()` |

**Indexes:**
- `idx_document_chunks_material_id` on (`material_id`)
- `idx_document_chunks_user_id` on (`user_id`)

---

### strava_connections

OAuth credentials for Strava integration. Tokens are encrypted at rest via `encryptToken()`/`decryptToken()`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, UNIQUE, FK -> `users.id` ON DELETE CASCADE |
| `strava_athlete_id` | `varchar(255)` | NOT NULL |
| `access_token` | `text` | NOT NULL (encrypted) |
| `refresh_token` | `text` | NOT NULL (encrypted) |
| `expires_at` | `timestamp` | NOT NULL |
| `scope` | `text` | nullable |
| `last_synced_at` | `timestamp` | nullable |
| `created_at` | `timestamp` | default `now()` |

The `user_id` column has a UNIQUE constraint, enforcing one Strava connection per user. Upserts use `onConflictDoUpdate` targeting this unique constraint.

---

### garmin_connections

Garmin Connect session storage. Unlike Strava, Garmin has no public OAuth — authentication uses email/password against the reverse-engineered SSO flow ([@flow-js/garmin-connect](https://www.npmjs.com/package/@flow-js/garmin-connect)). Credentials and OAuth token blobs are encrypted at rest with the shared `encryptToken`/`decryptToken` helpers (AES-256-GCM). The `lastError` column is plaintext (generated message, non-secret) and is surfaced to the UI as a reconnect banner.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, UNIQUE, FK -> `users.id` ON DELETE CASCADE |
| `garmin_display_name` | `varchar(255)` | nullable (hashed/opaque display name from `getUserProfile()`) |
| `encrypted_email` | `text` | NOT NULL (encrypted AES-256-GCM) |
| `encrypted_password` | `text` | NOT NULL (encrypted AES-256-GCM) |
| `encrypted_oauth1_token` | `text` | nullable, `JSON.stringify(IOauth1Token)` encrypted |
| `encrypted_oauth2_token` | `text` | nullable, `JSON.stringify(IOauth2Token)` encrypted |
| `token_expires_at` | `timestamp` | nullable — derived from `oauth2.expires_at` |
| `last_synced_at` | `timestamp` | nullable |
| `last_error` | `text` | nullable — plaintext reconnect-needed message; cleared on success |
| `created_at` | `timestamp` | default `now()` |

One Garmin connection per user (UNIQUE on `user_id`). **Important:** This approach does not support Garmin two-step verification; users with 2SV must disable it to connect. See [Integrations → Garmin Connect](integrations.md#garmin-connect-integration).

---

### timeline_annotations

User-authored bands that mark date ranges as injury, illness, travel, or rest so volume dips remain legible when looking back at Timeline history or sharing Analytics. Stored as inclusive `[start_date, end_date]` date strings and rendered as shaded bands on Analytics charts and as a banner above the Timeline filters.

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(255)` | PK, default `gen_random_uuid()` |
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE |
| `start_date` | `date` | NOT NULL |
| `end_date` | `date` | NOT NULL |
| `type` | `varchar(50)` | NOT NULL |
| `note` | `text` | nullable (max 500 chars, enforced in Zod) |
| `created_at` | `timestamp` | default `now()` |
| `updated_at` | `timestamp` | default `now()` |

**Check constraints:**
- `timeline_annotation_type_check`: `type IN ('injury', 'illness', 'travel', 'rest')`
- `timeline_annotation_range_check`: `end_date >= start_date`

**Indexes:**
- `idx_timeline_annotations_user_id` on (`user_id`)
- `idx_timeline_annotations_user_range` on (`user_id`, `start_date`, `end_date`) -- composite, used for overlap queries against the visible timeline window

---

### idempotency_keys

Server-side idempotency cache for mutating API requests. Uses a composite primary key on `(user_id, key)`.

| Column | Type | Constraints |
|---|---|---|
| `user_id` | `varchar(255)` | NOT NULL, FK -> `users.id` ON DELETE CASCADE, composite PK |
| `key` | `varchar(255)` | NOT NULL, composite PK |
| `method` | `varchar(10)` | NOT NULL |
| `path` | `text` | NOT NULL |
| `status_code` | `integer` | NOT NULL |
| `response_body` | `jsonb` | NOT NULL |
| `created_at` | `timestamp` | NOT NULL, default `now()` |
| `expires_at` | `timestamp` | NOT NULL |

**Indexes:**
- Composite primary key on (`user_id`, `key`)
- `idx_idempotency_keys_expires_at` on (`expires_at`) -- for TTL cleanup

Entries expire after 7 days. The `idempotencyMiddleware` checks this table before executing mutating handlers and caches responses for duplicate keys.

---

### rate_limit_buckets

Shared rate-limit counters for `server/routeUtils.ts`. Production and development route limiters store their buckets here so limits apply globally across app replicas.

| Column | Type | Constraints |
|---|---|---|
| `key` | text | Primary key |
| `hit_count` | integer | Not null, default `0` |
| `reset_at` | timestamp with time zone | Not null |
| `updated_at` | timestamp with time zone | Not null, default `now()` |

**Indexes:**
- Primary key on `key`
- `idx_rate_limit_buckets_reset_at` on (`reset_at`) -- for TTL cleanup

Expired rows are pruned by the daily shared runtime cleanup cron job.

---

### server_runtime_cache

Short-lived shared runtime cache for safe multi-instance operation. Keys are hashed before storage when they include user identifiers or prompt/query text.

| Column | Type | Constraints |
|---|---|---|
| `key` | text | Primary key |
| `value` | jsonb | Not null |
| `expires_at` | timestamp with time zone | Not null |
| `updated_at` | timestamp with time zone | Not null, default `now()` |

Current use cases:
- Clerk auth seen-cache (`auth-seen:*`)
- Gemini embedding cache (`embedding:*`)
- RAG embedding-health probe (`rag-health:*`)
- RAG retrieval cache (`rag:*`)

**Indexes:**
- Primary key on `key`
- `idx_server_runtime_cache_expires_at` on (`expires_at`) -- for TTL cleanup

---

## Drizzle Relations

All tables have explicit Drizzle relation definitions in `shared/schema/tables.ts`, enabling the `db.query.<table>.findMany({ with: { ... } })` relational query pattern. This replaces several manual JOIN queries with cleaner, type-safe relation-based queries.

**Defined relations:**

| Relation | Type | Description |
|---|---|---|
| `usersRelations` | `many` trainingPlans, workoutLogs, customExercises, chatMessages, coachingMaterials, documentChunks, aiUsageLogs, pushSubscriptions, trainingStyles, mafProfiles, mafTestResults, mafWorkoutAnalyses; `one` stravaConnection, garminConnection |
| `trainingPlansRelations` | `one` user; `many` planDays (`days`), workoutLogs |
| `planDaysRelations` | `one` trainingPlan; `many` workoutLogs, exerciseSets |
| `workoutLogsRelations` | `one` user, planDay (optional), trainingPlan (optional); `many` exerciseSets |
| `exerciseSetsRelations` | `one` workoutLog (optional), planDay (optional) |
| `customExercisesRelations` | `one` user |
| `chatMessagesRelations` | `one` user |
| `coachingMaterialsRelations` | `one` user; `many` documentChunks (`chunks`) |
| `documentChunksRelations` | `one` coachingMaterial, user |
| `stravaConnectionsRelations` | `one` user |
| `garminConnectionsRelations` | `one` user |
| `aiUsageLogsRelations` | `one` user |
| `pushSubscriptionsRelations` | `one` user |
| `userTrainingStyleRelations` | `one` user |
| `mafProfileRelations` | `one` user |
| `mafTestResultsRelations` | `one` user |
| `mafWorkoutAnalysisRelations` | `one` user, workoutLog |

Note: `timeline_annotations`, `rate_limit_buckets`, `server_runtime_cache`, and the `structured_exercise_*` tables do not declare Drizzle relations and are queried directly.

---

## Entity Relationships

```
users
  |-- 1:N --> training_plans
  |             |-- 1:N --> plan_days
  |
  |-- 1:N --> workout_logs
  |             |-- 1:N --> exercise_sets
  |             |-- N:1 --> plan_days        (optional link, ON DELETE SET NULL)
  |             |-- N:1 --> training_plans   (optional link, ON DELETE SET NULL)
  |
  |-- 1:N --> coaching_materials
  |             |-- 1:N --> document_chunks
  |
  |-- 1:1 --> strava_connections
  |-- 1:1 --> garmin_connections
  |
  |-- 1:N --> chat_messages
  |
  |-- 1:N --> custom_exercises
  |
  |-- 1:N --> timeline_annotations
  |
  |-- 1:N --> idempotency_keys
```

```mermaid
erDiagram
    users ||--o{ trainingPlans : "has"
    users ||--o{ workoutLogs : "logs"
    users ||--o{ chatMessages : "sends"
    users ||--o{ coachingMaterials : "uploads"
    users ||--o{ customExercises : "defines"
    users ||--|| stravaConnections : "connects"
    
    trainingPlans ||--o{ planDays : "contains"
    workoutLogs ||--o{ exerciseSets : "has"
    workoutLogs }o--o| planDays : "links to"
    workoutLogs }o--o| trainingPlans : "belongs to"
    coachingMaterials ||--o{ documentChunks : "chunked into"
```

Key relationships:

- **users -> training_plans -> plan_days**: A user owns multiple training plans, each containing plan days organized by week number and day name. All cascade on user/plan deletion.
- **users -> workout_logs -> exercise_sets**: A user logs workouts, each containing multiple exercise sets. Exercise sets cascade on workout deletion.
- **workout_logs -> plan_days** (optional): A workout log may be linked to a plan day via `plan_day_id`. When a workout is logged against a plan day, the plan day's status is automatically set to `"completed"`. This FK uses `ON DELETE SET NULL` so deleting a plan day does not remove the workout log.
- **workout_logs -> training_plans** (optional): Direct link to the plan for fast lookups, also `ON DELETE SET NULL`.
- **users -> coaching_materials -> document_chunks**: Coaching materials are chunked and embedded for RAG. Deleting a material cascades to its chunks.
- **users -> strava_connections**: One-to-one relationship enforced by UNIQUE constraint on `user_id`.
- **users -> chat_messages**: Conversation history for the AI coach, ordered by timestamp.
- **users -> custom_exercises**: User-defined exercises with a unique constraint on `(user_id, name)` to prevent duplicates.

```mermaid
erDiagram
    users ||--o{ trainingPlans : "has"
    users ||--o{ workoutLogs : "logs"
    users ||--o{ chatMessages : "sends"
    users ||--o{ coachingMaterials : "uploads"
    users ||--o{ customExercises : "defines"
    users ||--|| stravaConnections : "connects"
    
    trainingPlans ||--o{ planDays : "contains"
    workoutLogs ||--o{ exerciseSets : "has"
    workoutLogs }o--o| planDays : "links to"
    workoutLogs }o--o| trainingPlans : "belongs to"
    coachingMaterials ||--o{ documentChunks : "chunked into"
```

---

## Drizzle ORM Setup

### Main Database Connection (`server/db.ts`)

```typescript
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,       // DB_IDLE_TIMEOUT_MS
  connectionTimeoutMillis: 5_000,  // DB_CONNECTION_TIMEOUT_MS
  statement_timeout: 30_000,       // DB_STATEMENT_TIMEOUT_MS
});

export const db = drizzle(pool, { schema });
```

The `db` instance is the single Drizzle client used by all storage classes except for vector operations. The full schema is imported from `@shared/schema` and passed to `drizzle()` for relational query support.

### Drizzle Kit Configuration (`drizzle.config.ts`)

```typescript
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema/tables.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

- **Schema source**: `shared/schema/tables.ts`
- **Migration output**: `./migrations/`
- **Dialect**: PostgreSQL

---

## pgvector

### Custom Type Definition

The pgvector `vector(N)` type is mapped to TypeScript `number[]` via a custom Drizzle type defined in `shared/schema/tables.ts`:

```typescript
const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});
```

The `fromDriver` function parses the PostgreSQL `[0.1,0.2,...]` text representation into a JavaScript `number[]`, and `toDriver` serializes it back.

### Embedding Dimensions

The embedding column uses **3072 dimensions**, matching the output of the Gemini embedding model `gemini-embedding-001`. The dimension count is the `EMBEDDING_DIMENSIONS` constant in `server/gemini/client.ts` (alongside the `EMBEDDING_MODEL` constant), and is mirrored in the table definition:

```typescript
embedding: vector("embedding", { dimensions: 3072 }),
```

### Separate Vector Database Pool (`server/vectorDb.ts`)

Vector operations use a dedicated connection pool that can point to a separate database (e.g., Neon with pgvector):

```typescript
const vectorUrl = env.VECTOR_DATABASE_URL || env.DATABASE_URL;

export const vectorPool = new Pool({
  connectionString: vectorUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});
```

- When `VECTOR_DATABASE_URL` is set, vector operations go to a separate Neon instance.
- When unset, it falls back to `DATABASE_URL` (single-DB mode).
- The pool is smaller (`max: 5`) since vector queries are less frequent but potentially longer-running.

### Vector Similarity Search

The `CoachingStorage.searchChunksByEmbedding()` method performs cosine distance similarity search using pgvector's `<=>` operator:

```sql
SELECT ... FROM document_chunks
WHERE user_id = $1 AND embedding IS NOT NULL
ORDER BY embedding::vector <=> $2::vector
LIMIT $3
```

### Schema Bootstrapping

The `document_chunks` table is **not** managed by Drizzle migrations. Instead, it is created at application startup by `runStartupMaintenance()` in `server/maintenance.ts`, which calls `ensurePgvectorExtension()` and then `ensureVectorSchema()`. Together these:

1. Ensure the pgvector extension via `CREATE EXTENSION IF NOT EXISTS vector`
2. Check if the `document_chunks` table exists on the vector database and `CREATE TABLE` it if missing, with the `vector(3072)` column type
3. Migrate the `embedding` column from `text` to `vector` type if needed (for upgrades from earlier versions) — this must run before the HNSW index, since `hnsw(embedding vector_cosine_ops)` requires a vector column
4. Create the `idx_document_chunks_embedding_hnsw` HNSW index (`vector_cosine_ops`, `m = 16`, `ef_construction = 64`) if it does not already exist

Because this runs against the vector pool, the `document_chunks` table can live on a separate connection (`VECTOR_DATABASE_URL`) independent of the main migration history.

---

## Storage Layer

### Architecture

The storage layer follows a **repository pattern** with domain-oriented classes. The `IStorage` type (defined in `server/storage/IStorage.ts`) is a composed object exposing each domain class as a property:

```typescript
interface IStorage {
  users: UserStorage;
  workouts: WorkoutStorage;
  plans: PlanStorage;
  timeline: TimelineStorage;
  timelineAnnotations: TimelineAnnotationsStorage;
  analytics: AnalyticsStorage;
  coaching: CoachingStorage;
  idempotency: IdempotencyStorage;
  aiUsage: AiUsageStorage;
  push: PushStorage;
}
```

### Storage Classes

Each domain class owns a cohesive slice of functionality:

| Class | File | Responsibility |
|---|---|---|
| `UserStorage` | `server/storage/users.ts` | Users, chat, Strava/Garmin connections, custom exercises, notification bookkeeping |
| `WorkoutStorage` | `server/storage/workouts.ts` | Workout logs, exercise sets, Strava/Garmin activity dedupe |
| `PlanStorage` | `server/storage/plans.ts` | Training plans, plan days, scheduling, missed-day marking |
| `TimelineStorage` | `server/storage/timeline.ts` | Unified timeline and upcoming planned days |
| `TimelineAnnotationsStorage` | `server/storage/timelineAnnotations.ts` | Timeline annotation bands (injury/illness/travel/rest) |
| `AnalyticsStorage` | `server/storage/analytics.ts` | Weekly stats, date-range queries, missed-workout reporting |
| `CoachingStorage` | `server/storage/coaching.ts` | Coaching materials and RAG document chunks (on the vector pool) |
| `IdempotencyStorage` | `server/storage/idempotency.ts` | Idempotency key caching (get, set, cleanup) |
| `AiUsageStorage` | `server/storage/aiUsage.ts` | AI token usage logging and daily-spend totals |
| `PushStorage` | `server/storage/push.ts` | Web Push subscription storage |

Shared query logic is extracted into helper modules: `server/storage/shared.ts` (e.g. joining exercise sets with workout dates), `planDayStatus.ts`, and `timelineWindow.ts`. `WorkoutStorage` additionally delegates to a `server/storage/workouts/` subdirectory (`crud.ts`, `customExercises.ts`, `timeline.ts`).

### Composed Facade (`server/storage/index.ts`)

`server/storage/index.ts` composes the domain classes into a single `storage` object. Callers reach domains by name:

```typescript
const workouts = new WorkoutStorage();

export const storage: IStorage = {
  users: new UserStorage(),
  workouts,
  plans: new PlanStorage(),
  timeline: new TimelineStorage(workouts),
  timelineAnnotations: new TimelineAnnotationsStorage(),
  analytics: new AnalyticsStorage(),
  coaching: new CoachingStorage(),
  idempotency: new IdempotencyStorage(),
  aiUsage: new AiUsageStorage(),
  push: new PushStorage(),
};
```

Usage from routes and services:

```typescript
await storage.users.getUser(userId);
await storage.workouts.createWorkoutLog(log);
await storage.plans.getActivePlan(userId);
await storage.timeline.getTimeline(userId);
await storage.analytics.getWeeklyStats(userId, start, end);
await storage.coaching.searchChunksByEmbedding(userId, embedding, topK);
```

Adding a new storage method means editing exactly one file — the owning domain class — rather than also wiring it through a central facade.

### Notable Storage Patterns

- **Upserts**: `UserStorage.upsertUser()` and `upsertStravaConnection()` use Drizzle's `onConflictDoUpdate` for idempotent writes.
- **Cascading status updates**: `WorkoutStorage.createWorkoutLog()` automatically marks the linked plan day as `"completed"` using a JOIN-based update.
- **Token encryption**: Strava access and refresh tokens are encrypted before storage and decrypted on read.
- **Batch operations**: `CoachingStorage.insertChunks()` and `replaceChunks()` batch inserts in groups of 100 using raw SQL through the vector pool.
- **Transactions**: `PlanStorage.deleteTrainingPlan()` and `schedulePlan()` use Drizzle transactions. `CoachingStorage.replaceChunks()` uses raw `BEGIN/COMMIT/ROLLBACK` on the vector pool.

---

## Migrations

### Drizzle Kit Workflow

Three npm scripts manage migrations:

| Command | Description |
|---|---|
| `npm run db:generate` | Generates a new SQL migration from schema changes (`drizzle-kit generate`) |
| `npm run db:migrate` | Applies pending migrations to the database (`drizzle-kit migrate`) |
| `npm run db:check` | Validates that the schema and migrations are in sync (`drizzle-kit check`) |

### Migration Files

Migrations are stored in the `migrations/` directory as numbered `.sql` files. There are currently **49 migrations**, `0000` through `0048`:

```
migrations/
  0000_huge_sentry.sql
  0001_flippant_shriek.sql
  0002_handy_living_lightning.sql
  ...
  0016_rename_hyrox_station_to_functional.sql
  0017_workout_logs_strava_unique.sql
  0018_backfill_plan_dates_and_workout_links.sql
  0019_add_idempotency_keys.sql
  ...
  0027_add_coach_notes.sql
  0028_plan_day_exercise_sets.sql
  ...
  0041_workout_structure_primitives.sql
  ...
  0046_complex_workout_block_scores.sql
  0047_last_magik.sql
  0048_shared_runtime_state.sql
  meta/
    _journal.json
    0000_snapshot.json
    ...
    0048_snapshot.json
```

- **SQL files**: Each migration contains the raw SQL statements.
- **`meta/_journal.json`**: Tracks migration ordering and versions.
- **`meta/NNNN_snapshot.json`**: Full schema snapshots at each migration point.

Migrations `0008` through `0014` relating to `document_chunks` are no-ops on the main database (the vector DB schema is managed at startup). They contain only `SELECT 1;` placeholders.

Notable recent migrations:
- `0016`: Renames exercise category from "hyrox" to "functional"
- `0017`: Adds unique constraint on `strava_activity_id` in `workout_logs`
- `0018`: Backfills `plan_dates` and `workout-to-plan` links
- `0019`: Creates the `idempotency_keys` table for server-side idempotency
- `0027`: Adds coach-note columns to `plan_days` (`ai_rationale`, `ai_note_updated_at`, `ai_inputs_used`) so the auto-coach can persist prescriptive rationale per day.
- `0028`: Adds `plan_day_id` FK on `exercise_sets`, allowing coach-prescribed exercises to be attached to a plan day before any workout is logged.
- `0041`: Adds the `workout_structure_blocks` and `workout_structure_steps` tables — the structured-format (EMOM/AMRAP/interval) primitives.
- `0043`: Adds EMOM support to structured blocks.
- `0044`: Adds the unique index on `(block_id, minute_index)` in `workout_structure_steps`.
- `0046`: Adds the `score` JSONB column to `workout_structure_blocks`.
- `0047`: Adds the `onboarding_completed` column to `users`.
- `0048`: Adds `rate_limit_buckets` and `server_runtime_cache` so rate limits and short-lived auth/AI/RAG caches are shared across app replicas.

### Startup Migration

In addition to Drizzle Kit migrations, `runStartupMaintenance()` in `server/maintenance.ts` runs at application startup to:

1. Test the database connection (`testDatabaseConnection`)
2. Execute Drizzle migrations (`runDrizzleMigrations`)
3. Ensure the pgvector extension (`ensurePgvectorExtension`)
4. Bootstrap the vector schema (`ensureVectorSchema`)
5. Mark past planned days as missed and reset stale `isAutoCoaching` flags

---

## Transaction Patterns

Drizzle transactions are used for atomic multi-table operations. Example from `server/services/workoutService.ts`:

```typescript
// Replace exercise sets atomically — delete old, insert new
await db.transaction(async (tx) => {
  await tx.delete(exerciseSets)
    .where(eq(exerciseSets.workoutLogId, workoutId));
  if (setRows.length > 0) {
    await tx.insert(exerciseSets).values(setRows);
  }
});
```

The workout creation flow orchestrates multiple related operations:

1. Insert `workoutLogs` record
2. If linked to a plan day, update `planDays` status to `"completed"` via JOIN-based update
3. Expand parsed exercises into `exerciseSets` rows (using `expandExercisesToSetRows()`)
4. Upsert `customExercises` for any new custom exercise names

These run as service-level orchestration (not a single DB transaction) because some steps involve external API calls (AI provider parsing). The exercise set replacement uses a proper transaction to avoid partial state where old sets are deleted but new ones fail to insert.

**Custom exercise deduplication** uses a `Map` with "last-wins" strategy:

```typescript
// Single-pass deduplication using Map (O(N) instead of O(N^2))
const uniqueCustomExs = new Map<string, { userId: string; name: string; category: string }>();
for (const ex of exercises) {
  if (ex.exerciseName === "custom" && ex.customLabel) {
    uniqueCustomExs.set(ex.customLabel, {
      userId, name: ex.customLabel, category: ex.category || "conditioning",
    });
  }
}
```

---

## Indexing Strategy

### Summary by Table

**plan_days** (5 indexes -- most heavily indexed):
- Single-column: `plan_id`, `scheduled_date`, `status`
- Composite: `(plan_id, week_number)` for week-based queries, `(plan_id, status)` for filtering by plan and completion state

**workout_logs** (9 indexes):
- Single-column: `user_id`, `date`, `plan_day_id`, `plan_id`, `strava_activity_id`, `garmin_activity_id`, `source`
- Composite: `(user_id, date)` for the most common query pattern (user's workouts by date)
- Partial unique: `(user_id, strava_activity_id)` and `(user_id, garmin_activity_id)` for per-user import dedupe

**exercise_sets** (6 indexes):
- Single-column: `workout_log_id`, `plan_day_id`, `exercise_name`
- Composite: `(workout_log_id, sort_order)` for ordered display, `(workout_log_id, exercise_name)` for per-exercise lookups within a workout, `(plan_day_id, sort_order)` for prescribed-row ordering

**chat_messages** (2 indexes):
- Single-column: `user_id`
- Composite: `(user_id, timestamp)` for chronological retrieval per user

**document_chunks** (3 indexes):
- Single-column: `material_id`, `user_id`
- `idx_document_chunks_embedding_hnsw` — HNSW index on `embedding vector_cosine_ops` for fast approximate cosine similarity search. Created on boot by `server/maintenance.ts` after the `vector` extension is confirmed, so the index lives on the vector database regardless of migration history.

**training_plans**, **coaching_materials**, **custom_exercises** (1 index each):
- All indexed on `user_id`

**custom_exercises** also has:
- Unique composite: `(user_id, name)` to prevent duplicate exercise names per user

---

## Performance Considerations

**Coalesced Analytics Cache:**
The analytics routes (`server/routes/analytics.ts`) use two in-memory promise caches — one for exercise sets (`getExerciseSetsCoalesced`) and one for workout logs (`getWorkoutLogsCoalesced`) — to prevent redundant DB queries within a single process. These caches only coalesce duplicate DB reads and are not part of abuse prevention or AI provider-spend controls; those shared concerns use the Postgres-backed runtime-state tables above. The cache entry stores the *pending* promise, so concurrent callers on the same replica share the same in-flight query.

```typescript
// Multiple concurrent requests for the same user's analytics data
// share a single database query via a cached Promise
const cacheKey = `${userId}-${from || 'none'}-${to || 'none'}`;
const entry = cache.get(cacheKey);
if (entry && (now - entry.timestamp < CACHE_TTL_MS)) {
  return entry.promise; // Return the same Promise to all callers
}
```

| Knob | Value | Source |
|---|---|---|
| TTL | 5 minutes (`ANALYTICS_CACHE_TTL_MS`) | `server/constants.ts` |
| Max entries per cache | 500 (`MAX_CACHE_SIZE`) | `server/routes/analytics.ts` |
| Eviction | Expired entries first, then oldest-by-timestamp once over the size cap | `evictStale()` |
| Failure handling | Rejected promises are removed from the cache so the next caller retries immediately | `.catch` in the coalescer |

This coalescing pattern means three concurrent `/training-overview` requests for the same user/window result in one DB query, not three — and the week-over-week delta computation (which fetches both the current and previous windows in parallel via `Promise.all`) reuses the cached promise for the prior window on subsequent requests within the TTL.

**N+1 Avoidance:**
- `getExerciseSetsByWorkoutLogs(ids[])`: Batch-fetches exercise sets for multiple workouts in a single query, avoiding per-workout queries on the timeline.
- `getAllExerciseSetsWithDates(userId, from?, to?)`: Fetches all sets in a date range in one query for analytics computation.

**Key Index Usage:**
- `idx_workout_logs_user_date` -- Most-used index. Powers timeline queries (WHERE userId = ? ORDER BY date).
- `idx_exercise_sets_workout_sort` -- Powers ordered exercise display within a workout.
- `idx_plan_days_plan_status` -- Composite index for "find all planned days in a plan" (used by auto-coach).

---

## Type Safety

### drizzle-zod Integration

Insert schemas are generated from Drizzle table definitions using `createInsertSchema()` from `drizzle-zod`, then refined with Zod extensions:

```typescript
// Auto-generated from the table, omitting server-managed fields
export const insertTrainingPlanSchema = createInsertSchema(trainingPlans).omit({
  id: true,
}).extend({
  goal: z.string().max(500).nullable().optional(),
});
```

This pattern is used for all entity insert/update schemas, which live in the `shared/schema/types/` modules (e.g. `plans.ts`, `workouts.ts`, `coaching.ts`, `connections.ts`, `annotations.ts`). `createInsertSchema` and the shared patched `z` instance come from `shared/schema/zod.ts`, which binds `drizzle-zod` to the same `zod` constructor used elsewhere (required for the `.openapi()` prototype patch).

### Inferred Types

Drizzle's `$inferSelect` and `$inferInsert` utilities generate TypeScript types directly from table definitions:

```typescript
export type User = typeof users.$inferSelect;        // Row read from DB
export type UpsertUser = typeof users.$inferInsert;   // Data for insert/upsert
```

These types are used throughout the storage layer and API routes, ensuring that column names, types, and nullability are always in sync with the database schema.

### Validation Schemas

Request-level validation schemas are defined alongside the types in the `shared/schema/types/` modules (notably `requests.ts`):

- `updateUserPreferencesSchema` -- validates preference updates with enum constraints
- `chatRequestSchema` -- validates chat messages with length limits, truncates history to last 20 messages
- `parseExercisesRequestSchema` -- validates free-text exercise parsing input
- `importPlanRequestSchema` -- validates CSV import payloads (up to 100K characters)
- `schedulePlanRequestSchema` -- validates start date format
- `exercisesPayloadSchema` -- validates arrays of exercise data (up to 200 exercises)
- `generatePlanInputSchema` -- validates AI plan generation parameters
- `insertCoachingMaterialSchema` -- validates coaching material uploads (up to 1.5M characters)

### Enums

Type-safe enums are defined in `shared/schema/enums.ts`:

- `WorkoutStatus`: `"planned" | "completed" | "missed" | "skipped"`
- `ExerciseCategory`: `"functional" | "running" | "strength" | "conditioning"`

### Exercise Definitions

The canonical exercise list is defined in `shared/schema/exercises.ts` as `EXERCISE_DEFINITIONS`, mapping exercise keys (e.g., `skierg`, `back_squat`) to their display labels, categories, and applicable measurement fields. The `ExerciseName` type is derived from the keys of this object.

---

See also: [Server -- Storage Layer Usage](server.md), [AI and RAG -- documentChunks](ai-and-rag.md#rag-pipeline), [Architecture -- Schema Pipeline](architecture.md#schema-pipeline)
