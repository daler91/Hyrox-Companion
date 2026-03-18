import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, date, timestamp, index, real, uniqueIndex, boolean, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const workoutStatusEnum = ["planned", "completed", "missed", "skipped"] as const;
export type WorkoutStatus = (typeof workoutStatusEnum)[number];

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
  emailNotifications: boolean("email_notifications").default(true),
  aiCoachEnabled: boolean("ai_coach_enabled").default(true),
  lastWeeklySummaryAt: timestamp("last_weekly_summary_at"),
  lastMissedReminderAt: timestamp("last_missed_reminder_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const updateUserPreferencesSchema = z.object({
  weightUnit: z.enum(["kg", "lbs"]).optional(),
  distanceUnit: z.enum(["km", "miles"]).optional(),
  weeklyGoal: z.number().min(1).max(14).optional(),
  emailNotifications: z.boolean().optional(),
  aiCoachEnabled: z.boolean().optional(),
});

export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;

export const trainingPlans = pgTable("training_plans", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceFileName: text("source_file_name"),
  totalWeeks: integer("total_weeks").notNull(),
  goal: text("goal"),
}, (table) => [
  index("idx_training_plans_user_id").on(table.userId),
]);

export const insertTrainingPlanSchema = createInsertSchema(trainingPlans).omit({
  id: true,
}).extend({
  goal: z.string().max(500).nullable().optional(),
});

export const updateTrainingPlanGoalSchema = z.object({
  goal: z.string().max(500).nullable(),
});

export type UpdateTrainingPlanGoal = z.infer<typeof updateTrainingPlanGoalSchema>;
export type InsertTrainingPlan = z.infer<typeof insertTrainingPlanSchema>;
export type TrainingPlan = typeof trainingPlans.$inferSelect;

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
}, (table) => [
  check("status_check", sql`status IN ('planned', 'completed', 'missed', 'skipped')`),
  index("idx_plan_days_plan_id").on(table.planId),
  index("idx_plan_days_scheduled_date").on(table.scheduledDate),
  index("idx_plan_days_status").on(table.status),
  index("idx_plan_days_plan_week").on(table.planId, table.weekNumber),
  index("idx_plan_days_plan_status").on(table.planId, table.status),
]);

export const insertPlanDaySchema = createInsertSchema(planDays).omit({
  id: true,
}).extend({
  status: z.enum(["planned", "completed", "missed", "skipped"]).default("planned"),
});

export const updatePlanDaySchema = insertPlanDaySchema.partial().omit({
  planId: true,
});

export type InsertPlanDay = z.infer<typeof insertPlanDaySchema>;
export type UpdatePlanDay = z.infer<typeof updatePlanDaySchema>;
export type PlanDay = typeof planDays.$inferSelect;

export type TrainingPlanWithDays = TrainingPlan & {
  days: PlanDay[];
};

export const workoutLogs = pgTable("workout_logs", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  focus: text("focus").notNull(),
  mainWorkout: text("main_workout").notNull(),
  accessory: text("accessory"),
  notes: text("notes"),
  duration: integer("duration"),
  rpe: integer("rpe"),
  planDayId: varchar("plan_day_id", { length: 255 }).references(() => planDays.id, { onDelete: "set null" }),
  source: varchar("source", { length: 255 }).default("manual"),
  stravaActivityId: varchar("strava_activity_id", { length: 255 }),
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
  index("idx_workout_logs_strava_activity_id").on(table.stravaActivityId),
  index("idx_workout_logs_source").on(table.source),
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

export const insertStravaConnectionSchema = createInsertSchema(stravaConnections).omit({
  id: true,
  createdAt: true,
});

export type InsertStravaConnection = z.infer<typeof insertStravaConnectionSchema>;
export type StravaConnection = typeof stravaConnections.$inferSelect;

export const insertWorkoutLogSchema = createInsertSchema(workoutLogs).omit({
  id: true,
  userId: true,
});

export const updateWorkoutLogSchema = insertWorkoutLogSchema.partial();

export type InsertWorkoutLog = z.infer<typeof insertWorkoutLogSchema>;
export type UpdateWorkoutLog = z.infer<typeof updateWorkoutLogSchema>;
export type WorkoutLog = typeof workoutLogs.$inferSelect;

export const exerciseCategoryEnum = ["hyrox_station", "running", "strength", "conditioning"] as const;
export type ExerciseCategory = (typeof exerciseCategoryEnum)[number];

export const EXERCISE_DEFINITIONS = {
  skierg: { label: "SkiErg", category: "hyrox_station" as const, fields: ["distance", "time", "weight"] as const },
  sled_push: { label: "Sled Push", category: "hyrox_station" as const, fields: ["distance", "time", "weight"] as const },
  sled_pull: { label: "Sled Pull", category: "hyrox_station" as const, fields: ["distance", "time", "weight"] as const },
  burpee_broad_jump: { label: "Burpee Broad Jump", category: "hyrox_station" as const, fields: ["distance", "time", "reps"] as const },
  rowing: { label: "Rowing", category: "hyrox_station" as const, fields: ["distance", "time"] as const },
  farmers_carry: { label: "Farmers Carry", category: "hyrox_station" as const, fields: ["distance", "time", "weight"] as const },
  sandbag_lunges: { label: "Sandbag Lunges", category: "hyrox_station" as const, fields: ["distance", "time", "weight"] as const },
  wall_balls: { label: "Wall Balls", category: "hyrox_station" as const, fields: ["reps", "time", "weight"] as const },
  easy_run: { label: "Easy Run", category: "running" as const, fields: ["distance", "time"] as const },
  tempo_run: { label: "Tempo Run", category: "running" as const, fields: ["distance", "time"] as const },
  interval_run: { label: "Intervals", category: "running" as const, fields: ["distance", "time", "sets"] as const },
  long_run: { label: "Long Run", category: "running" as const, fields: ["distance", "time"] as const },
  back_squat: { label: "Back Squat", category: "strength" as const, fields: ["sets", "reps", "weight"] as const },
  front_squat: { label: "Front Squat", category: "strength" as const, fields: ["sets", "reps", "weight"] as const },
  deadlift: { label: "Deadlift", category: "strength" as const, fields: ["sets", "reps", "weight"] as const },
  romanian_deadlift: { label: "Romanian Deadlift", category: "strength" as const, fields: ["sets", "reps", "weight"] as const },
  bench_press: { label: "Bench Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const },
  overhead_press: { label: "Overhead Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const },
  pull_up: { label: "Pull-ups", category: "strength" as const, fields: ["sets", "reps", "weight"] as const },
  bent_over_row: { label: "Bent Over Row", category: "strength" as const, fields: ["sets", "reps", "weight"] as const },
  lunges: { label: "Lunges", category: "strength" as const, fields: ["sets", "reps", "weight"] as const },
  hip_thrust: { label: "Hip Thrust", category: "strength" as const, fields: ["sets", "reps", "weight"] as const },
  burpees: { label: "Burpees", category: "conditioning" as const, fields: ["sets", "reps", "time"] as const },
  box_jumps: { label: "Box Jumps", category: "conditioning" as const, fields: ["sets", "reps", "time"] as const },
  assault_bike: { label: "Assault Bike", category: "conditioning" as const, fields: ["distance", "time"] as const },
  kettlebell_swings: { label: "KB Swings", category: "conditioning" as const, fields: ["sets", "reps", "weight"] as const },
  battle_ropes: { label: "Battle Ropes", category: "conditioning" as const, fields: ["sets", "time"] as const },
  custom: { label: "Custom", category: "conditioning" as const, fields: ["sets", "reps", "weight", "distance", "time"] as const },
} as const;

export type ExerciseName = keyof typeof EXERCISE_DEFINITIONS;
export const exerciseNames = Object.keys(EXERCISE_DEFINITIONS) as ExerciseName[];

export const exerciseSets = pgTable("exercise_sets", {
  id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
  workoutLogId: varchar("workout_log_id", { length: 255 }).notNull().references(() => workoutLogs.id, { onDelete: "cascade" }),
  exerciseName: varchar("exercise_name", { length: 255 }).notNull(),
  customLabel: text("custom_label"),
  category: varchar("category", { length: 255 }).notNull(),
  setNumber: integer("set_number").notNull().default(1),
  reps: integer("reps"),
  weight: real("weight"),
  distance: real("distance"),
  time: real("time"),
  notes: text("notes"),
  confidence: integer("confidence"),
  sortOrder: integer("sort_order").default(0),
}, (table) => [
  index("idx_exercise_sets_workout_log_id").on(table.workoutLogId),
  index("idx_exercise_sets_exercise_name").on(table.exerciseName),
  index("idx_exercise_sets_workout_sort").on(table.workoutLogId, table.sortOrder),
  index("idx_exercise_sets_workout_exercise").on(table.workoutLogId, table.exerciseName),
]);

export const insertExerciseSetSchema = createInsertSchema(exerciseSets).omit({
  id: true,
});

export type InsertExerciseSet = z.infer<typeof insertExerciseSetSchema>;
export type ExerciseSet = typeof exerciseSets.$inferSelect;

export type TimelineEntry = {
  id: string;
  date: string;
  type: "planned" | "logged";
  status: WorkoutStatus;
  focus: string;
  mainWorkout: string;
  accessory: string | null;
  notes: string | null;
  duration?: number | null;
  rpe?: number | null;
  planDayId?: string | null;
  workoutLogId?: string | null;
  weekNumber?: number;
  dayName?: string;
  planName?: string | null;
  planId?: string | null;
  source?: "manual" | "strava";
  exerciseSets?: ExerciseSet[];
  calories?: number | null;
  distanceMeters?: number | null;
  elevationGain?: number | null;
  avgHeartrate?: number | null;
  maxHeartrate?: number | null;
  avgSpeed?: number | null;
  maxSpeed?: number | null;
  avgCadence?: number | null;
  avgWatts?: number | null;
  sufferScore?: number | null;
};

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

export const insertCustomExerciseSchema = createInsertSchema(customExercises).omit({
  id: true,
  createdAt: true,
}).extend({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  category: z.string().trim().max(50, "Category must be 50 characters or less").optional(),
});

export type InsertCustomExercise = z.infer<typeof insertCustomExerciseSchema>;
export type CustomExercise = typeof customExercises.$inferSelect;

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

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  timestamp: true,
});

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Request Validation Schemas
export const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a valid date in YYYY-MM-DD format");

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1, "Message content cannot be empty").max(5000, "Message must be 5000 characters or less"),
});

export const chatRequestSchema = z.object({
  message: z.string().min(1, "Message is required").max(5000, "Message must be 5000 characters or less"),
  history: z.array(chatMessageSchema).optional().default([]).transform((h) => h.slice(-20)),
});

export const parseExercisesRequestSchema = z.object({
  text: z.string().trim().min(1, "Text is required").max(100000, "Text must be 100,000 characters or less"),
});

export const importPlanRequestSchema = z.object({
  csvContent: z.string().min(1, "CSV content is required").max(1000000, "CSV content must be 1,000,000 characters or less"),
  fileName: z.string().max(255, "File name must be 255 characters or less").optional(),
  planName: z.string().max(255, "Plan name must be 255 characters or less").optional(),
});

export const schedulePlanRequestSchema = z.object({
  startDate: dateStringSchema,
});

export const exerciseSetSchema = z.object({
  setNumber: z.number().optional().nullable(),
  reps: z.number().optional().nullable(),
  weight: z.number().optional().nullable(),
  distance: z.number().optional().nullable(),
  time: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
}).passthrough();

export const incomingExerciseSchema = z.object({
  exerciseName: z.string().min(1).max(255),
  customLabel: z.string().max(255).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  numSets: z.number().min(1).max(50).optional().nullable(),
  reps: z.number().optional().nullable(),
  weight: z.number().optional().nullable(),
  distance: z.number().optional().nullable(),
  time: z.number().optional().nullable(),
  confidence: z.number().min(0).max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
  sets: z.array(exerciseSetSchema).max(50).optional().nullable(),
}).passthrough();

export const exercisesPayloadSchema = z.array(incomingExerciseSchema).max(200);

export interface ParsedExercise {
  exerciseName: string;
  category: string;
  customLabel?: string;
  confidence?: number;
  missingFields?: string[];
  numSets?: number;
  reps?: number;
  weight?: number;
  distance?: number;
  time?: number;
  notes?: string;
  sets: Array<{
    setNumber: number;
    reps?: number;
    weight?: number;
    distance?: number;
    time?: number;
    notes?: string;
  }>;
}

export interface PersonalRecordValue {
  value: number;
  date: string;
  workoutLogId: string;
}

export interface PersonalRecord {
  category: string;
  customLabel?: string | null;
  maxWeight?: PersonalRecordValue;
  maxDistance?: PersonalRecordValue;
  bestTime?: PersonalRecordValue;
}
