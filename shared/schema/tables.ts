import { relations, sql } from "drizzle-orm";
import { boolean, check, customType, date, index, integer, jsonb, pgTable, primaryKey,real, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import type { CoachNoteInputs } from "./types";

// pgvector custom type: maps PostgreSQL vector(N) ↔ TypeScript number[]
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

// User table
export const users = pgTable("users", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).unique(),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  profileImageUrl: varchar("profile_image_url", { length: 255 }),
  weightUnit: varchar("weight_unit", { length: 255 }).default("kg"),
  distanceUnit: varchar("distance_unit", { length: 255 }).default("km"),
  // IANA timezone name (e.g. "America/Chicago", "Europe/London") used by the
  // email scheduler and any "this week" / "yesterday" math that must align
  // with the athlete's local calendar rather than server UTC (review C10).
  // Auto-detected on the client via Intl.DateTimeFormat after first sign-in;
  // defaults to "UTC" so the column is non-null pre-detection.
  userTimezone: varchar("user_timezone", { length: 64 }).default("UTC").notNull(),
  weeklyGoal: integer("weekly_goal").default(5),
  // Master email toggle. When false, no email is ever sent. When true,
  // the per-type toggles below decide which email categories actually
  // go out. New users must explicitly opt in (GDPR compliance).
  emailNotifications: boolean("email_notifications").default(false),
  emailWeeklySummary: boolean("email_weekly_summary").default(false),
  emailMissedReminder: boolean("email_missed_reminder").default(false),
  showAdherenceInsights: boolean("show_adherence_insights").default(true),
  // AI coach requires explicit consent before first use because workout
  // data is sent to Google Gemini for processing.
  aiCoachEnabled: boolean("ai_coach_enabled").default(false),
  trainingStyleId: text("training_style_id").default("balanced_default"),
  trainingStylePreviousId: text("training_style_previous_id"),
  trainingStyleChangedAt: timestamp("training_style_changed_at", { withTimezone: true }),
  trainingStyleRecomputeNow: boolean("training_style_recompute_now").default(false),
  onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
  // Athlete competition profile — drives HYROX station load standards and the
  // benchmark fallbacks used by the Race Predictor. `division` defaults to the
  // recreational "open" standard; `gender` is nullable (null ≡ not yet
  // answered, treated as "prefer_not_to_say" by the predictor).
  division: varchar("division", { length: 16 }).default("open"),
  gender: varchar("gender", { length: 16 }),
  // General athlete age, collected for every user (profile/onboarding) and used
  // by the Race Predictor to pick an age cohort. Distinct from `mafAge`, which
  // is only set during MAF onboarding — so balanced-style athletes previously
  // had no age signal and fell back to the all-ages cohort (review W17).
  age: integer("age"),
  // Body-composition inputs for the calculated-nutrition-targets feature
  // (BMR/TDEE via Mifflin–St Jeor). Stored CANONICAL (kg/cm), not the user's
  // display unit: these are formula inputs like maf_test_results, not parsed
  // workout weights, so the S5 stored-unit invariant does not apply — the UI
  // converts at the input/display edge only. All nullable (profiles are partial;
  // the calc degrades gracefully and is gated client-side until complete).
  bodyweightKg: real("bodyweight_kg"),
  heightCm: real("height_cm"),
  // Mifflin–St Jeor activity multiplier bucket. null ⇒ calc unavailable.
  activityLevel: varchar("activity_level", { length: 24 }), // sedentary|light|moderate|active|very_active
  // Weight-goal DIRECTION for the calorie adjustment. Distinct from weeklyGoal
  // (training sessions/week). null/maintain ⇒ no adjustment.
  weightGoalDirection: varchar("weight_goal_direction", { length: 16 }), // lose|maintain|gain
  // Target rate of weight change in kg/week (canonical). Magnitude only; the
  // sign comes from weightGoalDirection. null ⇒ treated as 0 (maintain).
  weightGoalRateKgPerWeek: real("weight_goal_rate_kg_per_week"),
  mafAge: integer("maf_age"),
  mafInjuryIllnessMedication: boolean("maf_injury_illness_medication"),
  mafConsistency: text("maf_consistency"),
  mafTrend: text("maf_trend"),
  mafHrDataAvailable: boolean("maf_hr_data_available"),
  mafHr: integer("maf_hr"),
  mafBaselineTestScheduledAt: timestamp("maf_baseline_test_scheduled_at", { withTimezone: true }),
  isAutoCoaching: boolean("is_auto_coaching").default(false),
  lastWeeklySummaryAt: timestamp("last_weekly_summary_at"),
  lastMissedReminderAt: timestamp("last_missed_reminder_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  hitCount: integer("hit_count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_rate_limit_buckets_reset_at").on(table.resetAt),
]);

export const serverRuntimeCache = pgTable("server_runtime_cache", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_server_runtime_cache_expires_at").on(table.expiresAt),
  // text_pattern_ops lets deleteRuntimeCachePrefix()'s `key LIKE 'prefix%'`
  // use an index regardless of the database's default collation (a plain btree
  // on a non-C collation can't serve a LIKE-prefix scan). See review L4.
  index("idx_server_runtime_cache_key_pattern").on(table.key.op("text_pattern_ops")),
]);

// Canonical analytics surfaces whose last computed result is persisted so it
// can be shown instantly on open and refreshed by the midnight cron. Kept in
// sync with the analytics_results check constraint below.
export const ANALYTICS_FEATURES = ["coach_insights", "race_prediction", "nutrition_insights"] as const;
export type AnalyticsFeature = (typeof ANALYTICS_FEATURES)[number];

// Durable "last computed result" for the expensive analytics surfaces (Coach
// Insights, Race Predictor). Unlike serverRuntimeCache this is NOT expiry-based:
// the row persists until the next recompute so the client can paint the
// previous result instantly on open (no spinner/blank), and the midnight cron
// can tell whether a newer workout has landed since it was generated. One row
// per (user, feature), upserted on the unique index.
export const analyticsResults = pgTable("analytics_results", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  feature: text("feature").notNull(),
  payload: jsonb("payload").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  // Calendar date (YYYY-MM-DD) of the athlete's latest logged workout AT the
  // moment this result was generated. The cron compares the CURRENT latest
  // workout date against this to decide staleness — a robust ISO-string
  // compare that sidesteps the date-vs-timestamp mismatch (workout.date is a
  // calendar day with no time component, generatedAt is a timestamp).
  lastWorkoutDateAtGeneration: date("last_workout_date_at_generation"),
  // Local calendar date of the last cron recompute — the once-per-day claim
  // guard so at-least-once job delivery (or a DST-doubled local hour) can't
  // recompute the same feature twice in one day.
  recomputedOn: date("recomputed_on"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_analytics_results_user_feature").on(table.userId, table.feature),
  index("idx_analytics_results_feature").on(table.feature),
  check("analytics_results_feature_check", sql`feature IN ('coach_insights', 'race_prediction', 'nutrition_insights')`),
]);

export type AnalyticsResult = typeof analyticsResults.$inferSelect;

export const trainingPlans = pgTable("training_plans", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceFileName: text("source_file_name"),
  totalWeeks: integer("total_weeks").notNull(),
  goal: text("goal"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  // The athlete's race day, captured when the end date is flagged as the race
  // date. Stored separately from endDate because scheduling derives endDate from
  // the Monday-aligned plan days, which can drift a few days off the true race day.
  raceDate: date("race_date"),
  generationStatus: text("generation_status").notNull().default("ready"),
  generationError: text("generation_error"),
  // When AI generation began, used by the startup sweep to fail plans left
  // `pending`/`generating` by a worker that crashed mid-job (S2). DEFAULT now()
  // backfills existing rows harmlessly — only stuck pending/generating rows are
  // ever swept, and those are all newly created.
  generationStartedAt: timestamp("generation_started_at").defaultNow(),
}, (table) => [
  index("idx_training_plans_user_id").on(table.userId),
  check("training_plans_generation_status_check", sql`generation_status IN ('pending', 'generating', 'ready', 'failed')`),
]);

export const planDays = pgTable("plan_days", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id", { length: 255 }).notNull().references(() => trainingPlans.id, { onDelete: "cascade" }),
  weekNumber: integer("week_number").notNull(),
  dayName: text("day_name").notNull(),
  focus: text("focus").notNull(),
  mainWorkout: text("main_workout").notNull(),
  accessory: text("accessory"),
  notes: text("notes"),
  scheduledDate: date("scheduled_date"),
  status: text("status").default("planned"),
  aiSource: text("ai_source"),
  aiRationale: text("ai_rationale"),
  aiNoteUpdatedAt: timestamp("ai_note_updated_at", { withTimezone: true }),
  aiInputsUsed: jsonb("ai_inputs_used").$type<CoachNoteInputs>(),
  // Athlete's expected duration (minutes) + intensity (RPE 1–10) for a planned
  // session. Drives per-session fuelling targets before the workout is logged;
  // nullable, so an unset session estimates from the planned exercise table or
  // falls back to a moderate-session baseline.
  expectedDurationMin: integer("expected_duration_min"),
  expectedRpe: integer("expected_rpe"),
}, (table) => [
  check("status_check", sql`status IN ('planned', 'completed', 'missed', 'skipped')`),
  check("plan_days_expected_duration_check", sql`expected_duration_min IS NULL OR (expected_duration_min BETWEEN 1 AND 600)`),
  check("plan_days_expected_rpe_check", sql`expected_rpe IS NULL OR (expected_rpe BETWEEN 1 AND 10)`),
  index("idx_plan_days_plan_id").on(table.planId),
  index("idx_plan_days_scheduled_date").on(table.scheduledDate),
  index("idx_plan_days_status").on(table.status),
  index("idx_plan_days_plan_week").on(table.planId, table.weekNumber),
  index("idx_plan_days_plan_status").on(table.planId, table.status),
  index("idx_plan_days_plan_scheduled").on(table.planId, table.scheduledDate),
]);

export const workoutLogs = pgTable("workout_logs", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  focus: text("focus").notNull(),
  mainWorkout: text("main_workout").notNull(),
  accessory: text("accessory"),
  notes: text("notes"),
  // Snapshot of the free-text prescription copied at initial log create.
  // Completed-workout UI lets athletes edit this reference text when they
  // need to re-parse structured rows from the coach prescription.
  prescribedMainWorkout: text("prescribed_main_workout"),
  prescribedAccessory: text("prescribed_accessory"),
  prescribedNotes: text("prescribed_notes"),
  plannedSetCount: integer("planned_set_count"),
  actualSetCount: integer("actual_set_count"),
  matchedSetCount: integer("matched_set_count"),
  addedSetCount: integer("added_set_count"),
  removedSetCount: integer("removed_set_count"),
  compliancePct: integer("compliance_pct"),
  duration: integer("duration"),
  rpe: integer("rpe"),
  planDayId: varchar("plan_day_id", { length: 255 }).references(() => planDays.id, { onDelete: "set null" }),
  planId: varchar("plan_id", { length: 255 }).references(() => trainingPlans.id, { onDelete: "set null" }),
  source: varchar("source", { length: 255 }).default("manual"),
  stravaActivityId: varchar("strava_activity_id", { length: 255 }),
  garminActivityId: varchar("garmin_activity_id", { length: 255 }),
  calories: integer("calories"),
  distanceMeters: real("distance_meters"),
  elevationGain: real("elevation_gain"),
  avgHeartrate: integer("avg_heartrate"),
  maxHeartrate: integer("max_heartrate"),
  avgSpeed: real("avg_speed"),
  maxSpeed: real("max_speed"),
  avgCadence: real("avg_cadence"),
  avgWatts: integer("avg_watts"),
  sufferScore: integer("suffer_score"),
  // True session start instant captured from Strava/Garmin at import (Phase 3).
  // Nullable: legacy rows and manual logs leave it null and fall back to the
  // pre_workout/post_workout meal-type tags on the calendar day for the
  // fuelling-around-session views (FR-3.1/3.2). No manual entry UI this phase.
  startedAt: timestamp("started_at", { withTimezone: true }),
}, (table) => [
  index("idx_workout_logs_user_id").on(table.userId),
  index("idx_workout_logs_date").on(table.date),
  index("idx_workout_logs_user_date").on(table.userId, table.date),
  index("idx_workout_logs_plan_day_id").on(table.planDayId),
  index("idx_workout_logs_plan_id").on(table.planId),
  index("idx_workout_logs_strava_activity_id").on(table.stravaActivityId),
  index("idx_workout_logs_garmin_activity_id").on(table.garminActivityId),
  index("idx_workout_logs_source").on(table.source),
  index("idx_workout_logs_user_started_at").on(table.userId, table.startedAt),
  // Enforce Strava activity uniqueness per user at the DB layer so concurrent
  // sync requests cannot create duplicate workouts for the same activity
  // (CODEBASE_AUDIT.md §5). Partial index so non-Strava rows are unaffected.
  uniqueIndex("idx_workout_logs_user_strava_unique")
    .on(table.userId, table.stravaActivityId)
    .where(sql`${table.stravaActivityId} IS NOT NULL`),
  // Same dedupe guarantee for Garmin imports.
  uniqueIndex("idx_workout_logs_user_garmin_unique")
    .on(table.userId, table.garminActivityId)
    .where(sql`${table.garminActivityId} IS NOT NULL`),
  check("rpe_range_check", sql`${table.rpe} IS NULL OR (${table.rpe} >= 1 AND ${table.rpe} <= 10)`),
]);

// Strava OAuth connection storage
export const stravaConnections = pgTable("strava_connections", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  stravaAthleteId: varchar("strava_athlete_id", { length: 255 }).notNull(),
  // S4: these tokens are encrypted at rest (AES-256-GCM via server/crypto.ts) by
  // the storage layer and decrypted on read — despite the plain column names,
  // which lack the `encrypted_` prefix the garmin_connections columns use, for
  // historical reasons. Do not assume the stored values are plaintext.
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  scope: text("scope"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Garmin Connect session storage. Unlike Strava, Garmin has no public OAuth
// for end users — we authenticate with the user's email + password against the
// reverse-engineered SSO flow used by @flow-js/garmin-connect. We store the
// credentials encrypted-at-rest (AES-256-GCM via server/crypto.ts) so we can
// re-login when the cached OAuth tokens expire (~1 year). The OAuth1/OAuth2
// token blobs are JSON, also encrypted at rest.
//
// IMPORTANT: this approach does NOT support Garmin two-step verification.
// Users with 2SV enabled will fail at login and must temporarily disable it.
export const garminConnections = pgTable("garmin_connections", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  // displayName from getUserProfile() — opaque hash, not the email.
  garminDisplayName: varchar("garmin_display_name", { length: 255 }),
  // Garmin email + password, encrypted at rest (AES-256-GCM). Nullable because
  // they're cleared when a connection enters the failed state (lastError set) —
  // a broken connection needs a manual reconnect, which re-collects them, so we
  // never retain replayable credentials for a connection we won't reuse without
  // the user re-entering them (review M2). Invariant: non-null iff lastError is null.
  encryptedEmail: text("encrypted_email"),
  encryptedPassword: text("encrypted_password"),
  // JSON.stringify(IOauth1Token) and JSON.stringify(IOauth2Token), each
  // encrypted with encryptToken(). Null until the first successful login.
  encryptedOauth1Token: text("encrypted_oauth1_token"),
  encryptedOauth2Token: text("encrypted_oauth2_token"),
  // expires_at from the OAuth2 token (seconds since epoch → JS Date). We
  // re-login when current time passes this value, since the lib's refresh
  // path is unreliable.
  tokenExpiresAt: timestamp("token_expires_at"),
  lastSyncedAt: timestamp("last_synced_at"),
  // Surfaced to the UI as a "reconnect needed" banner. Cleared on successful
  // sync. Stored as plain text since it's a generated message, not a secret.
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Exercise sets are either "prescribed" (owned by a planDay — the AI-generated
// plan rows the user will see in the workout detail modal) or "logged" (owned
// by a workoutLog — what the user actually did). Exactly one owner column is
// set per row; when a user logs a planned day we copy prescribed rows into a
// new workoutLog as starter rows so the plan stays pristine and the log is
// a snapshot.
//
// On logged rows, `reps`/`weight`/`distance`/`time` represent the ACTUAL
// performed values, while `plannedReps`/`plannedWeight`/`plannedDistance`/
// `plannedTime` capture the prescription at the moment the log was created.
// This lets the UI render mid-workout adjustments (e.g. dropped from 100 → 95
// lb) as a diff without losing the original plan. Prescribed rows
// (planDay-owned) leave `plannedX` NULL — the row itself is the prescription.
export const exerciseSets = pgTable("exercise_sets", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  workoutLogId: varchar("workout_log_id", { length: 255 }).references(() => workoutLogs.id, { onDelete: "cascade" }),
  planDayId: varchar("plan_day_id", { length: 255 }).references(() => planDays.id, { onDelete: "cascade" }),
  exerciseName: varchar("exercise_name", { length: 255 }).notNull(),
  customLabel: text("custom_label"),
  category: varchar("category", { length: 255 }).notNull(),
  setNumber: integer("set_number").notNull().default(1),
  // Logged rows store actual values in reps/weight/distance/time. When a
  // plan row is copied into a workout log, these nullable fields snapshot the
  // original prescription so the athlete can edit actuals without losing plan
  // context.
  reps: integer("reps"),
  weight: real("weight"),
  distance: real("distance"),
  time: real("time"),
  plannedReps: integer("planned_reps"),
  plannedWeight: real("planned_weight"),
  plannedDistance: real("planned_distance"),
  plannedTime: real("planned_time"),
  blockId: varchar("block_id", { length: 255 }),
  stepNumber: integer("step_number"),
  intervalMinute: integer("interval_minute"),
  cycleNumber: integer("cycle_number"),
  stepRole: varchar("step_role", { length: 50 }),
  groupId: varchar("group_id", { length: 255 }),
  intensity: jsonb("intensity"),
  load: jsonb("load"),
  repMode: varchar("rep_mode", { length: 50 }),
  tempo: jsonb("tempo"),
  standards: jsonb("standards"),
  notes: text("notes"),
  confidence: integer("confidence"),
  sortOrder: integer("sort_order").default(0),
  // Optimistic-lock version (W18). Bumped server-side on every UPDATE.
  // Clients can opt into conflict detection by passing `expectedVersion`
  // on the PATCH body; storage returns AppError(CONFLICT, 409) when the
  // value doesn't match. Defaults to 1 so existing rows backfill without
  // breaking writes from clients that don't yet send expectedVersion.
  version: integer("version").notNull().default(1),
}, (table) => [
  index("idx_exercise_sets_workout_log_id").on(table.workoutLogId),
  index("idx_exercise_sets_plan_day_id").on(table.planDayId),
  index("idx_exercise_sets_plan_day_sort").on(table.planDayId, table.sortOrder),
  index("idx_exercise_sets_exercise_name").on(table.exerciseName),
  index("idx_exercise_sets_workout_sort").on(table.workoutLogId, table.sortOrder),
  index("idx_exercise_sets_workout_exercise").on(table.workoutLogId, table.exerciseName),
  check("set_number_check", sql`set_number > 0`),
  check("weight_non_negative_check", sql`weight IS NULL OR weight >= 0`),
  check("distance_non_negative_check", sql`distance IS NULL OR distance >= 0`),
  check("time_non_negative_check", sql`time IS NULL OR time >= 0`),
  check("planned_weight_non_negative_check", sql`planned_weight IS NULL OR planned_weight >= 0`),
  check("planned_distance_non_negative_check", sql`planned_distance IS NULL OR planned_distance >= 0`),
  check("planned_time_non_negative_check", sql`planned_time IS NULL OR planned_time >= 0`),
  check("step_number_positive_check", sql`step_number IS NULL OR step_number > 0`),
  check("interval_minute_non_negative_check", sql`interval_minute IS NULL OR interval_minute >= 0`),
  check("cycle_number_positive_check", sql`cycle_number IS NULL OR cycle_number > 0`),
  check("rep_mode_check", sql`rep_mode IS NULL OR rep_mode IN ('total', 'per_side')`),
  check("exercise_set_block_step_pair_check", sql`(block_id IS NULL) = (step_number IS NULL)`),
  // Exactly one owner — prescribed (planDay) xor logged (workoutLog).
  check(
    "exercise_set_single_owner_check",
    sql`(workout_log_id IS NULL) <> (plan_day_id IS NULL)`,
  ),
]);

export const workoutStructureBlocks = pgTable("workout_structure_blocks", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  workoutLogId: varchar("workout_log_id", { length: 255 }).references(() => workoutLogs.id, { onDelete: "cascade" }),
  planDayId: varchar("plan_day_id", { length: 255 }).references(() => planDays.id, { onDelete: "cascade" }),
  sectionType: varchar("section_type", { length: 50 }).notNull(),
  formatType: varchar("format_type", { length: 50 }).notNull(),
  durationSeconds: integer("duration_seconds"),
  rounds: integer("rounds"),
  workSeconds: integer("work_seconds"),
  restSeconds: integer("rest_seconds"),
  durationMinutes: integer("duration_minutes"),
  roundCount: integer("round_count"),
  timeCapMinutes: integer("time_cap_minutes"),
  workIntervalSec: integer("work_interval_sec"),
  restIntervalSec: integer("rest_interval_sec"),
  score: jsonb("score"),
  sequenceOrder: integer("sequence_order").notNull().default(0),
  instructions: text("instructions"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  index("idx_workout_structure_blocks_workout_log_id").on(table.workoutLogId),
  index("idx_workout_structure_blocks_plan_day_id").on(table.planDayId),
  index("idx_workout_structure_blocks_workout_sort").on(table.workoutLogId, table.sortOrder),
  index("idx_workout_structure_blocks_plan_day_sort").on(table.planDayId, table.sortOrder),
  check("workout_structure_block_single_owner_check", sql`(workout_log_id IS NULL) <> (plan_day_id IS NULL)`),
  check("workout_structure_block_duration_non_negative_check", sql`duration_seconds IS NULL OR duration_seconds >= 0`),
  check("workout_structure_block_rounds_positive_check", sql`rounds IS NULL OR rounds > 0`),
  check("workout_structure_block_work_non_negative_check", sql`work_seconds IS NULL OR work_seconds >= 0`),
  check("workout_structure_block_rest_non_negative_check", sql`rest_seconds IS NULL OR rest_seconds >= 0`),
  check("workout_structure_block_duration_minutes_positive_check", sql`duration_minutes IS NULL OR duration_minutes > 0`),
  check("workout_structure_block_round_count_positive_check", sql`round_count IS NULL OR round_count > 0`),
  check("workout_structure_block_time_cap_positive_check", sql`time_cap_minutes IS NULL OR time_cap_minutes > 0`),
]);

export const exerciseLoadTags = pgTable("exercise_load_tags", {
  exerciseName: varchar("exercise_name", { length: 255 }).primaryKey(),
  posteriorChain: real("posterior_chain").notNull().default(0),
  anteriorChain: real("anterior_chain").notNull().default(0),
  unilateralStability: real("unilateral_stability").notNull().default(0),
  elasticTendon: real("elastic_tendon").notNull().default(0),
  axialLoadModifier: real("axial_load_modifier").notNull().default(1),
  tendonLoadModifier: real("tendon_load_modifier").notNull().default(1),
  eccentricRiskModifier: real("eccentric_risk_modifier").notNull().default(1),
  highIntensityRunningRisk: real("high_intensity_running_risk").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("exercise_load_tags_posterior_non_negative_check", sql`${table.posteriorChain} >= 0`),
  check("exercise_load_tags_anterior_non_negative_check", sql`${table.anteriorChain} >= 0`),
  check("exercise_load_tags_unilateral_non_negative_check", sql`${table.unilateralStability} >= 0`),
  check("exercise_load_tags_elastic_non_negative_check", sql`${table.elasticTendon} >= 0`),
  check("exercise_load_tags_axial_modifier_positive_check", sql`${table.axialLoadModifier} >= 0`),
  check("exercise_load_tags_tendon_modifier_positive_check", sql`${table.tendonLoadModifier} >= 0`),
  check("exercise_load_tags_eccentric_modifier_positive_check", sql`${table.eccentricRiskModifier} >= 0`),
  check("exercise_load_tags_running_risk_non_negative_check", sql`${table.highIntensityRunningRisk} >= 0`),
]);

export const workoutStructureSteps = pgTable("workout_structure_steps", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  blockId: varchar("block_id", { length: 255 }).notNull().references(() => workoutStructureBlocks.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  minuteIndex: integer("minute_index"),
  stepType: varchar("step_type", { length: 50 }).notNull().default("work"),
  exerciseName: varchar("exercise_name", { length: 255 }),
  category: varchar("category", { length: 255 }),
  customLabel: text("custom_label"),
  targetReps: integer("target_reps"),
  targetTime: real("target_time"),
  targetDistance: real("target_distance"),
  targetWeight: real("target_weight"),
  targets: jsonb("targets"),
  stepRole: varchar("step_role", { length: 50 }),
  intensity: jsonb("intensity"),
  loadMode: varchar("load_mode", { length: 50 }),
  unilateralMode: varchar("unilateral_mode", { length: 50 }),
  tempo: jsonb("tempo"),
  constraintTags: jsonb("constraint_tags"),
  groupId: varchar("group_id", { length: 255 }),
  groupMeta: jsonb("group_meta"),
}, (table) => [
  index("idx_workout_structure_steps_block_id").on(table.blockId),
  uniqueIndex("idx_workout_structure_steps_block_step_unique").on(table.blockId, table.stepNumber),
  uniqueIndex("idx_workout_structure_steps_block_minute_unique").on(table.blockId, table.minuteIndex),
  check("workout_structure_step_number_positive_check", sql`step_number > 0`),
  check("workout_structure_step_minute_index_positive_check", sql`minute_index IS NULL OR minute_index > 0`),
  check("workout_structure_step_type_check", sql`step_type IN ('work', 'rest', 'transition')`),
  check(
    "workout_structure_rest_step_target_restrictions_check",
    sql`step_type <> 'rest' OR (
      exercise_name IS NULL
      AND custom_label IS NULL
      AND target_reps IS NULL
      AND target_time IS NULL
      AND target_distance IS NULL
      AND target_weight IS NULL
    )`,
  ),
]);

export const structuredExerciseBackfillReviews = pgTable("structured_exercise_backfill_reviews", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  ownerType: text("owner_type").notNull(),
  ownerId: varchar("owner_id", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  reason: text("reason"),
  firstSeenAt: timestamp("first_seen_at").defaultNow(),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  check("structured_exercise_backfill_owner_type_check", sql`${table.ownerType} IN ('planDay', 'workoutLog')`),
  check("structured_exercise_backfill_status_check", sql`${table.status} IN ('needs_manual_review', 'resolved')`),
  uniqueIndex("idx_structured_exercise_backfill_owner_unique").on(table.ownerType, table.ownerId),
  index("idx_structured_exercise_backfill_status").on(table.status),
  index("idx_structured_exercise_backfill_user_id").on(table.userId),
]);

export const structuredExerciseHealthCounters = pgTable("structured_exercise_health_counters", {
  day: date("day").notNull(),
  ownerType: text("owner_type").notNull(),
  source: text("source").notNull(),
  counterName: text("counter_name").notNull(),
  value: integer("value").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.day, table.ownerType, table.source, table.counterName] }),
  check("structured_exercise_health_owner_type_check", sql`${table.ownerType} IN ('workout_log', 'plan_day')`),
  check("structured_exercise_health_source_check", sql`${table.source} IN ('manual', 'voice', 'photo', 'import')`),
  check("structured_exercise_health_counter_name_check", sql`${table.counterName} IN ('text_only_rows_detected', 'auto_hydration_attempted', 'auto_hydration_succeeded', 'auto_hydration_failed', 'manual_fix_completed', 'rejected_text_only_write', 'parse_text_attempted', 'parse_text_succeeded', 'parse_text_failed', 'parse_photo_attempted', 'parse_photo_succeeded', 'parse_photo_failed', 'structured_blocks_fallback', 'structured_blocks_accepted')`),
]);

export const structuredExerciseHealthDailyRollups = pgTable("structured_exercise_health_daily_rollups", {
  day: date("day").primaryKey(),
  totalRows: integer("total_rows").notNull().default(0),
  structuredRows: integer("structured_rows").notNull().default(0),
  legacyOnlyRows: integer("legacy_only_rows").notNull().default(0),
  failedHydrationBacklog: integer("failed_hydration_backlog").notNull().default(0),
  legacyOnlyPct: real("legacy_only_pct").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User-authored annotations on date ranges in their training timeline —
// typically injuries, illness, or travel periods that explain volume dips
// when a user looks back at their history or shares Analytics with a
// coach. Stored as inclusive [startDate, endDate] date strings so they
// can be rendered as shaded bands on Analytics charts and as a banner
// above the Timeline filters.
export const timelineAnnotations = pgTable("timeline_annotations", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  check("timeline_annotation_type_check", sql`type IN ('injury', 'illness', 'travel', 'rest')`),
  check("timeline_annotation_range_check", sql`end_date >= start_date`),
  index("idx_timeline_annotations_user_id").on(table.userId),
  index("idx_timeline_annotations_user_range").on(table.userId, table.startDate, table.endDate),
]);

// Custom exercises saved by users for AI recognition
export const customExercises = pgTable("custom_exercises", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: varchar("category", { length: 255 }).notNull().default("conditioning"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_custom_exercises_user_id").on(table.userId),
  uniqueIndex("idx_custom_exercises_user_name").on(table.userId, table.name),
]);

// Chat messages for AI Coach persistence
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
}, (table) => [
  index("idx_chat_messages_user_id").on(table.userId),
  index("idx_chat_messages_user_time").on(table.userId, table.timestamp),
]);

// Coaching reference materials for AI coach knowledge pipeline
export const coachingMaterials = pgTable("coaching_materials", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  type: varchar("type", { length: 50 }).notNull().default("principles"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_coaching_materials_user_id").on(table.userId),
]);

// Idempotency keys — cache responses for mutating requests so offline/retry
// replays (CODEBASE_AUDIT.md §2) do not double-write. Scoped per user so a
// key collision across users is impossible. Rows are pruned by cron after
// `expiresAt`.
export const idempotencyKeys = pgTable("idempotency_keys", {
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 255 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code").notNull(),
  responseBody: jsonb("response_body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.key] }),
  index("idx_idempotency_keys_expires_at").on(table.expiresAt),
]);

// Document chunks for RAG pipeline - stores embedded chunks of coaching materials
export const documentChunks = pgTable("document_chunks", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  materialId: varchar("material_id", { length: 255 }).notNull().references(() => coachingMaterials.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  embedding: vector("embedding", { dimensions: 3072 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_document_chunks_material_id").on(table.materialId),
  index("idx_document_chunks_user_id").on(table.userId),
]);

// AI usage tracking — records token consumption per user per Gemini call so
// daily spend can be capped (e.g. $2/day) and anomalies flagged.
export const aiUsageLogs = pgTable("ai_usage_logs", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  model: varchar("model", { length: 100 }).notNull(),
  feature: varchar("feature", { length: 50 }).notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estimatedCostCents: real("estimated_cost_cents").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_ai_usage_logs_user_created").on(table.userId, table.createdAt),
]);

// Push notification subscriptions — stores Web Push API subscription objects
// so the server can send push notifications to opted-in browsers/devices.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_push_subscriptions_user_id").on(table.userId),
  uniqueIndex("idx_push_subscriptions_user_endpoint").on(table.userId, table.endpoint),
]);

// Auditable consent records (GDPR Art. 7(1)/5(2), CCPA). Until now privacy-
// notice acknowledgement and Sentry opt-in lived only in the browser's
// localStorage with no server-side trail (review W4). One row per
// (userId, consentType) holds the latest decision and when it was made;
// `granted` distinguishes accept vs. reject so an opt-out is auditable too.
export const userConsents = pgTable("user_consents", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  consentType: varchar("consent_type", { length: 64 }).notNull(),
  granted: boolean("granted").notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_user_consents_user_type").on(table.userId, table.consentType),
]);

// User training-style history. Stores where a style came from (onboarding or
// settings) and when it became effective so downstream analysis can use the
// style active at a given workout/test date.
export const userTrainingStyle = pgTable("user_training_style", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  style: text("style").notNull(),
  effectiveDate: date("effective_date").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_user_training_style_user_effective").on(table.userId, table.effectiveDate),
  check("user_training_style_source_check", sql`source IN ('onboarding', 'settings', 'migration_default')`),
]);

export const mafProfile = pgTable("maf_profile", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  baseHr: integer("base_hr").notNull(),
  adjustment: integer("adjustment").notNull().default(0),
  finalHr: integer("final_hr").notNull(),
  reason: text("reason"),
  phase: text("phase"),
  strictMode: boolean("strict_mode").notNull().default(false),
  version: integer("version").notNull().default(1),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_maf_profile_user_calculated").on(table.userId, table.calculatedAt),
]);

export const mafTestResults = pgTable("maf_test_results", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  protocolType: text("protocol_type").notNull(),
  conditions: jsonb("conditions"),
  metrics: jsonb("metrics"),
  notes: text("notes"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_maf_test_results_user_created").on(table.userId, table.createdAt),
]);

export const mafWorkoutAnalysis = pgTable("maf_workout_analysis", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  workoutLogId: varchar("workout_log_id", { length: 255 }).references(() => workoutLogs.id, { onDelete: "set null" }),
  compliancePct: integer("compliance_pct"),
  classification: text("classification"),
  nextAction: text("next_action"),
  analysisDetails: jsonb("analysis_details"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_maf_workout_analysis_user_created").on(table.userId, table.createdAt),
  index("idx_maf_workout_analysis_workout_log_id").on(table.workoutLogId),
]);

// ---------------------------------------------------------------------------
// Nutrition tracking (Phase 1 — core logging). Food reference data is cached
// from USDA FoodData Central; every stored nutrition number originates from
// USDA / Open Food Facts / a user custom food — never from AI (BRD §7).
// ---------------------------------------------------------------------------

// Where a food's reference data came from. USDA is the Phase 1 source; `off`
// (Open Food Facts) and `custom` are reserved for Phase 2.
export const FOOD_SOURCES = ["usda", "off", "custom"] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

// Meal slot a log entry is filed under. pre_workout / post_workout exist so the
// Phase 3 training-integration views can bucket fuelling around sessions.
export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

// How an entry was created. Phase 1 only ever writes "manual"; the others are
// dormant columns reserved for Phase 2 (barcode) and Phase 4 (AI nl/photo).
export const FOOD_ENTRY_METHODS = ["manual", "barcode", "nl", "photo"] as const;
export type FoodEntryMethod = (typeof FOOD_ENTRY_METHODS)[number];

// Shared, NON-per-user reference cache. A USDA food is cached once (keyed by
// fdcId) and reused across every user's log. All nutrition values are stored on
// a PER-100-GRAM basis and scaled by the logged grams at read time — the column
// names say so explicitly to make a wrong-basis bug impossible to write.
export const foods = pgTable("foods", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  source: varchar("source", { length: 16 }).notNull(),
  // USDA fdcId (or OFF barcode). NULL only for user custom foods (Phase 2).
  sourceId: varchar("source_id", { length: 255 }),
  name: text("name").notNull(),
  brand: text("brand"),
  // Typical/default serving in grams, surfaced as a one-tap "1 serving" option.
  servingSizeG: real("serving_size_g"),
  caloriesPer100g: real("calories_per_100g"),
  proteinPer100g: real("protein_per_100g"),
  carbPer100g: real("carb_per_100g"),
  fatPer100g: real("fat_per_100g"),
  fiberPer100g: real("fiber_per_100g"),
  // Long tail of micronutrients (per 100g), reserved for the Phase 5 panel.
  micros: jsonb("micros").$type<Record<string, number>>(),
  // Owner of a user custom food / recipe-backing food (Phase 2). NULL = the
  // shared USDA/OFF reference cache. `set null` on user delete (NOT cascade) so
  // logged history survives — a food referenced by food_log_entries can't be
  // deleted (that FK is restrict), which would otherwise block the user delete.
  createdByUserId: varchar("created_by_user_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Upsert-on-cache key. Partial (source_id IS NOT NULL) so custom foods, which
  // have no source_id, are exempt — mirrors the Strava partial-unique above.
  uniqueIndex("uq_foods_source_source_id")
    .on(table.source, table.sourceId)
    .where(sql`${table.sourceId} IS NOT NULL`),
  // Functional index for case-insensitive prefix search (ILIKE 'q%'). pg_trgm
  // is intentionally NOT enabled; fuzzy ranking would go in its own migration.
  index("idx_foods_name_lower").on(sql`lower(${table.name})`),
  index("idx_foods_created_by_user_id").on(table.createdByUserId),
  check("foods_source_check", sql`source IN ('usda', 'off', 'custom')`),
]);
export type Food = typeof foods.$inferSelect;
export type InsertFood = typeof foods.$inferInsert;

// Named portions for a food ("1 cup", "1 medium"). Created now; the Phase 1 UI
// only uses foods.serving_size_g — multi-portion logging arrives in Phase 2.
export const foodServings = pgTable("food_servings", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  foodId: varchar("food_id", { length: 255 }).notNull().references(() => foods.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  grams: real("grams").notNull(),
}, (table) => [
  index("idx_food_servings_food_id").on(table.foodId),
  check("food_servings_grams_positive_check", sql`grams > 0`),
]);
export type FoodServing = typeof foodServings.$inferSelect;

// A single logged food. `loggedAt` is the mandatory instant and the future
// Phase 3 join key to workout_logs; `logDate` is the user's LOCAL calendar day
// (computed server-side from users.user_timezone) so daily rollups stay correct
// across midnight for offset users. Nutrition is computed by joining to `foods`
// and scaling per-100g values by quantity_g — never snapshotted, because USDA
// values are immutable per fdcId.
export const foodLogEntries = pgTable("food_log_entries", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  // restrict: a cached food can't be evicted while a log still references it,
  // so historical entries never lose their nutrition source.
  foodId: varchar("food_id", { length: 255 }).notNull().references(() => foods.id, { onDelete: "restrict" }),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
  logDate: date("log_date").notNull(),
  quantityG: real("quantity_g").notNull(),
  mealType: varchar("meal_type", { length: 16 }).notNull(),
  entryMethod: varchar("entry_method", { length: 16 }).notNull().default("manual"),
  // Reserved for Phase 2/4: original text/photo ref + AI parse confidence + a
  // low-confidence review-queue flag. Dormant in Phase 1.
  rawInput: text("raw_input"),
  parseConfidence: real("parse_confidence"),
  pendingReview: boolean("pending_review").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_food_log_entries_user_log_date").on(table.userId, table.logDate),
  index("idx_food_log_entries_user_logged_at").on(table.userId, table.loggedAt),
  index("idx_food_log_entries_food_id").on(table.foodId),
  check("food_log_entries_quantity_positive_check", sql`quantity_g > 0`),
  check("food_log_entries_meal_type_check", sql`meal_type IN ('breakfast','lunch','dinner','snack','pre_workout','post_workout')`),
  check("food_log_entries_entry_method_check", sql`entry_method IN ('manual','barcode','nl','photo')`),
]);
export type FoodLogEntry = typeof foodLogEntries.$inferSelect;

// User-defined macro/calorie targets, versioned by effective_from. Created now;
// targets CRUD/UI is Phase 5, so Phase 1 never writes to or reads this table.
export const nutritionTargets = pgTable("nutrition_targets", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  calories: real("calories"),
  proteinG: real("protein_g"),
  carbG: real("carb_g"),
  fatG: real("fat_g"),
  // Training-day-aware targets: when enabled, the effective carb (and therefore
  // calorie) target for a given date is scaled from this baseline by that date's
  // actual training load (UTSS). Protein/fat stay anchored to bodyweight. Config
  // lives on the versioned row so past dates use the then-current plan, not
  // today's. NULL/false ⇒ a flat target (back-compatible with pre-existing rows).
  periodizationEnabled: boolean("periodization_enabled").notNull().default(false),
  referenceUtss: real("reference_utss"), // UTSS at which carbG == the baseline carbG
  carbGramsPerUtss: real("carb_grams_per_utss"), // ΔcarbG per +1 UTSS vs the reference
  effectiveFrom: date("effective_from").notNull(),
}, (table) => [
  index("idx_nutrition_targets_user_effective").on(table.userId, table.effectiveFrom),
]);
export type NutritionTarget = typeof nutritionTargets.$inferSelect;

// Per-user favourites over the shared `foods` cache (FR-1.5).
export const foodFavorites = pgTable("food_favorites", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  foodId: varchar("food_id", { length: 255 }).notNull().references(() => foods.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_food_favorites_user_food").on(table.userId, table.foodId),
  index("idx_food_favorites_user_id").on(table.userId),
]);
export type FoodFavorite = typeof foodFavorites.$inferSelect;

// A recipe is a user custom food (the backing `foods` row, source='custom')
// PLUS an ingredient breakdown. Its per-100g macros are COMPUTED from the
// ingredients, so it logs and rolls up through the unchanged Phase 1 path; the
// recipe + ingredient rows let the user re-open and edit it (FR-2.3).
export const recipes = pgTable("recipes", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  // The backing custom food (source='custom', created_by_user_id=userId).
  // restrict: deleting the recipe decides the food's fate explicitly (the food
  // may be referenced by food_log_entries, which is itself restrict).
  foodId: varchar("food_id", { length: 255 }).notNull().references(() => foods.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  servings: real("servings").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_recipes_user_id").on(table.userId),
  index("idx_recipes_food_id").on(table.foodId),
  check("recipes_servings_positive_check", sql`servings > 0`),
]);
export type Recipe = typeof recipes.$inferSelect;

// One ingredient line of a recipe. foodId is restrict so an ingredient food
// (USDA / OFF / another custom) can't be deleted out from under the recipe.
export const recipeIngredients = pgTable("recipe_ingredients", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  recipeId: varchar("recipe_id", { length: 255 }).notNull().references(() => recipes.id, { onDelete: "cascade" }),
  foodId: varchar("food_id", { length: 255 }).notNull().references(() => foods.id, { onDelete: "restrict" }),
  quantityG: real("quantity_g").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_recipe_ingredients_recipe_id").on(table.recipeId),
  index("idx_recipe_ingredients_food_id").on(table.foodId),
  check("recipe_ingredients_quantity_positive_check", sql`quantity_g > 0`),
]);
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;

// ---------------------------------------------------------------------------
// Drizzle relations — enables `db.query.<table>.findMany({ with: { ... } })`
// for type-safe nested queries in the storage layer.
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many, one }) => ({
  trainingPlans: many(trainingPlans),
  workoutLogs: many(workoutLogs),
  stravaConnection: one(stravaConnections, {
    fields: [users.id],
    references: [stravaConnections.userId],
  }),
  garminConnection: one(garminConnections, {
    fields: [users.id],
    references: [garminConnections.userId],
  }),
  customExercises: many(customExercises),
  chatMessages: many(chatMessages),
  coachingMaterials: many(coachingMaterials),
  documentChunks: many(documentChunks),
  aiUsageLogs: many(aiUsageLogs),
  pushSubscriptions: many(pushSubscriptions),
  trainingStyles: many(userTrainingStyle),
  mafProfiles: many(mafProfile),
  mafTestResults: many(mafTestResults),
  mafWorkoutAnalyses: many(mafWorkoutAnalysis),
  analyticsResults: many(analyticsResults),
  foodLogEntries: many(foodLogEntries),
  foodFavorites: many(foodFavorites),
  nutritionTargets: many(nutritionTargets),
  recipes: many(recipes),
}));

export const trainingPlansRelations = relations(trainingPlans, ({ one, many }) => ({
  user: one(users, {
    fields: [trainingPlans.userId],
    references: [users.id],
  }),
  days: many(planDays),
  workoutLogs: many(workoutLogs),
}));

export const planDaysRelations = relations(planDays, ({ one, many }) => ({
  plan: one(trainingPlans, {
    fields: [planDays.planId],
    references: [trainingPlans.id],
  }),
  workoutLogs: many(workoutLogs),
  exerciseSets: many(exerciseSets),
}));

export const workoutLogsRelations = relations(workoutLogs, ({ one, many }) => ({
  user: one(users, {
    fields: [workoutLogs.userId],
    references: [users.id],
  }),
  planDay: one(planDays, {
    fields: [workoutLogs.planDayId],
    references: [planDays.id],
  }),
  plan: one(trainingPlans, {
    fields: [workoutLogs.planId],
    references: [trainingPlans.id],
  }),
  exerciseSets: many(exerciseSets),
}));

export const stravaConnectionsRelations = relations(stravaConnections, ({ one }) => ({
  user: one(users, {
    fields: [stravaConnections.userId],
    references: [users.id],
  }),
}));

export const garminConnectionsRelations = relations(garminConnections, ({ one }) => ({
  user: one(users, {
    fields: [garminConnections.userId],
    references: [users.id],
  }),
}));

export const exerciseSetsRelations = relations(exerciseSets, ({ one }) => ({
  workoutLog: one(workoutLogs, {
    fields: [exerciseSets.workoutLogId],
    references: [workoutLogs.id],
  }),
  planDay: one(planDays, {
    fields: [exerciseSets.planDayId],
    references: [planDays.id],
  }),
}));

export const customExercisesRelations = relations(customExercises, ({ one }) => ({
  user: one(users, {
    fields: [customExercises.userId],
    references: [users.id],
  }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  user: one(users, {
    fields: [chatMessages.userId],
    references: [users.id],
  }),
}));

export const coachingMaterialsRelations = relations(coachingMaterials, ({ one, many }) => ({
  user: one(users, {
    fields: [coachingMaterials.userId],
    references: [users.id],
  }),
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  material: one(coachingMaterials, {
    fields: [documentChunks.materialId],
    references: [coachingMaterials.id],
  }),
  user: one(users, {
    fields: [documentChunks.userId],
    references: [users.id],
  }),
}));

export const aiUsageLogsRelations = relations(aiUsageLogs, ({ one }) => ({
  user: one(users, {
    fields: [aiUsageLogs.userId],
    references: [users.id],
  }),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [pushSubscriptions.userId],
    references: [users.id],
  }),
}));

export const userTrainingStyleRelations = relations(userTrainingStyle, ({ one }) => ({
  user: one(users, {
    fields: [userTrainingStyle.userId],
    references: [users.id],
  }),
}));

export const mafProfileRelations = relations(mafProfile, ({ one }) => ({
  user: one(users, {
    fields: [mafProfile.userId],
    references: [users.id],
  }),
}));

export const mafTestResultsRelations = relations(mafTestResults, ({ one }) => ({
  user: one(users, {
    fields: [mafTestResults.userId],
    references: [users.id],
  }),
}));

export const mafWorkoutAnalysisRelations = relations(mafWorkoutAnalysis, ({ one }) => ({
  user: one(users, {
    fields: [mafWorkoutAnalysis.userId],
    references: [users.id],
  }),
  workoutLog: one(workoutLogs, {
    fields: [mafWorkoutAnalysis.workoutLogId],
    references: [workoutLogs.id],
  }),
}));

export const analyticsResultsRelations = relations(analyticsResults, ({ one }) => ({
  user: one(users, {
    fields: [analyticsResults.userId],
    references: [users.id],
  }),
}));

export const foodsRelations = relations(foods, ({ many }) => ({
  servings: many(foodServings),
  logEntries: many(foodLogEntries),
  favorites: many(foodFavorites),
  recipes: many(recipes),
  recipeIngredients: many(recipeIngredients),
}));

export const foodServingsRelations = relations(foodServings, ({ one }) => ({
  food: one(foods, {
    fields: [foodServings.foodId],
    references: [foods.id],
  }),
}));

export const foodLogEntriesRelations = relations(foodLogEntries, ({ one }) => ({
  user: one(users, {
    fields: [foodLogEntries.userId],
    references: [users.id],
  }),
  food: one(foods, {
    fields: [foodLogEntries.foodId],
    references: [foods.id],
  }),
}));

export const foodFavoritesRelations = relations(foodFavorites, ({ one }) => ({
  user: one(users, {
    fields: [foodFavorites.userId],
    references: [users.id],
  }),
  food: one(foods, {
    fields: [foodFavorites.foodId],
    references: [foods.id],
  }),
}));

export const nutritionTargetsRelations = relations(nutritionTargets, ({ one }) => ({
  user: one(users, {
    fields: [nutritionTargets.userId],
    references: [users.id],
  }),
}));

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  user: one(users, { fields: [recipes.userId], references: [users.id] }),
  food: one(foods, { fields: [recipes.foodId], references: [foods.id] }),
  ingredients: many(recipeIngredients),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeIngredients.recipeId], references: [recipes.id] }),
  food: one(foods, { fields: [recipeIngredients.foodId], references: [foods.id] }),
}));
