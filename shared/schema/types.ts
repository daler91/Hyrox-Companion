import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import type { WorkoutStatus } from "./enums";
import {
  chatMessages,
  coachingMaterials,
  customExercises,
  documentChunks,
  exerciseSets,
  planDays,
  stravaConnections,
  trainingPlans,
  users,
  workoutLogs,
} from "./tables";

// User types and schemas
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const updateUserPreferencesSchema = z.object({
  weightUnit: z.enum(["kg", "lbs"]).optional(),
  distanceUnit: z.enum(["km", "miles"]).optional(),
  weeklyGoal: z.number().min(1).max(14).optional(),
  // Master toggle — when false, no email is ever sent regardless of
  // the per-type flags below. Kept for backward compatibility with
  // older clients that only know about this field.
  emailNotifications: z.boolean().optional(),
  // Per-type toggles. Take effect only when the master toggle is on.
  // Default behavior (both true) preserves pre-migration behavior for
  // existing users.
  emailWeeklySummary: z.boolean().optional(),
  emailMissedReminder: z.boolean().optional(),
  aiCoachEnabled: z.boolean().optional(),
});

export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;

// Training plan types and schemas
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

// Plan day types and schemas
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

// Strava connection types and schemas
export const insertStravaConnectionSchema = createInsertSchema(stravaConnections).omit({
  id: true,
  createdAt: true,
});

export type InsertStravaConnection = z.infer<typeof insertStravaConnectionSchema>;
export type StravaConnection = typeof stravaConnections.$inferSelect;

// Workout log types and schemas
export const insertWorkoutLogSchema = createInsertSchema(workoutLogs).omit({
  id: true,
  userId: true,
});

export const updateWorkoutLogSchema = insertWorkoutLogSchema.partial();

export type InsertWorkoutLog = z.infer<typeof insertWorkoutLogSchema>;
export type UpdateWorkoutLog = z.infer<typeof updateWorkoutLogSchema>;
export type WorkoutLog = typeof workoutLogs.$inferSelect;

// Exercise set types and schemas
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
  aiSource?: "rag" | "legacy" | null;
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

// Custom exercise types and schemas
export const insertCustomExerciseSchema = createInsertSchema(customExercises).omit({
  id: true,
  createdAt: true,
}).extend({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  category: z.string().trim().max(50, "Category must be 50 characters or less").optional(),
});

export type InsertCustomExercise = z.infer<typeof insertCustomExerciseSchema>;
export type CustomExercise = typeof customExercises.$inferSelect;

// Chat message types and schemas
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  timestamp: true,
});

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Request Validation Schemas
export const dateStringSchema = z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a valid date in YYYY-MM-DD format");

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1, "Message content cannot be empty").max(50000, "Message must be 50000 characters or less"),
});

export const chatRequestSchema = z.object({
  message: z.string().min(1, "Message is required").max(1000, "Message must be 1000 characters or less"),
  history: z.array(chatMessageSchema).optional().default([]).transform((h) => h.slice(-20)),
});

export const parseExercisesRequestSchema = z.object({
  text: z.string().trim()
    .min(1, "Text is required")
    .max(2000, "Text must be 2000 characters or less"),
});

export const importPlanRequestSchema = z.object({
  csvContent: z.string().min(1, "CSV content is required").max(100000, "CSV content must be 100,000 characters or less"),
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
  notes: z.string().max(1000).optional().nullable(),
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
  notes: z.string().max(1000).optional().nullable(),
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

// Coaching material types and schemas
export const insertCoachingMaterialSchema = createInsertSchema(coachingMaterials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  title: z.string().trim().min(1, "Title is required").max(255, "Title must be 255 characters or less"),
  content: z.string().trim().min(1, "Content is required").max(1500000, "Content must be 1,500,000 characters or less"),
  type: z.enum(["principles", "document"]),
});

export type InsertCoachingMaterial = z.infer<typeof insertCoachingMaterialSchema>;
export type CoachingMaterial = typeof coachingMaterials.$inferSelect;

// Document chunk types
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type InsertDocumentChunk = typeof documentChunks.$inferInsert;

// AI Plan Generation
export const generatePlanInputSchema = z.object({
  goal: z.string().min(1, "Goal is required").max(500, "Goal must be 500 characters or less"),
  totalWeeks: z.number().min(1).max(24).default(8),
  daysPerWeek: z.number().min(2).max(7).default(5),
  experienceLevel: z.enum(["beginner", "intermediate", "advanced"]),
  raceDate: dateStringSchema.optional(),
  startDate: dateStringSchema.optional(),
  restDays: z.array(
    z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
  ).optional(),
  focusAreas: z.array(z.string().max(100)).max(10).optional(),
  injuries: z.string().max(500).optional(),
});

export type GeneratePlanInput = z.infer<typeof generatePlanInputSchema>;

// AI coaching types (shared between client and server)
export interface RagInfo {
  source: "rag" | "legacy" | "none";
  chunkCount: number;
  chunks?: string[];
  materialCount?: number;
  fallbackReason?: string;
}

export interface WorkoutSuggestion {
  workoutId: string;
  workoutDate: string;
  workoutFocus: string;
  targetField: "mainWorkout" | "accessory" | "notes";
  action: "replace" | "append";
  recommendation: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}

// Analytics — Training Overview types
export interface WeeklySummary {
  weekStart: string; // YYYY-MM-DD (Monday)
  workoutCount: number;
  totalDuration: number; // minutes
  avgRpe: number | null;
  categoryBreakdown: Record<string, number>;
}

export interface TrainingOverview {
  weeklySummaries: WeeklySummary[];
  workoutDates: string[];
  categoryTotals: Record<string, { count: number; totalSets: number }>;
  stationCoverage: Array<{ station: string; lastTrained: string | null; daysSince: number | null }>;
}
