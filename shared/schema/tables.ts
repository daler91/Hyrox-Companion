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
  isAutoCoaching: boolean("is_auto_coaching").default(false),
  lastWeeklySummaryAt: timestamp("last_weekly_summary_at"),
  lastMissedReminderAt: timestamp("last_missed_reminder_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const trainingPlans = pgTable("training_plans", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceFileName: text("source_file_name"),
  totalWeeks: integer("total_weeks").notNull(),
  goal: text("goal"),
  startDate: date("start_date"),
  endDate: date("end_date"),
}, (table) => [
  index("idx_training_plans_user_id").on(table.userId),
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
}, (table) => [
  check("status_check", sql`status IN ('planned', 'completed', 'missed', 'skipped')`),
  index("idx_plan_days_plan_id").on(table.planId),
  index("idx_plan_days_scheduled_date").on(table.scheduledDate),
  index("idx_plan_days_status").on(table.status),
  index("idx_plan_days_plan_week").on(table.planId, table.weekNumber),
  index("idx_plan_days_plan_status").on(table.planId, table.status),
]);

export const workoutLogs = pgTable("workout_logs", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  focus: text("focus").notNull(),
  mainWorkout: text("main_workout").notNull(),
  accessory: text("accessory"),
  notes: text("notes"),
  // Immutable snapshot of the free-text prescription at initial log create.
  // Used by completed-workout UI to show original coach intent even if the
  // mutable log text fields are later edited.
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
}, (table) => [
  index("idx_workout_logs_user_id").on(table.userId),
  index("idx_workout_logs_date").on(table.date),
  index("idx_workout_logs_user_date").on(table.userId, table.date),
  index("idx_workout_logs_plan_day_id").on(table.planDayId),
  index("idx_workout_logs_plan_id").on(table.planId),
  index("idx_workout_logs_strava_activity_id").on(table.stravaActivityId),
  index("idx_workout_logs_garmin_activity_id").on(table.garminActivityId),
  index("idx_workout_logs_source").on(table.source),
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
  encryptedEmail: text("encrypted_email").notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
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
  notes: text("notes"),
  confidence: integer("confidence"),
  sortOrder: integer("sort_order").default(0),
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
  // Exactly one owner — prescribed (planDay) xor logged (workoutLog).
  check(
    "exercise_set_single_owner_check",
    sql`(workout_log_id IS NULL) <> (plan_day_id IS NULL)`,
  ),
]);

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
