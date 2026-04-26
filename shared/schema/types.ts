import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { createSchemaFactory } from "drizzle-zod";
import { z } from "zod";

// Zod v4 does not propagate late prototype patches to already-instantiated
// schemas, so the `.openapi()` extension must run before any schema is
// created. Performing it here — the earliest module in the schema graph —
// guarantees every drizzle-zod and plain `z.object()` schema gets the method.
extendZodWithOpenApi(z);

// Bind drizzle-zod to our `z` instance so the schemas it emits share our
// ZodObject constructor, which is required for the `.openapi()` prototype
// patch above to apply.
const { createInsertSchema } = createSchemaFactory({ zodInstance: z });

import type { WorkoutStatus } from "./enums";
import {
  chatMessages,
  coachingMaterials,
  customExercises,
  documentChunks,
  exerciseSets,
  garminConnections,
  planDays,
  stravaConnections,
  timelineAnnotations,
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
  showAdherenceInsights: z.boolean().optional(),
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

/**
 * Compact audit of which inputs drove the coach's note for a plan day.
 * Persisted as `plan_days.ai_inputs_used` (jsonb) and shown on the
 * workout card so the athlete can see what the coach was weighing.
 */
export const coachNoteInputsSchema = z.object({
  rpeTrend: z.enum(["rising", "stable", "falling", "insufficient_data"]).optional(),
  fatigueFlag: z.boolean().optional(),
  planPhase: z.enum(["early", "build", "peak", "taper", "race_week"]).optional(),
  weeklyVolumeTrend: z.enum(["increasing", "stable", "decreasing"]).optional(),
  stationGaps: z.array(z.string()).optional(),
  progressionFlags: z.array(z.string()).optional(),
  ragUsed: z.boolean().optional(),
  recentWorkoutCount: z.number().int().nonnegative().optional(),
  planGoalPresent: z.boolean().optional(),
});
export type CoachNoteInputs = z.infer<typeof coachNoteInputsSchema>;

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

// Garmin connection types and schemas. The insert schema validates the
// pre-encryption inputs (raw email/password/token JSON) — encryption happens
// inside the storage layer just like Strava.
export const insertGarminConnectionSchema = createInsertSchema(garminConnections).omit({
  id: true,
  createdAt: true,
});

export type InsertGarminConnection = z.infer<typeof insertGarminConnectionSchema>;
export type GarminConnection = typeof garminConnections.$inferSelect;

// Workout log types and schemas
// Reject workout dates more than 24h in the future. A 24h grace window lets
// Strava/Garmin activities that straddle midnight in the user's timezone
// still land, while preventing users from logging genuinely future workouts
// (which otherwise skew Week-over-Week deltas and completion stats).
const workoutDateNotFuture = z
  .string()
  .refine((d) => {
    const target = new Date(`${d}T00:00:00Z`).getTime();
    if (Number.isNaN(target)) return false;
    return target <= Date.now() + 24 * 60 * 60 * 1000;
  }, { message: "Workout date cannot be in the future" });

export const insertWorkoutLogSchema = createInsertSchema(workoutLogs).omit({
  id: true,
  userId: true,
  prescribedMainWorkout: true,
  prescribedAccessory: true,
  prescribedNotes: true,
  plannedSetCount: true,
  actualSetCount: true,
  matchedSetCount: true,
  addedSetCount: true,
  removedSetCount: true,
  compliancePct: true,
}).extend({
  date: workoutDateNotFuture,
  rpe: z.number().int().min(1, "RPE must be at least 1").max(10, "RPE must be at most 10").optional().nullable(),
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
  source?: "manual" | "strava" | "garmin";
  aiSource?: "rag" | "legacy" | "review" | null;
  aiRationale?: string | null;
  aiNoteUpdatedAt?: string | Date | null;
  aiInputsUsed?: CoachNoteInputs | null;
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
  plannedSetCount?: number | null;
  actualSetCount?: number | null;
  matchedSetCount?: number | null;
  addedSetCount?: number | null;
  removedSetCount?: number | null;
  compliancePct?: number | null;
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

/**
 * Image-parse request. We transport the image as a base64 string inside the
 * JSON body (no multer / multipart) so the global body parser and CSRF
 * pipeline apply unchanged; the route caps body size at 10MB on its own
 * express.json() middleware. The base64 length cap matches that budget —
 * an accepted string can decode to ~7.5MB of image bytes, which is
 * comfortably above the ≤1.5MB payloads the client compresses to.
 */
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export const parseExercisesFromImageRequestSchema = z.object({
  mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
  imageBase64: z.string()
    .min(1, "Image is required")
    .max(10 * 1024 * 1024, "Image must be 10MB or less"),
});
export type ParseExercisesFromImageRequest = z.infer<typeof parseExercisesFromImageRequestSchema>;

export const importPlanRequestSchema = z.object({
  csvContent: z.string().min(1, "CSV content is required").max(100000, "CSV content must be 100,000 characters or less"),
  fileName: z.string().max(255, "File name must be 255 characters or less").optional(),
  planName: z.string().max(255, "Plan name must be 255 characters or less").optional(),
});

export const schedulePlanRequestSchema = z.object({
  startDate: dateStringSchema,
});

// 🛡️ Sentinel: numeric bounds on measurable fields
// (CODEBASE_REVIEW_2026-04-12.md #33). Prevents negative weights from stray
// minus signs in voice input and unreasonable distances/times that would
// break analytics aggregates downstream. exerciseSetSchema is reused for
// AI-parsed output so reps uses .min(0) (Gemini may legitimately emit a
// zero-rep "failed attempt" row); incomingExerciseSchema is user-submitted
// and uses .min(1) on reps since a zero-rep user log is meaningless.
export const exerciseSetSchema = z.object({
  setNumber: z.number().min(1).max(100).optional().nullable(),
  reps: z.number().min(0).max(10_000).optional().nullable(),
  weight: z.number().min(0).max(2_000).optional().nullable(),
  distance: z.number().min(0).max(1_000_000).optional().nullable(),
  time: z.number().min(0).max(86_400).optional().nullable(),
  plannedReps: z.number().min(0).max(10_000).optional().nullable(),
  plannedWeight: z.number().min(0).max(2_000).optional().nullable(),
  plannedDistance: z.number().min(0).max(1_000_000).optional().nullable(),
  plannedTime: z.number().min(0).max(86_400).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
}).strip();

export const incomingExerciseSchema = z.object({
  exerciseName: z.string().min(1).max(255),
  customLabel: z.string().max(255).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  numSets: z.number().min(1).max(50).optional().nullable(),
  reps: z.number().min(1).max(10_000).optional().nullable(),
  weight: z.number().min(0).max(2_000).optional().nullable(),
  distance: z.number().min(0).max(1_000_000).optional().nullable(),
  time: z.number().min(0).max(86_400).optional().nullable(),
  plannedReps: z.number().min(0).max(10_000).optional().nullable(),
  plannedWeight: z.number().min(0).max(2_000).optional().nullable(),
  plannedDistance: z.number().min(0).max(1_000_000).optional().nullable(),
  plannedTime: z.number().min(0).max(86_400).optional().nullable(),
  confidence: z.number().min(0).max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  sets: z.array(exerciseSetSchema).max(50).optional().nullable(),
}).strip();

export const exercisesPayloadSchema = z.array(incomingExerciseSchema).max(200);

// Request bodies for the set-level CRUD routes. Shared between the
// workout-log routes (server/routes/workouts.ts) and the plan-day routes
// (server/routes/plans.ts) so a single numeric-bounds contract covers
// both paths — one schema, one Sonar-visible definition.
export const patchExerciseSetBodySchema = z.object({
  exerciseName: z.string().min(1).max(255).optional(),
  customLabel: z.string().max(255).nullable().optional(),
  category: z.string().max(50).optional(),
  setNumber: z.number().int().min(1).max(100).optional(),
  reps: z.number().int().min(0).max(10_000).nullable().optional(),
  weight: z.number().min(0).max(2_000).nullable().optional(),
  distance: z.number().min(0).max(1_000_000).nullable().optional(),
  time: z.number().min(0).max(86_400).nullable().optional(),
  plannedReps: z.number().int().min(0).max(10_000).nullable().optional(),
  plannedWeight: z.number().min(0).max(2_000).nullable().optional(),
  plannedDistance: z.number().min(0).max(1_000_000).nullable().optional(),
  plannedTime: z.number().min(0).max(86_400).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().nullable().optional(),
});
export type PatchExerciseSetBody = z.infer<typeof patchExerciseSetBodySchema>;

export const addExerciseSetBodySchema = z.object({
  exerciseName: z.string().min(1).max(255),
  customLabel: z.string().max(255).nullable().optional(),
  category: z.string().max(50),
  setNumber: z.number().int().min(1).max(100).default(1),
  reps: z.number().int().min(0).max(10_000).nullable().optional(),
  weight: z.number().min(0).max(2_000).nullable().optional(),
  distance: z.number().min(0).max(1_000_000).nullable().optional(),
  time: z.number().min(0).max(86_400).nullable().optional(),
  plannedReps: z.number().int().min(0).max(10_000).nullable().optional(),
  plannedWeight: z.number().min(0).max(2_000).nullable().optional(),
  plannedDistance: z.number().min(0).max(1_000_000).nullable().optional(),
  plannedTime: z.number().min(0).max(86_400).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
});
export type AddExerciseSetBody = z.infer<typeof addExerciseSetBodySchema>;

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
  plannedReps?: number;
  plannedWeight?: number;
  plannedDistance?: number;
  plannedTime?: number;
  notes?: string;
  sets: Array<{
    setNumber: number;
    reps?: number;
    weight?: number;
    distance?: number;
    time?: number;
    plannedReps?: number;
    plannedWeight?: number;
    plannedDistance?: number;
    plannedTime?: number;
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
  estimated1RM?: PersonalRecordValue;
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

/**
 * Compact aggregate stats that the Analytics Overview tab surfaces as four
 * delta-indicator cards. Computed for both the currently-visible date range
 * and the equal-length window immediately before it, so the client can
 * render "↑ X% vs previous period" without a second round-trip.
 */
export interface OverviewStats {
  /** Total number of logged workouts in the period. */
  totalWorkouts: number;
  /** Average workouts per calendar week across the period (one decimal). */
  avgPerWeek: number;
  /** Sum of all workout durations (minutes). */
  totalDuration: number;
  /**
   * Average duration per workout (minutes, rounded). Zero when there were
   * no durations recorded.
   */
  avgDuration: number;
  /** Mean of the per-week avgRpe values that had at least one RPE entry. */
  avgRpe: number | null;
  /** Mean adherence % across workouts that have compliance snapshots. */
  avgCompliancePct: number | null;
}

export interface TrainingOverview {
  weeklySummaries: WeeklySummary[];
  workoutDates: string[];
  categoryTotals: Record<string, { count: number; totalSets: number }>;
  stationCoverage: Array<{ station: string; lastTrained: string | null; daysSince: number | null }>;
  /** Current-period aggregate stats used for delta comparisons. */
  currentStats: OverviewStats;
  /**
   * Aggregate stats for the equal-length window immediately before the
   * current period. Omitted when the user picked "All time" (no prior
   * window exists) or when the query didn't include a lower bound.
   */
  previousStats?: OverviewStats;
}

// Timeline annotations — user-authored date ranges (injury, illness, etc.)
// that explain volume dips in the training history.
export type TimelineAnnotationType = "injury" | "illness" | "travel" | "rest";
export const TIMELINE_ANNOTATION_TYPES: readonly TimelineAnnotationType[] = [
  "injury",
  "illness",
  "travel",
  "rest",
];

export type TimelineAnnotation = typeof timelineAnnotations.$inferSelect;

export const insertTimelineAnnotationSchema = createInsertSchema(timelineAnnotations)
  .omit({ id: true, userId: true, createdAt: true, updatedAt: true })
  .extend({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
    type: z.enum(["injury", "illness", "travel", "rest"]),
    note: z.string().max(500, "Note must be 500 characters or less").nullable().optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export type InsertTimelineAnnotation = z.infer<typeof insertTimelineAnnotationSchema>;

// Partial update schema — users can change any subset of the editable
// fields. The same date ordering constraint is enforced when both dates
// are present.
export const updateTimelineAnnotationSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    type: z.enum(["injury", "illness", "travel", "rest"]).optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine(
    (data) => !(data.startDate && data.endDate) || data.endDate >= data.startDate,
    { message: "endDate must be on or after startDate", path: ["endDate"] },
  );

export type UpdateTimelineAnnotation = z.infer<typeof updateTimelineAnnotationSchema>;
